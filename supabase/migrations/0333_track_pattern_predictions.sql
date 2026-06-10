-- 0333 — track pattern predictions (auto cluster trigger) (X6.60 / Phase 3a)
--
-- 목적:
--   X6.58 (0332) 의 decision_pattern_clusters 가 학습한 패턴을 활용해
--   audio features 분석 완료된 트랙을 자동 cluster 매칭 →
--   "이 트랙은 [음질 부적격] 78% 유사 — 검수 우선" 자동 flag.
--
-- 흐름:
--   1) track_audio_features status='done' INSERT/UPDATE → trigger
--   2) predict_track_decision(track_id) → cluster z-score 거리 → top match
--   3) track_pattern_predictions 에 INSERT/UPDATE
--   4) admin 검수 후 admin_sync_prediction_actuals() 로 actual_decision sync
--      → 모델 정확도 측정 가능
--
-- 정책: 자동 차단/발매정지 X — 우선순위 신호만.
--   remove cluster 임계값: similarity ≥60%
--   approve cluster 임계값: similarity ≥50% (참고 정보)

create table if not exists public.track_pattern_predictions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  predicted_decision text not null,
  predicted_reason_key text not null,
  predicted_reason_display text,
  similarity_pct numeric(5,2) not null,
  cluster_sample_count int,
  cluster_decision_total int,
  generated_at timestamptz not null default now(),
  actual_decision text,
  actual_reason_key text,
  validated_at timestamptz,
  unique (track_id, predicted_decision)
);

create index if not exists track_pattern_pred_track_idx on public.track_pattern_predictions (track_id);
create index if not exists track_pattern_pred_similarity_idx on public.track_pattern_predictions (predicted_decision, similarity_pct desc);
create index if not exists track_pattern_pred_unvalidated_idx on public.track_pattern_predictions (generated_at desc) where actual_decision is null;

alter table public.track_pattern_predictions enable row level security;
drop policy if exists track_pred_admin_read on public.track_pattern_predictions;
create policy track_pred_admin_read on public.track_pattern_predictions
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
  );


-- =============================================================================
-- 핵심: 단일 트랙 → cluster 점수 → top match upsert
-- =============================================================================
create or replace function public.predict_track_decision(p_track_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $$
declare
  v_feat record;
  v_keys text[] := array['bpm','energy','danceability','acousticness','instrumentalness',
                         'vocal_presence','brightness','valence','spectral_centroid'];
  v_min_remove_sim numeric := 60;
  v_min_approve_sim numeric := 50;
  v_count int;
begin
  select * into v_feat from public.track_audio_features where track_id = p_track_id;
  if v_feat is null then return 0; end if;

  with cluster_dist as (
    select c.reason_key, c.reason_display, c.decision_type, c.sample_count,
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
    where c.sample_count >= 5
  ),
  scored as (
    select reason_key, reason_display, decision_type, sample_count, total_decisions,
           round((100 * exp(-coalesce(avg_z_dist, 5)))::numeric, 2) as similarity_pct
    from cluster_dist
    where avg_z_dist is not null
  ),
  top_per_decision as (
    select distinct on (decision_type)
      decision_type, reason_key, reason_display, sample_count, total_decisions, similarity_pct
    from scored
    where (decision_type = 'remove' and similarity_pct >= v_min_remove_sim)
       or (decision_type = 'approve' and similarity_pct >= v_min_approve_sim)
    order by decision_type, similarity_pct desc
  )
  insert into public.track_pattern_predictions (
    track_id, predicted_decision, predicted_reason_key, predicted_reason_display,
    similarity_pct, cluster_sample_count, cluster_decision_total, generated_at
  )
  select p_track_id, decision_type, reason_key, reason_display,
    similarity_pct, sample_count, total_decisions, now()
  from top_per_decision
  on conflict (track_id, predicted_decision) do update set
    predicted_reason_key = excluded.predicted_reason_key,
    predicted_reason_display = excluded.predicted_reason_display,
    similarity_pct = excluded.similarity_pct,
    cluster_sample_count = excluded.cluster_sample_count,
    cluster_decision_total = excluded.cluster_decision_total,
    generated_at = excluded.generated_at;

  get diagnostics v_count = row_count;
  return v_count;
end; $$;

grant execute on function public.predict_track_decision(uuid) to authenticated, service_role;


-- =============================================================================
-- Trigger: audio_features 분석 완료 시 자동 호출
-- =============================================================================
create or replace function public._tg_predict_track_after_features()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status = 'done' then
    perform public.predict_track_decision(new.track_id);
  end if;
  return new;
end; $$;

drop trigger if exists tg_predict_after_audio_features on public.track_audio_features;
create trigger tg_predict_after_audio_features
  after insert or update on public.track_audio_features
  for each row execute function public._tg_predict_track_after_features();


-- =============================================================================
-- Backfill — 기존 features 있는 트랙 일괄 처리
-- =============================================================================
create or replace function public.admin_backfill_track_predictions(p_limit int default 2000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_total int := 0; v_upserted int := 0; r record;
begin
  if not (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
    or coalesce(auth.role(), '') = 'service_role'
    or current_user = 'postgres'
  ) then
    raise exception 'admin only';
  end if;

  for r in
    select track_id from public.track_audio_features
    where status = 'done'
    order by updated_at desc nulls last
    limit greatest(1, p_limit)
  loop
    v_total := v_total + 1;
    v_upserted := v_upserted + public.predict_track_decision(r.track_id);
  end loop;

  return jsonb_build_object('ok', true, 'tracks_processed', v_total,
    'predictions_upserted', v_upserted, 'completed_at', now());
end; $$;

grant execute on function public.admin_backfill_track_predictions(int) to authenticated, service_role;


-- =============================================================================
-- Actual sync — 검수 결과를 prediction 에 채워 정확도 측정
-- =============================================================================
create or replace function public.admin_sync_prediction_actuals()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_updated int := 0;
begin
  if not (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
    or coalesce(auth.role(), '') = 'service_role'
    or current_user = 'postgres'
  ) then
    raise exception 'admin only';
  end if;

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
    and (p.actual_decision is null or p.validated_at < l.created_at);

  get diagnostics v_updated = row_count;
  return jsonb_build_object('ok', true, 'predictions_validated', v_updated);
end; $$;

grant execute on function public.admin_sync_prediction_actuals() to authenticated, service_role;


-- =============================================================================
-- UI list — admin 표시용
-- =============================================================================
create or replace function public.admin_list_track_predictions(
  p_decision text default 'remove',
  p_min_similarity numeric default 60,
  p_only_unvalidated boolean default false,
  p_limit int default 100
)
returns table(
  track_id uuid, track_title text, track_artist text,
  release_status text, visibility_status text,
  predicted_decision text, predicted_reason_key text, predicted_reason_display text,
  similarity_pct numeric, cluster_sample_count int, cluster_decision_total int,
  generated_at timestamptz,
  actual_decision text, actual_reason_key text, validated_at timestamptz,
  prediction_correct boolean
) language sql security definer set search_path to 'public' as $$
  select p.track_id, t.title, t.artist,
    t.release_status, t.visibility_status,
    p.predicted_decision, p.predicted_reason_key, p.predicted_reason_display,
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
-- 정확도 요약
-- =============================================================================
create or replace function public.admin_prediction_accuracy_summary()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  return (
    select jsonb_strip_nulls(jsonb_build_object(
      'remove', (select to_jsonb(s) from (
        select 'remove' as predicted_decision,
          count(*) as total,
          count(*) filter (where actual_decision is not null) as validated,
          count(*) filter (where actual_decision = 'remove') as correct,
          count(*) filter (where actual_decision is not null and actual_decision <> 'remove') as wrong,
          round(avg(similarity_pct) filter (where actual_decision = 'remove')::numeric, 1) as avg_correct_sim,
          round(avg(similarity_pct) filter (where actual_decision is not null and actual_decision <> 'remove')::numeric, 1) as avg_wrong_sim
        from public.track_pattern_predictions where predicted_decision = 'remove'
      ) s),
      'approve', (select to_jsonb(s) from (
        select 'approve' as predicted_decision,
          count(*) as total,
          count(*) filter (where actual_decision is not null) as validated,
          count(*) filter (where actual_decision = 'approve') as correct,
          count(*) filter (where actual_decision is not null and actual_decision <> 'approve') as wrong,
          round(avg(similarity_pct) filter (where actual_decision = 'approve')::numeric, 1) as avg_correct_sim,
          round(avg(similarity_pct) filter (where actual_decision is not null and actual_decision <> 'approve')::numeric, 1) as avg_wrong_sim
        from public.track_pattern_predictions where predicted_decision = 'approve'
      ) s)
    ))
  );
end; $$;

grant execute on function public.admin_prediction_accuracy_summary() to authenticated;
