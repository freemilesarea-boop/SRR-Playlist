-- 0533_admin_ai_executive_os.sql
-- Phase AI-OPS-30 — Enterprise Executive AI Operating System, Unified Intelligence &
-- Autonomous Advisory Center(최종 통합 레이어).
--
-- 실제 구조 분석 결과(추측 없음 — AI-OPS-1~29 실측 소스 전부 검증 완료):
--   Strategy(0524)/Execution·Commitment(0520)/Performance·KPI(0525)/Finance(0526)/
--   Market(0527)/Risk(0528)/Resources(0529)/Ecosystem(0530)/Knowledge(0531)/
--   Learning(0532) + 핵심 실측(subscriptions/users/playback_events_v2).
--   본 Phase 는 기존 모듈을 대체하지 않는 통합 관제 레이어 — 전부 읽기 전용 조회.
--   신규 테이블은 이벤트 1개뿐(Executive OS 는 새 엔터티를 만들지 않음).
--
-- Executive AI 정직성(전부 강제):
--   * 자동 Executive Decision/Strategy·KPI·Budget·Policy·계약 변경 없음.
--   * Executive View ≠ Executive Decision. Enterprise Health ≠ Business Success.
--   * Cross-domain Correlation ≠ Causation. Recommendation ≠ Approval.
--   * Confidence ≠ Correctness. Unified Intelligence ≠ Complete Knowledge.
--   * Health 는 영역별 독립 평가 — 전체 점수 단일 합산 없음(클라이언트 로직도 강제).
--   * Unknown 유지(null→0 금지). 근거 부족 executive_unverified.
--   * Trigger 없음 · 삭제 RPC 없음 · 원본(0472~0532) 미변경 · 자동 발송 없음.

-- Advisory/Briefing/Health/CrossDomain/Timeline/Graph/Scorecard 검토 기록은 Event 통합(신규 테이블 1개).
create table if not exists public.ai_executive_os_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('unified_view_reviewed','enterprise_health_evaluated','cross_domain_analyzed','unified_timeline_reviewed','executive_graph_analyzed','operating_scorecard_evaluated','executive_advisory_created','unified_briefing_recorded','situation_room_noted','executive_review_noted','external_executive_reference','executive_os_governance_noted')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_os_evt on public.ai_executive_os_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Unified Summary — 10개 도메인 실측 통합 조회(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_os_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_mrr numeric; v_starts bigint; v_errors bigint;
begin
  perform public._admin_growth_guard();
  select coalesce(sum(current_amount), 0) into v_mrr from public.subscriptions where status in ('active','cancel_scheduled');
  select count(*) filter (where event_type = 'play_start'), count(*) filter (where event_type = 'player_error')
    into v_starts, v_errors from public.playback_events_v2 where created_at > now() - interval '30 days';
  select jsonb_build_object(
    -- 핵심 실측:
    'core_actuals', jsonb_build_object(
      'mrr', v_mrr,
      'members_total', (select count(*) from public.users),
      'play_starts_30d', v_starts,
      'player_errors_30d', v_errors
    ),
    -- 10개 도메인 실측(전부 읽기 전용 참조 — 원본 미변경):
    'domain_actuals', jsonb_build_object(
      'strategy', jsonb_build_object(
        'visions_0524', (select count(*) from public.ai_corporate_vision_records where record_status = 'active_reference'),
        'objectives_0524', (select count(*) from public.ai_corporate_objectives),
        'roadmap_items_0524', (select count(*) from public.ai_strategic_roadmap_items)
      ),
      'execution', jsonb_build_object(
        'commitments_0520', (select count(*) from public.ai_execution_commitments),
        'priorities_0518', (select count(*) from public.ai_executive_priority_candidates),
        'outcomes_0514', (select count(*) from public.ai_decision_outcomes)
      ),
      'performance', jsonb_build_object(
        'kpi_definitions_0525', (select count(*) from public.ai_kpi_definitions),
        'kpi_snapshots_0525', (select count(*) from public.ai_kpi_snapshots)
      ),
      'finance', jsonb_build_object(
        'financial_records_0526', (select count(*) from public.ai_financial_records),
        'financial_snapshots_0526', (select count(*) from public.ai_financial_snapshots)
      ),
      'market', jsonb_build_object(
        'competitors_0527', (select count(*) from public.ai_market_competitors),
        'signals_0527', (select count(*) from public.ai_market_signals)
      ),
      'risk', jsonb_build_object(
        'risks_0528', (select count(*) from public.ai_risk_register),
        'risks_open_0528', (select count(*) from public.ai_risk_register where risk_status = 'open'),
        'incidents_open_0502', (select count(*) from public.ai_incidents where status not in ('resolved','false_positive','closed'))
      ),
      'resources', jsonb_build_object(
        'resources_0529', (select count(*) from public.ai_resource_registry),
        'capacity_snapshots_0508', (select count(*) from public.ai_capacity_snapshots)
      ),
      'ecosystem', jsonb_build_object(
        'partners_0530', (select count(*) from public.ai_partner_registry),
        'dependencies_0508', (select count(*) from public.ai_operational_dependencies)
      ),
      'knowledge', jsonb_build_object(
        'org_memory_0531', (select count(*) from public.ai_org_memory),
        'knowledge_nodes_0498', (select count(*) from public.ai_knowledge_nodes)
      ),
      'learning', jsonb_build_object(
        'learning_registry_0532', (select count(*) from public.ai_learning_registry),
        'org_learnings_0515', (select count(*) from public.ai_organizational_learnings)
      )
    ),
    'executive_unavailable', jsonb_build_array('board_reporting_system','external_erp','bi_warehouse','realtime_stream_metrics'),   -- 원본 없음(실측)
    'no_auto_executive_decision', true, 'no_auto_strategy_change', true, 'no_auto_budget_change', true, 'no_auto_policy_change', true,
    'executive_view_is_not_decision', true, 'health_is_not_business_success', true, 'unified_is_not_complete_knowledge', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Governance Event / Audit — Advisory/Briefing/Health/CrossDomain/
--    Timeline/Graph/Scorecard 검토 기록 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_os_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('unified_view_reviewed','enterprise_health_evaluated','cross_domain_analyzed','unified_timeline_reviewed','executive_graph_analyzed','operating_scorecard_evaluated','executive_advisory_created','unified_briefing_recorded','situation_room_noted','executive_review_noted','external_executive_reference','executive_os_governance_noted') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_executive_os_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'enterprise_health_evaluated' then ' (Health ≠ Business Success·단일 합산 없음)'
      when p_kind = 'cross_domain_analyzed' then ' (Correlation ≠ Causation)'
      when p_kind = 'executive_advisory_created' then ' (Recommendation ≠ Approval)'
      when p_kind = 'unified_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'unified_view_reviewed' then ' (Executive View ≠ Decision)'
      when p_kind = 'executive_graph_analyzed' then ' (Cycle 감지 — 인과 주장 없음)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'executive_decision_made', false, 'strategy_changed', false, 'budget_changed', false, 'policy_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_os_audit(p_limit int default 100)
returns setof public.ai_executive_os_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_os_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_executive_os_events enable row level security;

comment on table public.ai_executive_os_events is 'AI-OPS-30 — Executive OS Audit(event_type whitelist 12종·통합 관제 레이어 — 신규 엔터티 없음·전 도메인 읽기 전용).';
