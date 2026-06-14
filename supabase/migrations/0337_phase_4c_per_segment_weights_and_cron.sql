-- 0337 — Phase 4c: 매장별/시간대별 가중치 분리 + pg_cron 주간 회귀 자동 실행 (X6.70)
--
-- 배경:
--   X6.69 (Phase 4b) 의 회귀 RPC 는 global 가중치만 처리. 매장 유형(카페/병원/...) 별,
--   시간대(morning/lunch/afternoon/evening/late) 별로 청취 패턴이 다르므로 가중치도 분리 필요.
--   주 1회 자동 회귀 → 운영팀이 매주 월요일 큐에서 검토 후 승인.
--
-- 변경:
--   1) pg_cron 확장 활성화
--   2) ai_scoring_config_overrides 테이블 — (store_type, daypart) 별 가중치 저장
--      NULL = "전체" (segment 미지정). NULLS NOT DISTINCT 로 unique 강제.
--   3) _ai_resolve_weights(store_type, daypart) — 가장 구체적인 매칭 반환
--      우선순위: (store, daypart) > (store, NULL) > (NULL, daypart) > base config
--   4) _ai_compute_fit 수정 — base config 대신 resolver 사용 (가중치만, threshold/cutoff 는 base 유지)
--   5) admin_compute_regression_weights(window_days, store_type, daypart) — 세그먼트 회귀
--      eligible CTE 에서 playlists.business_category / daypart 로 필터
--      suggestion 에 store_type/daypart 메타 포함
--   6) admin_decide_weight_regression — segment 명시 시 overrides 에 upsert (base config 보호)
--   7) cron_compute_regression_weights() — service-callable (admin auth bypass)
--      ai_weight_regression_runs 로그 테이블 → cron 실행 기록 audit
--   8) pg_cron 스케줄 — 매주 월요일 04:00 UTC = 13:00 KST (global + 매장별 segment)

-- =============================================================================
-- 1. pg_cron 활성화
-- =============================================================================
create extension if not exists pg_cron;


-- =============================================================================
-- 2. ai_scoring_config_overrides 테이블
-- =============================================================================
create table if not exists public.ai_scoring_config_overrides (
  id uuid primary key default gen_random_uuid(),
  store_type text,                           -- NULL = 모든 매장
  daypart text check (daypart is null or daypart in ('morning','lunch','afternoon','evening','late')),
  fit_audio_w numeric not null,
  fit_meta_w numeric not null,
  fit_behavior_w numeric not null,
  fit_penalty_w numeric not null,
  source text not null default 'manual',     -- 'manual' | 'regression:<id>' | 'cron'
  source_suggestion_id uuid references public.ai_weight_regression_suggestions(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null,
  constraint ai_scoring_overrides_unique_segment
    unique nulls not distinct (store_type, daypart)
);

create index if not exists ai_scoring_overrides_seg_idx
  on public.ai_scoring_config_overrides (store_type, daypart);

alter table public.ai_scoring_config_overrides enable row level security;
drop policy if exists ai_overrides_admin_read on public.ai_scoring_config_overrides;
create policy ai_overrides_admin_read on public.ai_scoring_config_overrides for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));


-- =============================================================================
-- 3. _ai_resolve_weights(store_type, daypart)
--    가장 구체적인 매칭 반환. 우선순위:
--      (store, daypart) > (store, NULL) > (NULL, daypart) > base config (id=1)
-- =============================================================================
create or replace function public._ai_resolve_weights(
  p_store_type text,
  p_daypart text
)
returns table(
  fit_audio_w numeric,
  fit_meta_w numeric,
  fit_behavior_w numeric,
  fit_penalty_w numeric,
  source text,
  override_id uuid
) language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_best record;
  v_base record;
begin
  select o.* into v_best from public.ai_scoring_config_overrides o
   where (o.store_type is not distinct from p_store_type or o.store_type is null)
     and (o.daypart is not distinct from p_daypart or o.daypart is null)
   order by
     (case when o.store_type is not distinct from p_store_type and o.store_type is not null then 2 else 0 end
      + case when o.daypart is not distinct from p_daypart and o.daypart is not null then 1 else 0 end) desc
   limit 1;

  select * into v_base from public.ai_scoring_config where id=1;

  if v_best.id is not null then
    return query select v_best.fit_audio_w, v_best.fit_meta_w, v_best.fit_behavior_w, v_best.fit_penalty_w,
                        v_best.source, v_best.id;
  else
    return query select v_base.fit_audio_w, v_base.fit_meta_w, v_base.fit_behavior_w, v_base.fit_penalty_w,
                        'base'::text, null::uuid;
  end if;
end; $$;

grant execute on function public._ai_resolve_weights(text, text) to authenticated, service_role;


-- =============================================================================
-- 4. _ai_compute_fit 수정 — resolver 사용 (가중치만, 나머지 base 유지)
--    기존 함수의 body 를 그대로 두되 cfg 의 fit_*_w 4개 필드만 resolver 결과로 덮어씀.
-- =============================================================================
create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pl record; ai record; t record; cfg record; gr jsonb; pred record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric;
  v_manual numeric; v_fit numeric;
  v_status text; v_reason text; v_excluded boolean := false; v_gpen numeric := 0;
  v_normalized_slug text;
  v_ai_genre int := 0; v_ai_mood int := 0; v_ai_store int := 0; v_ai_boost int := 0;
  v_mood_overlap int := 0;
  v_reason_codes text[] := '{}';
  v_w record;   -- X6.70 — segment-resolved weights
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := coalesce(nullif(btrim(pl.ai_store_key),''),
                    public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));

  -- X6.70 — segment 별 가중치 해석 (store_type + daypart 매칭)
  v_normalized_slug := public.normalize_store_label(pl.business_category);
  select * into v_w from public._ai_resolve_weights(v_normalized_slug, pl.daypart);

  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then
    v_audio := (ai.ai_store_fit->>v_key)::numeric; else v_audio := 50; end if;
  v_meta := 50 + public._ai_overlap(pl.genre_tags, t.genre_tags)*8
              + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));
  v_behav := public._ai_behavior_score(p_playlist_id, p_track_id);
  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id
           and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));
  -- X6.70 — segment 가중치 사용 (v_w.* — base 또는 override)
  v_manual := least(100, greatest(0, v_audio*v_w.fit_audio_w + v_meta*v_w.fit_meta_w
                                    + v_behav*v_w.fit_behavior_w - v_pen*v_w.fit_penalty_w));

  -- ===== X2.2 AI boost (변경 없음) =====
  select * into pred from public.track_ai_predictions
    where track_id=p_track_id and model_version='taxonomy-v1';

  if pred.predicted_main_genre is not null
     and exists(select 1 from unnest(pl.genre_tags) g where lower(g)=lower(pred.predicted_main_genre)) then
    v_ai_genre := 5;
    v_reason_codes := array_append(v_reason_codes, 'ai_genre_match');
  end if;

  if pred.predicted_moods is not null then
    select count(*) into v_mood_overlap from unnest(pred.predicted_moods) pm
    join public.taxonomy_moods tm on tm.slug=pm
    where tm.name_ko = any(coalesce(pl.mood_tags,'{}'::text[]));
    v_ai_mood := least(v_mood_overlap*3, 9);
    if v_mood_overlap > 0 then
      v_reason_codes := array_append(v_reason_codes, 'ai_mood_overlap_' || v_mood_overlap::text);
    end if;
  end if;

  if pred.predicted_store_types is not null and v_normalized_slug is not null then
    if array_length(pred.predicted_store_types, 1) >= 1
       and pred.predicted_store_types[1] = v_normalized_slug then
      v_ai_store := v_ai_store + 20;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top1_match');
    elsif array_length(pred.predicted_store_types, 1) >= 2
          and pred.predicted_store_types[2] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top2_match');
    elsif array_length(pred.predicted_store_types, 1) >= 3
          and pred.predicted_store_types[3] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := array_append(v_reason_codes, 'ai_store_top3_match');
    end if;

    if pred.prediction_scores ? 'store_type'
       and (pred.prediction_scores->'store_type' ? v_normalized_slug) then
      v_ai_store := v_ai_store + least(10, round(
        (pred.prediction_scores->'store_type'->>v_normalized_slug)::numeric * 30
      )::int);
      v_reason_codes := array_append(v_reason_codes, 'ai_store_prob_boost');
    end if;
  end if;

  v_ai_boost := v_ai_genre + v_ai_mood + v_ai_store;
  v_fit := least(100, greatest(0, v_manual + v_ai_boost));

  -- Hard Guardrails
  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'excluded')::boolean then
      v_excluded := true;
      v_gpen := coalesce((gr->>'penalty')::numeric, 0);
      v_fit := greatest(0, v_fit - v_gpen);
      v_reason_codes := array_append(v_reason_codes, 'guardrail_excluded');
    end if;
  end if;

  v_status := case when v_excluded then 'excluded' when v_fit >= cfg.fit_recommend_cutoff then 'recommend'
                   when v_fit < cfg.fit_exclude_cutoff then 'low' else 'neutral' end;
  v_reason := 'audio=' || round(v_audio,1) || ' meta=' || round(v_meta,1)
            || ' behav=' || round(v_behav,1) || ' pen=' || round(v_pen,1)
            || ' boost=' || v_ai_boost || ' final=' || round(v_fit,1)
            || ' [w:' || v_w.source || ']';

  insert into public.playlist_track_fit_scores(
    playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
    manual_score, ai_genre_score, ai_mood_score, ai_store_score, ai_boost_total,
    normalized_store_slug, reason_codes, reason, source, status, updated_at, final_fit_score
  ) values (
    p_playlist_id, p_track_id, v_fit, v_audio, v_meta, v_behav, v_pen,
    v_manual, v_ai_genre, v_ai_mood, v_ai_store, v_ai_boost,
    v_normalized_slug, v_reason_codes, v_reason, 'ai_v2.2', v_status, now(), v_fit
  )
  on conflict (playlist_id, track_id) do update set
    fit_score = excluded.fit_score, audio_score = excluded.audio_score,
    metadata_score = excluded.metadata_score, behavior_score = excluded.behavior_score,
    penalty_score = excluded.penalty_score, manual_score = excluded.manual_score,
    ai_genre_score = excluded.ai_genre_score, ai_mood_score = excluded.ai_mood_score,
    ai_store_score = excluded.ai_store_score, ai_boost_total = excluded.ai_boost_total,
    normalized_store_slug = excluded.normalized_store_slug, reason_codes = excluded.reason_codes,
    reason = excluded.reason, source = excluded.source, status = excluded.status,
    updated_at = now(), final_fit_score = excluded.final_fit_score;
end; $$;


-- =============================================================================
-- 5. admin_compute_regression_weights — segment 인자 추가
--    (signature 변경 → drop + 재생성)
-- =============================================================================
drop function if exists public.admin_compute_regression_weights(int);

create or replace function public.admin_compute_regression_weights(
  p_window_days int default 30,
  p_store_type text default null,
  p_daypart text default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_min_play_count int := 5;
  v_min_sample int := 50;
  v_min_sum_r2 numeric := 0.05;
  v_n int;
  v_audio_slope numeric; v_audio_r2 numeric;
  v_meta_slope numeric;  v_meta_r2 numeric;
  v_behavior_slope numeric; v_behavior_r2 numeric;
  v_penalty_slope numeric; v_penalty_r2 numeric;
  v_sum_r2 numeric;
  v_w_audio numeric; v_w_meta numeric; v_w_behavior numeric; v_w_penalty numeric;
  v_id uuid;
  v_suggestion jsonb;
  v_regression jsonb;
  v_segment jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
     and current_user <> 'postgres' then
    raise exception 'admin only';
  end if;

  v_segment := jsonb_build_object(
    'store_type', p_store_type,
    'daypart', p_daypart
  );

  with eligible as (
    select fs.audio_score, fs.metadata_score, fs.behavior_score, fs.penalty_score,
           b.completion_rate, b.play_count
    from public.playlist_track_fit_scores fs
    join public.track_behavior_scores b
      on b.track_id = fs.track_id and b.window_days = 30
    join public.playlists p on p.id = fs.playlist_id
    where fs.status='active' and b.play_count >= v_min_play_count
      and (p_store_type is null
           or public.normalize_store_label(p.business_category) = p_store_type)
      and (p_daypart is null or p.daypart = p_daypart)
  )
  select
    count(*),
    regr_slope(completion_rate, audio_score),    coalesce(regr_r2(completion_rate, audio_score), 0),
    regr_slope(completion_rate, metadata_score), coalesce(regr_r2(completion_rate, metadata_score), 0),
    regr_slope(completion_rate, behavior_score), coalesce(regr_r2(completion_rate, behavior_score), 0),
    regr_slope(completion_rate, penalty_score),  coalesce(regr_r2(completion_rate, penalty_score), 0)
  into v_n,
       v_audio_slope, v_audio_r2,
       v_meta_slope, v_meta_r2,
       v_behavior_slope, v_behavior_r2,
       v_penalty_slope, v_penalty_r2
  from eligible;

  v_regression := jsonb_build_object(
    'audio',    jsonb_build_object('slope', round(coalesce(v_audio_slope,0)::numeric, 5),    'r2', round(v_audio_r2::numeric, 4)),
    'meta',     jsonb_build_object('slope', round(coalesce(v_meta_slope,0)::numeric, 5),     'r2', round(v_meta_r2::numeric, 4)),
    'behavior', jsonb_build_object('slope', round(coalesce(v_behavior_slope,0)::numeric, 5), 'r2', round(v_behavior_r2::numeric, 4)),
    'penalty',  jsonb_build_object('slope', round(coalesce(v_penalty_slope,0)::numeric, 5),  'r2', round(v_penalty_r2::numeric, 4)),
    'n', v_n,
    'window_days', p_window_days,
    'min_play_count', v_min_play_count,
    'segment', v_segment
  );

  if v_n < v_min_sample then
    return jsonb_build_object(
      'ok', true, 'queued', false,
      'reason', 'insufficient_sample',
      'sample_size', v_n, 'min_required', v_min_sample,
      'regression', v_regression, 'segment', v_segment
    );
  end if;

  v_sum_r2 := v_audio_r2 + v_meta_r2 + v_behavior_r2 + v_penalty_r2;
  if v_sum_r2 < v_min_sum_r2 then
    return jsonb_build_object(
      'ok', true, 'queued', false,
      'reason', 'no_explanatory_power',
      'sum_r2', round(v_sum_r2::numeric, 4), 'min_required', v_min_sum_r2,
      'regression', v_regression, 'segment', v_segment
    );
  end if;

  v_w_audio := round((v_audio_r2 / v_sum_r2)::numeric, 3);
  v_w_meta := round((v_meta_r2 / v_sum_r2)::numeric, 3);
  v_w_behavior := round((v_behavior_r2 / v_sum_r2)::numeric, 3);
  v_w_penalty := round((v_penalty_r2 / v_sum_r2)::numeric, 3);

  v_suggestion := jsonb_build_object(
    'fit_audio_w', v_w_audio,
    'fit_meta_w', v_w_meta,
    'fit_behavior_w', v_w_behavior,
    'fit_penalty_w', v_w_penalty,
    'store_type', p_store_type,
    'daypart', p_daypart
  );

  -- 동일 segment 의 기존 pending → superseded
  update public.ai_weight_regression_suggestions
     set status='superseded', reviewed_at=now()
   where status='pending'
     and (suggestion->>'store_type') is not distinct from p_store_type
     and (suggestion->>'daypart')    is not distinct from p_daypart;

  insert into public.ai_weight_regression_suggestions (suggestion, regression, sample_size, status)
  values (v_suggestion, v_regression, v_n, 'pending')
  returning id into v_id;

  return jsonb_build_object(
    'ok', true, 'queued', true,
    'suggestion_id', v_id,
    'suggestion', v_suggestion,
    'regression', v_regression,
    'sample_size', v_n,
    'segment', v_segment
  );
end; $$;

revoke execute on function public.admin_compute_regression_weights(int, text, text) from public, anon;
grant execute on function public.admin_compute_regression_weights(int, text, text) to authenticated, service_role;


-- =============================================================================
-- 6. admin_decide_weight_regression — segment 명시 시 overrides 에 upsert
-- =============================================================================
create or replace function public.admin_decide_weight_regression(
  p_id uuid,
  p_approve boolean,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_sug record;
  v_new_config jsonb;
  v_store_type text;
  v_daypart text;
  v_target text;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;

  select * into v_sug from public.ai_weight_regression_suggestions where id = p_id for update;
  if v_sug.id is null then raise exception 'suggestion not found'; end if;
  if v_sug.status <> 'pending' then
    raise exception 'suggestion is not pending (current status: %)', v_sug.status;
  end if;

  v_store_type := nullif(v_sug.suggestion->>'store_type', '');
  v_daypart    := nullif(v_sug.suggestion->>'daypart', '');

  if p_approve then
    if v_store_type is null and v_daypart is null then
      -- 글로벌 → base config 업데이트 (trigger 로 history 자동)
      update public.ai_scoring_config set
        fit_audio_w    = (v_sug.suggestion->>'fit_audio_w')::numeric,
        fit_meta_w     = (v_sug.suggestion->>'fit_meta_w')::numeric,
        fit_behavior_w = (v_sug.suggestion->>'fit_behavior_w')::numeric,
        fit_penalty_w  = (v_sug.suggestion->>'fit_penalty_w')::numeric,
        updated_at = now(), updated_by = v_uid
      where id=1;
      v_target := 'base_config';
      update public.ai_scoring_config_history
         set reason = 'applied_suggestion:' || p_id::text
       where id = (select id from public.ai_scoring_config_history order by changed_at desc limit 1)
         and reason is null;
    else
      -- segment → overrides 에 upsert (base config 보호)
      insert into public.ai_scoring_config_overrides
        (store_type, daypart, fit_audio_w, fit_meta_w, fit_behavior_w, fit_penalty_w,
         source, source_suggestion_id, updated_by, updated_at)
      values (
        v_store_type, v_daypart,
        (v_sug.suggestion->>'fit_audio_w')::numeric,
        (v_sug.suggestion->>'fit_meta_w')::numeric,
        (v_sug.suggestion->>'fit_behavior_w')::numeric,
        (v_sug.suggestion->>'fit_penalty_w')::numeric,
        'regression:' || p_id::text, p_id, v_uid, now()
      )
      on conflict (store_type, daypart) do update set
        fit_audio_w    = excluded.fit_audio_w,
        fit_meta_w     = excluded.fit_meta_w,
        fit_behavior_w = excluded.fit_behavior_w,
        fit_penalty_w  = excluded.fit_penalty_w,
        source = excluded.source,
        source_suggestion_id = excluded.source_suggestion_id,
        updated_by = excluded.updated_by,
        updated_at = now();
      v_target := 'override:' || coalesce(v_store_type,'*') || '/' || coalesce(v_daypart,'*');
    end if;

    select to_jsonb(c) into v_new_config from public.ai_scoring_config c where id=1;
    update public.ai_weight_regression_suggestions
       set status='approved', reviewed_by=v_uid, reviewed_at=now(), review_note=p_note,
           applied_at=now(), applied_config_snapshot=v_new_config
     where id=p_id;
  else
    update public.ai_weight_regression_suggestions
       set status='rejected', reviewed_by=v_uid, reviewed_at=now(), review_note=p_note
     where id=p_id;
    v_target := 'none';
  end if;

  return jsonb_build_object('ok', true, 'approved', p_approve, 'id', p_id, 'target', v_target);
end; $$;


-- =============================================================================
-- 7. cron_compute_regression_weights — service-callable (pg_cron 용)
--    admin auth 우회. global + 매장별 segment 일괄 회귀.
-- =============================================================================
create table if not exists public.ai_weight_regression_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  triggered_by text not null default 'cron',  -- 'cron' | 'manual'
  result jsonb,
  error text
);

create index if not exists ai_weight_runs_started_idx
  on public.ai_weight_regression_runs (started_at desc);


create or replace function public.cron_compute_regression_weights()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_run_id uuid;
  v_segments record;
  v_segment_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_summary jsonb;
  v_total_queued int := 0;
  v_total_skipped int := 0;
begin
  insert into public.ai_weight_regression_runs (triggered_by) values ('cron') returning id into v_run_id;

  -- A) 글로벌
  v_one := public._cron_run_regression_internal(null, null);
  v_segment_results := v_segment_results || v_one;
  if (v_one->>'queued')::boolean then v_total_queued := v_total_queued + 1; else v_total_skipped := v_total_skipped + 1; end if;

  -- B) 매장별 (5개 매장 × null daypart) — segment 별 표본 부족 시 자동 skip
  for v_segments in
    select distinct public.normalize_store_label(business_category) as store_type
    from public.playlists
    where business_category is not null
      and public.normalize_store_label(business_category) is not null
  loop
    v_one := public._cron_run_regression_internal(v_segments.store_type, null);
    v_segment_results := v_segment_results || jsonb_build_array(v_one);
    if (v_one->>'queued')::boolean then v_total_queued := v_total_queued + 1; else v_total_skipped := v_total_skipped + 1; end if;
  end loop;

  v_summary := jsonb_build_object(
    'ok', true,
    'total_segments', jsonb_array_length(v_segment_results),
    'queued', v_total_queued,
    'skipped', v_total_skipped,
    'segments', v_segment_results
  );

  update public.ai_weight_regression_runs
     set finished_at = now(), result = v_summary
   where id = v_run_id;

  return v_summary;
exception when others then
  update public.ai_weight_regression_runs
     set finished_at = now(), error = SQLERRM
   where id = v_run_id;
  raise;
end; $$;

revoke execute on function public.cron_compute_regression_weights() from public, anon;
grant execute on function public.cron_compute_regression_weights() to service_role;


-- 내부 헬퍼 — admin_compute_regression_weights 의 admin 체크 bypass 버전
create or replace function public._cron_run_regression_internal(
  p_store_type text,
  p_daypart text
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_min_play_count int := 5;
  v_min_sample int := 50;
  v_min_sum_r2 numeric := 0.05;
  v_n int;
  v_audio_slope numeric; v_audio_r2 numeric;
  v_meta_slope numeric;  v_meta_r2 numeric;
  v_behavior_slope numeric; v_behavior_r2 numeric;
  v_penalty_slope numeric; v_penalty_r2 numeric;
  v_sum_r2 numeric;
  v_w_audio numeric; v_w_meta numeric; v_w_behavior numeric; v_w_penalty numeric;
  v_id uuid;
  v_suggestion jsonb;
  v_regression jsonb;
  v_segment jsonb;
begin
  v_segment := jsonb_build_object('store_type', p_store_type, 'daypart', p_daypart);

  with eligible as (
    select fs.audio_score, fs.metadata_score, fs.behavior_score, fs.penalty_score,
           b.completion_rate, b.play_count
    from public.playlist_track_fit_scores fs
    join public.track_behavior_scores b
      on b.track_id = fs.track_id and b.window_days = 30
    join public.playlists p on p.id = fs.playlist_id
    where fs.status='active' and b.play_count >= v_min_play_count
      and (p_store_type is null
           or public.normalize_store_label(p.business_category) = p_store_type)
      and (p_daypart is null or p.daypart = p_daypart)
  )
  select
    count(*),
    regr_slope(completion_rate, audio_score),    coalesce(regr_r2(completion_rate, audio_score), 0),
    regr_slope(completion_rate, metadata_score), coalesce(regr_r2(completion_rate, metadata_score), 0),
    regr_slope(completion_rate, behavior_score), coalesce(regr_r2(completion_rate, behavior_score), 0),
    regr_slope(completion_rate, penalty_score),  coalesce(regr_r2(completion_rate, penalty_score), 0)
  into v_n,
       v_audio_slope, v_audio_r2,
       v_meta_slope, v_meta_r2,
       v_behavior_slope, v_behavior_r2,
       v_penalty_slope, v_penalty_r2
  from eligible;

  v_regression := jsonb_build_object(
    'audio',    jsonb_build_object('slope', round(coalesce(v_audio_slope,0)::numeric, 5),    'r2', round(v_audio_r2::numeric, 4)),
    'meta',     jsonb_build_object('slope', round(coalesce(v_meta_slope,0)::numeric, 5),     'r2', round(v_meta_r2::numeric, 4)),
    'behavior', jsonb_build_object('slope', round(coalesce(v_behavior_slope,0)::numeric, 5), 'r2', round(v_behavior_r2::numeric, 4)),
    'penalty',  jsonb_build_object('slope', round(coalesce(v_penalty_slope,0)::numeric, 5),  'r2', round(v_penalty_r2::numeric, 4)),
    'n', v_n, 'segment', v_segment
  );

  if v_n < v_min_sample then
    return jsonb_build_object('queued', false, 'reason', 'insufficient_sample', 'sample_size', v_n, 'segment', v_segment);
  end if;

  v_sum_r2 := v_audio_r2 + v_meta_r2 + v_behavior_r2 + v_penalty_r2;
  if v_sum_r2 < v_min_sum_r2 then
    return jsonb_build_object('queued', false, 'reason', 'no_explanatory_power', 'sum_r2', round(v_sum_r2::numeric, 4), 'segment', v_segment);
  end if;

  v_w_audio := round((v_audio_r2 / v_sum_r2)::numeric, 3);
  v_w_meta := round((v_meta_r2 / v_sum_r2)::numeric, 3);
  v_w_behavior := round((v_behavior_r2 / v_sum_r2)::numeric, 3);
  v_w_penalty := round((v_penalty_r2 / v_sum_r2)::numeric, 3);

  v_suggestion := jsonb_build_object(
    'fit_audio_w', v_w_audio, 'fit_meta_w', v_w_meta,
    'fit_behavior_w', v_w_behavior, 'fit_penalty_w', v_w_penalty,
    'store_type', p_store_type, 'daypart', p_daypart
  );

  -- 동일 segment pending → superseded
  update public.ai_weight_regression_suggestions
     set status='superseded', reviewed_at=now()
   where status='pending'
     and (suggestion->>'store_type') is not distinct from p_store_type
     and (suggestion->>'daypart')    is not distinct from p_daypart;

  insert into public.ai_weight_regression_suggestions (suggestion, regression, sample_size, status)
  values (v_suggestion, v_regression, v_n, 'pending')
  returning id into v_id;

  return jsonb_build_object('queued', true, 'suggestion_id', v_id, 'sample_size', v_n, 'segment', v_segment);
end; $$;

revoke execute on function public._cron_run_regression_internal(text, text) from public, anon;


-- =============================================================================
-- 8. pg_cron 스케줄 — 매주 월요일 04:00 UTC = 13:00 KST
-- =============================================================================
-- 기존 동일 이름 스케줄 있으면 제거 후 재등록 (idempotent)
do $$ begin
  perform cron.unschedule(jobid)
    from cron.job where jobname = 'srr-weight-regression-weekly';
exception when others then null;
end $$;

select cron.schedule(
  'srr-weight-regression-weekly',
  '0 4 * * 1',  -- Monday 04:00 UTC = 13:00 KST
  $$select public.cron_compute_regression_weights();$$
);


-- =============================================================================
-- 9. admin helpers — overrides 관리 + cron 실행 이력
-- =============================================================================
create or replace function public.admin_list_weight_overrides()
returns table(
  id uuid, store_type text, daypart text,
  fit_audio_w numeric, fit_meta_w numeric, fit_behavior_w numeric, fit_penalty_w numeric,
  source text, source_suggestion_id uuid,
  updated_at timestamptz, updated_by uuid, updated_by_name text
) language sql stable security definer set search_path to 'public' as $$
  select o.id, o.store_type, o.daypart,
         o.fit_audio_w, o.fit_meta_w, o.fit_behavior_w, o.fit_penalty_w,
         o.source, o.source_suggestion_id,
         o.updated_at, o.updated_by, coalesce(u.full_name, u.nickname) as updated_by_name
  from public.ai_scoring_config_overrides o
  left join public.users u on u.id = o.updated_by
  where exists (select 1 from public.users uu where uu.id=auth.uid() and uu.role='admin')
  order by o.store_type nulls first, o.daypart nulls first;
$$;
grant execute on function public.admin_list_weight_overrides() to authenticated;


create or replace function public.admin_delete_weight_override(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  delete from public.ai_scoring_config_overrides where id = p_id;
  return jsonb_build_object('ok', true, 'deleted', found);
end; $$;
grant execute on function public.admin_delete_weight_override(uuid) to authenticated;


create or replace function public.admin_list_weight_regression_runs(p_limit int default 20)
returns table(
  id uuid, started_at timestamptz, finished_at timestamptz,
  triggered_by text, result jsonb, error text
) language sql stable security definer set search_path to 'public' as $$
  select r.id, r.started_at, r.finished_at, r.triggered_by, r.result, r.error
  from public.ai_weight_regression_runs r
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
  order by r.started_at desc
  limit greatest(1, p_limit);
$$;
grant execute on function public.admin_list_weight_regression_runs(int) to authenticated;
