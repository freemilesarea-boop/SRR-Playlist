-- ============================================
-- 0565_ai_playlist_intel_core.sql
--
-- Phase AI-PLAYLIST-INTEL-1 — Playlist Intelligence Core & Safe Draft Generation.
--
-- 기존 Production 재생 경로(Playback/Player/Queue/Scheduler/get_playlist_tracks/
-- recommend_* RPC/Auto Placement/일일 Refresh/Store Fit/Guardrail/Reaction Learning/
-- 정산 v1·v2/Stream Event) **전부 무변경**. 이 마이그레이션은 Shadow/Draft/Advisory
-- 전용 자산만 추가한다.
--
-- 흐름: Production Read Models → Candidate Pool → Constraint/Diversity/Energy 평가
--       → Playlist Draft → Quality Score → Explainability → Human Review. **여기서 종료.**
-- 금지: Draft → playlists/playlist_tracks INSERT, Queue/Scheduler/Player 반영,
--       자동 승인, 자동 Publish, Production Trigger. Publish RPC 는 존재하지 않는다.
--
-- 기존 자산 재사용: _admin_growth_guard(0472) · _touch_updated_at(0025) ·
--   released 판정(0138: visibility_status='approved' AND (release_status='released'
--   OR source_type='admin_upload') AND removed_at IS NULL) ·
--   genre_block_rules 매칭 규칙(0221: lower(main_genre) like '%'||pattern||'%') ·
--   track_store_exclusions(0246) · playlist_track_fit_scores(0156) ·
--   audio_qc_reports(0224) · track_audio_features/track_ai_metadata(0156).
--
-- 0487 playlist_drafts 는 status 3종 + tracks jsonb 임베드 계약(기존 RPC/테스트)이
-- 있어 무변경 유지한다. Intelligence Core 는 6-status Workflow + 정규화 Track +
-- Audit Event + RLS 가 필요해 별도 Shadow 테이블로 구성한다(중복 아님 — 목적 상이).
--
-- Approved 는 "사람이 Draft 품질을 검토하고 승인했다"는 감사 기록일 뿐이며
-- 실제 Playlist Publish 가 아니다.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Draft 본체 — Shadow 전용. Production Playlist 와 Cascade 연결 금지
--    (source_playlist_id 는 on delete set null; 삭제 방향은 Production→Draft 단방향).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playlist_drafts (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 1 and 200),
  generation_mode       text not null default 'store'
    check (generation_mode in ('store','brand','industry','daypart','manual_assist')),
  store_id              uuid,
  store_type            text,
  brand_key             text,
  source_playlist_id    uuid references public.playlists(id) on delete set null,
  target_track_count    int not null check (target_track_count between 1 and 200),
  candidate_track_count int not null default 0 check (candidate_track_count >= 0),
  selected_track_count  int not null default 0 check (selected_track_count >= 0),
  status                text not null default 'draft'
    check (status in ('draft','ready_for_review','approved','rejected','expired','archived')),
  algorithm_version     text not null,
  input_snapshot        jsonb not null default '{}'::jsonb,
  constraint_snapshot   jsonb not null default '{}'::jsonb,
  relaxations           jsonb not null default '[]'::jsonb,
  quality_score         numeric check (quality_score is null or (quality_score >= 0 and quality_score <= 100)),
  quality_grade         text check (quality_grade is null or quality_grade in ('A','B','C','D','insufficient_data')),
  quality_breakdown     jsonb not null default '{}'::jsonb,
  explanation           jsonb not null default '[]'::jsonb,
  warnings              jsonb not null default '[]'::jsonb,
  insufficient_data     jsonb not null default '[]'::jsonb,
  input_hash            text,
  created_by            uuid,
  reviewed_by           uuid,
  reviewed_at           timestamptz,
  rejection_reason      text,
  expires_at            timestamptz not null default now() + interval '30 days',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.ai_playlist_drafts is
  'AI-PLAYLIST-INTEL-1 — Playlist Intelligence Draft(Shadow). 실제 Playlist/Queue/Player 미반영. Approved=검토 감사 기록.';

create index if not exists idx_ai_pl_drafts_status on public.ai_playlist_drafts (status, created_at desc);
create index if not exists idx_ai_pl_drafts_store on public.ai_playlist_drafts (store_type, created_at desc);
create index if not exists idx_ai_pl_drafts_hash on public.ai_playlist_drafts (input_hash, created_at desc);

drop trigger if exists tg_ai_pl_drafts_touch on public.ai_playlist_drafts;
create trigger tg_ai_pl_drafts_touch before update on public.ai_playlist_drafts
  for each row execute function public._touch_updated_at();

alter table public.ai_playlist_drafts enable row level security;
-- 정책 없음(deny-all) — 접근은 아래 SECURITY DEFINER 관리자 RPC 로만.

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Draft Track — 정규화 저장. track FK 는 Production→Draft 단방향 cascade
--    (트랙 hard-delete 시 draft 행 정리; draft 삭제는 Production 에 영향 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playlist_draft_tracks (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null references public.ai_playlist_drafts(id) on delete cascade,
  track_id          uuid not null references public.tracks(id) on delete cascade,
  draft_order       int not null check (draft_order >= 0),
  selection_score   numeric check (selection_score is null or (selection_score >= 0 and selection_score <= 100)),
  selected          boolean not null default true,
  selection_reasons jsonb not null default '[]'::jsonb,
  exclusion_reasons jsonb not null default '[]'::jsonb,
  feature_snapshot  jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  unique (draft_id, track_id)
);

comment on table public.ai_playlist_draft_tracks is
  'AI-PLAYLIST-INTEL-1 — Draft 선택/제외 Track + Evidence. playlist_tracks 와 무관(Publish 없음).';

create index if not exists idx_ai_pl_draft_tracks_draft on public.ai_playlist_draft_tracks (draft_id, draft_order);

alter table public.ai_playlist_draft_tracks enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Draft Audit Event
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playlist_draft_events (
  id              uuid primary key default gen_random_uuid(),
  draft_id        uuid not null references public.ai_playlist_drafts(id) on delete cascade,
  event_type      text not null check (event_type in ('created','reevaluated','status_changed','note')),
  actor_id        uuid,
  previous_status text,
  next_status     text,
  reason          text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

comment on table public.ai_playlist_draft_events is
  'AI-PLAYLIST-INTEL-1 — Draft Audit(생성/재평가/상태 변경). 승인자·시각·사유 기록.';

create index if not exists idx_ai_pl_draft_events_draft on public.ai_playlist_draft_events (draft_id, created_at desc);

alter table public.ai_playlist_draft_events enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Hard Gate 서버 재검증 — 클라이언트 결과를 신뢰하지 않는다.
--    released(0138 규칙)/Store 제외/차단 장르/Explicit/Instrumental/QC/fit excluded.
--    반환: 위반 목록(빈 배열이면 통과). STABLE(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public._ai_pl_hard_violations(
  p_track_ids uuid[],
  p_store_type text,
  p_source_playlist_id uuid,
  p_block_explicit boolean,
  p_require_instrumental boolean,
  p_min_qc numeric
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with sel as (select unnest(coalesce(p_track_ids, '{}')) as track_id),
  latest_qc as (
    select distinct on (q.track_id) q.track_id, q.qc_score
    from public.audio_qc_reports q
    join sel s on s.track_id = q.track_id
    order by q.track_id, q.created_at desc
  ),
  checks as (
    select s.track_id,
      case when tr.id is null then 'not_found'
           when tr.removed_at is not null
             or tr.visibility_status is distinct from 'approved'
             or not (tr.release_status = 'released' or tr.source_type = 'admin_upload')
             then 'not_released'
           when p_store_type is not null and exists (
             select 1 from public.track_store_exclusions ex
             where ex.track_id = tr.id and ex.store_type_slug = p_store_type and ex.is_active
           ) then 'store_excluded'
           when p_store_type is not null and exists (
             select 1 from public.genre_block_rules gb
             where gb.business_category = p_store_type and gb.block_kind = 'block'
               and (lower(coalesce(tr.main_genre,'')) like '%' || lower(gb.genre_pattern) || '%'
                 or lower(coalesce(tr.sub_genre,'')) like '%' || lower(gb.genre_pattern) || '%')
           ) then 'genre_blocked'
           when p_block_explicit and coalesce(tr.explicit_content, false) then 'explicit_blocked'
           when p_require_instrumental and coalesce(tr.instrumental, false) = false then 'instrumental_required'
           when p_min_qc is not null and lq.qc_score is not null and lq.qc_score < p_min_qc then 'qc_below_min'
           when p_source_playlist_id is not null and exists (
             select 1 from public.playlist_track_fit_scores f
             where f.playlist_id = p_source_playlist_id and f.track_id = tr.id and f.status = 'excluded'
           ) then 'fit_excluded'
           else null end as violation
    from sel s
    left join public.tracks tr on tr.id = s.track_id
    left join latest_qc lq on lq.track_id = s.track_id
  )
  select coalesce(
    jsonb_agg(jsonb_build_object('track_id', track_id, 'violation', violation)) filter (where violation is not null),
    '[]'::jsonb)
  from checks;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Candidate Pool — 읽기 전용. Production Read Model 조인(수정 없음).
--    후보 상한 500(Full Scan 방지: released 필터 + KPI 조인 + limit).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pl_candidate_pool(p_filters jsonb default '{}'::jsonb)
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
      af.energy, af.vocal_presence, af.instrumentalness, af.tempo_stability,
      lq.qc_score, lq.qc_grade,
      f.fit_score, f.status as fit_status,
      k.events, k.last_event_at,
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
    'items', v_result,
    'store_type', v_store_type,
    'source_playlist_id', v_playlist_id,
    'limit', v_limit,
    'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_pl_candidate_pool(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 서버측 Quality 재계산 — 클라이언트 점수를 그대로 저장하지 않는다.
--    저장된 Draft Track(feature_snapshot) + 실시간 Hard Gate 재검증으로 계산.
--    가중치(코드 상수와 동일): policy 20 · storeFit 20 · genreBalance 20 ·
--    artistDiversity 20 · energyConsistency 10 · vocalBalance 5 · novelty 5.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public._ai_pl_draft_quality(p_draft_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  d record;
  v_n int; v_missing int; v_missing_ratio numeric;
  v_hard jsonb; v_hard_count int;
  v_artists int; v_max_artist int; v_albums int; v_max_album int; v_max_genre int;
  v_fit_avg numeric; v_fit_missing int;
  v_energy_avg numeric; v_energy_sd numeric; v_energy_missing int;
  v_vocal_missing int; v_instrumental_cnt int;
  v_new_cnt int;
  v_policy numeric; v_storefit numeric; v_genre_bal numeric; v_artist_div numeric;
  v_album_div numeric; v_energy_cons numeric; v_vocal_bal numeric; v_novelty numeric;
  v_mood_bal numeric; v_rep_risk numeric;
  v_score numeric; v_grade text;
begin
  select * into d from public.ai_playlist_drafts where id = p_draft_id;
  if d.id is null then raise exception 'draft not found: %', p_draft_id using errcode = 'P0002'; end if;

  select count(*) into v_n from public.ai_playlist_draft_tracks dt where dt.draft_id = p_draft_id and dt.selected;
  if v_n = 0 then
    return jsonb_build_object('score', null, 'grade', 'insufficient_data', 'hard_violations', 0,
      'breakdown', '{}'::jsonb, 'reason', 'no_selected_tracks');
  end if;

  v_hard := public._ai_pl_hard_violations(
    (select array_agg(dt.track_id) from public.ai_playlist_draft_tracks dt where dt.draft_id = p_draft_id and dt.selected),
    d.store_type, d.source_playlist_id,
    coalesce((d.constraint_snapshot->>'block_explicit')::boolean, false),
    coalesce((d.constraint_snapshot->>'require_instrumental')::boolean, false),
    (d.constraint_snapshot->>'min_qc')::numeric);
  v_hard_count := jsonb_array_length(v_hard);

  select
    count(distinct lower(coalesce(tr.artist,''))) filter (where coalesce(tr.artist,'') <> ''),
    count(distinct lower(coalesce(tr.album_name,''))) filter (where coalesce(tr.album_name,'') <> ''),
    avg((dt.feature_snapshot->>'fit_score')::numeric) filter (where dt.feature_snapshot->>'fit_score' is not null),
    count(*) filter (where dt.feature_snapshot->>'fit_score' is null),
    avg(af.energy), stddev_pop(af.energy), count(*) filter (where af.energy is null),
    count(*) filter (where af.vocal_presence is null and tr.instrumental is null),
    count(*) filter (where coalesce(tr.instrumental, false)),
    count(*) filter (where tr.release_date is not null and tr.release_date >= (now() - interval '90 days')::date),
    count(*) filter (where dt.feature_snapshot is null or dt.feature_snapshot = '{}'::jsonb)
  into v_artists, v_albums,
       v_fit_avg, v_fit_missing, v_energy_avg, v_energy_sd, v_energy_missing,
       v_vocal_missing, v_instrumental_cnt, v_new_cnt, v_missing
  from public.ai_playlist_draft_tracks dt
  join public.tracks tr on tr.id = dt.track_id
  left join public.track_audio_features af on af.track_id = dt.track_id
  where dt.draft_id = p_draft_id and dt.selected;

  -- 편중(share)은 그룹별 최대 건수로 계산.
  select max(c) into v_max_artist from (
    select count(*) as c from public.ai_playlist_draft_tracks dt join public.tracks tr on tr.id = dt.track_id
    where dt.draft_id = p_draft_id and dt.selected and coalesce(tr.artist,'') <> ''
    group by lower(tr.artist)) x;
  select max(c) into v_max_album from (
    select count(*) as c from public.ai_playlist_draft_tracks dt join public.tracks tr on tr.id = dt.track_id
    where dt.draft_id = p_draft_id and dt.selected and coalesce(tr.album_name,'') <> ''
    group by lower(tr.album_name)) x;
  select max(c) into v_max_genre from (
    select count(*) as c from public.ai_playlist_draft_tracks dt join public.tracks tr on tr.id = dt.track_id
    where dt.draft_id = p_draft_id and dt.selected and coalesce(tr.main_genre,'') <> ''
    group by lower(tr.main_genre)) x;

  v_missing_ratio := (coalesce(v_energy_missing,0) + coalesce(v_fit_missing,0))::numeric / (2 * v_n);

  v_policy := greatest(0, 100 - v_hard_count * 100);
  v_storefit := case when v_fit_missing >= v_n then null else round(least(100, greatest(0, v_fit_avg)), 1) end;
  v_genre_bal := case when v_max_genre is null then null
    else round(greatest(0, 100 - greatest(0, (v_max_genre::numeric / v_n) - 0.5) * 200), 1) end;
  v_artist_div := round(least(100,
      (v_artists::numeric / v_n) * 70 + greatest(0, 1 - (coalesce(v_max_artist,0)::numeric / v_n) / 0.3) * 30) * 1, 1);
  v_album_div := case when v_albums = 0 then null
    else round(least(100, (v_albums::numeric / v_n) * 100), 1) end;
  v_energy_cons := case when v_energy_missing >= v_n then null
    else round(greatest(0, 100 - coalesce(v_energy_sd, 0) * 200 - (v_energy_missing::numeric / v_n) * 30), 1) end;
  v_vocal_bal := round(100 - abs((v_instrumental_cnt::numeric / v_n) -
      coalesce((d.constraint_snapshot->>'target_instrumental_ratio')::numeric, v_instrumental_cnt::numeric / v_n)) * 100, 1);
  v_novelty := round((v_new_cnt::numeric / v_n) * 100, 1);
  v_mood_bal := null; -- mood 분포 목표치 정책 부재 — 임의 목표를 만들지 않는다(insufficient).
  v_rep_risk := (select round(avg(least(100, coalesce((dt.feature_snapshot->>'events')::numeric, 0) / 80 * 100)), 1)
    from public.ai_playlist_draft_tracks dt where dt.draft_id = p_draft_id and dt.selected);

  if v_missing_ratio > 0.4 then
    v_score := null; v_grade := 'insufficient_data';
  else
    -- 가중 평균(존재 항목만; 가중치는 헤더 명시 상수).
    select round(sum(val * w) / nullif(sum(w), 0), 1) into v_score from (values
      (v_policy, 20::numeric), (v_storefit, 20), (v_genre_bal, 20), (v_artist_div, 20),
      (v_energy_cons, 10), (v_vocal_bal, 5), (v_novelty, 5)
    ) t(val, w) where val is not null;
    v_grade := case when v_score is null then 'insufficient_data'
      when v_score >= 85 then 'A' when v_score >= 70 then 'B' when v_score >= 55 then 'C' else 'D' end;
  end if;

  return jsonb_build_object(
    'score', v_score, 'grade', v_grade, 'hard_violations', v_hard_count, 'hard_detail', v_hard,
    'missing_ratio', round(v_missing_ratio, 3),
    'breakdown', jsonb_build_object(
      'policyCompliance', v_policy, 'storeFit', v_storefit, 'genreBalance', v_genre_bal,
      'moodBalance', v_mood_bal, 'artistDiversity', v_artist_div, 'albumDiversity', v_album_div,
      'energyConsistency', v_energy_cons, 'vocalBalance', v_vocal_bal,
      'novelty', v_novelty, 'repetitionRisk', v_rep_risk));
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Draft 생성 — 서버 Hard Gate 재검증 후 저장. 위반 시 저장 거부.
--    Idempotency: 동일 input_hash + 10분 내 기존 draft 반환(중복 생성 방지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pl_draft_create(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_name text := p_payload->>'name';
  v_mode text := coalesce(nullif(p_payload->>'generation_mode',''), 'store');
  v_store_type text := nullif(p_payload->>'store_type','');
  v_playlist_id uuid := nullif(p_payload->>'source_playlist_id','')::uuid;
  v_target int := (p_payload->>'target_track_count')::int;
  v_tracks jsonb := p_payload->'tracks';
  v_input jsonb := coalesce(p_payload->'input_snapshot', '{}'::jsonb);
  v_constraints jsonb := coalesce(p_payload->'constraint_snapshot', '{}'::jsonb);
  v_hash text; v_dup uuid; v_id uuid;
  v_selected_ids uuid[]; v_hard jsonb; v_quality jsonb;
  v_row record; v_i int := 0; v_item jsonb;
begin
  perform public._admin_growth_guard();

  if coalesce(v_name,'') = '' then raise exception 'name required' using errcode = '22023'; end if;
  if v_target is null or v_target < 1 or v_target > 200 then
    raise exception 'target_track_count must be 1..200' using errcode = '22023';
  end if;
  if v_tracks is null or jsonb_typeof(v_tracks) <> 'array' or jsonb_array_length(v_tracks) = 0 then
    raise exception 'tracks required' using errcode = '22023';
  end if;
  if jsonb_array_length(v_tracks) > 400 then
    raise exception 'too many tracks (max 400 incl. excluded)' using errcode = '22023';
  end if;
  if length(p_payload::text) > 400000 then
    raise exception 'payload too large' using errcode = '22023';
  end if;

  -- Idempotency: 동일 조건 재생성 방지(10분).
  v_hash := md5(v_input::text || v_constraints::text || coalesce(v_store_type,'') || v_target::text);
  select id into v_dup from public.ai_playlist_drafts
  where input_hash = v_hash and status in ('draft','ready_for_review')
    and created_at >= now() - interval '10 minutes'
  order by created_at desc limit 1;
  if v_dup is not null then
    return public.admin_ai_pl_draft_detail(v_dup) || jsonb_build_object('duplicate', true);
  end if;

  select array_agg((e->>'track_id')::uuid) into v_selected_ids
  from jsonb_array_elements(v_tracks) e where coalesce((e->>'selected')::boolean, true);
  if v_selected_ids is null or array_length(v_selected_ids, 1) = 0 then
    raise exception 'no selected tracks' using errcode = '22023';
  end if;

  -- 서버 Hard Gate 재검증 — 클라이언트 판정을 신뢰하지 않음.
  v_hard := public._ai_pl_hard_violations(
    v_selected_ids, v_store_type, v_playlist_id,
    coalesce((v_constraints->>'block_explicit')::boolean, false),
    coalesce((v_constraints->>'require_instrumental')::boolean, false),
    (v_constraints->>'min_qc')::numeric);
  if jsonb_array_length(v_hard) > 0 then
    raise exception 'hard constraint violations: %', v_hard::text using errcode = '23514';
  end if;

  insert into public.ai_playlist_drafts(
    name, generation_mode, store_id, store_type, brand_key, source_playlist_id,
    target_track_count, candidate_track_count, selected_track_count,
    algorithm_version, input_snapshot, constraint_snapshot, relaxations,
    explanation, warnings, insufficient_data, input_hash, created_by)
  values (
    v_name, v_mode, nullif(p_payload->>'store_id','')::uuid, v_store_type,
    nullif(p_payload->>'brand_key',''), v_playlist_id,
    v_target, coalesce((p_payload->>'candidate_track_count')::int, jsonb_array_length(v_tracks)),
    coalesce(array_length(v_selected_ids, 1), 0),
    coalesce(nullif(p_payload->>'algorithm_version',''), 'pl-intel-core-v1'),
    v_input, v_constraints, coalesce(p_payload->'relaxations', '[]'::jsonb),
    coalesce(p_payload->'explanation', '[]'::jsonb),
    coalesce(p_payload->'warnings', '[]'::jsonb),
    coalesce(p_payload->'insufficient_data', '[]'::jsonb),
    v_hash, auth.uid())
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(v_tracks) loop
    insert into public.ai_playlist_draft_tracks(
      draft_id, track_id, draft_order, selection_score, selected,
      selection_reasons, exclusion_reasons, feature_snapshot)
    values (
      v_id, (v_item->>'track_id')::uuid, coalesce((v_item->>'draft_order')::int, v_i),
      least(100, greatest(0, coalesce((v_item->>'selection_score')::numeric, 0))),
      coalesce((v_item->>'selected')::boolean, true),
      coalesce(v_item->'selection_reasons', '[]'::jsonb),
      coalesce(v_item->'exclusion_reasons', '[]'::jsonb),
      coalesce(v_item->'feature_snapshot', '{}'::jsonb))
    on conflict (draft_id, track_id) do nothing;
    v_i := v_i + 1;
  end loop;

  -- 품질은 서버가 계산해 저장(클라이언트 점수 무시).
  v_quality := public._ai_pl_draft_quality(v_id);
  update public.ai_playlist_drafts set
    quality_score = (v_quality->>'score')::numeric,
    quality_grade = v_quality->>'grade',
    quality_breakdown = v_quality
  where id = v_id;

  insert into public.ai_playlist_draft_events(draft_id, event_type, actor_id, next_status, metadata)
  values (v_id, 'created', auth.uid(), 'draft',
    jsonb_build_object('selected', array_length(v_selected_ids,1), 'quality', v_quality->>'score'));

  return public.admin_ai_pl_draft_detail(v_id);
end;
$$;

grant execute on function public.admin_ai_pl_draft_create(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/상세/재평가/상태 변경 — Publish RPC 는 존재하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pl_drafts(p_status text default null, p_limit int default 50)
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
    select d.id, d.name, d.generation_mode, d.store_type, d.brand_key, d.status,
      d.target_track_count, d.candidate_track_count, d.selected_track_count,
      d.quality_score, d.quality_grade, d.algorithm_version, d.expires_at,
      d.created_at, d.reviewed_at, u.nickname as created_by_name, r.nickname as reviewed_by_name
    from public.ai_playlist_drafts d
    left join public.users u on u.id = d.created_by
    left join public.users r on r.id = d.reviewed_by
    where p_status is null or d.status = p_status
    order by d.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_pl_drafts(text, int) to authenticated;

create or replace function public.admin_ai_pl_draft_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_draft jsonb; v_tracks jsonb; v_events jsonb;
begin
  perform public._admin_growth_guard();

  select to_jsonb(d) into v_draft from public.ai_playlist_drafts d where d.id = p_id;
  if v_draft is null then raise exception 'draft not found: %', p_id using errcode = 'P0002'; end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.draft_order), '[]'::jsonb) into v_tracks
  from (
    select dt.track_id, dt.draft_order, dt.selection_score, dt.selected,
      dt.selection_reasons, dt.exclusion_reasons, dt.feature_snapshot,
      tr.title, tr.artist, tr.album_name, tr.main_genre, tr.mood, tr.bpm
    from public.ai_playlist_draft_tracks dt
    left join public.tracks tr on tr.id = dt.track_id
    where dt.draft_id = p_id
  ) t;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_events
  from (
    select ev.event_type, ev.actor_id, ev.previous_status, ev.next_status, ev.reason, ev.metadata, ev.created_at,
      u.nickname as actor_name
    from public.ai_playlist_draft_events ev
    left join public.users u on u.id = ev.actor_id
    where ev.draft_id = p_id
    order by ev.created_at desc limit 50
  ) e;

  return jsonb_build_object('draft', v_draft, 'tracks', v_tracks, 'events', v_events, 'generated_at', now());
end;
$$;

grant execute on function public.admin_ai_pl_draft_detail(uuid) to authenticated;

create or replace function public.admin_ai_pl_draft_reevaluate(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_quality jsonb; v_status text;
begin
  perform public._admin_growth_guard();

  select status into v_status from public.ai_playlist_drafts where id = p_id;
  if v_status is null then raise exception 'draft not found: %', p_id using errcode = 'P0002'; end if;

  v_quality := public._ai_pl_draft_quality(p_id);
  update public.ai_playlist_drafts set
    quality_score = (v_quality->>'score')::numeric,
    quality_grade = v_quality->>'grade',
    quality_breakdown = v_quality
  where id = p_id;

  insert into public.ai_playlist_draft_events(draft_id, event_type, actor_id, metadata)
  values (p_id, 'reevaluated', auth.uid(), jsonb_build_object('quality', v_quality->>'score', 'grade', v_quality->>'grade'));

  return public.admin_ai_pl_draft_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_pl_draft_reevaluate(uuid) to authenticated;

-- 상태 전이 화이트리스트. Hard 위반 존재 시 ready_for_review 승격 차단.
-- approved 는 감사 기록일 뿐 Publish 아님(Publish 경로 자체가 없음).
create or replace function public.admin_ai_pl_draft_set_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare d record; v_allowed boolean := false; v_quality jsonb;
begin
  perform public._admin_growth_guard();

  select * into d from public.ai_playlist_drafts where id = p_id;
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
    v_quality := public._ai_pl_draft_quality(p_id);
    if coalesce((v_quality->>'hard_violations')::int, 0) > 0 then
      raise exception 'hard constraint violations block review: %', v_quality->'hard_detail' using errcode = '23514';
    end if;
    update public.ai_playlist_drafts set
      quality_score = (v_quality->>'score')::numeric, quality_grade = v_quality->>'grade', quality_breakdown = v_quality
    where id = p_id;
  end if;

  if p_status = 'rejected' and coalesce(p_reason,'') = '' then
    raise exception 'rejection_reason required' using errcode = '22023';
  end if;

  update public.ai_playlist_drafts set
    status = p_status,
    reviewed_by = case when p_status in ('approved','rejected') then auth.uid() else reviewed_by end,
    reviewed_at = case when p_status in ('approved','rejected') then now() else reviewed_at end,
    rejection_reason = case when p_status = 'rejected' then p_reason else rejection_reason end
  where id = p_id;

  insert into public.ai_playlist_draft_events(draft_id, event_type, actor_id, previous_status, next_status, reason)
  values (p_id, 'status_changed', auth.uid(), d.status, p_status, p_reason);

  return public.admin_ai_pl_draft_detail(p_id);
end;
$$;

grant execute on function public.admin_ai_pl_draft_set_status(uuid, text, text) to authenticated;
