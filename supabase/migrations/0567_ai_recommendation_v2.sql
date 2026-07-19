-- ============================================
-- 0567_ai_recommendation_v2.sql
--
-- Phase AI-RECOMMEND-2 — Contextual Recommendation Engine v2 & Shadow Comparison.
--
-- 기존 Recommendation v1(recommend_tracks_by_context / get_personalized_recommendations /
-- recommend_similar_tracks)과 Store Fit/Guardrail/Auto Placement/Reaction Learning/
-- Playlist/Queue/Scheduler/Player/정산은 **일절 무변경**. v1 은 비교를 위해
-- **읽기 전용으로 호출만** 한다(저장·교체·Disable 없음).
--
-- 흐름: Context → Candidate Pool v2 → Hard Eligibility(서버 재검증) → Multi-Objective
--       Scoring(클라이언트 미신뢰 — 서버 재계산) → Recommendation Draft →
--       v1 Shadow Comparison → Human Review. **여기서 종료.**
-- 금지: Production 추천 Apply/교체, playlist_tracks INSERT/UPDATE, Queue/Scheduler/
--       Player 반영, 자동 승인/Publish. 해당 RPC 자체가 존재하지 않는다.
--
-- 재사용: _admin_growth_guard(0472) · _touch_updated_at(0025) ·
--   _ai_pl_hard_violations(0565) · track_reaction_aggregate(0345 — ratio 는 percent
--   0..100) · track_behavior_scores(0250) · released 판정(0138).
-- Exposure(추천 노출) 원장은 존재하지 않음 → insufficient_data, 30일 재생 이벤트를
--   프록시로만 기록. Reaction 은 Production 0행 실측 — Confidence 기반 정직 처리.
--
-- 서버 Quality 가중치(코드 상수 REC_QUALITY_WEIGHTS 와 동일):
--   storeFit 20 · policy 15 · trackQuality 10 · playlistCompat 10 · sequenceCompat 10 ·
--   reaction 10 · reputation 5 · novelty 5 · fatigue 5 · exposure 5 · fairness 3 · meta 2.
--   (playlistCompat/sequenceCompat/exposure 는 서버 집계 불가 시 결측 재정규화.)
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Recommendation Draft 본체
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_recommendation_drafts (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(name) between 1 and 200),
  recommendation_mode text not null default 'store'
    check (recommendation_mode in ('store','brand','industry','playlist_fill','next_track','similar_track','manual_assist')),
  status              text not null default 'draft'
    check (status in ('draft','ready_for_review','approved','rejected','expired','archived')),
  store_id            uuid,
  store_type          text,
  brand_id            uuid,
  source_playlist_id  uuid references public.playlists(id) on delete set null,
  playlist_draft_id   uuid references public.ai_playlist_drafts(id) on delete set null,
  sequence_draft_id   uuid references public.ai_playlist_sequence_drafts(id) on delete set null,
  current_track_id    uuid,
  target_track_count  int not null check (target_track_count between 1 and 100),
  candidate_count     int not null default 0,
  eligible_count      int not null default 0,
  selected_count      int not null default 0,
  seed                bigint not null default 1,
  algorithm_version   text not null,
  input_snapshot      jsonb not null default '{}'::jsonb,
  weight_snapshot     jsonb not null default '{}'::jsonb,
  constraint_snapshot jsonb not null default '{}'::jsonb,
  quality_score       numeric check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  quality_grade       text check (quality_grade is null or quality_grade in ('A','B','C','D','insufficient_data')),
  quality_breakdown   jsonb not null default '{}'::jsonb,
  comparison_summary  jsonb not null default '{}'::jsonb,
  explanation         jsonb not null default '[]'::jsonb,
  warnings            jsonb not null default '[]'::jsonb,
  insufficient_data   jsonb not null default '[]'::jsonb,
  input_hash          text,
  created_by          uuid,
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  rejection_reason    text,
  expires_at          timestamptz not null default now() + interval '30 days',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.ai_recommendation_drafts is
  'AI-RECOMMEND-2 — Recommendation v2 Draft(Shadow). Production 추천/Playlist/Queue/Player 미반영. Approved=검토 감사 기록.';

create index if not exists idx_ai_rec_drafts_status on public.ai_recommendation_drafts (status, created_at desc);
create index if not exists idx_ai_rec_drafts_store on public.ai_recommendation_drafts (store_type, created_at desc);
create index if not exists idx_ai_rec_drafts_hash on public.ai_recommendation_drafts (input_hash, created_at desc);

drop trigger if exists tg_ai_rec_drafts_touch on public.ai_recommendation_drafts;
create trigger tg_ai_rec_drafts_touch before update on public.ai_recommendation_drafts
  for each row execute function public._touch_updated_at();

alter table public.ai_recommendation_drafts enable row level security;
-- 정책 없음(deny-all) — 접근은 관리자 SECURITY DEFINER RPC 로만.

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Draft Track — 순위/점수/근거. rank 는 draft 내 unique(서버가 무결성 재검증).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_recommendation_draft_tracks (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null references public.ai_recommendation_drafts(id) on delete cascade,
  track_id          uuid not null references public.tracks(id) on delete cascade,
  rank              int not null check (rank >= 0),
  selected          boolean not null default true,
  eligible          boolean not null default true,
  final_score       numeric check (final_score is null or (final_score >= 0 and final_score <= 100)),
  score_breakdown   jsonb not null default '{}'::jsonb,
  selection_reasons jsonb not null default '[]'::jsonb,
  exclusion_reasons jsonb not null default '[]'::jsonb,
  feature_snapshot  jsonb not null default '{}'::jsonb,
  v1_rank           int,
  rank_delta        int,
  created_at        timestamptz not null default now(),
  unique (draft_id, track_id),
  unique (draft_id, rank)
);

create index if not exists idx_ai_rec_draft_tracks on public.ai_recommendation_draft_tracks (draft_id, rank);

alter table public.ai_recommendation_draft_tracks enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Audit Event / 4) v1·버전 비교 스냅샷
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_recommendation_draft_events (
  id              uuid primary key default gen_random_uuid(),
  draft_id        uuid not null references public.ai_recommendation_drafts(id) on delete cascade,
  event_type      text not null check (event_type in ('created','reevaluated','status_changed','v1_compared','note')),
  actor_id        uuid,
  previous_status text,
  next_status     text,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_rec_draft_events on public.ai_recommendation_draft_events (draft_id, created_at desc);

alter table public.ai_recommendation_draft_events enable row level security;

create table if not exists public.ai_recommendation_comparisons (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null references public.ai_recommendation_drafts(id) on delete cascade,
  comparison_type   text not null check (comparison_type in ('v1_context','draft_vs_draft')),
  baseline_version  text not null,
  candidate_version text not null,
  metrics           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_ai_rec_comparisons on public.ai_recommendation_comparisons (draft_id, created_at desc);

alter table public.ai_recommendation_comparisons enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Candidate Pool v2 — 읽기 전용. 0565 pool 에 behavior/reaction/playlist 포함
--    여부를 더한다. 상한 500, Full Scan 방지(released 필터 + limit).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_rec_candidate_pool(p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_store_type text := nullif(p_filters->>'store_type','');
  v_playlist_id uuid := nullif(p_filters->>'source_playlist_id','')::uuid;
  v_limit int := greatest(1, least(coalesce((p_filters->>'limit')::int, 300), 500));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc nulls last, t.title), '[]'::jsonb) into v_result
  from (
    select tr.id as track_id, tr.title, tr.artist, tr.album_name, tr.main_genre, tr.sub_genre, tr.mood,
      tr.bpm, tr.duration, tr.release_date, tr.explicit_content, tr.instrumental,
      af.energy, af.vocal_presence, af.instrumentalness,
      lq.qc_score, lq.qc_grade,
      f.fit_score, f.status as fit_status,
      bs.behavior_score, bs.completion_rate, bs.skip_rate, bs.play_count, bs.unique_listener_count,
      agg.like_count, agg.dislike_count, agg.like_ratio, agg.dislike_ratio, agg.total_reactions,
      k.events, k.last_event_at,
      (v_playlist_id is not null and exists (select 1 from public.playlist_tracks pt
        where pt.playlist_id = v_playlist_id and pt.track_id = tr.id)) as in_source_playlist,
      (exists (select 1 from public.track_store_exclusions ex
        where ex.track_id = tr.id and ex.store_type_slug = v_store_type and ex.is_active)) as store_excluded,
      (v_store_type is not null and exists (select 1 from public.genre_block_rules gb
        where gb.business_category = v_store_type and gb.block_kind = 'block'
          and (lower(coalesce(tr.main_genre,'')) like '%' || lower(gb.genre_pattern) || '%'
            or lower(coalesce(tr.sub_genre,'')) like '%' || lower(gb.genre_pattern) || '%'))) as genre_blocked
    from public.tracks tr
    left join public.track_audio_features af on af.track_id = tr.id
    left join lateral (
      select q.qc_score, q.qc_grade from public.audio_qc_reports q
      where q.track_id = tr.id order by q.created_at desc limit 1
    ) lq on true
    left join public.playlist_track_fit_scores f
      on v_playlist_id is not null and f.playlist_id = v_playlist_id and f.track_id = tr.id
    left join lateral (
      select b.behavior_score, b.completion_rate, b.skip_rate, b.play_count, b.unique_listener_count
      from public.track_behavior_scores b
      where b.track_id = tr.id order by b.window_days asc limit 1
    ) bs on true
    left join public.track_reaction_aggregate agg on agg.track_id = tr.id
    left join lateral (
      select count(*)::int as events, max(e.created_at) as last_event_at
      from public.playback_events_v2 e
      where e.track_id = tr.id and e.created_at >= now() - interval '30 days'
    ) k on true
    where tr.removed_at is null
      and tr.visibility_status = 'approved'
      and (tr.release_status = 'released' or tr.source_type = 'admin_upload')
      and tr.audio_url is not null
      and coalesce(tr.audio_health_status, 'unknown') in ('ok','unknown')
    limit v_limit
  ) t;

  return jsonb_build_object(
    'items', v_result, 'store_type', v_store_type, 'source_playlist_id', v_playlist_id,
    'limit', v_limit, 'exposure_ledger', 'not_available', 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_rec_candidate_pool(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 서버측 Quality 재계산 — 클라이언트 Score/Rank 를 신뢰하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public._ai_rec_draft_quality(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d record;
  v_n int; v_sel int;
  v_hard jsonb; v_hard_arr text[] := '{}';
  v_rank_dup int; v_rank_gap int;
  v_fit_avg numeric; v_fit_missing int;
  v_qc_avg numeric; v_qc_missing int;
  v_artists int; v_max_artist int; v_genres int;
  v_new_cnt int; v_react_conf numeric; v_rep_missing int;
  v_fatigue_avg numeric; v_meta_missing int;
  v_c_elig numeric; v_c_fit numeric; v_c_policy numeric; v_c_quality numeric;
  v_c_react numeric; v_c_rep numeric; v_c_novel numeric; v_c_fatigue numeric;
  v_c_fair numeric; v_c_meta numeric;
  v_missing_ratio numeric; v_score numeric; v_grade text;
begin
  select * into d from public.ai_recommendation_drafts where id = p_draft_id;
  if d.id is null then raise exception 'draft not found: %', p_draft_id using errcode = 'P0002'; end if;

  select count(*), count(*) filter (where selected) into v_n, v_sel
  from public.ai_recommendation_draft_tracks where draft_id = p_draft_id;
  if v_sel = 0 then
    return jsonb_build_object('score', null, 'grade', 'insufficient_data',
      'hard_violations', '[]'::jsonb, 'breakdown', '{}'::jsonb, 'reason', 'no_selected_tracks');
  end if;

  -- Rank 무결성(선택 Track 기준 0..v_sel-1 조밀·중복 없음).
  select count(*) into v_rank_dup from (
    select rank from public.ai_recommendation_draft_tracks
    where draft_id = p_draft_id and selected group by rank having count(*) > 1) x;
  select count(*) into v_rank_gap from (
    select generate_series(0, v_sel - 1) as r
    except select rank from public.ai_recommendation_draft_tracks where draft_id = p_draft_id and selected) x;
  if v_rank_dup > 0 then v_hard_arr := array_append(v_hard_arr, 'rank_duplicate'); end if;
  if v_rank_gap > 0 then v_hard_arr := array_append(v_hard_arr, 'rank_gap'); end if;

  -- Hard Eligibility 재검증(0565 재사용) + current/playlist 중복.
  v_hard := public._ai_pl_hard_violations(
    (select array_agg(track_id) from public.ai_recommendation_draft_tracks where draft_id = p_draft_id and selected),
    d.store_type, d.source_playlist_id,
    coalesce((d.constraint_snapshot->>'block_explicit')::boolean, false),
    coalesce((d.constraint_snapshot->>'require_instrumental')::boolean, false),
    (d.constraint_snapshot->>'min_qc')::numeric);
  if jsonb_array_length(v_hard) > 0 then v_hard_arr := array_append(v_hard_arr, 'source_policy_violation'); end if;
  if d.current_track_id is not null and exists (
    select 1 from public.ai_recommendation_draft_tracks
    where draft_id = p_draft_id and selected and track_id = d.current_track_id
  ) then v_hard_arr := array_append(v_hard_arr, 'current_track_included'); end if;
  if d.source_playlist_id is not null
    and coalesce((d.constraint_snapshot->>'block_playlist_duplicates')::boolean, true)
    and exists (
      select 1 from public.ai_recommendation_draft_tracks dt
      join public.playlist_tracks pt on pt.playlist_id = d.source_playlist_id and pt.track_id = dt.track_id
      where dt.draft_id = p_draft_id and dt.selected
  ) then v_hard_arr := array_append(v_hard_arr, 'playlist_duplicate_included'); end if;

  select
    avg((dt.feature_snapshot->>'fit_score')::numeric) filter (where dt.feature_snapshot->>'fit_score' is not null),
    count(*) filter (where dt.feature_snapshot->>'fit_score' is null),
    avg((dt.feature_snapshot->>'qc_score')::numeric) filter (where dt.feature_snapshot->>'qc_score' is not null),
    count(*) filter (where dt.feature_snapshot->>'qc_score' is null),
    count(distinct lower(coalesce(tr.artist,''))) filter (where coalesce(tr.artist,'') <> ''),
    count(distinct lower(coalesce(tr.main_genre,''))) filter (where coalesce(tr.main_genre,'') <> ''),
    count(*) filter (where tr.release_date is not null and tr.release_date >= (now() - interval '90 days')::date),
    avg(least(1, coalesce((dt.feature_snapshot->>'total_reactions')::numeric, 0) / 20)),
    count(*) filter (where dt.feature_snapshot->>'behavior_score' is null),
    avg(least(100, coalesce((dt.feature_snapshot->>'events')::numeric, 0) / 80 * 100)),
    count(*) filter (where tr.main_genre is null or tr.mood is null)
  into v_fit_avg, v_fit_missing, v_qc_avg, v_qc_missing, v_artists, v_genres, v_new_cnt,
       v_react_conf, v_rep_missing, v_fatigue_avg, v_meta_missing
  from public.ai_recommendation_draft_tracks dt
  join public.tracks tr on tr.id = dt.track_id
  where dt.draft_id = p_draft_id and dt.selected;

  select max(c) into v_max_artist from (
    select count(*) as c from public.ai_recommendation_draft_tracks dt
    join public.tracks tr on tr.id = dt.track_id
    where dt.draft_id = p_draft_id and dt.selected and coalesce(tr.artist,'') <> ''
    group by lower(tr.artist)) x;

  v_missing_ratio := (coalesce(v_fit_missing,0) + coalesce(v_qc_missing,0))::numeric / (2 * v_sel);

  v_c_elig := case when array_length(v_hard_arr, 1) is null then 100 else 0 end;
  v_c_fit := case when v_fit_missing >= v_sel then null else round(least(100, greatest(0, v_fit_avg)), 1) end;
  v_c_policy := v_c_elig; -- 정책 위반은 Hard 로만 판정(위반=0).
  v_c_quality := case when v_qc_missing >= v_sel then null else round(least(100, greatest(0, v_qc_avg)), 1) end;
  v_c_react := round(coalesce(v_react_conf, 0) * 100, 1); -- Confidence(표본 20건 기준) — 데이터 0이면 0.
  v_c_rep := case when v_rep_missing >= v_sel then null else round((1 - v_rep_missing::numeric / v_sel) * 100, 1) end;
  v_c_novel := round((v_new_cnt::numeric / v_sel) * 100, 1);
  v_c_fatigue := round(greatest(0, 100 - coalesce(v_fatigue_avg, 0)), 1);
  v_c_fair := case when v_max_artist is null then null
    else round(least(100, (v_artists::numeric / v_sel) * 70 + greatest(0, 1 - (v_max_artist::numeric / v_sel) / 0.3) * 30), 1) end;
  v_c_meta := round((1 - v_meta_missing::numeric / v_sel) * 100, 1);

  if array_length(v_hard_arr, 1) is not null then
    v_score := 0; v_grade := 'D';
  elsif v_missing_ratio > 0.4 then
    v_score := null; v_grade := 'insufficient_data';
  else
    -- 가중 평균(존재 신호만; playlist/sequence/exposure 는 서버 집계 불가 — 재정규화).
    select round(sum(val * w) / nullif(sum(w), 0), 1) into v_score from (values
      (v_c_fit, 20::numeric), (v_c_policy, 15), (v_c_quality, 10), (v_c_react, 10),
      (v_c_rep, 5), (v_c_novel, 5), (v_c_fatigue, 5), (v_c_fair, 3), (v_c_meta, 2)
    ) t(val, w) where val is not null;
    v_grade := case when v_score is null then 'insufficient_data'
      when v_score >= 85 then 'A' when v_score >= 70 then 'B' when v_score >= 55 then 'C' else 'D' end;
  end if;

  return jsonb_build_object(
    'score', v_score, 'grade', v_grade,
    'hard_violations', to_jsonb(coalesce(v_hard_arr, '{}')), 'hard_detail', v_hard,
    'missing_ratio', round(v_missing_ratio, 3),
    'breakdown', jsonb_build_object(
      'eligibility', v_c_elig, 'storeFit', v_c_fit, 'policyCompliance', v_c_policy,
      'trackQuality', v_c_quality, 'playlistCompatibility', null, 'sequenceCompatibility', null,
      'reactionSignal', v_c_react, 'reputation', v_c_rep, 'novelty', v_c_novel,
      'fatigueControl', v_c_fatigue, 'exposureControl', null, 'artistFairness', v_c_fair,
      'metadataCompleteness', v_c_meta, 'overallScore', v_score),
    'notes', jsonb_build_array(
      'playlistCompatibility/sequenceCompatibility/exposureControl 은 서버 원장 부재로 클라이언트 breakdown 참고(가중치 재정규화).',
      'exposure_ledger not_available — 30일 재생 이벤트 프록시만 사용.'));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Draft 생성 — 서버 Hard Gate + Rank 무결성 재검증. 위반 시 저장 거부.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_rec_draft_create(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text := p_payload->>'name';
  v_mode text := coalesce(nullif(p_payload->>'recommendation_mode',''), 'store');
  v_tracks jsonb := p_payload->'tracks';
  v_target int := (p_payload->>'target_track_count')::int;
  v_hash text; v_dup uuid; v_id uuid; v_item jsonb; v_quality jsonb;
  v_sel int;
begin
  perform public._admin_growth_guard();

  if coalesce(v_name,'') = '' then raise exception 'name required' using errcode = '22023'; end if;
  if v_target is null or v_target < 1 or v_target > 100 then
    raise exception 'target_track_count must be 1..100' using errcode = '22023';
  end if;
  if v_tracks is null or jsonb_typeof(v_tracks) <> 'array' or jsonb_array_length(v_tracks) = 0 then
    raise exception 'tracks required' using errcode = '22023';
  end if;
  if jsonb_array_length(v_tracks) > 300 then
    raise exception 'too many tracks (max 300 incl. excluded)' using errcode = '22023';
  end if;
  if length(p_payload::text) > 400000 then
    raise exception 'payload too large' using errcode = '22023';
  end if;

  v_hash := md5(coalesce(p_payload->'input_snapshot','{}'::jsonb)::text
    || coalesce(p_payload->'weight_snapshot','{}'::jsonb)::text
    || coalesce(p_payload->'constraint_snapshot','{}'::jsonb)::text
    || coalesce(p_payload->>'seed','1'));
  select id into v_dup from public.ai_recommendation_drafts
  where input_hash = v_hash and status in ('draft','ready_for_review')
    and created_at >= now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_dup is not null then
    return public.admin_ai_rec_draft_detail(v_dup) || jsonb_build_object('duplicate', true);
  end if;

  insert into public.ai_recommendation_drafts(
    name, recommendation_mode, store_id, store_type, brand_id,
    source_playlist_id, playlist_draft_id, sequence_draft_id, current_track_id,
    target_track_count, candidate_count, eligible_count, selected_count,
    seed, algorithm_version, input_snapshot, weight_snapshot, constraint_snapshot,
    explanation, warnings, insufficient_data, input_hash, created_by)
  values (
    v_name, v_mode,
    nullif(p_payload->>'store_id','')::uuid, nullif(p_payload->>'store_type',''),
    nullif(p_payload->>'brand_id','')::uuid,
    nullif(p_payload->>'source_playlist_id','')::uuid,
    nullif(p_payload->>'playlist_draft_id','')::uuid,
    nullif(p_payload->>'sequence_draft_id','')::uuid,
    nullif(p_payload->>'current_track_id','')::uuid,
    v_target,
    coalesce((p_payload->>'candidate_count')::int, jsonb_array_length(v_tracks)),
    coalesce((p_payload->>'eligible_count')::int, 0),
    0,
    coalesce((p_payload->>'seed')::bigint, 1),
    coalesce(nullif(p_payload->>'algorithm_version',''), 'rec-v2'),
    coalesce(p_payload->'input_snapshot', '{}'::jsonb),
    coalesce(p_payload->'weight_snapshot', '{}'::jsonb),
    coalesce(p_payload->'constraint_snapshot', '{}'::jsonb),
    coalesce(p_payload->'explanation', '[]'::jsonb),
    coalesce(p_payload->'warnings', '[]'::jsonb),
    coalesce(p_payload->'insufficient_data', '[]'::jsonb),
    v_hash, auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_tracks) loop
    insert into public.ai_recommendation_draft_tracks(
      draft_id, track_id, rank, selected, eligible, final_score,
      score_breakdown, selection_reasons, exclusion_reasons, feature_snapshot)
    values (
      v_id, (v_item->>'track_id')::uuid, (v_item->>'rank')::int,
      coalesce((v_item->>'selected')::boolean, true),
      coalesce((v_item->>'eligible')::boolean, true),
      least(100, greatest(0, coalesce((v_item->>'final_score')::numeric, 0))),
      coalesce(v_item->'score_breakdown', '{}'::jsonb),
      coalesce(v_item->'selection_reasons', '[]'::jsonb),
      coalesce(v_item->'exclusion_reasons', '[]'::jsonb),
      coalesce(v_item->'feature_snapshot', '{}'::jsonb));
  end loop;

  select count(*) into v_sel from public.ai_recommendation_draft_tracks where draft_id = v_id and selected;
  update public.ai_recommendation_drafts set selected_count = v_sel where id = v_id;

  -- 서버 재검증(Hard Gate + Rank 무결성). 위반 → 저장 거부(rollback).
  v_quality := public._ai_rec_draft_quality(v_id);
  if jsonb_array_length(v_quality->'hard_violations') > 0 then
    raise exception 'recommendation_draft_rejected: % (hard gate / rank integrity)', v_quality->'hard_violations'
      using errcode = '23514';
  end if;
  update public.ai_recommendation_drafts set
    quality_score = (v_quality->>'score')::numeric,
    quality_grade = v_quality->>'grade',
    quality_breakdown = v_quality
  where id = v_id;

  insert into public.ai_recommendation_draft_events(draft_id, event_type, actor_id, next_status, metadata)
  values (v_id, 'created', auth.uid(), 'draft',
    jsonb_build_object('selected', v_sel, 'quality', v_quality->>'score'));

  return public.admin_ai_rec_draft_detail(v_id);
end;
$$;

grant execute on function public.admin_ai_rec_draft_create(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/상세/재평가/상태 전이 — Production Apply RPC 는 존재하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_rec_drafts(p_status text default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit, 50), 200)); v_result jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_result
  from (
    select d.id, d.name, d.recommendation_mode, d.status, d.store_type, d.brand_id,
      d.target_track_count, d.candidate_count, d.eligible_count, d.selected_count,
      d.quality_score, d.quality_grade,
      (d.comparison_summary <> '{}'::jsonb) as has_v1_comparison,
      d.algorithm_version, d.seed, d.expires_at, d.created_at, d.reviewed_at,
      u.nickname as created_by_name, r.nickname as reviewed_by_name
    from public.ai_recommendation_drafts d
    left join public.users u on u.id = d.created_by
    left join public.users r on r.id = d.reviewed_by
    where p_status is null or d.status = p_status
    order by d.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_rec_drafts(text, int) to authenticated;

create or replace function public.admin_ai_rec_draft_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_draft jsonb; v_tracks jsonb; v_events jsonb; v_comparisons jsonb;
begin
  perform public._admin_growth_guard();

  select to_jsonb(d) into v_draft from public.ai_recommendation_drafts d where d.id = p_id;
  if v_draft is null then raise exception 'draft not found: %', p_id using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.rank), '[]'::jsonb) into v_tracks
  from (
    select dt.track_id, dt.rank, dt.selected, dt.eligible, dt.final_score,
      dt.score_breakdown, dt.selection_reasons, dt.exclusion_reasons, dt.feature_snapshot,
      dt.v1_rank, dt.rank_delta,
      tr.title, tr.artist, tr.album_name, tr.main_genre, tr.mood, tr.bpm
    from public.ai_recommendation_draft_tracks dt
    left join public.tracks tr on tr.id = dt.track_id
    where dt.draft_id = p_id
  ) t;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_events
  from (
    select ev.event_type, ev.actor_id, ev.previous_status, ev.next_status, ev.reason, ev.metadata, ev.created_at,
      u.nickname as actor_name
    from public.ai_recommendation_draft_events ev
    left join public.users u on u.id = ev.actor_id
    where ev.draft_id = p_id
    order by ev.created_at desc limit 50
  ) e;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb) into v_comparisons
  from (
    select comparison_type, baseline_version, candidate_version, metrics, created_at
    from public.ai_recommendation_comparisons where draft_id = p_id
    order by created_at desc limit 10
  ) c;

  return jsonb_build_object('draft', v_draft, 'tracks', v_tracks, 'events', v_events,
    'comparisons', v_comparisons, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_rec_draft_detail(uuid) to authenticated;

create or replace function public.admin_ai_rec_draft_reevaluate(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_quality jsonb; v_status text;
begin
  perform public._admin_growth_guard();
  select status into v_status from public.ai_recommendation_drafts where id = p_id;
  if v_status is null then raise exception 'draft not found: %', p_id using errcode = 'P0002'; end if;

  v_quality := public._ai_rec_draft_quality(p_id);
  update public.ai_recommendation_drafts set
    quality_score = (v_quality->>'score')::numeric,
    quality_grade = v_quality->>'grade',
    quality_breakdown = v_quality
  where id = p_id;

  insert into public.ai_recommendation_draft_events(draft_id, event_type, actor_id, metadata)
  values (p_id, 'reevaluated', auth.uid(),
    jsonb_build_object('quality', v_quality->>'score', 'grade', v_quality->>'grade',
      'hard_violations', v_quality->'hard_violations'));

  return public.admin_ai_rec_draft_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_rec_draft_reevaluate(uuid) to authenticated;

create or replace function public.admin_ai_rec_draft_set_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare d record; v_allowed boolean; v_quality jsonb;
begin
  perform public._admin_growth_guard();

  select * into d from public.ai_recommendation_drafts where id = p_id;
  if d.id is null then raise exception 'draft not found: %', p_id using errcode = 'P0002'; end if;

  if p_status not in ('draft','ready_for_review','approved','rejected','expired','archived') then
    raise exception 'invalid status: %', p_status using errcode = '22023';
  end if;

  v_allowed := (d.status = 'draft' and p_status in ('ready_for_review','archived'))
    or (d.status = 'ready_for_review' and p_status in ('approved','rejected','draft','archived'))
    or (d.status in ('approved','rejected') and p_status = 'archived')
    or (p_status = 'expired' and now() > d.expires_at);
  if not v_allowed then
    raise exception 'transition not allowed: % -> %', d.status, p_status using errcode = '22023';
  end if;

  if p_status = 'ready_for_review' then
    v_quality := public._ai_rec_draft_quality(p_id);
    if jsonb_array_length(v_quality->'hard_violations') > 0 then
      raise exception 'hard violations block review: %', v_quality->'hard_violations' using errcode = '23514';
    end if;
    update public.ai_recommendation_drafts set
      quality_score = (v_quality->>'score')::numeric, quality_grade = v_quality->>'grade', quality_breakdown = v_quality
    where id = p_id;
  end if;

  if p_status = 'rejected' and coalesce(p_reason,'') = '' then
    raise exception 'rejection_reason required' using errcode = '22023';
  end if;

  update public.ai_recommendation_drafts set
    status = p_status,
    reviewed_by = case when p_status in ('approved','rejected') then auth.uid() else reviewed_by end,
    reviewed_at = case when p_status in ('approved','rejected') then now() else reviewed_at end,
    rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end
  where id = p_id;

  insert into public.ai_recommendation_draft_events(draft_id, event_type, actor_id, previous_status, next_status, reason)
  values (p_id, 'status_changed', auth.uid(), d.status, p_status, p_reason);

  return public.admin_ai_rec_draft_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_rec_draft_set_status(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) v1 Shadow Comparison — Production v1 RPC 를 **읽기 전용 호출**(무변경)해
--    동일 Context 의 Top-N 을 비교하고 결과를 Draft 에만 기록한다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_rec_compare_v1(p_draft_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d record;
  v_limit int;
  v_overlap int := 0; v_v1_only int := 0; v_v2_only int := 0;
  v_v1_count int; v_v2_count int;
  v_metrics jsonb;
begin
  perform public._admin_growth_guard();

  select * into d from public.ai_recommendation_drafts where id = p_draft_id;
  if d.id is null then raise exception 'draft not found: %', p_draft_id using errcode = 'P0002'; end if;

  v_limit := least(coalesce((d.input_snapshot->>'candidate_limit')::int, d.target_track_count), 50);

  -- v1 결과 수집(읽기 전용) — Context 는 Draft input_snapshot 의 v1 호환 필드만 사용.
  create temp table _v1_result on commit drop as
  select row_number() over () - 1 as v1_rank, r.track_id
  from public.recommend_tracks_by_context(
    nullif(d.input_snapshot->>'time_slot',''),
    nullif(d.input_snapshot->>'situation',''),
    coalesce(nullif(d.input_snapshot->>'business_type',''), d.store_type),
    nullif(d.input_snapshot->>'mood',''),
    v_limit) r;

  select count(*) into v_v1_count from _v1_result;
  select count(*) into v_v2_count from public.ai_recommendation_draft_tracks
  where draft_id = p_draft_id and selected;

  -- v1_rank / rank_delta 기록(Draft 내부에만 저장 — v1 은 무변경).
  update public.ai_recommendation_draft_tracks dt set
    v1_rank = v1.v1_rank,
    rank_delta = dt.rank - v1.v1_rank
  from _v1_result v1
  where dt.draft_id = p_draft_id and dt.track_id = v1.track_id;

  select count(*) into v_overlap
  from public.ai_recommendation_draft_tracks dt
  join _v1_result v1 on v1.track_id = dt.track_id
  where dt.draft_id = p_draft_id and dt.selected;
  v_v1_only := greatest(0, v_v1_count - v_overlap);
  v_v2_only := greatest(0, v_v2_count - v_overlap);

  v_metrics := jsonb_build_object(
    'v1_count', v_v1_count, 'v2_count', v_v2_count,
    'top_n_overlap', v_overlap,
    'overlap_ratio', case when v_v2_count > 0 then round(v_overlap::numeric / v_v2_count, 3) else null end,
    'v1_only', v_v1_only, 'v2_only', v_v2_only,
    'v1_supported_context', jsonb_build_object(
      'time_slot', d.input_snapshot->>'time_slot', 'situation', d.input_snapshot->>'situation',
      'business_type', coalesce(nullif(d.input_snapshot->>'business_type',''), d.store_type),
      'mood', d.input_snapshot->>'mood'),
    'limitations', jsonb_build_array(
      'v1(recommend_tracks_by_context)은 time_slot/situation/business_type/mood 만 지원 — 그 외 Context 는 비교 불가로 명시.',
      'v1 결과는 저장/변경하지 않음(읽기 전용 호출).'),
    'compared_at', now());

  insert into public.ai_recommendation_comparisons(draft_id, comparison_type, baseline_version, candidate_version, metrics)
  values (p_draft_id, 'v1_context', 'recommend_tracks_by_context(v1)', d.algorithm_version, v_metrics);

  update public.ai_recommendation_drafts set comparison_summary = v_metrics where id = p_draft_id;

  insert into public.ai_recommendation_draft_events(draft_id, event_type, actor_id, metadata)
  values (p_draft_id, 'v1_compared', auth.uid(), v_metrics);

  return public.admin_ai_rec_draft_detail(p_draft_id);
end;
$$;

grant execute on function public.admin_ai_rec_compare_v1(uuid) to authenticated;
