-- ============================================
-- 0504_admin_ai_operations_center.sql
--
-- Phase AI-OPS-1 — AI Operations Center, Governance Workflow & Human-AI Collaboration.
--
-- AI 가 생성한 모든 전략/추천/복구안/운영 제안을 하나의 Operations Queue 로 모아
-- 운영자가 검토·승인·거절·피드백하는 통합 운영센터. **AI 는 제안만, 최종 운영은 사람.**
--
--   AI Engines → Recommendations → Operations Queue → Review Workflow
--   → Approval Workflow → Execution Queue(수동) → Audit → Evidence
--
-- ⚠️ 절대: Production Apply/자동 승인/자동 Merge/Rollout/Publish 없음. 기존 AI Engine/
--   Governance/Constitution/Trust/Self-Healing/Federated 정의 무변경. Trigger 없음.
--
-- 재사용 최우선: 큐 항목은 기존 Recommendation 테이블(ai_executive_recommendations 0503 ·
--   ai_recovery_candidates 0502 · ai_fleet_opportunities/ai_best_practices 0500 ·
--   strategy_snapshots 0493 · context_recommendation_outcomes 0491)을 **참조 등록만**
--   (내용 복제 없음 — 이중 진실 공급원 방지). Feedback 은 review 행에 내장(별도 테이블 미생성).
--   AI Feedback Loop 는 기록 기반 참고 Evidence — 자동 모델/가중치 변경 없음.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Operations Queue(참조 등록 — 내용 복제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operations (
  id              uuid primary key default gen_random_uuid(),
  operation_code  text not null unique,
  source_type     text not null check (source_type in ('executive_recommendation','recovery_candidate','fleet_opportunity','best_practice','strategy_snapshot','context_recommendation')),
  source_id       uuid not null,
  title           text not null,
  category        text not null check (category in ('strategy','risk_mitigation','opportunity','recovery','playlist','context')),
  risk_tier       text check (risk_tier is null or risk_tier in ('low','medium','high','critical')),
  impact          text check (impact is null or impact in ('low','moderate','high','critical')),
  approval_policy text not null default 'single' check (approval_policy in ('single','dual','executive')),
  status          text not null default 'new' check (status in ('new','reviewing','waiting_evidence','approved','rejected','archived')),
  timeline        jsonb not null default '[]'::jsonb,   -- [{at, event, actor, detail}]
  evidence_refs   jsonb not null default '[]'::jsonb,   -- 관련 Twin/Pattern/Incident 참조
  source_version  text not null,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source_type, source_id)                        -- 동일 Recommendation 중복 등록 방지
);
comment on table public.ai_operations is
  'AI-OPS-1 — 통합 Operations Queue. 기존 Recommendation 참조 등록만(복제 없음). 자동 승인/실행 없음 — 사람이 최종 운영.';
create index if not exists idx_ops_status on public.ai_operations (status, created_at desc);
create index if not exists idx_ops_risk on public.ai_operations (risk_tier, impact);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Review + Feedback(내장) — 승인 정책 게이트의 근거 행.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operation_reviews (
  id             uuid primary key default gen_random_uuid(),
  operation_id   uuid not null references public.ai_operations(id),
  action         text not null check (action in ('approve','hold','reject','request_review')),
  reason         text not null,
  -- AI Feedback Loop(기록 기반 참고 — 자동 학습/가중치 변경 없음).
  feedback_type  text check (feedback_type is null or feedback_type in ('accurate','inaccurate','needs_modification','insufficient_evidence')),
  learning_note  text,
  reviewer_id    uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_operation_reviews is
  'AI-OPS-1 — 운영자 Review/Feedback 기록. Feedback 은 AI 학습용 참고 Evidence(자동 반영 없음).';
create index if not exists idx_ops_review on public.ai_operation_reviews (operation_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Queue 등록 — Source 실존 검증(참조만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_operation_enroll(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_type text := p_payload->>'source_type'; v_sid uuid := (p_payload->>'source_id')::uuid;
        v_exists boolean := false; v_existing public.ai_operations; v_row public.ai_operations; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if v_type is null or v_type not in ('executive_recommendation','recovery_candidate','fleet_opportunity','best_practice','strategy_snapshot','context_recommendation') then raise exception 'invalid source_type' using errcode='22023'; end if;
  if v_sid is null then raise exception 'source_id required' using errcode='22023'; end if;
  if coalesce(p_payload->>'operation_code','') = '' or coalesce(p_payload->>'title','') = '' then raise exception 'operation_code/title required' using errcode='22023'; end if;
  if coalesce(p_payload->>'category','') not in ('strategy','risk_mitigation','opportunity','recovery','playlist','context') then raise exception 'invalid category' using errcode='22023'; end if;
  if coalesce(nullif(p_payload->>'approval_policy',''),'single') not in ('single','dual','executive') then raise exception 'invalid approval_policy' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' then raise exception 'source_version required' using errcode='22023'; end if;

  -- Source 실존 검증(존재하지 않는 Recommendation 등록 금지).
  if v_type = 'executive_recommendation' then select exists(select 1 from public.ai_executive_recommendations where id = v_sid) into v_exists;
  elsif v_type = 'recovery_candidate' then select exists(select 1 from public.ai_recovery_candidates where id = v_sid) into v_exists;
  elsif v_type = 'fleet_opportunity' then select exists(select 1 from public.ai_fleet_opportunities where id = v_sid) into v_exists;
  elsif v_type = 'best_practice' then select exists(select 1 from public.ai_best_practices where id = v_sid) into v_exists;
  elsif v_type = 'strategy_snapshot' then select exists(select 1 from public.strategy_snapshots where id = v_sid) into v_exists;
  elsif v_type = 'context_recommendation' then select exists(select 1 from public.context_recommendation_outcomes where id = v_sid) into v_exists;
  end if;
  if not v_exists then raise exception 'source not found (실존하지 않는 Recommendation 등록 금지)' using errcode='P0002'; end if;

  select * into v_existing from public.ai_operations where source_type = v_type and source_id = v_sid;
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'operation', to_jsonb(v_existing)); end if;

  insert into public.ai_operations(operation_code, source_type, source_id, title, category, risk_tier, impact, approval_policy,
    timeline, evidence_refs, source_version, created_by)
  values (p_payload->>'operation_code', v_type, v_sid, p_payload->>'title', p_payload->>'category',
    nullif(p_payload->>'risk_tier',''), nullif(p_payload->>'impact',''), coalesce(nullif(p_payload->>'approval_policy',''),'single'),
    jsonb_build_array(jsonb_build_object('at', now(), 'event', 'created', 'actor', auth.uid(), 'detail', v_type)),
    coalesce(p_payload->'evidence_refs','[]'::jsonb), p_payload->>'source_version', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_operations where id = v_id;
  return jsonb_build_object('idempotent', false, 'operation', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_operation_enroll(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Queue 조회 / 상세(리뷰 포함).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_operations_queue(p_status text default null, p_category text default null, p_risk text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select o.*, (select count(*) from public.ai_operation_reviews r where r.operation_id = o.id and r.action = 'approve') as approve_count
    from public.ai_operations o
    where (p_status is null or o.status = p_status) and (p_category is null or o.category = p_category) and (p_risk is null or o.risk_tier = p_risk)
    order by o.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_operations_queue(text, text, text, int) to authenticated;

create or replace function public.admin_operation_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operations; v_reviews jsonb; v_source jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_operations where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb) into v_reviews
  from public.ai_operation_reviews r where r.operation_id = p_id;
  -- Source 스냅샷(읽기 전용 참조 — Evidence Viewer 용).
  if v_row.source_type = 'executive_recommendation' then
    select to_jsonb(s) into v_source from (select title, summary, evidence, confidence, risk_tier, expected_outcome, status from public.ai_executive_recommendations where id = v_row.source_id) s;
  elsif v_row.source_type = 'recovery_candidate' then
    select to_jsonb(s) into v_source from (select strategy_type, description, evidence, confidence, validation_status, twin_run_id, status, outcome from public.ai_recovery_candidates where id = v_row.source_id) s;
  elsif v_row.source_type = 'fleet_opportunity' then
    select to_jsonb(s) into v_source from (select opportunity_type, severity, kpi_snapshot, evidence, status from public.ai_fleet_opportunities where id = v_row.source_id) s;
  elsif v_row.source_type = 'best_practice' then
    select to_jsonb(s) into v_source from (select title, observed_effect, sample_events, confidence, evidence, status from public.ai_best_practices where id = v_row.source_id) s;
  elsif v_row.source_type = 'strategy_snapshot' then
    select to_jsonb(s) into v_source from (select strategy_type, roi_score, risk_score, confidence, evidence, status from public.strategy_snapshots where id = v_row.source_id) s;
  elsif v_row.source_type = 'context_recommendation' then
    select to_jsonb(s) into v_source from (select reco_type, title, evidence, status, outcome from public.context_recommendation_outcomes where id = v_row.source_id) s;
  end if;
  return jsonb_build_object('found', true, 'operation', to_jsonb(v_row), 'reviews', v_reviews, 'source', v_source);
end; $$;
grant execute on function public.admin_operation_detail(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Review(승인/보류/거절/재검토) — 승인 정책 게이트(자동 승인 없음).
--    dual: 서로 다른 reviewer 2인 approve 필요 · reason 필수 · Timeline append.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_operation_review(p_id uuid, p_action text, p_reason text, p_feedback_type text default null, p_learning_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operations; v_approvals int; v_required int; v_new_status text;
begin
  perform public._admin_growth_guard();
  if p_action is null or p_action not in ('approve','hold','reject','request_review') then raise exception 'invalid action' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (근거 없는 판정 금지)' using errcode='22023'; end if;
  if p_feedback_type is not null and p_feedback_type not in ('accurate','inaccurate','needs_modification','insufficient_evidence') then raise exception 'invalid feedback_type' using errcode='22023'; end if;
  select * into v_row from public.ai_operations where id = p_id;
  if v_row.id is null then raise exception 'operation not found' using errcode='P0002'; end if;
  if v_row.status in ('approved','rejected','archived') then raise exception 'operation already finalized' using errcode='22023'; end if;

  insert into public.ai_operation_reviews(operation_id, action, reason, feedback_type, learning_note, reviewer_id)
  values (p_id, p_action, p_reason, p_feedback_type, p_learning_note, auth.uid());

  if p_action = 'approve' then
    -- 승인 정책 게이트: distinct reviewer 기준(자동 승인 없음).
    select count(distinct reviewer_id) into v_approvals from public.ai_operation_reviews where operation_id = p_id and action = 'approve';
    v_required := case v_row.approval_policy when 'dual' then 2 else 1 end;
    v_new_status := case when v_approvals >= v_required then 'approved' else 'reviewing' end;
  elsif p_action = 'reject' then v_new_status := 'rejected';
  elsif p_action = 'hold' then v_new_status := 'waiting_evidence';
  else v_new_status := 'reviewing';
  end if;

  update public.ai_operations set status = v_new_status,
    timeline = timeline || jsonb_build_array(jsonb_build_object('at', now(), 'event', p_action, 'actor', auth.uid(), 'detail', p_reason)),
    updated_at = now()
  where id = p_id returning * into v_row;
  return jsonb_build_object('operation', to_jsonb(v_row), 'note', case when v_row.status = 'reviewing' and p_action = 'approve' then 'dual approval — 추가 승인 필요' else null end);
end; $$;
grant execute on function public.admin_operation_review(uuid, text, text, text, text) to authenticated;

create or replace function public.admin_operation_archive(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operations;
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_operations where id = p_id;
  if v_row.id is null then raise exception 'operation not found' using errcode='P0002'; end if;
  update public.ai_operations set status = 'archived',
    timeline = timeline || jsonb_build_array(jsonb_build_object('at', now(), 'event', 'archived', 'actor', auth.uid(), 'detail', p_reason)),
    updated_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_operation_archive(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Analytics — 승인율/거절율/수정요청/평균 검토시간(실측 기반).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_operation_analytics()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ops jsonb; v_reviews jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total', count(*),
    'by_status', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.ai_operations group by status) x),
    'approved', count(*) filter (where status = 'approved'),
    'rejected', count(*) filter (where status = 'rejected'),
    'avg_review_hours', round((extract(epoch from avg(updated_at - created_at) filter (where status in ('approved','rejected'))) / 3600)::numeric, 1)
  ) into v_ops from public.ai_operations;
  select jsonb_build_object(
    'total', count(*),
    'modification_requests', count(*) filter (where feedback_type = 'needs_modification'),
    'accurate', count(*) filter (where feedback_type = 'accurate'),
    'inaccurate', count(*) filter (where feedback_type = 'inaccurate'),
    'insufficient_evidence', count(*) filter (where feedback_type = 'insufficient_evidence')
  ) into v_reviews from public.ai_operation_reviews;
  return jsonb_build_object('operations', v_ops, 'reviews', v_reviews, 'generated_at', now());
end; $$;
grant execute on function public.admin_operation_analytics() to authenticated;
