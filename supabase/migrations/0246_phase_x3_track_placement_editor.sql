-- 0246 — Phase X3 Admin Track Placement Editor + Store Exclusion
--
-- 목표: 관리자가 음원별 운영 메타를 직접 편집하고, 금지 장소를 지정하여
--       자동 배치/추천/fit_score 에서 강제 제외할 수 있도록 한다.
--
-- 정책 (사용자 spec):
--   - 자동 메타 적용 금지, 자동 삭제 금지, 자동 차단 금지
--   - 모든 변경은 관리자 preview + confirm + audit log
--   - exclusion 은 hard block — AI boost 로 우회 불가

-- ===== A. track_store_exclusions =====
create table if not exists public.track_store_exclusions (
  id              uuid primary key default gen_random_uuid(),
  track_id        uuid not null references public.tracks(id) on delete cascade,
  store_type_slug text not null,
  reason          text,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  is_active       boolean not null default true,
  unique (track_id, store_type_slug)
);
create index if not exists ix_track_excl_track on public.track_store_exclusions(track_id) where is_active;
create index if not exists ix_track_excl_slug on public.track_store_exclusions(store_type_slug) where is_active;
alter table public.track_store_exclusions enable row level security;
drop policy if exists "excl admin all" on public.track_store_exclusions;
create policy "excl admin all" on public.track_store_exclusions for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. admin_track_metadata_audit =====
create table if not exists public.admin_track_metadata_audit (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid not null references public.tracks(id) on delete cascade,
  admin_id    uuid references public.users(id) on delete set null,
  action_type text not null,
  before_json jsonb,
  after_json  jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists ix_audit_track on public.admin_track_metadata_audit(track_id, created_at desc);
alter table public.admin_track_metadata_audit enable row level security;
drop policy if exists "audit admin read" on public.admin_track_metadata_audit;
create policy "audit admin read" on public.admin_track_metadata_audit for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== C. _track_is_excluded_from_playlist =====
-- 매칭 3중: normalize_store_label(business_category) | playlist.ai_store_key | taxonomy_store_types.name_ko=business_category
create or replace function public._track_is_excluded_from_playlist(p_track_id uuid, p_playlist_id uuid)
returns boolean
language sql
stable
parallel safe
as $$
  select exists (
    select 1
    from public.track_store_exclusions e
    join public.playlists p on p.id = p_playlist_id
    where e.track_id = p_track_id
      and e.is_active = true
      and (
        e.store_type_slug = public.normalize_store_label(p.business_category)
        or e.store_type_slug = p.ai_store_key
        or e.store_type_slug in (
          select ts.slug from public.taxonomy_store_types ts where ts.name_ko = p.business_category
        )
      )
  );
$$;

-- ===== D. _ai_compute_fit v3 (X3): admin_store_exclusion early return =====
-- 진입 직후 exclusion 체크 → fit=0, status='excluded' upsert 후 return.
-- 기존 manual+AI boost 점수 계산 (0241) 보존.
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
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;

  -- 🆕 X3 hard block: admin store exclusion
  if public._track_is_excluded_from_playlist(p_track_id, p_playlist_id) then
    insert into public.playlist_track_fit_scores(
      playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
      reason, source, status, updated_at,
      manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
      normalized_store_slug, reason_codes
    ) values (
      p_playlist_id, p_track_id, 0, 0, 0, 0, 0,
      '[admin_store_exclusion] 관리자가 이 매장에서 이 트랙을 제외함',
      'algorithm', 'excluded', now(),
      0, 0, 0, 0, 0,
      public.normalize_store_label(pl.business_category),
      array['admin_store_exclusion']
    )
    on conflict (playlist_id, track_id) do update set
      fit_score = 0,
      audio_score = 0, metadata_score = 0, behavior_score = 0, penalty_score = 0,
      reason = '[admin_store_exclusion] 관리자가 이 매장에서 이 트랙을 제외함',
      status = case when public.playlist_track_fit_scores.source = 'admin'
                    then public.playlist_track_fit_scores.status else 'excluded' end,
      updated_at = now(),
      manual_score = 0, ai_store_score = 0, ai_mood_score = 0,
      ai_genre_score = 0, ai_boost_total = 0,
      reason_codes = array['admin_store_exclusion'];
    return;
  end if;

  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := coalesce(nullif(btrim(pl.ai_store_key),''),
                    public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));

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
  v_manual := least(100, greatest(0, v_audio*cfg.fit_audio_w + v_meta*cfg.fit_meta_w
                                    + v_behav*cfg.fit_behavior_w - v_pen*cfg.fit_penalty_w));

  select * into pred from public.track_ai_predictions
    where track_id=p_track_id and model_version='taxonomy-v1';
  v_normalized_slug := public.normalize_store_label(pl.business_category);

  if pred.predicted_main_genre is not null
     and exists(select 1 from unnest(pl.genre_tags) g where lower(g)=lower(pred.predicted_main_genre)) then
    v_ai_genre := 5;
    v_reason_codes := v_reason_codes || 'ai_genre_match';
  end if;
  if pred.predicted_moods is not null then
    select count(*) into v_mood_overlap from unnest(pred.predicted_moods) pm
    join public.taxonomy_moods tm on tm.slug=pm
    where tm.name_ko = any(coalesce(pl.mood_tags,'{}'::text[]));
    v_ai_mood := least(v_mood_overlap*3, 9);
    if v_mood_overlap > 0 then
      v_reason_codes := v_reason_codes || ('ai_mood_overlap_' || v_mood_overlap);
    end if;
  end if;
  if pred.predicted_store_types is not null and v_normalized_slug is not null then
    if array_length(pred.predicted_store_types, 1) >= 1
       and pred.predicted_store_types[1] = v_normalized_slug then
      v_ai_store := v_ai_store + 20;
      v_reason_codes := v_reason_codes || 'ai_store_top1_match';
    elsif array_length(pred.predicted_store_types, 1) >= 2
          and pred.predicted_store_types[2] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := v_reason_codes || 'ai_store_top2_match';
    elsif array_length(pred.predicted_store_types, 1) >= 3
          and pred.predicted_store_types[3] = v_normalized_slug then
      v_ai_store := v_ai_store + 10;
      v_reason_codes := v_reason_codes || 'ai_store_top3_match';
    end if;
    if pred.prediction_scores ? 'store_type'
       and (pred.prediction_scores->'store_type' ? v_normalized_slug) then
      v_ai_store := v_ai_store + least(10, round(
        (pred.prediction_scores->'store_type'->>v_normalized_slug)::numeric * 30
      )::int);
      v_reason_codes := v_reason_codes || 'ai_store_prob_boost';
    end if;
  end if;

  v_ai_boost := v_ai_genre + v_ai_mood + v_ai_store;
  v_fit := least(100, greatest(0, v_manual + v_ai_boost));

  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'blocked')::boolean then
      v_fit := 0; v_excluded := true;
      v_reason := '[guardrail hard_block] ' || coalesce((select string_agg(e->>'reason',', ') from jsonb_array_elements(gr->'violations') e), '');
      v_reason_codes := v_reason_codes || 'guardrail_blocked';
    else
      v_gpen := coalesce((gr->>'penalty_score')::numeric, 0);
      if v_gpen > 0 then
        v_fit := greatest(0, v_fit - v_gpen);
        v_reason_codes := v_reason_codes || ('guardrail_penalty_' || round(v_gpen));
      end if;
    end if;
  end if;
  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then
    v_excluded := true;
    v_reason_codes := v_reason_codes || 'ai_excluded';
  end if;

  if v_status is null then
    v_status := case when v_excluded then 'excluded'
                     when v_fit < cfg.fit_exclude_cutoff then 'review_needed'
                     else 'active' end;
  end if;
  if v_reason is null then
    v_reason := format('audio %s · meta %s · behavior %s · penalty %s · manual %s · ai_boost +%s (g%s/m%s/s%s)%s%s',
      round(v_audio), round(v_meta), round(v_behav), round(v_pen),
      round(v_manual), v_ai_boost, v_ai_genre, v_ai_mood, v_ai_store,
      case when v_key is not null then ' · store='||v_key else '' end,
      case when v_gpen>0 then ' · guardrail -'||round(v_gpen) else '' end);
  end if;

  insert into public.playlist_track_fit_scores(
    playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
    reason, source, status, updated_at,
    manual_score, ai_store_score, ai_mood_score, ai_genre_score, ai_boost_total,
    normalized_store_slug, reason_codes
  )
  values (p_playlist_id, p_track_id, round(v_fit),
          round(v_audio), round(v_meta), round(v_behav), round(v_pen),
          v_reason, 'algorithm', v_status, now(),
          round(v_manual), v_ai_store, v_ai_mood, v_ai_genre, v_ai_boost,
          v_normalized_slug, v_reason_codes)
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin'
                then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now(),
    manual_score=excluded.manual_score, ai_store_score=excluded.ai_store_score,
    ai_mood_score=excluded.ai_mood_score, ai_genre_score=excluded.ai_genre_score,
    ai_boost_total=excluded.ai_boost_total,
    normalized_store_slug=excluded.normalized_store_slug,
    reason_codes=excluded.reason_codes;
end; $$;

-- ===== E. auto_place_track v4 (X3) — exclusion 사전 필터 =====
-- 본 마이그레이션 적용 시 0239 의 auto_place_track 위에 OR REPLACE 됨.
-- 핵심 변경: SELECT WHERE 절에 `and not public._track_is_excluded_from_playlist(p_track_id, p.id)`,
-- 응답 jsonb 에 skip_admin_exclusion 필드 추가. 본문은 0239 와 99% 동일.
-- (실제 본문은 supabase_migrations.schema_migrations 의 phase_x3_apply_exclusion_to_placement_funcs 참고)

-- ===== F. admin_simulate_storefit_v2 v3 (X3) — exclusion 사전 필터 =====
-- cands CTE WHERE 절에 동일 필터 추가. 0239 본문 + DROP/CREATE.

-- ===== G. admin_explain_placement v4 (X3) — admin_excluded 명시 =====
-- v_admin_excluded boolean + block_reasons 에 'admin_store_exclusion → ...' 추가
-- + final_decision='skip_admin_exclusion' + return JSON 에 admin_store_excluded 필드.

-- ===== H. admin_get_track_placement_detail =====
create or replace function public.admin_get_track_placement_detail(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_track jsonb; v_pred jsonb; v_excl jsonb; v_placements jsonb; v_audit_count int;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select to_jsonb(t.*) - 'audio_url' - 'audio_sha256' - 'isrc'
         || jsonb_build_object(
              'audio_url_present', t.audio_url is not null,
              'isrc_present', t.isrc is not null,
              'locked_fields', array['audio_url','audio_sha256','isrc','release_date','rights_holder_name','release_title','track_code']
            )
    into v_track from public.tracks t where t.id = p_track_id;
  if v_track is null then raise exception 'track not found: %', p_track_id; end if;
  select jsonb_build_object(
    'predicted_main_genre', p.predicted_main_genre,
    'predicted_sub_genres', p.predicted_sub_genres,
    'genre_confidence', p.genre_confidence,
    'predicted_moods', p.predicted_moods,
    'mood_confidence', p.mood_confidence,
    'predicted_store_types', p.predicted_store_types,
    'store_type_confidence', p.store_type_confidence,
    'prediction_scores', p.prediction_scores,
    'applied_at', p.applied_at,
    'predicted_main_genre_ko', (select tg.name_ko from public.taxonomy_genres tg where tg.slug = p.predicted_main_genre),
    'predicted_moods_ko', (select array_agg(tm.name_ko order by tm.sort_order)
                            from public.taxonomy_moods tm where tm.slug = any(coalesce(p.predicted_moods,'{}'::text[]))),
    'predicted_store_types_ko', (select array_agg(ts.name_ko order by ts.sort_order)
                                  from public.taxonomy_store_types ts where ts.slug = any(coalesce(p.predicted_store_types,'{}'::text[])))
  ) into v_pred from public.track_ai_predictions p
  where p.track_id = p_track_id and p.model_version='taxonomy-v1';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'store_type_slug', e.store_type_slug,
    'store_type_name_ko', (select ts.name_ko from public.taxonomy_store_types ts where ts.slug = e.store_type_slug),
    'reason', e.reason, 'created_at', e.created_at,
    'created_by_name', (select u.full_name from public.users u where u.id = e.created_by)
  ) order by e.created_at desc), '[]'::jsonb) into v_excl
  from public.track_store_exclusions e where e.track_id = p_track_id and e.is_active;
  select coalesce(jsonb_agg(jsonb_build_object(
    'playlist_id', pl.id, 'playlist_title', pl.title,
    'business_category', pl.business_category, 'daypart', pl.daypart,
    'ai_store_key', pl.ai_store_key,
    'fit_score', fs.fit_score, 'fit_status', fs.status,
    'manual_score', fs.manual_score, 'ai_boost_total', fs.ai_boost_total,
    'reason_codes', fs.reason_codes,
    'in_playlist', pt.id is not null, 'order_index', pt.order_index,
    'placement_reason', pt.placement_reason,
    'is_excluded_by_admin', public._track_is_excluded_from_playlist(p_track_id, pl.id)
  ) order by pl.title), '[]'::jsonb) into v_placements
  from public.playlists pl
  left join public.playlist_tracks pt on pt.playlist_id = pl.id and pt.track_id = p_track_id
  left join public.playlist_track_fit_scores fs on fs.playlist_id = pl.id and fs.track_id = p_track_id
  where pl.is_auto_generated = true and pl.status = 'released'
    and (pt.id is not null or fs.id is not null);
  select count(*) into v_audit_count from public.admin_track_metadata_audit where track_id = p_track_id;
  return jsonb_build_object('track', v_track, 'ai_prediction', v_pred,
    'exclusions', v_excl, 'placements', v_placements, 'audit_count', v_audit_count);
end; $$;

-- ===== I. admin_update_track_metadata =====
create or replace function public.admin_update_track_metadata(
  p_track_id uuid, p_title text default null, p_artist text default null,
  p_main_genre text default null, p_mood text default null,
  p_suitable_store text default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb; v_admin uuid;
begin
  v_admin := auth.uid();
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select jsonb_build_object('title', title, 'artist', artist, 'main_genre', main_genre,
    'mood', mood, 'suitable_store', suitable_store) into v_before
  from public.tracks where id = p_track_id;
  if v_before is null then raise exception 'track not found: %', p_track_id; end if;
  update public.tracks set
    title = coalesce(p_title, title), artist = coalesce(p_artist, artist),
    main_genre = coalesce(p_main_genre, main_genre),
    mood = coalesce(p_mood, mood),
    suitable_store = coalesce(p_suitable_store, suitable_store),
    updated_at = now()
  where id = p_track_id;
  select jsonb_build_object('title', title, 'artist', artist, 'main_genre', main_genre,
    'mood', mood, 'suitable_store', suitable_store) into v_after
  from public.tracks where id = p_track_id;
  insert into public.admin_track_metadata_audit(track_id, admin_id, action_type, before_json, after_json, reason)
  values (p_track_id, v_admin, 'metadata_update', v_before, v_after, p_reason);
  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after);
end; $$;

-- ===== J. admin_apply_ai_metadata_with_audit =====
create or replace function public.admin_apply_ai_metadata_with_audit(
  p_track_id uuid, p_apply_genre boolean default false, p_apply_mood boolean default false,
  p_apply_store boolean default false, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_before jsonb; v_after jsonb; v_pred record; v_admin uuid;
        v_new_genre text; v_new_mood text; v_new_store text;
begin
  v_admin := auth.uid();
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_pred from public.track_ai_predictions
    where track_id = p_track_id and model_version='taxonomy-v1';
  if v_pred.track_id is null then raise exception 'no AI prediction for track: %', p_track_id; end if;
  select jsonb_build_object('main_genre', main_genre, 'mood', mood, 'suitable_store', suitable_store)
    into v_before from public.tracks where id = p_track_id;
  if p_apply_genre and v_pred.predicted_main_genre is not null then
    select name_ko into v_new_genre from public.taxonomy_genres where slug = v_pred.predicted_main_genre;
  end if;
  if p_apply_mood and v_pred.predicted_moods is not null and array_length(v_pred.predicted_moods,1) > 0 then
    select name_ko into v_new_mood from public.taxonomy_moods where slug = v_pred.predicted_moods[1];
  end if;
  if p_apply_store and v_pred.predicted_store_types is not null and array_length(v_pred.predicted_store_types,1) > 0 then
    select name_ko into v_new_store from public.taxonomy_store_types where slug = v_pred.predicted_store_types[1];
  end if;
  update public.tracks set
    main_genre = coalesce(v_new_genre, main_genre),
    mood = coalesce(v_new_mood, mood),
    suitable_store = coalesce(v_new_store, suitable_store),
    updated_at = now()
  where id = p_track_id;
  select jsonb_build_object('main_genre', main_genre, 'mood', mood, 'suitable_store', suitable_store)
    into v_after from public.tracks where id = p_track_id;
  insert into public.admin_track_metadata_audit(track_id, admin_id, action_type, before_json, after_json, reason)
  values (p_track_id, v_admin,
          'ai_apply_' || array_to_string(array_remove(array[
            case when p_apply_genre then 'genre' end,
            case when p_apply_mood then 'mood' end,
            case when p_apply_store then 'store' end
          ], null), '_'),
          v_before, v_after, p_reason);
  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after,
    'predicted_main_genre', v_pred.predicted_main_genre,
    'predicted_moods', v_pred.predicted_moods,
    'predicted_store_types', v_pred.predicted_store_types);
end; $$;

-- ===== K. exclusion add/remove =====
create or replace function public.admin_add_track_exclusion(
  p_track_id uuid, p_store_type_slug text, p_reason text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_id uuid;
begin
  v_admin := auth.uid();
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if not exists (select 1 from public.taxonomy_store_types where slug = p_store_type_slug) then
    raise exception 'unknown store_type_slug: %', p_store_type_slug;
  end if;
  insert into public.track_store_exclusions(track_id, store_type_slug, reason, created_by, is_active)
  values (p_track_id, p_store_type_slug, p_reason, v_admin, true)
  on conflict (track_id, store_type_slug) do update set
    is_active = true, reason = excluded.reason, created_by = v_admin, created_at = now()
  returning id into v_id;
  insert into public.admin_track_metadata_audit(track_id, admin_id, action_type, before_json, after_json, reason)
  values (p_track_id, v_admin, 'exclusion_add',
          jsonb_build_object('store_type_slug', p_store_type_slug, 'is_active', false),
          jsonb_build_object('store_type_slug', p_store_type_slug, 'is_active', true),
          p_reason);
  return v_id;
end; $$;

create or replace function public.admin_remove_track_exclusion(p_exclusion_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_track_id uuid; v_slug text;
begin
  v_admin := auth.uid();
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select track_id, store_type_slug into v_track_id, v_slug
  from public.track_store_exclusions where id = p_exclusion_id;
  if v_track_id is null then raise exception 'exclusion not found: %', p_exclusion_id; end if;
  update public.track_store_exclusions set is_active = false where id = p_exclusion_id;
  insert into public.admin_track_metadata_audit(track_id, admin_id, action_type, before_json, after_json, reason)
  values (v_track_id, v_admin, 'exclusion_remove',
          jsonb_build_object('store_type_slug', v_slug, 'is_active', true),
          jsonb_build_object('store_type_slug', v_slug, 'is_active', false), null);
end; $$;

-- ===== L. admin_preview_placement_changes =====
create or replace function public.admin_preview_placement_changes(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v_remove jsonb; v_keep jsonb; v_new_cand jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'playlist_id', pl.id, 'playlist_title', pl.title,
    'business_category', pl.business_category,
    'current_fit_score', fs.fit_score, 'order_index', pt.order_index,
    'matched_exclusion_slug', (
      select e.store_type_slug from public.track_store_exclusions e
      where e.track_id = p_track_id and e.is_active
        and (e.store_type_slug = public.normalize_store_label(pl.business_category)
          or e.store_type_slug = pl.ai_store_key
          or e.store_type_slug in (select ts.slug from public.taxonomy_store_types ts where ts.name_ko = pl.business_category))
      limit 1)
  )), '[]'::jsonb) into v_remove
  from public.playlist_tracks pt
  join public.playlists pl on pl.id = pt.playlist_id
  left join public.playlist_track_fit_scores fs on fs.playlist_id = pl.id and fs.track_id = p_track_id
  where pt.track_id = p_track_id and public._track_is_excluded_from_playlist(p_track_id, pl.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'playlist_id', pl.id, 'playlist_title', pl.title,
    'business_category', pl.business_category,
    'current_fit_score', fs.fit_score, 'order_index', pt.order_index
  )), '[]'::jsonb) into v_keep
  from public.playlist_tracks pt
  join public.playlists pl on pl.id = pt.playlist_id
  left join public.playlist_track_fit_scores fs on fs.playlist_id = pl.id and fs.track_id = p_track_id
  where pt.track_id = p_track_id and not public._track_is_excluded_from_playlist(p_track_id, pl.id);
  select coalesce(jsonb_agg(jsonb_build_object(
    'playlist_id', s.playlist_id, 'playlist_title', s.playlist_title,
    'business_category', s.business_category,
    'estimated_score', s.total_score, 'decision', s.decision
  )), '[]'::jsonb) into v_new_cand
  from public.admin_simulate_storefit_v2(p_track_id, 5) s
  where s.would_place
    and not exists (select 1 from public.playlist_tracks pt
                    where pt.track_id = p_track_id and pt.playlist_id = s.playlist_id);
  return jsonb_build_object(
    'remove_count', jsonb_array_length(v_remove),
    'keep_count', jsonb_array_length(v_keep),
    'new_candidate_count', jsonb_array_length(v_new_cand),
    'to_remove', v_remove, 'to_keep', v_keep, 'new_candidates', v_new_cand);
end; $$;

-- ===== M. admin_remove_misplaced_playlist_tracks (preview / confirm) =====
create or replace function public.admin_remove_misplaced_playlist_tracks(
  p_track_id uuid, p_confirm boolean default false, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid; v_removed jsonb; v_count int := 0;
begin
  v_admin := auth.uid();
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  with targets as (
    select pt.id as pt_id, pt.playlist_id, pl.title as playlist_title,
           pl.business_category, pt.order_index
    from public.playlist_tracks pt
    join public.playlists pl on pl.id = pt.playlist_id
    where pt.track_id = p_track_id
      and public._track_is_excluded_from_playlist(p_track_id, pl.id)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'playlist_id', playlist_id, 'playlist_title', playlist_title,
    'business_category', business_category, 'order_index', order_index
  )), '[]'::jsonb), count(*) into v_removed, v_count from targets;
  if not p_confirm then
    return jsonb_build_object('preview', true, 'count', v_count, 'targets', v_removed);
  end if;
  delete from public.playlist_tracks pt using public.playlists pl
  where pt.playlist_id = pl.id and pt.track_id = p_track_id
    and public._track_is_excluded_from_playlist(p_track_id, pl.id);
  update public.playlist_track_fit_scores fs
  set status = 'excluded', fit_score = 0, reason_codes = array['admin_store_exclusion'], updated_at = now()
  from public.playlists pl
  where pl.id = fs.playlist_id and fs.track_id = p_track_id and fs.source <> 'admin'
    and public._track_is_excluded_from_playlist(p_track_id, fs.playlist_id);
  insert into public.admin_track_metadata_audit(track_id, admin_id, action_type, before_json, after_json, reason)
  values (p_track_id, v_admin, 'playlist_remove', v_removed,
          jsonb_build_object('removed_count', v_count), p_reason);
  return jsonb_build_object('preview', false, 'count', v_count, 'removed', v_removed);
end; $$;

-- ===== N. admin_list_track_metadata_audit =====
create or replace function public.admin_list_track_metadata_audit(p_track_id uuid, p_limit int default 100)
returns table (id uuid, action_type text, before_json jsonb, after_json jsonb,
               reason text, created_at timestamptz, admin_name text)
language sql security definer set search_path = public stable as $$
  select a.id, a.action_type, a.before_json, a.after_json, a.reason, a.created_at, u.full_name
  from public.admin_track_metadata_audit a
  left join public.users u on u.id = a.admin_id
  where a.track_id = p_track_id
  order by a.created_at desc limit greatest(p_limit, 1);
$$;

-- ===== O. admin_recompute_track_fit_scores =====
create or replace function public.admin_recompute_track_fit_scores(p_track_id uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_count int := 0; r record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  for r in
    select pl.id from public.playlists pl
    where pl.is_auto_generated = true and pl.status = 'released'
      and exists (select 1 from public.playlist_track_fit_scores fs
                  where fs.playlist_id = pl.id and fs.track_id = p_track_id)
  loop
    perform public._ai_compute_fit(r.id, p_track_id);
    v_count := v_count + 1;
  end loop;
  insert into public.admin_track_metadata_audit(track_id, admin_id, action_type, before_json, after_json, reason)
  values (p_track_id, v_admin, 'fit_recompute', null,
          jsonb_build_object('playlists_recomputed', v_count), null);
  return v_count;
end; $$;

-- 권한
revoke all on function public.admin_get_track_placement_detail(uuid) from public, anon;
revoke all on function public.admin_update_track_metadata(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function public.admin_apply_ai_metadata_with_audit(uuid, boolean, boolean, boolean, text) from public, anon;
revoke all on function public.admin_add_track_exclusion(uuid, text, text) from public, anon;
revoke all on function public.admin_remove_track_exclusion(uuid) from public, anon;
revoke all on function public.admin_preview_placement_changes(uuid) from public, anon;
revoke all on function public.admin_remove_misplaced_playlist_tracks(uuid, boolean, text) from public, anon;
revoke all on function public.admin_list_track_metadata_audit(uuid, int) from public, anon;
revoke all on function public.admin_recompute_track_fit_scores(uuid) from public, anon;
grant execute on function public.admin_get_track_placement_detail(uuid) to authenticated, service_role;
grant execute on function public.admin_update_track_metadata(uuid, text, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.admin_apply_ai_metadata_with_audit(uuid, boolean, boolean, boolean, text) to authenticated, service_role;
grant execute on function public.admin_add_track_exclusion(uuid, text, text) to authenticated, service_role;
grant execute on function public.admin_remove_track_exclusion(uuid) to authenticated, service_role;
grant execute on function public.admin_preview_placement_changes(uuid) to authenticated, service_role;
grant execute on function public.admin_remove_misplaced_playlist_tracks(uuid, boolean, text) to authenticated, service_role;
grant execute on function public.admin_list_track_metadata_audit(uuid, int) to authenticated, service_role;
grant execute on function public.admin_recompute_track_fit_scores(uuid) to authenticated, service_role;

-- NOTE: 0246 marker. E/F/G (auto_place_track / admin_simulate_storefit_v2 / admin_explain_placement)
-- 의 전체 본문은 supabase_migrations.schema_migrations 의
--   phase_x3_apply_exclusion_to_placement_funcs
--   phase_x3_drop_recreate_simulate_v2
-- 에서 적용됨. fresh deploy 시 0239 위에 OR REPLACE 패치 적용 필요.
