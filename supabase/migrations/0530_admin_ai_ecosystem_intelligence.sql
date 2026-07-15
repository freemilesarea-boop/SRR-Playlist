-- 0530_admin_ai_ecosystem_intelligence.sql
-- Phase AI-OPS-27 — Enterprise Ecosystem Intelligence, Partner Network &
-- External Dependency Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   Dependency 원본: ai_operational_dependencies(0508 — domain/provider/criticality/
--     fallback 실측 레지스트리, 읽기 전용 참조).
--   외부 서비스 사용 실측: ai_cost_snapshots(0508 — provider whitelist: supabase/vercel/
--     resend/payapp/kakao/storage), payment_orders(payapp 결제 흐름 — 0015).
--   Incident 참조: ai_incidents(0502 — api_failure/ai_service_failure 실측).
--   콘텐츠 공급 실측: tracks/users(artist).
--   외부 SLA/Uptime/Latency/파트너 계약 데이터 원본 없음(실측)
--     → ecosystem_unavailable 유지(임의 생성 금지). 파트너 프로필은 사람 등록만.
--
-- Ecosystem 정직성(전부 강제):
--   * 자동 파트너 등록/계약 변경/API 변경/공급사·클라우드·AI Provider 변경 없음.
--   * Dependency ≠ Failure. Availability ≠ SLA Guarantee. Partner ≠ Trust.
--   * Integration ≠ Compatibility Guarantee. Risk ≠ Incident.
--   * Recommendation ≠ Business Decision. Unknown 유지(null→0 금지).
--   * Partner 상태는 active/monitoring/suspended/unknown 4종만.
--   * Trigger 없음 · 삭제 RPC 없음 · 원본(0508/0502) 미변경 · 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Partner Registry — 사람 등록만(자동 파트너 등록 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_partner_registry (
  id                  uuid primary key default gen_random_uuid(),
  partner_code        text not null unique,
  partner_kind        text not null check (partner_kind in ('strategic','technology','infrastructure','payment','content','ai_provider','external_vendor')),
  name                text not null,
  description         text,
  provider_reference  text,
  linked_dependency_ids jsonb not null default '[]'::jsonb,      -- ai_operational_dependencies(0508) 실존 검증
  partner_status      text not null default 'unknown' check (partner_status in ('active','monitoring','suspended','unknown')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Partner ≠ Trust","등록 참조 — 계약/신뢰 판정 아님"]'::jsonb,
  source_version      text not null default 'ecosystem_v1(0530)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_partner_reg on public.ai_partner_registry (partner_kind, partner_status, created_at desc);

-- Dependency/Health/Performance/Integration/Graph/SupplyChain/Risk/Briefing/권고/Audit 는 Event 통합(테이블 최소화 — 신규 테이블 2개뿐).
create table if not exists public.ai_ecosystem_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('partner_registered','partner_reviewed','partner_suspended','dependency_analyzed','ecosystem_health_evaluated','partner_performance_analyzed','integration_analyzed','dependency_graph_analyzed','supply_chain_analyzed','ecosystem_risk_assessed','ecosystem_briefing_recorded','ecosystem_recommendation_created','external_ecosystem_reference','ecosystem_monitoring_noted','integration_deprecation_noted','sla_reference_noted')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_eco_evt on public.ai_ecosystem_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 요약 — 생태계 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ecosystem_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_paid bigint; v_failed bigint;
begin
  perform public._admin_growth_guard();
  select count(*) filter (where status = 'paid'), count(*) filter (where status = 'failed')
    into v_paid, v_failed from public.payment_orders where created_at > now() - interval '30 days';
  select jsonb_build_object(
    'registry_total', (select count(*) from public.ai_partner_registry),
    'registry_by_kind', (select coalesce(jsonb_object_agg(partner_kind, n), '{}'::jsonb) from (select partner_kind, count(*) n from public.ai_partner_registry group by partner_kind) x),
    'registry_by_status', (select coalesce(jsonb_object_agg(partner_status, n), '{}'::jsonb) from (select partner_status, count(*) n from public.ai_partner_registry group by partner_status) x),
    -- Dependency/공급망 실측(0508/0502/0015 참조 — 원본 미변경):
    'ecosystem_actuals', jsonb_build_object(
      'dependencies_total_0508', (select count(*) from public.ai_operational_dependencies),
      'dependencies_active_0508', (select count(*) from public.ai_operational_dependencies where lifecycle_status = 'active'),
      'dependencies_by_domain', (select coalesce(jsonb_object_agg(domain, n), '{}'::jsonb) from (select domain, count(*) n from public.ai_operational_dependencies group by domain) x),
      'dependencies_by_criticality', (select coalesce(jsonb_object_agg(criticality, n), '{}'::jsonb) from (select criticality, count(*) n from public.ai_operational_dependencies group by criticality) x),
      'dependencies_no_fallback', (select count(*) from public.ai_operational_dependencies where fallback_available = false),
      'dependencies_fallback_unknown', (select count(*) from public.ai_operational_dependencies where fallback_available is null),
      'cost_providers_90d', (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb) from (select provider, count(*) n from public.ai_cost_snapshots where period_end > now() - interval '90 days' group by provider) x),
      'payment_paid_30d', v_paid,
      'payment_failed_30d', v_failed,
      'incidents_api_failure_0502', (select count(*) from public.ai_incidents where incident_type in ('api_failure','ai_service_failure')),
      'tracks_supply_rows', (select count(*) from public.tracks),
      'artists_registered', (select count(*) from public.users where account_type = 'artist')
    ),
    'ecosystem_unavailable', jsonb_build_array('external_sla_data','partner_uptime_feed','latency_measurements','vendor_contract_data','api_version_registry','partner_incident_reports'),   -- 외부 원본 없음(실측)
    'no_auto_partner_registration', true, 'no_auto_contract_change', true, 'no_auto_api_change', true, 'no_auto_provider_change', true,
    'dependency_is_not_failure', true, 'partner_is_not_trust', true, 'availability_is_not_sla_guarantee', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Partner 등록·검토 — 사람 RPC 만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_partner_register_create(
  p_code text, p_kind text, p_name text, p_evidence jsonb,
  p_description text default null, p_provider text default null,
  p_dependency_ids jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_name is null or btrim(p_name) = '' then raise exception 'name 필수(사람 등록 — 자동 파트너 등록 없음)'; end if;
  if p_kind not in ('strategic','technology','infrastructure','payment','content','ai_provider','external_vendor') then raise exception '허용되지 않는 partner_kind'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(ecosystem_unverified 방지)'; end if;
  v_cnt := jsonb_array_length(coalesce(p_dependency_ids, '[]'::jsonb));
  if v_cnt > 20 then raise exception 'dependency 연결 20개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_operational_dependencies d where d.id in (select (jsonb_array_elements_text(p_dependency_ids))::uuid);
    if v_found <> v_cnt then raise exception 'dependency(0508) 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_partner_registry where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_partner_registry (partner_code, partner_kind, name, description, provider_reference, linked_dependency_ids, evidence, idempotency_key, created_by)
  values (p_code, p_kind, left(p_name, 200), p_description, p_provider, coalesce(p_dependency_ids, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_ecosystem_events (event_type, ref_id, detail, actor_id) values ('partner_registered', v_id, p_code || ' (' || p_kind || ') — 사람 등록(Partner ≠ Trust)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'partner_status', 'unknown', 'contract_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_partner_register_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('active','monitoring','suspended','unknown') then raise exception 'Partner 상태는 active/monitoring/suspended/unknown 4종만'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수(자동 계약/공급사 변경 없음)'; end if;
  select partner_status, created_by into v_cur, v_creator from public.ai_partner_registry where id = p_id for update;
  if v_cur is null then raise exception 'partner 없음'; end if;
  if v_cur = 'suspended' then raise exception '종결 상태(suspended)에서 재결정 불가'; end if;
  if v_creator is not null and v_creator = v_uid and p_status in ('active','suspended') then
    v_warnings := jsonb_build_array('self_review_warning: 등록자와 판정자가 동일');
  end if;
  update public.ai_partner_registry
     set partner_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  v_evt := case when p_status = 'suspended' then 'partner_suspended' else 'partner_reviewed' end;
  insert into public.ai_ecosystem_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (계약 변경 아님)', v_uid);
  return jsonb_build_object('ok', true, 'partner_status', p_status, 'warnings', v_warnings, 'contract_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_partner_register_list(p_kind text default null, p_limit int default 100)
returns setof public.ai_partner_registry language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_partner_registry where (p_kind is null or partner_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Dependency 목록(0508 읽기 전용 — Dependency 는 읽기 전용 분석만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ecosystem_dependencies(p_domain text default null, p_limit int default 100)
returns setof public.ai_operational_dependencies language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_operational_dependencies where (p_domain is null or domain = p_domain)
    order by criticality desc, created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Governance Event / Audit — Health/Performance/Integration/Graph/
--    SupplyChain/Risk/Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ecosystem_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('dependency_analyzed','ecosystem_health_evaluated','partner_performance_analyzed','integration_analyzed','dependency_graph_analyzed','supply_chain_analyzed','ecosystem_risk_assessed','ecosystem_briefing_recorded','ecosystem_recommendation_created','external_ecosystem_reference','ecosystem_monitoring_noted','integration_deprecation_noted','sla_reference_noted') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_ecosystem_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'dependency_analyzed' then ' (Dependency ≠ Failure)'
      when p_kind = 'ecosystem_health_evaluated' then ' (Availability ≠ SLA Guarantee)'
      when p_kind = 'partner_performance_analyzed' then ' (Partner ≠ Trust)'
      when p_kind = 'integration_analyzed' then ' (Integration ≠ Compatibility Guarantee)'
      when p_kind = 'ecosystem_risk_assessed' then ' (Risk ≠ Incident)'
      when p_kind = 'ecosystem_briefing_recorded' then ' (자동 발송 없음)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'contract_changed', false, 'api_changed', false, 'provider_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_ecosystem_audit(p_limit int default 100)
returns setof public.ai_ecosystem_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_ecosystem_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_partner_registry enable row level security;
alter table public.ai_ecosystem_events enable row level security;

comment on table public.ai_partner_registry is 'AI-OPS-27 — Partner Registry(사람 등록만 — 4상태·Partner ≠ Trust·자동 계약 변경 없음).';
comment on table public.ai_ecosystem_events is 'AI-OPS-27 — Ecosystem Audit(event_type whitelist 16종·Dependency/Health/Integration/SupplyChain/Risk 통합).';
