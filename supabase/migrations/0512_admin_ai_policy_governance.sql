-- 0512_admin_ai_policy_governance.sql
-- Phase AI-OPS-9 — Enterprise Policy & Strategy Governance Center.
--
-- 실제 정책 구조 분석 결과(추측 없음):
--   Pricing:    subscription_plans(0015 — plan_type individual/business, price, billing_cycle).
--   Settlement: settlement_policies(0059 — pool/company/tax ratio, min_payout, append-only 보호).
--   Retention:  ai_data_retention_policies(0510 — policy_code+version unique, legal_basis 필수).
--   SLA/Escalation/Emergency: ai_operational_policies(0509 — policy_code+version, checksum).
--   Brand/Playlist(B2B): franchise_music_policies + franchise_policy_versions(0349).
--   Enterprise 자동화:   enterprise_policy_automation_rules(0378).
--   Contract: artist_contracts(0057) / Rollout: track rollouts(0486) / Incident: playbooks(0502) /
--   Capacity: ai_capacity_plans(0508) / AI Learning·Recommendation: constitution rules(0496).
--   Store/Artist/Content 전용 정책 테이블은 없음 — inventory 에서 reference_only 정직 표기.
--
-- 원칙:
--   * AI 는 Policy Recommendation 만 생성 — 자동 정책/가격/계약/정산/추천 정책 변경 없음.
--     approved_reference 는 '참고 승인' 상태일 뿐 실제 Production 적용 상태가 아니다.
--   * 버전은 append-only(새 버전 insert 만) — 덮어쓰기 금지, 버전 수정/삭제 RPC 없음.
--   * 기존 정책 원본 테이블(settlement_policies/subscription_plans/…)은 절대 변경하지 않음(읽기 집계만).
--   * 모든 추천은 Recommendation/Reason/Evidence/Confidence/Alternatives/Risk/Preconditions/
--     Limitations 포함(서버 검증). Trigger 없음 · 삭제 RPC 없음 · payload 크기 제한.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Policy Registry — 전사 정책 인벤토리(도메인 18종 whitelist).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_policies (
  id                  uuid primary key default gen_random_uuid(),
  policy_code         text not null unique,
  domain              text not null check (domain in ('pricing','contract','settlement','playlist','recommendation','ai_learning','security','privacy','retention','brand','enterprise','store','artist','content','rollout','incident','capacity','cost')),
  title               text not null,
  status              text not null default 'draft' check (status in ('active','draft','deprecated','archived','proposed','insufficient_data')),
  current_version     int not null default 1 check (current_version >= 1),
  source_ref          text,                                  -- 실제 원본 테이블/근거 참조(없으면 registry 전용 — 정직 표기)
  depends_on          jsonb not null default '[]'::jsonb,    -- 의존 정책 code 배열(그래프 edge)
  objectives          jsonb not null default '[]'::jsonb,    -- Strategy Alignment 용 선언 목표
  limitations         jsonb not null default '["registry 기록 — Production 정책 원본 아님","자동 적용 없음"]'::jsonb,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_ent_policy on public.ai_enterprise_policies (domain, status, updated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Policy Versions — append-only 버전 관리(덮어쓰기 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_policy_versions (
  id                  uuid primary key default gen_random_uuid(),
  policy_id           uuid not null references public.ai_enterprise_policies(id),
  version             int not null check (version >= 1),
  previous_version    int check (previous_version is null or previous_version >= 1),
  content             jsonb not null default '{}'::jsonb,
  effective_date      date,
  change_reason       text not null,                         -- 사유 없는 버전 금지
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  proposed_by         uuid,
  approved_by         uuid,
  approval_date       timestamptz,
  created_at          timestamptz not null default now(),
  unique (policy_id, version)                                -- 중복 버전 금지
);
create index if not exists idx_ent_policy_ver on public.ai_enterprise_policy_versions (policy_id, version desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Policy Recommendation — Explainable(8요소) + Approval Workflow + Simulation 기록.
--    approval_status 는 참고 상태 — 실제 적용 상태가 아니다.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_policy_recommendations (
  id                  uuid primary key default gen_random_uuid(),
  rec_code            text not null unique,
  policy_code         text,                                  -- 대상 정책(신규 제안이면 null 가능)
  rec_type            text not null check (rec_type in ('policy_change','new_policy','deprecate','conflict_resolution','alignment_fix','simulation_followup','manual')),
  recommendation      text not null,
  reason              text not null,
  evidence            jsonb not null default '[]'::jsonb,
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  alternatives        jsonb not null default '[]'::jsonb,
  risk                text not null,
  preconditions       jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["추천만 — 자동 정책 변경·Production 적용 없음"]'::jsonb,
  simulation          jsonb,                                 -- Digital Twin evidence-only 결과(simulated_not_actual)
  impact              jsonb,                                 -- Impact Analysis 결과(negligible~critical/insufficient_data)
  approval_status     text not null default 'draft' check (approval_status in ('draft','proposed','waiting_review','approved_reference','rejected','cancelled','archived')),
  human_decision_reason text,
  decided_by          uuid,
  decided_at          timestamptz,
  source_version      text not null default 'polgov_v1(0512)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_policy_rec on public.ai_policy_recommendations (approval_status, created_at desc);

create table if not exists public.ai_policy_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('policy_registered','version_added','impact_analyzed','simulation_recorded','recommendation_proposed','recommendation_status_changed','conflict_detected','alignment_reviewed','consistency_reviewed','inventory_viewed_reference')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_policy_evt on public.ai_policy_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 요약 — registry + 실제 정책 원본 테이블 집계(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'registry_total', (select count(*) from public.ai_enterprise_policies),
    'registry_by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.ai_enterprise_policies group by status) x),
    'registry_by_domain', (select coalesce(jsonb_object_agg(domain, n), '{}'::jsonb) from (select domain, count(*) n from public.ai_enterprise_policies group by domain) x),
    'versions_total', (select count(*) from public.ai_enterprise_policy_versions),
    'recommendations_by_status', (select coalesce(jsonb_object_agg(approval_status, n), '{}'::jsonb) from (select approval_status, count(*) n from public.ai_policy_recommendations group by approval_status) x),
    -- 실제 정책 원본(원본 미변경 — 존재 집계만):
    'source_settlement_policies', (select count(*) from public.settlement_policies),
    'source_settlement_latest', (select jsonb_build_object('effective_from', effective_from, 'pool_revenue_ratio', pool_revenue_ratio, 'company_fee_ratio', company_fee_ratio, 'withholding_tax_ratio', withholding_tax_ratio, 'min_payout_amount', min_payout_amount, 'min_payout_basis', min_payout_basis)
        from public.settlement_policies order by effective_from desc limit 1),
    'source_subscription_plans', (select coalesce(jsonb_agg(jsonb_build_object('plan_type', plan_type, 'price', price, 'billing_cycle', billing_cycle, 'is_active', is_active) order by plan_type), '[]'::jsonb) from public.subscription_plans),
    'source_retention_policies', (select count(*) from public.ai_data_retention_policies),
    'source_operational_policies', (select count(*) from public.ai_operational_policies),
    'source_franchise_policies', (select count(*) from public.franchise_music_policies),
    'source_automation_rules', (select count(*) from public.enterprise_policy_automation_rules where deleted_at is null),
    'no_auto_policy_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 인벤토리/버전 조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_inventory(p_domain text default null, p_status text default null, p_limit int default 50)
returns setof public.ai_enterprise_policies language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_policies
    where (p_domain is null or domain = p_domain) and (p_status is null or status = p_status)
    order by updated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

create or replace function public.admin_policy_versions(p_policy_code text, p_limit int default 50)
returns setof public.ai_enterprise_policy_versions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select v.* from public.ai_enterprise_policy_versions v
    join public.ai_enterprise_policies p on p.id = v.policy_id
    where p.policy_code = p_policy_code
    order by v.version desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 정책 등록(v1 생성) — registry 기록일 뿐 Production 정책이 아님.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_register(
  p_code text, p_domain text, p_title text, p_content jsonb, p_change_reason text,
  p_evidence jsonb default '[]'::jsonb, p_source_ref text default null,
  p_depends_on jsonb default '[]'::jsonb, p_objectives jsonb default '[]'::jsonb,
  p_status text default 'draft', p_effective_date date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_code is null or btrim(p_code) = '' then raise exception 'policy_code 필수'; end if;
  if p_change_reason is null or btrim(p_change_reason) = '' then raise exception 'change_reason 필수 — 사유 없는 정책 등록 금지'; end if;
  if pg_column_size(p_content) > 65536 then raise exception 'content 64KB 초과'; end if;
  if pg_column_size(p_evidence) > 32768 or pg_column_size(p_depends_on) > 16384 or pg_column_size(p_objectives) > 16384 then raise exception 'payload 크기 초과'; end if;
  if exists (select 1 from public.ai_enterprise_policies where policy_code = p_code) then raise exception '중복 policy_code — 덮어쓰기 금지(버전 추가는 admin_policy_version_add)'; end if;
  insert into public.ai_enterprise_policies (policy_code, domain, title, status, current_version, source_ref, depends_on, objectives, created_by)
  values (p_code, p_domain, p_title, coalesce(p_status, 'draft'), 1, p_source_ref, coalesce(p_depends_on, '[]'::jsonb), coalesce(p_objectives, '[]'::jsonb), v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_policy_versions (policy_id, version, previous_version, content, effective_date, change_reason, evidence, proposed_by)
  values (v_id, 1, null, coalesce(p_content, '{}'::jsonb), p_effective_date, p_change_reason, coalesce(p_evidence, '[]'::jsonb), v_uid);
  insert into public.ai_policy_events (event_type, ref_id, detail, actor_id) values ('policy_registered', v_id, p_code || ' v1 (' || p_domain || ')', v_uid);
  return jsonb_build_object('ok', true, 'policy_id', v_id, 'version', 1, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 버전 추가 — append-only(기존 버전 불변). status 변경도 여기서만(사유 필수).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_version_add(
  p_code text, p_content jsonb, p_change_reason text,
  p_evidence jsonb default '[]'::jsonb, p_effective_date date default null,
  p_new_status text default null, p_approved_by_self boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cur int; v_next int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_change_reason is null or btrim(p_change_reason) = '' then raise exception 'change_reason 필수 — 사유 없는 버전 금지'; end if;
  if pg_column_size(p_content) > 65536 or pg_column_size(p_evidence) > 32768 then raise exception 'payload 크기 초과'; end if;
  select id, current_version into v_id, v_cur from public.ai_enterprise_policies where policy_code = p_code for update;
  if v_id is null then raise exception '정책 없음: %', p_code; end if;
  v_next := v_cur + 1;
  insert into public.ai_enterprise_policy_versions (policy_id, version, previous_version, content, effective_date, change_reason, evidence, proposed_by, approved_by, approval_date)
  values (v_id, v_next, v_cur, coalesce(p_content, '{}'::jsonb), p_effective_date, p_change_reason, coalesce(p_evidence, '[]'::jsonb), v_uid,
          case when p_approved_by_self then v_uid end, case when p_approved_by_self then now() end);
  update public.ai_enterprise_policies
     set current_version = v_next, updated_at = now(),
         status = coalesce(p_new_status, status)
   where id = v_id;
  insert into public.ai_policy_events (event_type, ref_id, detail, actor_id) values ('version_added', v_id, p_code || ' v' || v_next, v_uid);
  return jsonb_build_object('ok', true, 'policy_id', v_id, 'version', v_next, 'previous_version', v_cur, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 추천 저장 — Explainable 8요소 서버 검증(추천만 — 자동 적용 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_recommendation_save(
  p_code text, p_rec_type text, p_recommendation text, p_reason text,
  p_evidence jsonb, p_confidence numeric, p_alternatives jsonb, p_risk text,
  p_preconditions jsonb, p_limitations jsonb, p_idempotency_key text,
  p_policy_code text default null, p_simulation jsonb default null, p_impact jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_recommendation is null or btrim(p_recommendation) = '' then raise exception 'Recommendation 필수'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(빈 배열 금지)'; end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 100 then raise exception 'Confidence 0~100 필수'; end if;
  if p_alternatives is null or jsonb_typeof(p_alternatives) <> 'array' or jsonb_array_length(p_alternatives) = 0 then raise exception 'Alternatives 필수'; end if;
  if p_risk is null or btrim(p_risk) = '' then raise exception 'Risk 필수'; end if;
  if p_preconditions is null or jsonb_typeof(p_preconditions) <> 'array' then raise exception 'Preconditions 필수(배열)'; end if;
  if p_limitations is null or jsonb_typeof(p_limitations) <> 'array' or jsonb_array_length(p_limitations) = 0 then raise exception 'Limitations 필수'; end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then raise exception 'idempotency_key 필수'; end if;
  if pg_column_size(p_evidence) > 32768 or pg_column_size(coalesce(p_simulation, '{}'::jsonb)) > 32768 or pg_column_size(coalesce(p_impact, '{}'::jsonb)) > 32768 then raise exception 'payload 크기 초과'; end if;
  select id into v_id from public.ai_policy_recommendations where idempotency_key = p_idempotency_key;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_policy_recommendations (rec_code, policy_code, rec_type, recommendation, reason, evidence, confidence, alternatives, risk, preconditions, limitations, simulation, impact, approval_status, idempotency_key, created_by)
  values (p_code, p_policy_code, p_rec_type, p_recommendation, p_reason, p_evidence, p_confidence, p_alternatives, p_risk, p_preconditions, p_limitations, p_simulation, p_impact, 'proposed', p_idempotency_key, v_uid)
  returning id into v_id;
  insert into public.ai_policy_events (event_type, ref_id, detail, actor_id) values ('recommendation_proposed', v_id, p_code || ' (' || p_rec_type || ')', v_uid);
  if p_simulation is not null then
    insert into public.ai_policy_events (event_type, ref_id, detail, actor_id) values ('simulation_recorded', v_id, p_code || ' — simulated_not_actual', v_uid);
  end if;
  if p_impact is not null then
    insert into public.ai_policy_events (event_type, ref_id, detail, actor_id) values ('impact_analyzed', v_id, p_code, v_uid);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'approval_status', 'proposed', 'production_applied', false, 'human_approval_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 추천 결정 — 사람만(허용 전이 whitelist). approved_reference ≠ 실제 적용.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_recommendation_decide(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('proposed','waiting_review','approved_reference','rejected','cancelled','archived') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '결정 사유 필수'; end if;
  select approval_status into v_cur from public.ai_policy_recommendations where id = p_id for update;
  if v_cur is null then raise exception '추천 없음'; end if;
  if v_cur in ('approved_reference','rejected','cancelled','archived') and p_status <> 'archived' then
    raise exception '종결 상태(%)에서는 archive 만 가능', v_cur;
  end if;
  update public.ai_policy_recommendations
     set approval_status = p_status, human_decision_reason = p_reason, decided_by = v_uid, decided_at = now()
   where id = p_id;
  insert into public.ai_policy_events (event_type, ref_id, detail, actor_id)
  values ('recommendation_status_changed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'approval_status', p_status, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) 추천/감사 조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_recommendations(p_status text default null, p_limit int default 50)
returns setof public.ai_policy_recommendations language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_policy_recommendations
    where (p_status is null or approval_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200);
end $$;

create or replace function public.admin_policy_audit(p_limit int default 100)
returns setof public.ai_policy_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_policy_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만(직접 접근 차단).
alter table public.ai_enterprise_policies enable row level security;
alter table public.ai_enterprise_policy_versions enable row level security;
alter table public.ai_policy_recommendations enable row level security;
alter table public.ai_policy_events enable row level security;

comment on table public.ai_enterprise_policies is 'AI-OPS-9 — 전사 정책 registry(도메인 18종). Production 정책 원본 아님 — 자동 적용 없음.';
comment on table public.ai_enterprise_policy_versions is 'AI-OPS-9 — 정책 버전 append-only(덮어쓰기 금지·중복 버전 unique 방지).';
comment on table public.ai_policy_recommendations is 'AI-OPS-9 — Explainable 정책 추천 + Human Approval Workflow(approved_reference ≠ 실제 적용).';
comment on table public.ai_policy_events is 'AI-OPS-9 — Policy Governance Audit(event_type whitelist).';
