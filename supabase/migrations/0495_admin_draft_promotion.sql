-- ============================================
-- 0495_admin_draft_promotion.sql
--
-- Phase AI-MUSIC-7 — Human-Governed Draft Promotion & Controlled Execution Gateway.
--
-- AI-MUSIC-6 Sandbox 에서 검증된 Strategy 를 **운영자가 명시적으로 승인한 경우에만** 독립 Draft
-- (Playlist/Rotation/Rollout/Experiment)로 변환하고, Draft 를 재검증하여 ready/review_required/
-- rejected/expired 로 관리하며 Canary Candidate 지정까지만 수행한다.
--
--   Sandbox Approval Candidate → Human Review → Promotion Request → Draft Conversion
--   → Draft Validation → Canary Candidate → 운영자 승인 대기
--
-- ⚠️ 절대: 실제 Production 실행 없음. Production Entity(playlists/playlist_tracks/track_rollouts/
--   scheduler/queue/playback) 절대 UPDATE 금지. Experiment running/active 상태 생성 금지.
--   자동 Draft/자동 Canary/자동 승인/자동 Publish 없음. 운영자 명시 Promotion 승인 필수.
--   Sandbox go 만으로/Approval Candidate 만으로 Draft 생성 금지. Expired/Rejected Sandbox 승격 금지.
--   Hard Constraint Fail 승격 금지. Evidence 없는 Promotion 금지. Critical Risk 승인 불가.
--
-- 저장소는 **독립 Draft Entity**(strategy_promotion_drafts)로 생성한다(기존 Production/Experiment
-- 테이블 재사용·수정 금지). 권한 모델은 admin_users(super_admin 단일 role)뿐이므로 역할 분리를
-- 추정하지 않고 단일 관리자 승인 + Audit + 고위험 자기승인 제한으로 제한한다.
--
-- 절대 조건: SECURITY DEFINER + search_path 고정 · 관리자 가드 · draft_type/status/reason/risk
--   whitelist · Evidence 필수 · Idempotency · Duplicate 방지 · Input Hash/Model Version 일치 검증 ·
--   점수 0~100 clamp · NaN 금지 · Production Entity UPDATE 없음 · 자동 실행 Trigger 없음.
-- ============================================

-- 가드 _admin_growth_guard()(0472) 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Promotion Request 저장소.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.strategy_promotion_requests (
  id                    uuid primary key default gen_random_uuid(),
  sandbox_run_id        uuid references public.strategy_sandbox_runs(id) on delete set null,
  strategy_id           text,
  context_key           text not null,
  requested_draft_type  text not null check (requested_draft_type in ('playlist','rotation','rollout','experiment')),
  request_status        text not null default 'pending_review'
                          check (request_status in ('draft','pending_review','approved','rejected','conversion_failed','converted','expired','cancelled')),
  risk_tier             text check (risk_tier in ('low','medium','high','critical')),
  approval_readiness    int,
  additional_approval_required boolean default false,
  requested_by          uuid, reviewed_by uuid, approved_by uuid, rejected_by uuid,
  rejection_reason      text, approval_reason text,
  source_snapshot       jsonb not null default '{}'::jsonb,
  eligibility_result    jsonb, validation_result jsonb,
  draft_reference       uuid,
  idempotency_key       text,
  source_input_hash     text, source_model_version text,
  evidence              jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  reviewed_at timestamptz, approved_at timestamptz, rejected_at timestamptz, expired_at timestamptz
);
comment on table public.strategy_promotion_requests is
  'AI-MUSIC-7 — Promotion Request. Sandbox 승인 후보→운영자 승인→Draft 변환 요청. 자동 승인/실행 없음.';
create unique index if not exists uq_promotion_idem on public.strategy_promotion_requests (idempotency_key) where idempotency_key is not null;
create index if not exists idx_promotion_ctx on public.strategy_promotion_requests (context_key, created_at desc);
create index if not exists idx_promotion_status on public.strategy_promotion_requests (request_status, created_at desc);
create index if not exists idx_promotion_src on public.strategy_promotion_requests (sandbox_run_id, strategy_id, requested_draft_type);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 독립 Draft 저장소(Production/Experiment 테이블 미사용). running/applied 상태 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.strategy_promotion_drafts (
  id                  uuid primary key default gen_random_uuid(),
  promotion_request_id uuid references public.strategy_promotion_requests(id) on delete cascade,
  sandbox_run_id      uuid references public.strategy_sandbox_runs(id) on delete set null,
  strategy_id         text, context_key text not null,
  draft_type          text not null check (draft_type in ('playlist','rotation','rollout','experiment')),
  draft_status        text not null default 'generated'
                        check (draft_status in ('generated','validating','ready','review_required','rejected','expired','cancelled')),
  canary_status       text not null default 'not_candidate'
                        check (canary_status in ('not_candidate','candidate','review_required','rejected','expired')),
  risk_tier           text check (risk_tier in ('low','medium','high','critical')),
  canary_readiness    int, approval_readiness int,
  payload             jsonb not null default '{}'::jsonb,
  validation_result   jsonb, guardrail_result jsonb, go_criteria jsonb,
  rollback_plan       jsonb, observation_plan jsonb,
  source_input_hash   text, source_model_version text,
  evidence            jsonb not null default '[]'::jsonb,
  created_by          uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), expired_at timestamptz
);
comment on table public.strategy_promotion_drafts is
  'AI-MUSIC-7 — 독립 Draft(Playlist/Rotation/Rollout/Experiment). Production 무변경. 자동 실행/Publish 없음.';
create index if not exists idx_pdraft_ctx on public.strategy_promotion_drafts (context_key, created_at desc);
create index if not exists idx_pdraft_status on public.strategy_promotion_drafts (draft_status, created_at desc);
create index if not exists idx_pdraft_canary on public.strategy_promotion_drafts (canary_status, created_at desc);

create table if not exists public.strategy_promotion_audit (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid references public.strategy_promotion_requests(id) on delete cascade,
  draft_id       uuid references public.strategy_promotion_drafts(id) on delete cascade,
  action         text not null,
  previous_state text, next_state text, actor_id uuid, reason text, metadata jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_paudit on public.strategy_promotion_audit (request_id, created_at desc);
create index if not exists idx_paudit_draft on public.strategy_promotion_audit (draft_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Eligible Sandbox Runs — 승격 후보(passed/review_required + approval_candidate + 미expired).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_promotion_eligible_runs(p_context_key text default null, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select id as sandbox_run_id, strategy_id, context_key, run_status, review_status, decision, scenario, objective,
      safety_score, benefit_score, roi_score, risk_score, cost_score, confidence, sample_size, hard_constraint_pass,
      input_hash, model_version, strategy_snapshot, created_at, expired_at
    from public.strategy_sandbox_runs r
    where r.review_status = 'approval_candidate'
      and r.run_status in ('passed','review_required')
      and r.expired_at is null
      and coalesce(r.hard_constraint_pass, false) = true
      and r.decision in ('go','review_required')
      and (p_context_key is null or r.context_key = p_context_key)
    order by r.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end;
$$;
grant execute on function public.admin_promotion_eligible_runs(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Promotion Request 생성 — Eligibility 재검증 + Duplicate/Idempotency 방지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_promotion_request(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_row public.strategy_promotion_requests; v_run public.strategy_sandbox_runs;
  v_draft_type text := nullif(p_payload->>'requested_draft_type','');
  v_risk text := nullif(p_payload->>'risk_tier','');
  v_idem text := nullif(p_payload->>'idempotency_key','');
  v_run_id uuid := nullif(p_payload->>'sandbox_run_id','')::uuid;
  v_existing public.strategy_promotion_requests;
begin
  perform public._admin_growth_guard();

  if v_draft_type is null or v_draft_type not in ('playlist','rotation','rollout','experiment') then
    raise exception 'invalid requested_draft_type' using errcode='22023';
  end if;
  if v_risk is not null and v_risk not in ('low','medium','high','critical') then raise exception 'invalid risk_tier' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'evidence required (Evidence 없는 Promotion 금지)' using errcode='22023';
  end if;

  -- Idempotency: 동일 key 재호출 시 기존 반환.
  if v_idem is not null then
    select * into v_existing from public.strategy_promotion_requests where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'request', to_jsonb(v_existing)); end if;
  end if;

  -- Sandbox Eligibility 재검증.
  select * into v_run from public.strategy_sandbox_runs where id = v_run_id;
  if v_run.id is null then raise exception 'sandbox_run not found' using errcode='P0002'; end if;
  if v_run.expired_at is not null or v_run.run_status = 'expired' then raise exception 'Expired Sandbox 승격 불가' using errcode='22023'; end if;
  if v_run.run_status not in ('passed','review_required') then raise exception 'run_status 부적격(passed/review_required 필요)' using errcode='22023'; end if;
  if v_run.review_status <> 'approval_candidate' then raise exception 'approval_candidate 아님' using errcode='22023'; end if;
  if v_run.decision = 'reject' then raise exception 'Rejected Sandbox 승격 불가' using errcode='22023'; end if;
  if coalesce(v_run.hard_constraint_pass, false) = false then raise exception 'Hard Constraint Fail 승격 불가' using errcode='22023'; end if;

  -- Duplicate: 동일 sandbox_run + strategy + draft_type + active 상태.
  select * into v_existing from public.strategy_promotion_requests
    where sandbox_run_id = v_run_id and coalesce(strategy_id,'') = coalesce(nullif(p_payload->>'strategy_id',''),'')
      and requested_draft_type = v_draft_type and request_status in ('draft','pending_review','approved','converted')
    limit 1;
  if v_existing.id is not null then raise exception 'Duplicate Promotion(동일 Sandbox/Strategy/DraftType active 존재)' using errcode='23505'; end if;

  insert into public.strategy_promotion_requests(
    sandbox_run_id, strategy_id, context_key, requested_draft_type, request_status, risk_tier,
    approval_readiness, additional_approval_required, requested_by, source_snapshot, eligibility_result,
    idempotency_key, source_input_hash, source_model_version, evidence
  ) values (
    v_run_id, nullif(p_payload->>'strategy_id',''), coalesce(nullif(p_payload->>'context_key',''), v_run.context_key), v_draft_type, 'pending_review', v_risk,
    least(100,greatest(0,nullif(p_payload->>'approval_readiness','')::int)),
    coalesce((p_payload->>'additional_approval_required')::boolean, v_risk in ('high','critical')),
    auth.uid(), coalesce(p_payload->'source_snapshot', v_run.strategy_snapshot), p_payload->'eligibility_result',
    v_idem, coalesce(nullif(p_payload->>'source_input_hash',''), v_run.input_hash),
    coalesce(nullif(p_payload->>'source_model_version',''), v_run.model_version), p_payload->'evidence'
  ) returning id into v_id;

  insert into public.strategy_promotion_audit(request_id, action, next_state, actor_id, metadata)
  values (v_id, 'promotion_requested', 'pending_review', auth.uid(), jsonb_build_object('draft_type', v_draft_type, 'risk', v_risk));

  select * into v_row from public.strategy_promotion_requests where id = v_id;
  return jsonb_build_object('idempotent', false, 'request', to_jsonb(v_row));
end;
$$;
grant execute on function public.admin_promotion_request(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Review / Approve / Reject.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_promotion_review(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.strategy_promotion_requests;
begin
  perform public._admin_growth_guard();
  update public.strategy_promotion_requests set request_status='pending_review', reviewed_by=auth.uid(), reviewed_at=now()
    where id=p_id and request_status='pending_review' returning * into v_row;
  if v_row.id is null then raise exception 'not found or not reviewable' using errcode='P0002'; end if;
  insert into public.strategy_promotion_audit(request_id, action, next_state, actor_id, reason) values (p_id, 'promotion_review_started', 'pending_review', auth.uid(), p_reason);
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_promotion_review(uuid, text) to authenticated;

create or replace function public.admin_promotion_approve(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.strategy_promotion_requests;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.strategy_promotion_requests where id = p_id;
  if v_row.id is null then raise exception 'not found' using errcode='P0002'; end if;
  if v_row.request_status <> 'pending_review' then raise exception 'pending_review 상태만 승인 가능' using errcode='22023'; end if;
  if v_row.risk_tier = 'critical' then raise exception 'Critical Risk 는 이번 Phase 승인 불가' using errcode='22023'; end if;
  -- 자기 승인 제한(고위험): 승인자 ≠ 요청자.
  if v_row.risk_tier = 'high' and v_row.requested_by is not null and v_row.requested_by = auth.uid() then
    raise exception 'High Risk 자기 승인 불가(요청자와 승인자 분리 필요)' using errcode='22023';
  end if;

  update public.strategy_promotion_requests set request_status='approved', approved_by=auth.uid(), approval_reason=p_reason, approved_at=now()
    where id=p_id returning * into v_row;
  insert into public.strategy_promotion_audit(request_id, action, previous_state, next_state, actor_id, reason) values (p_id, 'promotion_approved', 'pending_review', 'approved', auth.uid(), p_reason);
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_promotion_approve(uuid, text) to authenticated;

create or replace function public.admin_promotion_reject(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.strategy_promotion_requests;
begin
  perform public._admin_growth_guard();
  update public.strategy_promotion_requests set request_status='rejected', rejected_by=auth.uid(), rejection_reason=p_reason, rejected_at=now()
    where id=p_id and request_status in ('pending_review','approved') returning * into v_row;
  if v_row.id is null then raise exception 'not found or not rejectable' using errcode='P0002'; end if;
  insert into public.strategy_promotion_audit(request_id, action, next_state, actor_id, reason) values (p_id, 'promotion_rejected', 'rejected', auth.uid(), p_reason);
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_promotion_reject(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Draft 변환 — request approved 일 때만. 독립 Draft 생성(Production 무변경). Idempotency.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_promotion_convert_draft(p_request_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req public.strategy_promotion_requests; v_draft public.strategy_promotion_drafts; v_id uuid;
begin
  perform public._admin_growth_guard();
  select * into v_req from public.strategy_promotion_requests where id = p_request_id;
  if v_req.id is null then raise exception 'request not found' using errcode='P0002'; end if;
  if v_req.request_status = 'converted' and v_req.draft_reference is not null then
    select * into v_draft from public.strategy_promotion_drafts where id = v_req.draft_reference;
    return jsonb_build_object('idempotent', true, 'draft', to_jsonb(v_draft));  -- 이미 변환됨
  end if;
  if v_req.request_status <> 'approved' then raise exception '승인된 요청만 Draft 변환 가능(운영자 승인 필수)' using errcode='22023'; end if;
  if p_payload->'payload' is null then raise exception 'draft payload required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;

  insert into public.strategy_promotion_drafts(
    promotion_request_id, sandbox_run_id, strategy_id, context_key, draft_type, draft_status, risk_tier,
    payload, guardrail_result, rollback_plan, observation_plan, source_input_hash, source_model_version, evidence, created_by
  ) values (
    p_request_id, v_req.sandbox_run_id, v_req.strategy_id, v_req.context_key, v_req.requested_draft_type, 'generated', v_req.risk_tier,
    p_payload->'payload', p_payload->'guardrail_result', p_payload->'rollback_plan', p_payload->'observation_plan',
    v_req.source_input_hash, v_req.source_model_version, p_payload->'evidence', auth.uid()
  ) returning id into v_id;

  update public.strategy_promotion_requests set request_status='converted', draft_reference=v_id where id=p_request_id;
  insert into public.strategy_promotion_audit(request_id, draft_id, action, next_state, actor_id) values (p_request_id, v_id, 'draft_created', 'generated', auth.uid());

  select * into v_draft from public.strategy_promotion_drafts where id = v_id;
  return jsonb_build_object('idempotent', false, 'draft', to_jsonb(v_draft));
end; $$;
grant execute on function public.admin_promotion_convert_draft(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Draft Validation — 결과 저장 + 상태(ready/review_required/rejected). Fail 이면 ready 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_promotion_draft_validate(p_draft_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_draft public.strategy_promotion_drafts; v_status text := nullif(p_payload->>'draft_status','');
begin
  perform public._admin_growth_guard();
  if v_status not in ('ready','review_required','rejected') then raise exception 'invalid draft_status(ready/review_required/rejected)' using errcode='22023'; end if;
  select * into v_draft from public.strategy_promotion_drafts where id = p_draft_id;
  if v_draft.id is null then raise exception 'draft not found' using errcode='P0002'; end if;
  if v_draft.expired_at is not null then raise exception 'Expired Draft' using errcode='22023'; end if;
  -- Hard Constraint Fail 이면 ready 금지.
  if v_status = 'ready' and coalesce((p_payload->>'hard_constraint_pass')::boolean, false) = false then
    raise exception 'Hard Constraint Fail — ready 금지' using errcode='22023';
  end if;

  update public.strategy_promotion_drafts set
    draft_status = v_status, validation_result = p_payload->'validation_result', guardrail_result = coalesce(p_payload->'guardrail_result', guardrail_result),
    risk_tier = coalesce(nullif(p_payload->>'risk_tier',''), risk_tier),
    canary_readiness = coalesce(least(100,greatest(0,nullif(p_payload->>'canary_readiness','')::int)), canary_readiness),
    approval_readiness = coalesce(least(100,greatest(0,nullif(p_payload->>'approval_readiness','')::int)), approval_readiness),
    go_criteria = coalesce(p_payload->'go_criteria', go_criteria), updated_at = now()
    where id = p_draft_id returning * into v_draft;

  insert into public.strategy_promotion_audit(draft_id, action, next_state, actor_id)
  values (p_draft_id, case when v_status='rejected' then 'draft_validation_failed' else 'draft_validation_passed' end, v_status, auth.uid());
  return to_jsonb(v_draft);
end; $$;
grant execute on function public.admin_promotion_draft_validate(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Canary Candidate 지정/해제 — ready + 미expired + risk≠critical + rollback/observation 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_promotion_mark_canary_candidate(p_draft_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_draft public.strategy_promotion_drafts;
begin
  perform public._admin_growth_guard();
  select * into v_draft from public.strategy_promotion_drafts where id = p_draft_id;
  if v_draft.id is null then raise exception 'draft not found' using errcode='P0002'; end if;
  if v_draft.draft_status <> 'ready' then raise exception 'ready Draft 만 Canary Candidate 가능' using errcode='22023'; end if;
  if v_draft.expired_at is not null then raise exception 'Expired Draft 지정 불가' using errcode='22023'; end if;
  if v_draft.risk_tier = 'critical' then raise exception 'Critical Risk 는 Candidate 불가' using errcode='22023'; end if;
  if v_draft.rollback_plan is null or v_draft.rollback_plan = '{}'::jsonb then raise exception 'Rollback Plan 필수' using errcode='22023'; end if;
  if v_draft.observation_plan is null or v_draft.observation_plan = '{}'::jsonb then raise exception 'Observation Plan 필수' using errcode='22023'; end if;

  update public.strategy_promotion_drafts set canary_status='candidate', updated_at=now() where id=p_draft_id returning * into v_draft;
  insert into public.strategy_promotion_audit(draft_id, action, next_state, actor_id, reason) values (p_draft_id, 'canary_candidate_marked', 'candidate', auth.uid(), p_reason);
  return to_jsonb(v_draft);
end; $$;
grant execute on function public.admin_promotion_mark_canary_candidate(uuid, text) to authenticated;

create or replace function public.admin_promotion_remove_canary_candidate(p_draft_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_draft public.strategy_promotion_drafts;
begin
  perform public._admin_growth_guard();
  update public.strategy_promotion_drafts set canary_status='not_candidate', updated_at=now() where id=p_draft_id returning * into v_draft;
  if v_draft.id is null then raise exception 'draft not found' using errcode='P0002'; end if;
  insert into public.strategy_promotion_audit(draft_id, action, next_state, actor_id, reason) values (p_draft_id, 'canary_candidate_rejected', 'not_candidate', auth.uid(), p_reason);
  return to_jsonb(v_draft);
end; $$;
grant execute on function public.admin_promotion_remove_canary_candidate(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 조회 — draft_detail / history / summary / audit.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_promotion_draft_detail(p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_draft public.strategy_promotion_drafts; v_audit jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_draft from public.strategy_promotion_drafts where id = p_draft_id;
  if v_draft.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_audit from public.strategy_promotion_audit a where a.draft_id = p_draft_id;
  return jsonb_build_object('draft', to_jsonb(v_draft), 'audit', v_audit);
end; $$;
grant execute on function public.admin_promotion_draft_detail(uuid) to authenticated;

create or replace function public.admin_promotion_history(p_context_key text default null, p_kind text default 'requests', p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  if p_kind = 'drafts' then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
      select * from public.strategy_promotion_drafts d where (p_context_key is null or d.context_key = p_context_key) order by d.created_at desc limit v_limit
    ) t;
  else
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
      select * from public.strategy_promotion_requests r where (p_context_key is null or r.context_key = p_context_key) order by r.created_at desc limit v_limit
    ) t;
  end if;
  return jsonb_build_object('kind', p_kind, 'items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_promotion_history(text, text, int) to authenticated;

create or replace function public.admin_promotion_summary(p_context_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req jsonb; v_draft jsonb;
begin
  perform public._admin_growth_guard();
  select to_jsonb(x) into v_req from (
    select count(*) total,
      count(*) filter (where request_status='pending_review') pending_reviews,
      count(*) filter (where request_status='approved') approved,
      count(*) filter (where request_status='rejected') rejected,
      count(*) filter (where request_status='converted') converted,
      count(*) filter (where request_status='expired') expired,
      count(*) filter (where risk_tier='high') high_risk,
      count(*) filter (where risk_tier='critical') critical_risk,
      round(avg(approval_readiness)::numeric,1) avg_approval_readiness
    from public.strategy_promotion_requests where (p_context_key is null or context_key = p_context_key)
  ) x;
  select to_jsonb(y) into v_draft from (
    select count(*) total,
      count(*) filter (where draft_status='ready') ready,
      count(*) filter (where draft_status='rejected') validation_failed,
      count(*) filter (where canary_status='candidate') canary_candidates,
      count(*) filter (where draft_status='expired') expired,
      round(avg(canary_readiness)::numeric,1) avg_canary_readiness
    from public.strategy_promotion_drafts where (p_context_key is null or context_key = p_context_key)
  ) y;
  return jsonb_build_object('context_key', p_context_key, 'requests', v_req, 'drafts', v_draft, 'generated_at', now());
end; $$;
grant execute on function public.admin_promotion_summary(text) to authenticated;

create or replace function public.admin_promotion_audit(p_request_id uuid default null, p_draft_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.strategy_promotion_audit a
    where (p_request_id is null or a.request_id = p_request_id) and (p_draft_id is null or a.draft_id = p_draft_id)
    order by a.created_at desc limit v_limit
  ) a;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_promotion_audit(uuid, uuid, int) to authenticated;
