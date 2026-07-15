-- 0521_admin_ai_execution_delivery_analytics.sql
-- Phase AI-OPS-18 — Enterprise Execution Intelligence, Strategic Delivery Analytics &
-- Organizational Performance Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0504~0520 검증 완료):
--   Delivery 원본: ai_execution_commitments/milestones/progress/blockers/
--     completion_reviews(0520 — reported/verified 분리 저장).
--   Priority/Portfolio 원본: 0518/0519. Outcome 원본: ai_decision_outcomes(0514)/
--     ai_post_change_observations(0506). Learning 원본: 0515.
--   KPI 원본: subscriptions.current_amount(MRR)/payment_orders(paid)/users(매장·아티스트)/
--     playback_events_v2. Customer Satisfaction 지표 없음(실측) → kpi_unavailable.
--   Department/조직 구조 없음(실측) → Domain 단위 분석만(부서 분석은 domain 대체 표기).
--
-- Analytics 정직성(전부 강제):
--   * 표본<5 이면 Success Rate/패턴 확정 금지(sample_too_small 서버 강제).
--   * KPI 상관 ≠ 인과(0517 원칙 재사용) — causally_attributed 상태 자체가 없음.
--   * Delivery Score/패턴 ≠ 인사 평가. 지연 전파 분석은 후보(확정 영향 아님).
--   * Snapshot 덮어쓰기 금지. 완료율 단독 ≠ Delivery Quality.
--   * Trigger 없음 · 삭제 RPC 없음 · KPI/Outcome/업무 자동 변경 없음 · 원본 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Delivery Analytics Snapshot — 분석 결과 기록(덮어쓰기 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_delivery_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_code       text not null unique,
  snapshot_kind       text not null check (snapshot_kind in ('delivery_summary','domain_delivery','initiative_delivery','portfolio_delivery','priority_delivery','bottleneck_analysis','cross_commitment_analysis','delivery_pattern','delivery_quality','execution_health','executive_cockpit','manual')),
  period_start        timestamptz,
  period_end          timestamptz,
  sample_size         int not null default 0 check (sample_size >= 0),
  success_rate        numeric check (success_rate is null or (success_rate >= 0 and success_rate <= 100)),
  rate_status         text not null default 'insufficient_data' check (rate_status in ('measured_reference','sample_too_small','insufficient_data')),
  metrics             jsonb not null default '{}'::jsonb,
  findings            jsonb not null default '[]'::jsonb,
  risk_factors        jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["완료율 단독 ≠ Delivery Quality","Delivery Score ≠ 인사 평가","분석 결과 ≠ 자동 실행 지시"]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  source_version      text not null default 'delivery_v1(0521)',
  input_hash          text not null,
  idempotency_key     text not null unique,
  created_by          uuid,
  generated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end > period_start)
);
create index if not exists idx_exec_delivery on public.ai_execution_delivery_snapshots (snapshot_kind, generated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) KPI Correlation — 상관 후보만(인과 확정 상태 없음 — 0517 원칙).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_kpi_correlations (
  id                  uuid primary key default gen_random_uuid(),
  correlation_code    text not null unique,
  commitment_scope    text not null,                            -- domain/commitment code 등 분석 범위
  kpi_type            text not null check (kpi_type in ('revenue','mrr','growth','store_expansion','artist_growth','playlist_quality_reference','customer_satisfaction_reference','stability','cost','manual')),
  kpi_source          text not null,
  sample_size         int not null default 0 check (sample_size >= 0),
  correlation_summary text not null,
  correlation_direction text check (correlation_direction is null or correlation_direction in ('positive_candidate','negative_candidate','no_known_correlation','mixed','insufficient_data')),
  correlation_status  text not null default 'insufficient_data' check (correlation_status in ('correlational_only','sample_too_small','kpi_unavailable','causality_unverified','insufficient_data')),
  causal_candidate_ref uuid,                                    -- 인과 검토는 0517 워크플로만(여기서 확정 없음)
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["상관 ≠ 인과(causally_attributed 상태 없음)","KPI 자동 변경 없음"]'::jsonb,
  source_version      text not null default 'delivery_v1(0521)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_kpi on public.ai_execution_kpi_correlations (kpi_type, correlation_status, created_at desc);

-- Pattern/Bottleneck/Cockpit 검토·외부 참조·Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_execution_delivery_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('delivery_snapshot_created','bottleneck_detected','cross_commitment_impact_analyzed','delivery_pattern_detected','delivery_quality_calculated','execution_health_calculated','kpi_correlation_recorded','executive_timeline_reviewed','executive_cockpit_reviewed','delivery_recommendation_created','external_delivery_reference','delivery_item_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_del_evt on public.ai_execution_delivery_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 요약 — 0514/0518~0520 실측 집계 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_delivery_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'commitments_total', (select count(*) from public.ai_execution_commitments),
    'commitments_by_status', (select coalesce(jsonb_object_agg(commitment_status, n), '{}'::jsonb) from (select commitment_status, count(*) n from public.ai_execution_commitments group by commitment_status) x),
    'commitments_by_domain', (select coalesce(jsonb_object_agg(commitment_domain, n), '{}'::jsonb) from (select commitment_domain, count(*) n from public.ai_execution_commitments group by commitment_domain) x),
    'verified_complete', (select count(*) from public.ai_commitment_completion_reviews where verification_status = 'verified_complete_reference'),
    'completion_reported', (select count(*) from public.ai_commitment_completion_reviews),
    'milestones_total', (select count(*) from public.ai_commitment_milestones),
    'milestones_verified', (select count(*) from public.ai_commitment_milestones where milestone_status = 'verified_complete_reference'),
    'blockers_total', (select count(*) from public.ai_commitment_blockers),
    'blockers_by_type', (select coalesce(jsonb_object_agg(blocker_type, n), '{}'::jsonb) from (select blocker_type, count(*) n from public.ai_commitment_blockers group by blocker_type) x),
    'progress_snapshots', (select count(*) from public.ai_commitment_progress_snapshots),
    'decision_outcomes', (select count(*) from public.ai_decision_outcomes),
    'delivery_snapshots', (select count(*) from public.ai_execution_delivery_snapshots),
    'kpi_correlations', (select count(*) from public.ai_execution_kpi_correlations),
    -- KPI 원본 실측(참조만) + 미존재 정직 표기:
    'kpi_actuals', jsonb_build_object(
      'mrr_actual', (select coalesce(sum(current_amount), 0) from public.subscriptions where status in ('active','cancel_scheduled')),
      'active_stores', (select count(*) from public.users where account_type = 'business' and withdrawn_at is null),
      'active_artists', (select count(*) from public.users where account_type = 'artist' and withdrawn_at is null),
      'customer_satisfaction', 'kpi_unavailable',
      'department_structure', 'organizational_dependency_unverified'
    ),
    'no_auto_work_assignment', true, 'no_auto_kpi_change', true, 'no_auto_outcome_creation', true, 'no_personnel_evaluation', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Snapshot 생성·조회 — 표본<5 확정 금지 서버 강제.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_delivery_snapshot_create(
  p_code text, p_kind text, p_evidence jsonb,
  p_sample int default 0, p_success_rate numeric default null,
  p_metrics jsonb default '{}'::jsonb, p_findings jsonb default '[]'::jsonb,
  p_risk_factors jsonb default '[]'::jsonb, p_unknown jsonb default '[]'::jsonb,
  p_period_start timestamptz default null, p_period_end timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_rate_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_sample < 0 then raise exception 'sample 음수 금지'; end if;
  if p_success_rate is not null and (p_success_rate < 0 or p_success_rate > 100) then raise exception 'success_rate 0~100'; end if;
  if pg_column_size(coalesce(p_metrics, '{}'::jsonb)) + pg_column_size(coalesce(p_findings, '[]'::jsonb)) > 32768 then raise exception 'payload 32KB 제한'; end if;
  -- 표본<5 이면 measured 확정 금지(sample_too_small 강제)
  v_rate_status := case when p_success_rate is null then 'insufficient_data'
                        when p_sample < 5 then 'sample_too_small'
                        else 'measured_reference' end;
  select id into v_id from public.ai_execution_delivery_snapshots where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_execution_delivery_snapshots (snapshot_code, snapshot_kind, period_start, period_end, sample_size, success_rate, rate_status, metrics, findings, risk_factors, unknown_factors, evidence, input_hash, idempotency_key, created_by)
  values (p_code, p_kind, p_period_start, p_period_end, p_sample, p_success_rate, v_rate_status, coalesce(p_metrics, '{}'::jsonb), coalesce(p_findings, '[]'::jsonb), coalesce(p_risk_factors, '[]'::jsonb), coalesce(p_unknown, '[]'::jsonb), p_evidence, md5(p_kind || coalesce(p_metrics::text, '')), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_execution_delivery_events (event_type, ref_id, detail, actor_id) values ('delivery_snapshot_created', v_id, p_code || ' (' || p_kind || '/' || v_rate_status || ') — 인사 평가 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'rate_status', v_rate_status, 'personnel_evaluation', false, 'production_applied', false);
end $$;

create or replace function public.admin_delivery_snapshots(p_kind text default null, p_limit int default 50)
returns setof public.ai_execution_delivery_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_delivery_snapshots where (p_kind is null or snapshot_kind = p_kind)
    order by generated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) KPI Correlation 기록·조회 — 상관 ≠ 인과.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_kpi_correlation_create(
  p_code text, p_scope text, p_kpi_type text, p_kpi_source text, p_summary text, p_evidence jsonb,
  p_sample int default 0, p_direction text default null, p_causal_ref uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_summary is null or btrim(p_summary) = '' then raise exception 'summary 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_direction is not null and p_direction not in ('positive_candidate','negative_candidate','no_known_correlation','mixed','insufficient_data') then raise exception '허용되지 않는 direction'; end if;
  if p_causal_ref is not null and not exists (select 1 from public.ai_business_causal_candidates where id = p_causal_ref) then raise exception 'causal candidate 실존 검증 실패(인과 검토는 0517 워크플로만)'; end if;
  -- KPI 원본 없는 유형은 kpi_unavailable, 표본<5 는 sample_too_small — correlational_only 확정 금지
  v_status := case when p_kpi_type in ('customer_satisfaction_reference','playlist_quality_reference') then 'kpi_unavailable'
                   when p_sample < 5 then 'sample_too_small'
                   else 'correlational_only' end;
  select id into v_id from public.ai_execution_kpi_correlations where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_execution_kpi_correlations (correlation_code, commitment_scope, kpi_type, kpi_source, sample_size, correlation_summary, correlation_direction, correlation_status, causal_candidate_ref, evidence, idempotency_key, created_by)
  values (p_code, p_scope, p_kpi_type, p_kpi_source, p_sample, left(p_summary, 1000), p_direction, v_status, p_causal_ref, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_execution_delivery_events (event_type, ref_id, detail, actor_id) values ('kpi_correlation_recorded', v_id, p_code || ' (' || p_kpi_type || '/' || v_status || ') — 상관 ≠ 인과', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'correlation_status', v_status, 'causally_attributed', false, 'production_applied', false);
end $$;

create or replace function public.admin_kpi_correlations(p_kpi_type text default null, p_limit int default 100)
returns setof public.ai_execution_kpi_correlations language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_kpi_correlations where (p_kpi_type is null or kpi_type = p_kpi_type)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Governance Event 기록 / Audit — 패턴·병목·Cockpit 검토 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_delivery_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('bottleneck_detected','cross_commitment_impact_analyzed','delivery_pattern_detected','delivery_quality_calculated','execution_health_calculated','executive_timeline_reviewed','executive_cockpit_reviewed','delivery_recommendation_created','external_delivery_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_execution_delivery_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case when p_kind = 'delivery_pattern_detected' then ' (개인 능력 단정 아님)' when p_kind = 'cross_commitment_impact_analyzed' then ' (전파 후보 — 확정 영향 아님)' else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'personnel_evaluation', false, 'production_applied', false);
end $$;

create or replace function public.admin_execution_delivery_audit(p_limit int default 100)
returns setof public.ai_execution_delivery_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_delivery_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_execution_delivery_snapshots enable row level security;
alter table public.ai_execution_kpi_correlations enable row level security;
alter table public.ai_execution_delivery_events enable row level security;

comment on table public.ai_execution_delivery_snapshots is 'AI-OPS-18 — Delivery Analytics Snapshot(표본<5 확정 금지·덮어쓰기 금지·인사 평가 아님).';
comment on table public.ai_execution_kpi_correlations is 'AI-OPS-18 — KPI Correlation(상관 ≠ 인과 — causally_attributed 상태 없음·KPI 자동 변경 없음).';
comment on table public.ai_execution_delivery_events is 'AI-OPS-18 — Delivery Audit(event_type whitelist 12종·패턴/병목/Cockpit 검토 통합).';
