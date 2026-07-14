-- ============================================
-- 0506_admin_ai_post_change_observation.sql
--
-- Phase AI-OPS-3 — Post-Change Observation, Validation, Rollback Governance
-- & Operational Certification.
--
-- AI-OPS-2 에서 ready → completed_reference(외부 사람 실행 기록)에 도달한 Execution Plan 의
-- 실행 결과를 시스템이 적용/조작하지 않고 다음 흐름으로 **관측·검증·판정·권고**만 한다:
--   Manual Execution Reference → Observation Session → Baseline/Target Validation
--   → Runtime KPI Collection → Regression → Incident Correlation → 판정 →
--   Rollback Recommendation → Human Rollback Decision → Operational Certification → Audit
--
-- ⚠️ 절대: Production Apply/Merge/Deploy/Migration Apply/**Rollback 실행** 없음.
--   Rollback 권고 ≠ 실행 · rollback_completed_reference 는 외부 수행 기록일 뿐.
--   자동 Certification 없음(사람 판정 + 사유 필수). 외부 실행 Reference 없는 Observation
--   시작 금지(서버 게이트). Baseline 없는 검증 금지 · 예측/Simulation 값을 Actual 로
--   저장 금지 · null→0 금지. Trigger 없음 · 삭제 RPC 없음.
--
-- 실측 KPI 소스: playback_events_v2(0253) — error/skip/completion/like/events 만
-- (Queue/Scheduler/Buffer/TTFA/Revenue telemetry 미수집 → unsupported 정직 표기).
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Observation Session(Rollback Decision/Reference/Certification 내장).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_post_change_observations (
  id                  uuid primary key default gen_random_uuid(),
  observation_code    text not null unique,
  execution_plan_id   uuid not null references public.ai_execution_plans(id) unique,   -- 중복 Observation 차단
  operation_id        uuid not null,
  external_change_id  text not null,
  observation_status  text not null default 'pending_observation' check (observation_status in ('draft','pending_observation','observing','data_delayed','review_required','completed','failed_validation','rollback_review','certified','certified_with_conditions','rejected','cancelled','expired','invalidated')),
  observation_scope   text,
  baseline_start      timestamptz not null,
  baseline_end        timestamptz not null,
  observation_start   timestamptz,
  observation_end     timestamptz,
  observation_timezone text not null default 'Asia/Seoul',
  source_version      text not null,
  deployed_version    text,
  input_hash          text not null,
  baseline_snapshot   jsonb not null default '{}'::jsonb,   -- 실측 수집(예상값 저장 금지)
  target_snapshot     jsonb not null default '{}'::jsonb,
  observed_snapshot   jsonb,
  monitoring_sources  jsonb not null default '[]'::jsonb,
  success_criteria    jsonb not null default '[]'::jsonb,
  failure_criteria    jsonb not null default '[]'::jsonb,
  regression_summary  jsonb,
  incident_summary    jsonb,
  rollback_assessment jsonb,
  rollback_decision   text check (rollback_decision is null or rollback_decision in ('continue_observation','accept_degradation','rollback_requested','rollback_completed_reference','change_cancelled','invalidated')),
  rollback_decision_reason text,
  rollback_reference  jsonb,                                 -- {external_rollback_id, rollback_executed_by, rollback_executed_at, rollback_result, restored_version, ...}
  certification_result text check (certification_result is null or certification_result in ('certified','certified_with_conditions','not_certified','rollback_recommended','rollback_completed_pending_validation','invalidated','insufficient_data')),
  certification_reason text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  idempotency_key     text not null unique,
  started_by          uuid,
  reviewed_by         uuid,
  started_at          timestamptz,
  completed_at        timestamptz,
  expired_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (baseline_start < baseline_end)
);
comment on table public.ai_post_change_observations is
  'AI-OPS-3 — Post-Change Observation Session. 관측/검증/판정/권고만 — Rollback 실행/Production 반영 없음. 자동 Certification 없음.';
create index if not exists idx_pco_status on public.ai_post_change_observations (observation_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Observed Metric(실측만 — Simulation/예상값 저장 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_post_change_observation_metrics (
  id                  uuid primary key default gen_random_uuid(),
  observation_id      uuid not null references public.ai_post_change_observations(id),
  metric_code         text not null check (metric_code in ('player_error_rate','skip_rate','completion_rate','like_rate','events','playback_start_success')),
  metric_type         text not null default 'actual' check (metric_type in ('actual','proxy')),   -- simulated/predicted 저장 불가
  metric_role         text not null default 'primary' check (metric_role in ('primary','guardrail','diagnostic','informational')),
  baseline_value      numeric,
  target_value        numeric,
  observed_value      numeric,
  absolute_delta      numeric,
  relative_delta      numeric,                                -- baseline 0 → null(나눗셈 금지)
  sample_size         int check (sample_size is null or sample_size >= 0),
  baseline_sample_size int check (baseline_sample_size is null or baseline_sample_size >= 0),
  threshold_status    text check (threshold_status is null or threshold_status in ('within','warning','failure')),
  validation_status   text not null default 'pending' check (validation_status in ('improved','stable','degraded','failed','pending','unsupported','insufficient_data','invalid')),
  confidence          int check (confidence is null or (confidence between 0 and 100)),
  source              text not null default 'playback_events_v2',
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  observed_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (observation_id, metric_code)
);
comment on table public.ai_post_change_observation_metrics is
  'AI-OPS-3 — 실측 KPI(Actual Only — Simulation/Prediction 저장 금지). baseline 0 → relative null.';
create index if not exists idx_pco_metric on public.ai_post_change_observation_metrics (observation_id, metric_code);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Post-Change Audit(Deploy/Rollback 실행 로그 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_post_change_audit (
  id             uuid primary key default gen_random_uuid(),
  observation_id uuid not null references public.ai_post_change_observations(id),
  event_type     text not null check (event_type in ('observation_created','observation_started','observation_data_received','observation_data_delayed','metric_validated','regression_detected','incident_correlated','rollback_assessed','rollback_requested','rollback_reference_recorded','rollback_validation_started','certification_review_started','certified','certified_with_conditions','certification_rejected','observation_cancelled','observation_expired','observation_invalidated')),
  detail         text,
  evidence       jsonb not null default '[]'::jsonb,
  actor_id       uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_post_change_audit is 'AI-OPS-3 — 관측/판정 이력(실제 Deploy/Rollback 실행 로그와 무관).';
create index if not exists idx_pco_audit on public.ai_post_change_audit (observation_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Observation 생성 — Eligibility 서버 게이트.
--    completed_reference + Manual Reference 필수(외부 실행 기록 없는 Observation 금지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_post_change_observation_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_plan public.ai_execution_plans; v_ref jsonb; v_existing public.ai_post_change_observations; v_row public.ai_post_change_observations; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  select * into v_plan from public.ai_execution_plans where id = (p_payload->>'execution_plan_id')::uuid;
  if v_plan.id is null then raise exception 'execution plan not found' using errcode='P0002'; end if;
  if v_plan.plan_status <> 'completed_reference' then raise exception 'plan status=% — 외부 실행 기록(completed_reference) 없는 Observation 시작 금지', v_plan.plan_status using errcode='22023'; end if;
  v_ref := v_plan.manual_reference;
  if v_ref is null or coalesce(v_ref->>'external_change_id','') = '' or coalesce(v_ref->>'executed_by','') = '' or coalesce(v_ref->>'executed_at','') = '' or coalesce(v_ref->>'execution_result','') = '' then
    raise exception 'manual execution reference incomplete (external_change_id/executed_by/executed_at/execution_result 필수)' using errcode='22023';
  end if;
  if v_plan.observation_plan is null then raise exception 'observation plan missing' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(v_plan.observation_plan->'kpis','[]'::jsonb)) = 0 then raise exception 'observation KPI missing' using errcode='22023'; end if;
  if p_payload->'baseline_snapshot' is null or jsonb_typeof(p_payload->'baseline_snapshot') <> 'object' or p_payload->'baseline_snapshot' = '{}'::jsonb then
    raise exception 'baseline required (Baseline 없는 KPI 검증 금지)' using errcode='22023';
  end if;
  if coalesce(p_payload->>'baseline_start','') = '' or coalesce(p_payload->>'baseline_end','') = '' then raise exception 'baseline period required' using errcode='22023'; end if;
  if coalesce(p_payload->>'observation_code','') = '' or coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' or coalesce(p_payload->>'idempotency_key','') = '' then
    raise exception 'code/source_version/input_hash/idempotency_key required' using errcode='22023';
  end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;

  select * into v_existing from public.ai_post_change_observations where idempotency_key = p_payload->>'idempotency_key';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'eligibility', 'duplicate', 'observation', to_jsonb(v_existing)); end if;
  select * into v_existing from public.ai_post_change_observations where execution_plan_id = v_plan.id;
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'eligibility', 'duplicate', 'observation', to_jsonb(v_existing)); end if;

  insert into public.ai_post_change_observations(observation_code, execution_plan_id, operation_id, external_change_id,
    observation_scope, baseline_start, baseline_end, source_version, deployed_version, input_hash,
    baseline_snapshot, target_snapshot, monitoring_sources, success_criteria, failure_criteria,
    evidence, limitations, idempotency_key, started_by)
  values (p_payload->>'observation_code', v_plan.id, v_plan.operation_id, v_ref->>'external_change_id',
    nullif(p_payload->>'observation_scope',''), (p_payload->>'baseline_start')::timestamptz, (p_payload->>'baseline_end')::timestamptz,
    p_payload->>'source_version', nullif(p_payload->>'deployed_version',''), p_payload->>'input_hash',
    p_payload->'baseline_snapshot', coalesce(p_payload->'target_snapshot','{}'::jsonb),
    coalesce(p_payload->'monitoring_sources','["playback_events_v2"]'::jsonb),
    coalesce(p_payload->'success_criteria','[]'::jsonb), coalesce(p_payload->'failure_criteria','[]'::jsonb),
    p_payload->'evidence', coalesce(p_payload->'limitations','["관측/검증만 — Rollback 실행 없음"]'::jsonb),
    p_payload->>'idempotency_key', auth.uid())
  returning id into v_id;
  insert into public.ai_post_change_audit(observation_id, event_type, detail, actor_id)
  values (v_id, 'observation_created', v_ref->>'external_change_id', auth.uid());
  select * into v_row from public.ai_post_change_observations where id = v_id;
  return jsonb_build_object('idempotent', false, 'eligibility', 'eligible', 'observation', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_post_change_observation_create(jsonb) to authenticated;

-- Observation 시작(observing 전환).
create or replace function public.admin_post_change_observation_start(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_post_change_observations;
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_post_change_observations where id = p_id;
  if v_row.id is null then raise exception 'observation not found' using errcode='P0002'; end if;
  if v_row.observation_status not in ('draft','pending_observation') then raise exception 'invalid status transition' using errcode='22023'; end if;
  update public.ai_post_change_observations set observation_status = 'observing', observation_start = now(), started_at = now(), updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_post_change_audit(observation_id, event_type, detail, actor_id) values (p_id, 'observation_started', p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_post_change_observation_start(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 실측 KPI 수집 — playback_events_v2 에서 Baseline/Observed 계산(Actual Only).
--    데이터 없으면 data_delayed(가짜 값 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_post_change_metrics_collect(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_post_change_observations; v_obs_start timestamptz; v_base record; v_curr record; v_cnt int := 0;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_post_change_observations where id = p_id;
  if v_row.id is null then raise exception 'observation not found' using errcode='P0002'; end if;
  if v_row.observation_status not in ('observing','data_delayed','review_required') then raise exception 'observation not active' using errcode='22023'; end if;
  v_obs_start := coalesce(v_row.observation_start, v_row.created_at);

  select count(*) as events,
    round(100.0 * count(*) filter (where event_type='player_error') / nullif(count(*),0), 2) as error_rate,
    round(100.0 * count(*) filter (where event_type='skip') / nullif(count(*),0), 1) as skip_rate,
    round((avg(case when track_duration_seconds > 0 then least(1, listened_seconds/track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
    round(100.0 * count(*) filter (where event_type='like') / nullif(count(*),0), 2) as like_rate,
    round(100.0 * count(*) filter (where event_type='play_complete') / nullif(count(*) filter (where event_type='play_start'),0), 1) as start_success
  into v_base from public.playback_events_v2 where created_at >= v_row.baseline_start and created_at < v_row.baseline_end;

  select count(*) as events,
    round(100.0 * count(*) filter (where event_type='player_error') / nullif(count(*),0), 2) as error_rate,
    round(100.0 * count(*) filter (where event_type='skip') / nullif(count(*),0), 1) as skip_rate,
    round((avg(case when track_duration_seconds > 0 then least(1, listened_seconds/track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
    round(100.0 * count(*) filter (where event_type='like') / nullif(count(*),0), 2) as like_rate,
    round(100.0 * count(*) filter (where event_type='play_complete') / nullif(count(*) filter (where event_type='play_start'),0), 1) as start_success
  into v_curr from public.playback_events_v2 where created_at >= v_obs_start;

  if coalesce(v_curr.events, 0) = 0 then
    update public.ai_post_change_observations set observation_status = 'data_delayed', updated_at = now() where id = p_id;
    insert into public.ai_post_change_audit(observation_id, event_type, detail, actor_id) values (p_id, 'observation_data_delayed', '관측 구간 이벤트 0건 — 가짜 값 생성 없음', auth.uid());
    return jsonb_build_object('collected', 0, 'status', 'data_delayed');
  end if;

  -- 6종 실측 KPI upsert(관측값만 — validation 은 사람/순수 로직 검토 후 별도 기록).
  insert into public.ai_post_change_observation_metrics(observation_id, metric_code, metric_role, baseline_value, observed_value,
    absolute_delta, relative_delta, sample_size, baseline_sample_size, observed_at, evidence)
  select p_id, m.code, m.role, m.base, m.obs,
    case when m.base is not null and m.obs is not null then round(m.obs - m.base, 2) end,
    case when m.base is not null and m.obs is not null and m.base <> 0 then round((m.obs - m.base) / abs(m.base) * 100, 2) end,   -- baseline 0 → null
    v_curr.events, v_base.events, now(),
    jsonb_build_array(jsonb_build_object('label','source','value','playback_events_v2'), jsonb_build_object('label','actual','value',true))
  from (values
    ('player_error_rate','guardrail', v_base.error_rate, v_curr.error_rate),
    ('skip_rate','primary', v_base.skip_rate, v_curr.skip_rate),
    ('completion_rate','primary', v_base.completion_rate, v_curr.completion_rate),
    ('like_rate','informational', v_base.like_rate, v_curr.like_rate),
    ('events','diagnostic', v_base.events::numeric, v_curr.events::numeric),
    ('playback_start_success','guardrail', v_base.start_success, v_curr.start_success)
  ) as m(code, role, base, obs)
  on conflict (observation_id, metric_code) do update set
    baseline_value = excluded.baseline_value, observed_value = excluded.observed_value,
    absolute_delta = excluded.absolute_delta, relative_delta = excluded.relative_delta,
    sample_size = excluded.sample_size, baseline_sample_size = excluded.baseline_sample_size, observed_at = now();
  get diagnostics v_cnt = row_count;

  update public.ai_post_change_observations set observation_status = case when observation_status = 'data_delayed' then 'observing' else observation_status end,
    observed_snapshot = jsonb_build_object('events', v_curr.events, 'error_rate', v_curr.error_rate, 'skip_rate', v_curr.skip_rate, 'completion_rate', v_curr.completion_rate, 'collected_at', now()),
    updated_at = now() where id = p_id;
  insert into public.ai_post_change_audit(observation_id, event_type, detail, actor_id) values (p_id, 'observation_data_received', format('%s metrics (actual)', v_cnt), auth.uid());
  return jsonb_build_object('collected', v_cnt, 'status', 'observing');
end; $$;
grant execute on function public.admin_post_change_metrics_collect(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 목록/상세/요약 + 검토 섹션 갱신(validation/regression/incident/rollback assessment).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_post_change_observations(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_post_change_observations o where (p_status is null or o.observation_status = p_status)
    order by o.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_post_change_observations(text, int) to authenticated;

create or replace function public.admin_post_change_observation_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_post_change_observations; v_metrics jsonb; v_audit jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_post_change_observations where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.metric_code), '[]'::jsonb) into v_metrics from public.ai_post_change_observation_metrics m where m.observation_id = p_id;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_audit from (
    select event_type, detail, actor_id, created_at from public.ai_post_change_audit where observation_id = p_id order by created_at desc limit 100) a;
  return jsonb_build_object('found', true, 'observation', to_jsonb(v_row), 'metrics', v_metrics, 'audit', v_audit);
end; $$;
grant execute on function public.admin_post_change_observation_detail(uuid) to authenticated;

create or replace function public.admin_post_change_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total', count(*),
    'by_status', (select coalesce(jsonb_object_agg(observation_status, n), '{}'::jsonb) from (select observation_status, count(*) n from public.ai_post_change_observations group by observation_status) x),
    'executed_changes', (select count(*) from public.ai_execution_plans where plan_status = 'completed_reference'),
    'certified', count(*) filter (where certification_result = 'certified'),
    'certified_with_conditions', count(*) filter (where certification_result = 'certified_with_conditions'),
    'not_certified', count(*) filter (where certification_result = 'not_certified'),
    'rollback_recommended', count(*) filter (where certification_result = 'rollback_recommended'),
    'last_observation_at', max(created_at)
  ) into v from public.ai_post_change_observations;
  return v || jsonb_build_object('generated_at', now());
end; $$;
grant execute on function public.admin_post_change_summary() to authenticated;

create or replace function public.admin_post_change_review_update(p_id uuid, p_section text, p_value jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_post_change_observations; v_event text;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_value) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if p_section is null or p_section not in ('metric_validation','regression_summary','incident_summary','rollback_assessment','status_review') then raise exception 'invalid section' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_post_change_observations where id = p_id;
  if v_row.id is null then raise exception 'observation not found' using errcode='P0002'; end if;
  if v_row.observation_status in ('certified','certified_with_conditions','rejected','cancelled','expired','invalidated') then raise exception 'observation finalized' using errcode='22023'; end if;

  if p_section = 'metric_validation' then
    -- 각 metric 의 validation_status 를 사람/순수 로직 검토 결과로 기록(whitelist 는 테이블 CHECK).
    update public.ai_post_change_observation_metrics m set
      validation_status = coalesce(x.vs, m.validation_status),
      threshold_status = coalesce(x.ts, m.threshold_status),
      target_value = coalesce(x.tv, m.target_value),
      metric_role = coalesce(x.role, m.metric_role)
    from (select (e->>'metric_code') mc, (e->>'validation_status') vs, (e->>'threshold_status') ts, nullif(e->>'target_value','')::numeric tv, nullif(e->>'metric_role','') role
          from jsonb_array_elements(coalesce(p_value,'[]'::jsonb)) e) x
    where m.observation_id = p_id and m.metric_code = x.mc;
    v_event := 'metric_validated';
  elsif p_section = 'regression_summary' then update public.ai_post_change_observations set regression_summary = p_value, updated_at = now() where id = p_id; v_event := 'regression_detected';
  elsif p_section = 'incident_summary' then update public.ai_post_change_observations set incident_summary = p_value, updated_at = now() where id = p_id; v_event := 'incident_correlated';
  elsif p_section = 'rollback_assessment' then update public.ai_post_change_observations set rollback_assessment = p_value, updated_at = now() where id = p_id; v_event := 'rollback_assessed';
  else
    update public.ai_post_change_observations set observation_status = 'review_required', observation_end = coalesce(observation_end, now()), updated_at = now() where id = p_id;
    v_event := 'certification_review_started';
  end if;

  insert into public.ai_post_change_audit(observation_id, event_type, detail, actor_id) values (p_id, v_event, p_reason, auth.uid());
  select * into v_row from public.ai_post_change_observations where id = p_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_post_change_review_update(uuid, text, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Human Rollback Decision + 외부 Rollback Reference(실행 아님).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_post_change_rollback_decision(p_id uuid, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_post_change_observations;
begin
  perform public._admin_growth_guard();
  if p_decision is null or p_decision not in ('continue_observation','accept_degradation','rollback_requested','change_cancelled','invalidated') then raise exception 'invalid decision' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_post_change_observations where id = p_id;
  if v_row.id is null then raise exception 'observation not found' using errcode='P0002'; end if;
  update public.ai_post_change_observations set
    rollback_decision = p_decision, rollback_decision_reason = p_reason, reviewed_by = auth.uid(),
    observation_status = case p_decision when 'rollback_requested' then 'rollback_review'
                                         when 'change_cancelled' then 'cancelled'
                                         when 'invalidated' then 'invalidated'
                                         else observation_status end,
    updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_post_change_audit(observation_id, event_type, detail, actor_id)
  values (p_id, case p_decision when 'rollback_requested' then 'rollback_requested'
                                when 'invalidated' then 'observation_invalidated'
                                when 'change_cancelled' then 'observation_cancelled'
                                else 'rollback_assessed' end, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_post_change_rollback_decision(uuid, text, text) to authenticated;

create or replace function public.admin_post_change_rollback_reference(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_post_change_observations;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'external_rollback_id','') = '' or coalesce(p_payload->>'rollback_executed_by','') = '' or coalesce(p_payload->>'rollback_executed_at','') = '' then
    raise exception 'external_rollback_id/rollback_executed_by/rollback_executed_at required' using errcode='22023';
  end if;
  if coalesce(p_payload->>'rollback_result','') not in ('succeeded','failed','partially') then raise exception 'invalid rollback_result' using errcode='22023'; end if;
  select * into v_row from public.ai_post_change_observations where id = p_id;
  if v_row.id is null then raise exception 'observation not found' using errcode='P0002'; end if;
  if v_row.observation_status <> 'rollback_review' then raise exception 'rollback_requested 상태에서만 참고 기록 가능' using errcode='22023'; end if;
  update public.ai_post_change_observations set
    rollback_reference = p_payload, rollback_decision = 'rollback_completed_reference',
    certification_result = 'rollback_completed_pending_validation',   -- 재검증 전 성공 인증 금지
    updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_post_change_audit(observation_id, event_type, detail, evidence, actor_id)
  values (p_id, 'rollback_reference_recorded', p_payload->>'external_rollback_id', coalesce(p_payload->'evidence','[]'::jsonb), auth.uid()),
         (p_id, 'rollback_validation_started', 'Rollback 후 별도 재검증 필요(성공 인증 아님)', '[]'::jsonb, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_post_change_rollback_reference(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Operational Certification — 사람 판정 + 서버 게이트(자동 Certification 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_post_change_certify(p_id uuid, p_result text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_post_change_observations; v_primary_fail int; v_guardrail_fail int; v_pending int; v_min_events int;
begin
  perform public._admin_growth_guard();
  if p_result is null or p_result not in ('certified','certified_with_conditions','not_certified','rollback_recommended','invalidated','insufficient_data') then raise exception 'invalid certification result' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (자동 Certification 없음 — 사람 사유 필수)' using errcode='22023'; end if;
  select * into v_row from public.ai_post_change_observations where id = p_id;
  if v_row.id is null then raise exception 'observation not found' using errcode='P0002'; end if;
  if v_row.observation_status not in ('review_required','completed','observing','rollback_review','failed_validation') then raise exception 'observation not reviewable(status=%)', v_row.observation_status using errcode='22023'; end if;

  if p_result in ('certified','certified_with_conditions') then
    if not exists (select 1 from public.ai_post_change_observation_metrics where observation_id = p_id) then raise exception '관측 데이터 없는 인증 금지' using errcode='22023'; end if;
    select count(*) into v_primary_fail from public.ai_post_change_observation_metrics where observation_id = p_id and metric_role = 'primary' and validation_status = 'failed';
    if v_primary_fail > 0 then raise exception 'primary KPI failed(%건) — 인증 금지', v_primary_fail using errcode='22023'; end if;
    select count(*) into v_guardrail_fail from public.ai_post_change_observation_metrics where observation_id = p_id and metric_role = 'guardrail' and validation_status in ('failed','degraded');
    if p_result = 'certified' and v_guardrail_fail > 0 then raise exception 'guardrail 위반(%건) — certified 금지(conditions 검토)', v_guardrail_fail using errcode='22023'; end if;
    select count(*) into v_pending from public.ai_post_change_observation_metrics where observation_id = p_id and metric_role in ('primary','guardrail') and validation_status = 'pending';
    if v_pending > 0 then raise exception 'primary/guardrail KPI %건 미검증(pending) — 인증 금지', v_pending using errcode='22023'; end if;
    select min(sample_size) into v_min_events from public.ai_post_change_observation_metrics where observation_id = p_id and metric_role = 'primary';
    if coalesce(v_min_events, 0) < 50 then raise exception 'sample 부족(min %s < 50) — 인증 금지', coalesce(v_min_events,0) using errcode='22023'; end if;
    if coalesce(v_row.regression_summary->>'critical', '0')::int > 0 then raise exception 'critical regression 존재 — 인증 금지' using errcode='22023'; end if;
    if jsonb_array_length(v_row.evidence) = 0 then raise exception 'evidence 없는 인증 금지' using errcode='22023'; end if;
  end if;

  update public.ai_post_change_observations set
    certification_result = p_result, certification_reason = p_reason, reviewed_by = auth.uid(),
    observation_status = case p_result when 'certified' then 'certified'
                                       when 'certified_with_conditions' then 'certified_with_conditions'
                                       when 'not_certified' then 'rejected'
                                       when 'rollback_recommended' then 'rollback_review'
                                       when 'invalidated' then 'invalidated'
                                       else 'review_required' end,
    completed_at = case when p_result in ('certified','certified_with_conditions','not_certified') then now() else completed_at end,
    updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_post_change_audit(observation_id, event_type, detail, actor_id)
  values (p_id, case p_result when 'certified' then 'certified' when 'certified_with_conditions' then 'certified_with_conditions'
                              when 'not_certified' then 'certification_rejected' else 'certification_review_started' end, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_post_change_certify(uuid, text, text) to authenticated;

create or replace function public.admin_post_change_audit(p_observation_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_post_change_audit a where (p_observation_id is null or a.observation_id = p_observation_id)
    order by a.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_post_change_audit(uuid, int) to authenticated;
