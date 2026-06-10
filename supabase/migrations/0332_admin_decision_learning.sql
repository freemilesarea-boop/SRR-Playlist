-- 0332 — admin decision learning v1 (X6.58)
--
-- 목적:
--   관리자의 매일 결정 (승인/거절/매장 제외/메타 수정) 을 학습 데이터로 축적해
--   각 결정 사유별 audio_features 분포 (cluster center + variance) 계산.
--   새 트랙 등록 시 "이 트랙은 [X 사유] cluster 와 78% 유사 — 검토 권장" 자동 신호.
--
-- 현재 자산 (production 분석 시점):
--   - track_moderation_events: 3,012건 (approved_and_released 860, removed 646, ...)
--   - track_audio_features: 1,506건 (BPM/energy/danceability/acousticness/
--     instrumentalness/vocal_presence/brightness/valence/spectral_centroid 등 14차원)
--   - track_metadata_audit_log: 3,234건 (관리자 메타 수정 before/after)
--
-- 발견된 첫 패턴 (Live data):
--   - 승인 곡 (143 with features): acoust 0.63, instr 0.53, bright 0.27
--   - 탈락 곡 (56 with features): acoust 0.57, instr 0.39, bright 0.35
--   → 매장 BGM 특성: instrumental + acoustic + 너무 밝지 않은 곡 선호
--   - 탈락 사유 TOP: "음질 부적격" 512건 (전체 79%)
--   - 띄어쓰기 차이로 "음질 부적격"/"음질부적격"/"음질 부적합" 별개 분류 → 표준화 필요
--
-- 향후 단계 (이 migration 후):
--   1) AiCurationPanel 에 cluster 시각화 탭
--   2) 새 트랙 업로드 trigger → 자동 risk_flag
--   3) reason dropdown 으로 표준화 입력 강제

-- =============================================================================
-- 1. 표준화 함수 — 같은 의미 사유를 하나의 key 로 묶음
-- =============================================================================
create or replace function public._normalize_decision_reason(p_text text)
returns text language plpgsql immutable as $$
declare
  v text;
begin
  if p_text is null then return null; end if;
  v := lower(btrim(p_text));
  -- 공백/구두점/줄바꿈 제거 (한글 매칭용)
  v := regexp_replace(v, '[\s\.,\-_/\[\]\(\)/]+', '', 'g');
  -- 동의어 매핑 (운영 데이터 패턴 기반)
  v := case
    when v ~ '음질부적|음질부족|음질저하|음질이상|음질문제' then 'audio_quality_low'
    when v ~ '곡길이|길이부적|길이부족' then 'duration_invalid'
    when v ~ '메타데이터|메타정보|장르오류|장르부적' then 'metadata_invalid'
    when v ~ '매장.*부적|분위기.*부적' then 'store_mismatch'
    when v ~ '파일명|제목|타이틀' then 'filename_invalid'
    when v ~ '재업로드|재제출|수정.*업로드' then 'reupload_required'
    when v ~ '저작권|copyright' then 'copyright_issue'
    when v ~ '중복|duplicate' then 'duplicate'
    when v = '' then 'no_reason'
    else 'other:' || left(v, 50)  -- 알 수 없는 사유는 prefix 로 격리
  end;
  return v;
end; $$;

-- =============================================================================
-- 2. cluster 테이블 — 사유별 feature 분포 저장
-- =============================================================================
create table if not exists public.decision_pattern_clusters (
  id uuid primary key default gen_random_uuid(),
  reason_key text not null,                     -- 표준화 사유 key
  reason_display text not null,                 -- canonical 표시명 (한글)
  reason_variants text[] not null default '{}', -- 원본 변형들 (audit)
  decision_type text not null,                  -- 'approve' | 'remove' | 'exclude_store' | 'rereview'
  store_type text,                              -- store_type slug (NULL = global)
  sample_count int not null default 0,          -- cluster 에 포함된 트랙 수
  feature_means jsonb not null default '{}',    -- {bpm, energy, ...}
  feature_stds jsonb not null default '{}',
  example_track_ids uuid[] not null default '{}',
  last_decision_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (reason_key, decision_type, store_type)
);

create index if not exists decision_clusters_reason_idx on public.decision_pattern_clusters (reason_key);
create index if not exists decision_clusters_decision_idx on public.decision_pattern_clusters (decision_type, sample_count desc);

alter table public.decision_pattern_clusters enable row level security;

drop policy if exists decision_clusters_admin_read on public.decision_pattern_clusters;
create policy decision_clusters_admin_read on public.decision_pattern_clusters
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
  );

-- =============================================================================
-- 3. refresh — 모든 결정 → cluster 재계산
-- =============================================================================
create or replace function public.refresh_decision_pattern_clusters()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_clusters_built int := 0;
  v_total_decisions int := 0;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'admin or service_role only';
  end if;

  -- A) track_moderation_events 의 'removed' / 'approved_and_released' 결정 통합
  with decisions as (
    -- removed (탈락) — note 가 사유
    select
      e.track_id,
      'remove' as decision_type,
      null::text as store_type,
      coalesce(nullif(trim(e.note), ''), '(no reason)') as reason_raw,
      _normalize_decision_reason(e.note) as reason_key,
      e.created_at
    from public.track_moderation_events e
    where e.action = 'removed' and e.note is not null
    union all
    -- approved (통과) — '__approved__' fixed key
    select
      e.track_id,
      'approve' as decision_type,
      null::text as store_type,
      '__approved__' as reason_raw,
      '__approved__' as reason_key,
      e.created_at
    from public.track_moderation_events e
    where e.action = 'approved_and_released'
    union all
    -- 매장 제외
    select
      ex.track_id,
      'exclude_store' as decision_type,
      ex.store_type_slug as store_type,
      coalesce(nullif(trim(ex.reason), ''), '(no reason)') as reason_raw,
      _normalize_decision_reason(ex.reason) as reason_key,
      ex.created_at
    from public.track_store_exclusions ex
    where ex.is_active = true
  ),
  joined as (
    -- audio features 조인 (없는 트랙은 NULL — 평균에서 자동 제외)
    select d.*, f.bpm, f.energy, f.danceability, f.acousticness, f.instrumentalness,
           f.vocal_presence, f.brightness, f.valence, f.spectral_centroid, f.loudness,
           f.tempo_stability, f.speechiness, f.dynamic_range
    from decisions d
    left join public.track_audio_features f on f.track_id = d.track_id
  ),
  aggregated as (
    select
      reason_key, decision_type, store_type,
      count(*) as total_count,
      count(*) filter (where bpm is not null) as features_count,
      array_agg(distinct reason_raw) filter (where reason_raw is not null) as variants,
      (array_agg(track_id order by created_at desc))[1:5] as examples,
      max(created_at) as last_at,
      -- means
      avg(bpm) as m_bpm, avg(energy) as m_energy, avg(danceability) as m_dance,
      avg(acousticness) as m_acoust, avg(instrumentalness) as m_instr,
      avg(vocal_presence) as m_vocal, avg(brightness) as m_bright, avg(valence) as m_valence,
      avg(spectral_centroid) as m_centroid, avg(loudness) as m_loud,
      avg(tempo_stability) as m_tstab, avg(speechiness) as m_speech, avg(dynamic_range) as m_dyn,
      -- std
      stddev_samp(bpm) as s_bpm, stddev_samp(energy) as s_energy, stddev_samp(danceability) as s_dance,
      stddev_samp(acousticness) as s_acoust, stddev_samp(instrumentalness) as s_instr,
      stddev_samp(vocal_presence) as s_vocal, stddev_samp(brightness) as s_bright, stddev_samp(valence) as s_valence,
      stddev_samp(spectral_centroid) as s_centroid, stddev_samp(loudness) as s_loud,
      stddev_samp(tempo_stability) as s_tstab, stddev_samp(speechiness) as s_speech, stddev_samp(dynamic_range) as s_dyn
    from joined
    group by reason_key, decision_type, store_type
  )
  insert into public.decision_pattern_clusters (
    reason_key, reason_display, reason_variants, decision_type, store_type,
    sample_count, feature_means, feature_stds, example_track_ids, last_decision_at, updated_at
  )
  select
    a.reason_key,
    coalesce(a.variants[1], a.reason_key) as reason_display,
    a.variants,
    a.decision_type,
    a.store_type,
    a.features_count,  -- features 있는 트랙 수 (실제 학습 가능 sample)
    jsonb_strip_nulls(jsonb_build_object(
      'bpm', a.m_bpm, 'energy', a.m_energy, 'danceability', a.m_dance,
      'acousticness', a.m_acoust, 'instrumentalness', a.m_instr,
      'vocal_presence', a.m_vocal, 'brightness', a.m_bright, 'valence', a.m_valence,
      'spectral_centroid', a.m_centroid, 'loudness', a.m_loud,
      'tempo_stability', a.m_tstab, 'speechiness', a.m_speech, 'dynamic_range', a.m_dyn,
      'total_decisions', a.total_count
    )) as feature_means,
    jsonb_strip_nulls(jsonb_build_object(
      'bpm', a.s_bpm, 'energy', a.s_energy, 'danceability', a.s_dance,
      'acousticness', a.s_acoust, 'instrumentalness', a.s_instr,
      'vocal_presence', a.s_vocal, 'brightness', a.s_bright, 'valence', a.s_valence,
      'spectral_centroid', a.s_centroid, 'loudness', a.s_loud,
      'tempo_stability', a.s_tstab, 'speechiness', a.s_speech, 'dynamic_range', a.s_dyn
    )) as feature_stds,
    a.examples,
    a.last_at,
    now()
  from aggregated a
  on conflict (reason_key, decision_type, store_type) do update set
    reason_display = excluded.reason_display,
    reason_variants = excluded.reason_variants,
    sample_count = excluded.sample_count,
    feature_means = excluded.feature_means,
    feature_stds = excluded.feature_stds,
    example_track_ids = excluded.example_track_ids,
    last_decision_at = excluded.last_decision_at,
    updated_at = now();

  get diagnostics v_clusters_built = row_count;

  select count(*) into v_total_decisions
  from public.track_moderation_events
  where action in ('removed','approved_and_released');

  return jsonb_build_object(
    'ok', true,
    'clusters_built', v_clusters_built,
    'source_decisions', v_total_decisions,
    'refreshed_at', now()
  );
end; $$;

revoke execute on function public.refresh_decision_pattern_clusters() from public, anon;
grant execute on function public.refresh_decision_pattern_clusters() to authenticated, service_role;

-- =============================================================================
-- 4. scoring — 새 트랙이 어떤 cluster 와 유사한지 (Z-score 거리)
-- =============================================================================
create or replace function public.admin_score_track_clusters(p_track_id uuid)
returns table(
  reason_key text, reason_display text, decision_type text, store_type text,
  similarity_pct numeric,                       -- 0~100, 높을수록 cluster 와 가까움
  cluster_sample_count int,
  matching_features jsonb                       -- {bpm: 'close', energy: 'far', ...}
) language plpgsql security definer set search_path to 'public' as $$
declare
  v_feat record;
  v_keys text[] := array['bpm','energy','danceability','acousticness','instrumentalness',
                         'vocal_presence','brightness','valence','spectral_centroid'];
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  select * into v_feat from public.track_audio_features where track_id = p_track_id;
  if v_feat is null then
    return; -- audio features 없는 트랙은 스코어링 불가
  end if;

  return query
  with cluster_dist as (
    select
      c.reason_key, c.reason_display, c.decision_type, c.store_type, c.sample_count,
      -- Z-score 거리 계산: 각 feature 별 |trackval - mean| / stddev, 평균
      (
        select avg(z_score) from (
          select
            case
              when (c.feature_stds->>k)::numeric > 0 then
                abs(
                  coalesce(
                    case k
                      when 'bpm' then v_feat.bpm when 'energy' then v_feat.energy
                      when 'danceability' then v_feat.danceability when 'acousticness' then v_feat.acousticness
                      when 'instrumentalness' then v_feat.instrumentalness when 'vocal_presence' then v_feat.vocal_presence
                      when 'brightness' then v_feat.brightness when 'valence' then v_feat.valence
                      when 'spectral_centroid' then v_feat.spectral_centroid else null::numeric end,
                    (c.feature_means->>k)::numeric
                  ) - (c.feature_means->>k)::numeric
                ) / nullif((c.feature_stds->>k)::numeric, 0)
              else null
            end as z_score
          from unnest(v_keys) as k
          where c.feature_means ? k and c.feature_stds ? k
        ) sub
        where z_score is not null
      ) as avg_z_dist
    from public.decision_pattern_clusters c
    where c.sample_count >= 3  -- 최소 3개 sample 있는 cluster 만
  )
  select
    cd.reason_key, cd.reason_display, cd.decision_type, cd.store_type,
    -- similarity = 100 * exp(-avg_z_dist) — 거리 0이면 100, 거리 1이면 37, 거리 2이면 14
    round((100 * exp(-coalesce(cd.avg_z_dist, 5)))::numeric, 1) as similarity_pct,
    cd.sample_count,
    null::jsonb as matching_features  -- v2 에서 채움
  from cluster_dist cd
  where cd.avg_z_dist is not null
  order by cd.avg_z_dist asc
  limit 10;
end; $$;

revoke execute on function public.admin_score_track_clusters(uuid) from public, anon;
grant execute on function public.admin_score_track_clusters(uuid) to authenticated;

-- =============================================================================
-- 5. summary — admin UI 표시용
-- =============================================================================
create or replace function public.admin_list_decision_clusters(p_min_samples int default 3)
returns table(
  reason_key text, reason_display text, reason_variants text[],
  decision_type text, store_type text, sample_count int,
  feature_means jsonb, last_decision_at timestamptz
) language sql security definer set search_path to 'public' as $$
  select c.reason_key, c.reason_display, c.reason_variants, c.decision_type, c.store_type,
         c.sample_count, c.feature_means, c.last_decision_at
  from public.decision_pattern_clusters c
  where c.sample_count >= p_min_samples
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
  order by c.sample_count desc, c.last_decision_at desc;
$$;

revoke execute on function public.admin_list_decision_clusters(int) from public, anon;
grant execute on function public.admin_list_decision_clusters(int) to authenticated;
