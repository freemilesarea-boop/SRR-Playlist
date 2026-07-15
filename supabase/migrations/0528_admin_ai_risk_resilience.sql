-- 0528_admin_ai_risk_resilience.sql
-- Phase AI-OPS-25 — Enterprise Risk Intelligence, Business Resilience &
-- Continuity Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   Incident 원본: ai_incidents(0502 — 실측 telemetry 기반, Risk ≠ Incident 구분 참조).
--   Recovery 원본: ai_recovery_candidates/ai_playbooks(0502 — 자동 실행 없음).
--   Monitoring/Detection 원본: ai_reliability_indicators/objectives/snapshots(0507).
--   Continuity Proxy 원본: playback_events_v2(player_error/play_start — 0253).
--   외부 리스크 피드/보험 데이터/감사 보고서 원본 없음(실측) → risk_unavailable 유지.
--
-- Risk 정직성(전부 강제):
--   * 자동 Incident 생성/자동 Risk 종료/서비스 자동 중단/운영 정책 자동 변경 없음.
--   * Risk ≠ Incident. Likelihood ≠ Reality. Recovery Plan ≠ Recovery Success.
--   * Continuity ≠ Zero Downtime. Correlation ≠ Causation(의존 관계는 인과 확정 아님).
--   * Recommendation ≠ Operational Decision. Unknown 유지(null→0 금지).
--   * 표본 부족 sample_too_small. 근거 부족 risk_unverified.
--   * Risk 상태는 open/monitoring/mitigated/closed 4종만. closed 는 사람 + Evidence 필수.
--   * Trigger 없음 · 삭제 RPC 없음 · 원본(0502/0507) 미변경 · 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Risk Register — 사람 등록만(자동 Incident/Risk 생성 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_risk_register (
  id                  uuid primary key default gen_random_uuid(),
  risk_code           text not null unique,
  risk_category       text not null check (risk_category in ('strategic','operational','financial','market','technology','compliance','security')),
  title               text not null,
  description         text,
  likelihood_reference int check (likelihood_reference is null or (likelihood_reference >= 1 and likelihood_reference <= 5)),   -- Likelihood ≠ Reality(null 유지)
  impact_reference    int check (impact_reference is null or (impact_reference >= 1 and impact_reference <= 5)),
  linked_risk_ids     jsonb not null default '[]'::jsonb,        -- 의존 관계 참조(인과 확정 아님)
  linked_incident_ids jsonb not null default '[]'::jsonb,        -- ai_incidents(0502) 실존 검증
  controls            jsonb not null default '[]'::jsonb,        -- [{name, note}] — Control ≠ 제거 보장
  risk_status         text not null default 'open' check (risk_status in ('open','monitoring','mitigated','closed')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  closure_evidence    jsonb,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Risk ≠ Incident","Likelihood ≠ Reality","Recovery Plan ≠ Recovery Success"]'::jsonb,
  source_version      text not null default 'risk_v1(0528)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_risk_reg on public.ai_risk_register (risk_category, risk_status, created_at desc);

-- Dependency/Heatmap/Timeline/Continuity/Resilience/Control/Recovery/Briefing/권고/Audit 는 Event 통합(테이블 최소화 — 신규 테이블 2개뿐).
create table if not exists public.ai_risk_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('risk_registered','risk_reviewed','risk_closed','risk_mitigation_recorded','risk_timeline_recorded','risk_dependency_analyzed','risk_heatmap_evaluated','continuity_evaluated','resilience_evaluated','control_effectiveness_analyzed','recovery_readiness_evaluated','risk_correlation_analyzed','risk_briefing_recorded','risk_recommendation_created','external_risk_reference','risk_item_invalid_note')),
  ref_id              uuid,
  stage               text check (stage is null or stage in ('detection','investigation','mitigation','recovery','review')),   -- Risk Timeline 5단계
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_risk_evt on public.ai_risk_events (event_type, created_at desc);
create index if not exists idx_risk_evt_ref on public.ai_risk_events (ref_id, stage, created_at asc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 요약 — 리스크/복원력 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_risk_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_starts bigint; v_errors bigint;
begin
  perform public._admin_growth_guard();
  select count(*) filter (where event_type = 'play_start'), count(*) filter (where event_type = 'player_error')
    into v_starts, v_errors from public.playback_events_v2 where created_at > now() - interval '30 days';
  select jsonb_build_object(
    'register_total', (select count(*) from public.ai_risk_register),
    'register_by_category', (select coalesce(jsonb_object_agg(risk_category, n), '{}'::jsonb) from (select risk_category, count(*) n from public.ai_risk_register group by risk_category) x),
    'register_by_status', (select coalesce(jsonb_object_agg(risk_status, n), '{}'::jsonb) from (select risk_status, count(*) n from public.ai_risk_register group by risk_status) x),
    -- 복원력/연속성 실측(참조만 — 원본 미변경):
    'resilience_actuals', jsonb_build_object(
      'incidents_total_0502', (select count(*) from public.ai_incidents),
      'incidents_open_0502', (select count(*) from public.ai_incidents where status not in ('resolved','false_positive','closed')),
      'incidents_by_severity_0502', (select coalesce(jsonb_object_agg(severity, n), '{}'::jsonb) from (select severity, count(*) n from public.ai_incidents group by severity) x),
      'recovery_candidates_0502', (select count(*) from public.ai_recovery_candidates),
      'playbooks_reference_0502', (select count(*) from public.ai_playbooks where status = 'reference'),
      'playbooks_draft_0502', (select count(*) from public.ai_playbooks where status = 'draft'),
      'reliability_indicators_0507', (select count(*) from public.ai_reliability_indicators),
      'reliability_objectives_0507', (select count(*) from public.ai_reliability_objectives),
      'play_starts_30d', v_starts,
      'player_errors_30d', v_errors
    ),
    'risk_unavailable', jsonb_build_array('external_risk_feed','insurance_data','audit_firm_reports','regulatory_penalty_data','disaster_recovery_drill_logs'),   -- 원본 없음(실측)
    'no_auto_incident_creation', true, 'no_auto_risk_closure', true, 'no_auto_service_stop', true, 'no_auto_policy_change', true,
    'risk_is_not_incident', true, 'continuity_is_not_zero_downtime', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Risk 등록·검토 — 사람 RPC 만(자동 종료 금지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_risk_register_create(
  p_code text, p_category text, p_title text, p_evidence jsonb,
  p_description text default null, p_likelihood int default null, p_impact int default null,
  p_linked_risk_ids jsonb default '[]'::jsonb, p_linked_incident_ids jsonb default '[]'::jsonb,
  p_controls jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수(사람 등록 — 자동 Risk 생성 없음)'; end if;
  if p_category not in ('strategic','operational','financial','market','technology','compliance','security') then raise exception '허용되지 않는 risk_category'; end if;
  if p_likelihood is not null and (p_likelihood < 1 or p_likelihood > 5) then raise exception 'likelihood 1~5(Likelihood ≠ Reality)'; end if;
  if p_impact is not null and (p_impact < 1 or p_impact > 5) then raise exception 'impact 1~5'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(risk_unverified 방지)'; end if;
  if jsonb_array_length(coalesce(p_controls, '[]'::jsonb)) > 30 then raise exception 'control 30개 제한'; end if;
  v_cnt := jsonb_array_length(coalesce(p_linked_risk_ids, '[]'::jsonb));
  if v_cnt > 20 or jsonb_array_length(coalesce(p_linked_incident_ids, '[]'::jsonb)) > 20 then raise exception '연결 20개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_risk_register r where r.id in (select (jsonb_array_elements_text(p_linked_risk_ids))::uuid);
    if v_found <> v_cnt then raise exception 'linked risk 실존 검증 실패'; end if;
  end if;
  v_cnt := jsonb_array_length(coalesce(p_linked_incident_ids, '[]'::jsonb));
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_incidents i where i.id in (select (jsonb_array_elements_text(p_linked_incident_ids))::uuid);
    if v_found <> v_cnt then raise exception 'incident(0502) 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_risk_register where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_risk_register (risk_code, risk_category, title, description, likelihood_reference, impact_reference, linked_risk_ids, linked_incident_ids, controls, evidence, idempotency_key, created_by)
  values (p_code, p_category, left(p_title, 200), p_description, p_likelihood, p_impact, coalesce(p_linked_risk_ids, '[]'::jsonb), coalesce(p_linked_incident_ids, '[]'::jsonb), coalesce(p_controls, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_risk_events (event_type, ref_id, detail, actor_id) values ('risk_registered', v_id, p_code || ' (' || p_category || ') — 사람 등록(Risk ≠ Incident)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'risk_status', 'open', 'incident_created', false, 'production_applied', false);
end $$;

create or replace function public.admin_risk_register_review(p_id uuid, p_status text, p_reason text, p_closure_evidence jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('open','monitoring','mitigated','closed') then raise exception 'Risk 상태는 open/monitoring/mitigated/closed 4종만'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수(자동 Risk 종료 금지)'; end if;
  select risk_status, created_by into v_cur, v_creator from public.ai_risk_register where id = p_id for update;
  if v_cur is null then raise exception 'risk 없음'; end if;
  if v_cur = 'closed' then raise exception '종결 상태(closed)에서 재결정 불가'; end if;
  -- closed 는 사람 + 종결 Evidence 필수(자동 종료 금지 — 서버 강제)
  if p_status = 'closed' and (p_closure_evidence is null or jsonb_typeof(p_closure_evidence) <> 'array' or jsonb_array_length(p_closure_evidence) = 0) then
    raise exception 'closed 전환은 종결 Evidence 필수(risk_unverified)';
  end if;
  if v_creator is not null and v_creator = v_uid and p_status in ('mitigated','closed') then
    v_warnings := jsonb_build_array('self_review_warning: 등록자와 판정자가 동일');
  end if;
  update public.ai_risk_register
     set risk_status = p_status, warnings = warnings || v_warnings,
         closure_evidence = case when p_status = 'closed' then p_closure_evidence else closure_evidence end,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  v_evt := case when p_status = 'closed' then 'risk_closed' when p_status = 'mitigated' then 'risk_mitigation_recorded' else 'risk_reviewed' end;
  insert into public.ai_risk_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || case when p_status = 'mitigated' then ' (Recovery Plan ≠ Recovery Success)' else '' end, v_uid);
  return jsonb_build_object('ok', true, 'risk_status', p_status, 'warnings', v_warnings, 'auto_closed', false, 'production_applied', false);
end $$;

create or replace function public.admin_risk_register_list(p_category text default null, p_limit int default 100)
returns setof public.ai_risk_register language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_risk_register where (p_category is null or risk_category = p_category)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Risk Timeline — Detection→Investigation→Mitigation→Recovery→Review(기록만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_risk_timeline_record(p_risk_id uuid, p_stage text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_stage not in ('detection','investigation','mitigation','recovery','review') then raise exception '허용되지 않는 stage(5단계)'; end if;
  if p_note is null or btrim(p_note) = '' then raise exception '기록 내용 필수'; end if;
  if not exists (select 1 from public.ai_risk_register where id = p_risk_id) then raise exception 'risk 실존 검증 실패'; end if;
  insert into public.ai_risk_events (event_type, ref_id, stage, detail, actor_id)
  values ('risk_timeline_recorded', p_risk_id, p_stage, left(p_note, 300) || ' (기록 — 단계 완료 보장 아님)', v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'stage', p_stage, 'stage_completed_guarantee', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Governance Event / Audit — Dependency/Heatmap/Continuity/Resilience/
--    Control/Recovery/Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_risk_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('risk_dependency_analyzed','risk_heatmap_evaluated','continuity_evaluated','resilience_evaluated','control_effectiveness_analyzed','recovery_readiness_evaluated','risk_correlation_analyzed','risk_briefing_recorded','risk_recommendation_created','external_risk_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_risk_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'risk_dependency_analyzed' then ' (의존 관계 — 인과 확정 아님)'
      when p_kind = 'continuity_evaluated' then ' (Continuity ≠ Zero Downtime)'
      when p_kind = 'recovery_readiness_evaluated' then ' (Recovery Plan ≠ Recovery Success)'
      when p_kind = 'risk_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'risk_heatmap_evaluated' then ' (Likelihood ≠ Reality)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'risk_resolved', false, 'service_stopped', false, 'policy_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_risk_audit(p_limit int default 100)
returns setof public.ai_risk_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_risk_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_risk_register enable row level security;
alter table public.ai_risk_events enable row level security;

comment on table public.ai_risk_register is 'AI-OPS-25 — Enterprise Risk Register(사람 등록만 — 4상태·closed 는 Evidence 필수·Risk ≠ Incident).';
comment on table public.ai_risk_events is 'AI-OPS-25 — Risk Audit(event_type whitelist 16종·Timeline 5단계·Dependency/Heatmap/Continuity/Resilience/Recovery 통합).';
