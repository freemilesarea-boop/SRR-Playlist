-- 0334 — Phase 3c: 매장별 cluster 분리 + reject 사유 dropdown 강제 (X6.65)
--
-- 목적:
--   0333 의 track_pattern_predictions 는 'remove'/'approve' 두 종류만 emit.
--   exclude_store cluster (track_store_exclusions 기반, store_type 별로 sample 축적됨)
--   는 predict 함수에서 무시되고 있었음 → 매장별 부적합 신호가 검수자에게 안 보임.
--
-- 변경:
--   1) track_pattern_predictions.store_type 컬럼 추가
--   2) UNIQUE (track_id, predicted_decision, store_type) — NULLS NOT DISTINCT (PG15+)
--      → 'remove'/'approve' 는 store_type NULL, 'exclude_store' 는 매장 slug 별로 별도 행
--   3) predict_track_decision() 가 exclude_store cluster 도 매장별로 top match emit
--   4) admin_list_track_predictions / admin_sync_prediction_actuals store_type 인식
--   5) 8개 표준 거절 사유 RPC (admin_list_canonical_reject_reasons) 노출
--      → UI dropdown 강제용

-- =============================================================================
-- 1. store_type 컬럼 추가 + UNIQUE 재설정
-- =============================================================================
alter table public.track_pattern_predictions
  add column if not exists store_type text;

create index if not exists track_pattern_pred_store_type_idx
  on public.track_pattern_predictions (store_type)
  where store_type is not null;

-- 기존 UNIQUE (track_id, predicted_decision) 삭제 후 store_type 포함 재생성.
-- NULLS NOT DISTINCT → NULL store_type 끼리도 동일 행으로 취급 (PG15+ 필요, Supabase=17).
alter table public.track_pattern_predictions
  drop constraint if exists track_pattern_predictions_track_id_predicted_decision_key;

alter table public.track_pattern_predictions
  drop constraint if exists track_pattern_predictions_track_decision_store_key;

alter table public.track_pattern_predictions
  add constraint track_pattern_predictions_track_decision_store_key
  unique nulls not distinct (track_id, predicted_decision, store_type);


-- =============================================================================
-- 2. predict_track_decision — exclude_store 포함, 매장별 top match
-- =============================================================================
create or replace function public.predict_track_decision(p_track_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_feat record;
  v_keys text[] := array['bpm','energy','danceability','acousticness','instrumentalness',
                         'vocal_presence','brightness','valence','spectral_centroid'];
  v_min_remove_sim numeric := 60;
  v_min_approve_sim numeric := 50;
  v_min_exclude_sim numeric := 55;  -- exclude_store: remove 보다 약간 낮게 (매장별 sample 적음)
  v_count int;
begin
  select * into v_feat from public.track_audio_features where track_id = p_track_id;
  if v_feat is null then return 0; end if;

  with cluster_dist as (
    select c.reason_key, c.reason_display, c.decision_type, c.store_type, c.sample_count,
      (c.feature_means->>'total_decisions')::int as total_decisions,
      (
        select avg(z_score) from (
          select case
            when (c.feature_stds->>k)::numeric > 0 then
              abs(
                coalesce(case k
                  when 'bpm' then v_feat.bpm when 'energy' then v_feat.energy
                  when 'danceability' then v_feat.danceability when 'acousticness' then v_feat.acousticness
                  when 'instrumentalness' then v_feat.instrumentalness when 'vocal_presence' then v_feat.vocal_presence
                  when 'brightness' then v_feat.brightness when 'valence' then v_feat.valence
                  when 'spectral_centroid' then v_feat.spectral_centroid else null::numeric end,
                  (c.feature_means->>k)::numeric
                ) - (c.feature_means->>k)::numeric
              ) / nullif((c.feature_stds->>k)::numeric, 0)
            else null end as z_score
          from unnest(v_keys) as k
          where c.feature_means ? k and c.feature_stds ? k
        ) sub
        where z_score is not null
      ) as avg_z_dist
    from public.decision_pattern_clusters c
    where (
      (c.decision_type in ('remove','approve') and c.sample_count >= 5)
      or (c.decision_type = 'exclude_store' and c.sample_count >= 3)
    )
  ),
  scored as (
    select reason_key, reason_display, decision_type, store_type, sample_count, total_decisions,
           round((100 * exp(-coalesce(avg_z_dist, 5)))::numeric, 2) as similarity_pct
    from cluster_dist
    where avg_z_dist is not null
  ),
  -- 'remove' / 'approve' : 전역 top 1 (store_type 무시)
  global_top as (
    select distinct on (decision_type)
      decision_type, null::text as store_type,
      reason_key, reason_display, sample_count, total_decisions, similarity_pct
    from scored
    where decision_type in ('remove','approve')
      and ((decision_type = 'remove' and similarity_pct >= v_min_remove_sim)
        or (decision_type = 'approve' and similarity_pct >= v_min_approve_sim))
    order by decision_type, similarity_pct desc
  ),
  -- 'exclude_store' : 매장 slug 별 top 1 (각 매장마다 가장 가까운 사유 cluster 1개)
  store_top as (
    select distinct on (store_type)
      'exclude_store' as decision_type, store_type,
      reason_key, reason_display, sample_count, total_decisions, similarity_pct
    from scored
    where decision_type = 'exclude_store'
      and store_type is not null
      and similarity_pct >= v_min_exclude_sim
    order by store_type, similarity_pct desc
  ),
  combined as (
    select * from global_top union all select * from store_top
  )
  insert into public.track_pattern_predictions (
    track_id, predicted_decision, store_type, predicted_reason_key, predicted_reason_display,
    similarity_pct, cluster_sample_count, cluster_decision_total, generated_at
  )
  select p_track_id, c.decision_type, c.store_type, c.reason_key, c.reason_display,
    c.similarity_pct, c.sample_count, c.total_decisions, now()
  from combined c
  on conflict (track_id, predicted_decision, store_type) do update set
    predicted_reason_key = excluded.predicted_reason_key,
    predicted_reason_display = excluded.predicted_reason_display,
    similarity_pct = excluded.similarity_pct,
    cluster_sample_count = excluded.cluster_sample_count,
    cluster_decision_total = excluded.cluster_decision_total,
    generated_at = excluded.generated_at;

  get diagnostics v_count = row_count;
  return v_count;
end; $$;


-- =============================================================================
-- 3. admin_list_track_predictions — store_type 출력 추가
-- =============================================================================
drop function if exists public.admin_list_track_predictions(text, numeric, boolean, int);

create or replace function public.admin_list_track_predictions(
  p_decision text default 'remove',
  p_min_similarity numeric default 60,
  p_only_unvalidated boolean default false,
  p_limit int default 100
)
returns table(
  track_id uuid, track_title text, track_artist text,
  release_status text, visibility_status text,
  predicted_decision text, store_type text,
  predicted_reason_key text, predicted_reason_display text,
  similarity_pct numeric, cluster_sample_count int, cluster_decision_total int,
  generated_at timestamptz,
  actual_decision text, actual_reason_key text, validated_at timestamptz,
  prediction_correct boolean
) language sql security definer set search_path to 'public' as $$
  select p.track_id, t.title, t.artist,
    t.release_status, t.visibility_status,
    p.predicted_decision, p.store_type,
    p.predicted_reason_key, p.predicted_reason_display,
    p.similarity_pct, p.cluster_sample_count, p.cluster_decision_total, p.generated_at,
    p.actual_decision, p.actual_reason_key, p.validated_at,
    case when p.actual_decision is null then null
         when p.actual_decision = p.predicted_decision then true
         else false end as prediction_correct
  from public.track_pattern_predictions p
  join public.tracks t on t.id = p.track_id
  where (p_decision is null or p.predicted_decision = p_decision)
    and p.similarity_pct >= p_min_similarity
    and (not p_only_unvalidated or p.actual_decision is null)
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
  order by p.similarity_pct desc, p.generated_at desc
  limit greatest(1, p_limit);
$$;

grant execute on function public.admin_list_track_predictions(text, numeric, boolean, int) to authenticated;


-- =============================================================================
-- 4. admin_sync_prediction_actuals — store_type 별 행 update 시 NULL 매칭 주의
-- =============================================================================
create or replace function public.admin_sync_prediction_actuals()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_updated int := 0; v_exc_updated int := 0;
begin
  if not (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
    or coalesce(auth.role(), '') = 'service_role'
    or current_user = 'postgres'
  ) then
    raise exception 'admin only';
  end if;

  -- (a) global remove/approve: store_type IS NULL 행만 sync
  with latest_decisions as (
    select e.track_id,
      case e.action when 'approved_and_released' then 'approve' when 'removed' then 'remove' else e.action end as actual_decision,
      _normalize_decision_reason(e.note) as actual_reason_key,
      e.created_at,
      row_number() over (partition by e.track_id order by e.created_at desc) as rn
    from public.track_moderation_events e
    where e.action in ('approved_and_released', 'removed')
  ),
  latest as (select * from latest_decisions where rn = 1)
  update public.track_pattern_predictions p
  set actual_decision = l.actual_decision,
      actual_reason_key = case when l.actual_decision = 'remove' then l.actual_reason_key else null end,
      validated_at = l.created_at
  from latest l
  where p.track_id = l.track_id
    and p.store_type is null
    and (p.actual_decision is null or p.validated_at < l.created_at);

  get diagnostics v_updated = row_count;

  -- (b) exclude_store: track_store_exclusions 매칭. store_type 동일 행만 sync.
  with active_exclusions as (
    select ex.track_id, ex.store_type_slug as store_type,
      _normalize_decision_reason(ex.reason) as actual_reason_key,
      ex.created_at,
      row_number() over (partition by ex.track_id, ex.store_type_slug order by ex.created_at desc) as rn
    from public.track_store_exclusions ex
    where ex.is_active = true
  ),
  latest_exc as (select * from active_exclusions where rn = 1)
  update public.track_pattern_predictions p
  set actual_decision = 'exclude_store',
      actual_reason_key = e.actual_reason_key,
      validated_at = e.created_at
  from latest_exc e
  where p.track_id = e.track_id
    and p.store_type = e.store_type
    and p.predicted_decision = 'exclude_store'
    and (p.actual_decision is null or p.validated_at < e.created_at);

  get diagnostics v_exc_updated = row_count;
  v_updated := v_updated + v_exc_updated;

  return jsonb_build_object('ok', true, 'predictions_validated', v_updated);
end; $$;

grant execute on function public.admin_sync_prediction_actuals() to authenticated, service_role;


-- =============================================================================
-- 5. 표준 거절 사유 목록 RPC — UI dropdown 강제용
--    SQL `_normalize_decision_reason` 의 pattern 과 1:1 대응 (label 에 pattern 키워드 포함).
-- =============================================================================
create or replace function public.list_canonical_reject_reasons()
returns table(
  reason_key text,
  label text,
  description text,
  sort_order int
) language sql immutable as $$
  values
    ('audio_quality_low', '음질 부족', 'EBU R128 외, 노이즈, 클리핑, 마스터링 부족 등', 1),
    ('duration_invalid', '곡 길이 부적절', '너무 짧거나 김', 2),
    ('metadata_invalid', '메타데이터 오류', '장르/분위기/제목/아티스트명', 3),
    ('store_mismatch', '매장 분위기 부적합', '특정 매장 컨셉과 안 맞음', 4),
    ('filename_invalid', '파일명/제목 오류', '제목/아티스트명 오타', 5),
    ('reupload_required', '재업로드 필요', '파일 자체 문제 (손상/포맷)', 6),
    ('copyright_issue', '저작권 문제', '권리 확인 불가, 샘플링 미신고', 7),
    ('duplicate', '중복 음원', '이미 등록된 곡', 8);
$$;

grant execute on function public.list_canonical_reject_reasons() to anon, authenticated, service_role;
