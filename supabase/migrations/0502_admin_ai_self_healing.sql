-- ============================================
-- 0502_admin_ai_self_healing.sql
--
-- Phase AI-MUSIC-15 — Self-Healing AI Music OS, Autonomous Operations & Resilience Intelligence.
--
-- AI 가 장애를 감지 → 원인 분석(RCA) → Digital Twin 에서 복구 전략 검증 → Governance
-- 승인용 복구안(Recovery Candidate)을 생성한다. **자동 Production 복구는 없다.**
--
--   Runtime Telemetry → Incident Detection → Root Cause Analysis → Recovery Strategy
--   → Digital Twin Validation → Risk Assessment → Governance Review → Recovery
--   Candidate → Evidence Only
--
-- ⚠️ 절대: 자동 Recovery/Rollback/Migration 실행/Production Apply/Queue·Playback·
--   Scheduler 변경 없음. Twin 검증 실패 시 Governance 제출 금지(RPC 게이트 강제).
--   Playbook 은 참고 문서(자동 실행 필드 자체 없음). Trigger 없음. 삭제 RPC 없음.
--
-- Telemetry 소스(실데이터): playback_events_v2(0253) 의 player_error/skip/completion.
--   Store Offline/API Failure/DB Latency/AI Service Failure 는 수집 telemetry 없음 —
--   unsupported 정직 표기(가짜 감지 없음). Twin 검증은 ai_twin_simulation_runs(0499) 참조.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Incident 저장소(Timeline 내장 — Detection→Analysis→Twin→Governance→Resolution).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_incidents (
  id               uuid primary key default gen_random_uuid(),
  incident_code    text not null unique,
  incident_type    text not null check (incident_type in ('playback_failure','streaming_degradation','buffer_spike','decoder_failure','queue_stall','scheduler_drift','store_offline','api_failure','db_latency','ai_service_failure')),
  severity         text not null check (severity in ('low','moderate','high','critical')),
  scope            text not null default 'global' check (scope in ('global','industry','store')),
  scope_key        text,
  status           text not null default 'detected' check (status in ('detected','analyzing','rca_complete','twin_validated','governance_review','recovery_candidate','resolved','false_positive','closed')),
  kpi_snapshot     jsonb not null default '{}'::jsonb,
  baseline_snapshot jsonb,
  root_cause_candidates jsonb not null default '[]'::jsonb,   -- [{cause, confidence, chain, note}] — 상관 기반 추론(단정 아님)
  timeline         jsonb not null default '[]'::jsonb,        -- [{at, event, detail}]
  evidence         jsonb not null default '[]'::jsonb,
  limitations      jsonb not null default '[]'::jsonb,
  source_version   text not null,
  input_hash       text not null unique,
  detected_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  created_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.ai_incidents is
  'AI-MUSIC-15 — Incident 기록(실측 telemetry 기반 감지). RCA 는 상관 기반 후보(단정 아님). 자동 복구 없음.';
create index if not exists idx_incident_status on public.ai_incidents (status, detected_at desc);
create index if not exists idx_incident_type on public.ai_incidents (incident_type, severity);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Recovery Candidate — Twin 검증 게이트 + Governance 제출용(자동 실행 없음).
--    Knowledge Base = outcome 필드 축적(성공/실패 사례).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_recovery_candidates (
  id                  uuid primary key default gen_random_uuid(),
  recovery_code       text not null unique,
  incident_id         uuid not null references public.ai_incidents(id),
  strategy_type       text not null check (strategy_type in ('queue_rebuild','playlist_reload','cache_refresh','retry_policy','alternate_cdn','local_fallback')),
  description         text,
  preconditions       jsonb not null default '[]'::jsonb,
  -- Twin 검증(0499 재사용) — governance_review 승격 필수 조건.
  twin_run_id         uuid references public.ai_twin_simulation_runs(id),
  validation_status   text not null default 'not_validated' check (validation_status in ('not_validated','twin_validated','twin_failed')),
  -- Risk Assessment(0~100 clamp · 실측 근거 없으면 null).
  success_probability int check (success_probability is null or (success_probability between 0 and 100)),
  blast_radius        text check (blast_radius is null or blast_radius in ('single_store','industry','fleet','global')),
  recovery_time_estimate_min int check (recovery_time_estimate_min is null or recovery_time_estimate_min >= 0),
  business_impact     text check (business_impact is null or business_impact in ('low','moderate','high','critical')),
  confidence          int check (confidence is null or (confidence between 0 and 100)),
  status              text not null default 'proposed' check (status in ('proposed','twin_validated','governance_review','approved_candidate','rejected','expired')),
  -- Recovery Knowledge Base(실제 Outcome — 없는 동안 pending).
  outcome             text not null default 'pending' check (outcome in ('pending','succeeded','failed','not_applied')),
  outcome_note        text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  source_version      text not null,
  input_hash          text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.ai_recovery_candidates is
  'AI-MUSIC-15 — 복구 전략 후보(제안만 · 자동 실행 없음). Twin 검증 실패 시 Governance 제출 불가(게이트). Outcome 은 실제 결과만.';
create index if not exists idx_recovery_incident on public.ai_recovery_candidates (incident_id, created_at desc);
create index if not exists idx_recovery_status on public.ai_recovery_candidates (status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Playbook(참고 문서 — 자동 실행 필드 자체 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playbooks (
  id             uuid primary key default gen_random_uuid(),
  playbook_code  text not null unique,
  incident_type  text not null check (incident_type in ('playback_failure','streaming_degradation','buffer_spike','decoder_failure','queue_stall','scheduler_drift','store_offline','api_failure','db_latency','ai_service_failure')),
  title          text not null,
  steps          jsonb not null default '[]'::jsonb,       -- [{order, action, note}] — 사람이 읽는 절차
  source_incident_ids jsonb not null default '[]'::jsonb,
  success_count  int not null default 0,
  fail_count     int not null default 0,
  status         text not null default 'draft' check (status in ('draft','reference','deprecated')),
  evidence       jsonb not null default '[]'::jsonb,
  source_version text not null,
  input_hash     text not null unique,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.ai_playbooks is
  'AI-MUSIC-15 — Incident 기반 복구 Playbook(사람이 읽는 참고 절차). 자동 실행 메커니즘 없음.';
create index if not exists idx_playbook_type on public.ai_playbooks (incident_type, status);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Incident Scan — 실측 telemetry 이상 감지(저장 없음, 조회만).
--    최근 절반 vs 이전 절반 비교(이전 없으면 감지하지 않음 — 가짜 장애 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_incident_scan(p_range text default '7d')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_interval interval := public._playlist_range_interval(p_range); v_mid timestamptz := now() - (v_interval/2); v_since timestamptz := now() - v_interval; v_global jsonb; v_by_industry jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'prev_events', count(*) filter (where created_at < v_mid),
    'curr_events', count(*) filter (where created_at >= v_mid),
    'prev_error_rate', round(100.0 * count(*) filter (where event_type='player_error' and created_at < v_mid) / nullif(count(*) filter (where created_at < v_mid),0), 2),
    'curr_error_rate', round(100.0 * count(*) filter (where event_type='player_error' and created_at >= v_mid) / nullif(count(*) filter (where created_at >= v_mid),0), 2),
    'prev_skip_rate', round(100.0 * count(*) filter (where event_type='skip' and created_at < v_mid) / nullif(count(*) filter (where created_at < v_mid),0), 1),
    'curr_skip_rate', round(100.0 * count(*) filter (where event_type='skip' and created_at >= v_mid) / nullif(count(*) filter (where created_at >= v_mid),0), 1),
    'prev_completion', round((avg(case when track_duration_seconds > 0 and created_at < v_mid then least(1, listened_seconds/track_duration_seconds) end)*100)::numeric, 1),
    'curr_completion', round((avg(case when track_duration_seconds > 0 and created_at >= v_mid then least(1, listened_seconds/track_duration_seconds) end)*100)::numeric, 1)
  ) into v_global from public.playback_events_v2 where created_at >= v_since;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.curr_error_rate desc nulls last), '[]'::jsonb) into v_by_industry from (
    select e.store_type_slug as store_type,
      count(*) filter (where e.created_at < v_mid) as prev_events,
      count(*) filter (where e.created_at >= v_mid) as curr_events,
      round(100.0 * count(*) filter (where e.event_type='player_error' and e.created_at < v_mid) / nullif(count(*) filter (where e.created_at < v_mid),0), 2) as prev_error_rate,
      round(100.0 * count(*) filter (where e.event_type='player_error' and e.created_at >= v_mid) / nullif(count(*) filter (where e.created_at >= v_mid),0), 2) as curr_error_rate,
      round(100.0 * count(*) filter (where e.event_type='skip' and e.created_at >= v_mid) / nullif(count(*) filter (where e.created_at >= v_mid),0), 1) as curr_skip_rate,
      round(100.0 * count(*) filter (where e.event_type='skip' and e.created_at < v_mid) / nullif(count(*) filter (where e.created_at < v_mid),0), 1) as prev_skip_rate
    from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug is not null
    group by e.store_type_slug
  ) t;
  return jsonb_build_object('range', coalesce(p_range,'7d'), 'global', v_global, 'by_industry', v_by_industry,
    'note', '이전 구간 데이터 없으면 감지 판정 불가(insufficient_data)', 'generated_at', now());
end; $$;
grant execute on function public.admin_incident_scan(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Incident 저장/조회/상태 전이(Timeline append).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_incident_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing public.ai_incidents; v_row public.ai_incidents; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'incident_code','') = '' then raise exception 'incident_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'incident_type','') not in ('playback_failure','streaming_degradation','buffer_spike','decoder_failure','queue_stall','scheduler_drift','store_offline','api_failure','db_latency','ai_service_failure') then raise exception 'invalid incident_type' using errcode='22023'; end if;
  if coalesce(p_payload->>'severity','') not in ('low','moderate','high','critical') then raise exception 'invalid severity' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required (근거 없는 장애 판정 금지)' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' then raise exception 'source_version/input_hash required' using errcode='22023'; end if;

  select * into v_existing from public.ai_incidents where input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'incident', to_jsonb(v_existing)); end if;

  insert into public.ai_incidents(incident_code, incident_type, severity, scope, scope_key, kpi_snapshot, baseline_snapshot,
    root_cause_candidates, timeline, evidence, limitations, source_version, input_hash, created_by)
  values (p_payload->>'incident_code', p_payload->>'incident_type', p_payload->>'severity',
    coalesce(nullif(p_payload->>'scope',''),'global'), nullif(p_payload->>'scope_key',''),
    coalesce(p_payload->'kpi_snapshot','{}'::jsonb), p_payload->'baseline_snapshot',
    coalesce(p_payload->'root_cause_candidates','[]'::jsonb),
    jsonb_build_array(jsonb_build_object('at', now(), 'event', 'detected', 'detail', p_payload->>'incident_type')),
    p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb), p_payload->>'source_version', p_payload->>'input_hash', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_incidents where id = v_id;
  return jsonb_build_object('idempotent', false, 'incident', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_incident_save(jsonb) to authenticated;

create or replace function public.admin_incidents(p_status text default null, p_type text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.detected_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_incidents i
    where (p_status is null or i.status = p_status) and (p_type is null or i.incident_type = p_type)
    order by i.detected_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_incidents(text, text, int) to authenticated;

create or replace function public.admin_incident_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_incidents; v_candidates jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_incidents where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb) into v_candidates
  from public.ai_recovery_candidates c where c.incident_id = p_id;
  return jsonb_build_object('found', true, 'incident', to_jsonb(v_row), 'candidates', v_candidates);
end; $$;
grant execute on function public.admin_incident_detail(uuid) to authenticated;

create or replace function public.admin_incident_update_status(p_id uuid, p_status text, p_reason text, p_root_cause_candidates jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_incidents;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('analyzing','rca_complete','twin_validated','governance_review','recovery_candidate','resolved','false_positive','closed') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_incidents where id = p_id;
  if v_row.id is null then raise exception 'incident not found' using errcode='P0002'; end if;
  -- Governance 제출 게이트: Twin 검증된 Recovery Candidate 없이 governance_review 불가.
  if p_status = 'governance_review' and not exists (
    select 1 from public.ai_recovery_candidates c where c.incident_id = p_id and c.validation_status = 'twin_validated'
  ) then raise exception 'governance_review requires twin_validated recovery candidate (Twin 검증 실패 시 제출 금지)' using errcode='22023'; end if;
  update public.ai_incidents set status = p_status,
    root_cause_candidates = coalesce(p_root_cause_candidates, root_cause_candidates),
    timeline = timeline || jsonb_build_array(jsonb_build_object('at', now(), 'event', p_status, 'detail', p_reason)),
    resolved_at = case when p_status in ('resolved','closed','false_positive') then now() else resolved_at end,
    updated_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_incident_update_status(uuid, text, text, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Recovery Candidate — 제안 저장 · Twin 연결 · 상태 게이트(자동 실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recovery_candidate_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_incident public.ai_incidents; v_existing public.ai_recovery_candidates; v_row public.ai_recovery_candidates; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  select * into v_incident from public.ai_incidents where id = (p_payload->>'incident_id')::uuid;
  if v_incident.id is null then raise exception 'incident not found' using errcode='P0002'; end if;
  if coalesce(p_payload->>'recovery_code','') = '' then raise exception 'recovery_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'strategy_type','') not in ('queue_rebuild','playlist_reload','cache_refresh','retry_policy','alternate_cdn','local_fallback') then raise exception 'invalid strategy_type' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' then raise exception 'source_version/input_hash required' using errcode='22023'; end if;

  select * into v_existing from public.ai_recovery_candidates where input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'candidate', to_jsonb(v_existing)); end if;

  insert into public.ai_recovery_candidates(recovery_code, incident_id, strategy_type, description, preconditions,
    success_probability, blast_radius, recovery_time_estimate_min, business_impact, confidence,
    evidence, limitations, source_version, input_hash, created_by)
  values (p_payload->>'recovery_code', v_incident.id, p_payload->>'strategy_type', nullif(p_payload->>'description',''),
    coalesce(p_payload->'preconditions','[]'::jsonb),
    least(100, greatest(0, nullif(p_payload->>'success_probability','')::int)), nullif(p_payload->>'blast_radius',''),
    greatest(0, nullif(p_payload->>'recovery_time_estimate_min','')::int), nullif(p_payload->>'business_impact',''),
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)),
    p_payload->'evidence', coalesce(p_payload->'limitations','["자동 실행 없음 — 제안만"]'::jsonb),
    p_payload->>'source_version', p_payload->>'input_hash', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_recovery_candidates where id = v_id;
  return jsonb_build_object('idempotent', false, 'candidate', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_recovery_candidate_save(jsonb) to authenticated;

create or replace function public.admin_recovery_candidates(p_incident_id uuid default null, p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_recovery_candidates c
    where (p_incident_id is null or c.incident_id = p_incident_id) and (p_status is null or c.status = p_status)
    order by c.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_recovery_candidates(uuid, text, int) to authenticated;

-- Twin 검증 연결(0499 Run 참조 — Twin 에서만 검증).
create or replace function public.admin_recovery_link_twin(p_id uuid, p_twin_run_id uuid, p_passed boolean, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_recovery_candidates;
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  if not exists (select 1 from public.ai_twin_simulation_runs where id = p_twin_run_id) then raise exception 'twin run not found (Twin 에서만 검증 가능)' using errcode='P0002'; end if;
  select * into v_row from public.ai_recovery_candidates where id = p_id;
  if v_row.id is null then raise exception 'candidate not found' using errcode='P0002'; end if;
  update public.ai_recovery_candidates set
    twin_run_id = p_twin_run_id,
    validation_status = case when p_passed then 'twin_validated' else 'twin_failed' end,
    status = case when p_passed and status = 'proposed' then 'twin_validated' else status end,
    updated_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_recovery_link_twin(uuid, uuid, boolean, text) to authenticated;

create or replace function public.admin_recovery_set_status(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_recovery_candidates;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('governance_review','approved_candidate','rejected','expired') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_recovery_candidates where id = p_id;
  if v_row.id is null then raise exception 'candidate not found' using errcode='P0002'; end if;
  -- 게이트: Twin 검증 실패/미검증 → Governance 제출 금지.
  if p_status in ('governance_review','approved_candidate') and v_row.validation_status <> 'twin_validated' then
    raise exception 'twin validation required (검증 실패 시 Governance 제출 금지)' using errcode='22023';
  end if;
  update public.ai_recovery_candidates set status = p_status, updated_at = now() where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_recovery_set_status(uuid, text, text) to authenticated;

-- 실제 Outcome 기록(Knowledge Base — 성공/실패 사례 축적, 사람이 기록).
create or replace function public.admin_recovery_record_outcome(p_id uuid, p_outcome text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_recovery_candidates;
begin
  perform public._admin_growth_guard();
  if p_outcome is null or p_outcome not in ('succeeded','failed','not_applied') then raise exception 'invalid outcome' using errcode='22023'; end if;
  if coalesce(p_note,'') = '' then raise exception 'note required (실제 결과 근거)' using errcode='22023'; end if;
  select * into v_row from public.ai_recovery_candidates where id = p_id;
  if v_row.id is null then raise exception 'candidate not found' using errcode='P0002'; end if;
  update public.ai_recovery_candidates set outcome = p_outcome, outcome_note = p_note, updated_at = now() where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_recovery_record_outcome(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Playbook 저장/조회/상태(참고 문서 — 자동 실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playbook_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing public.ai_playbooks; v_row public.ai_playbooks; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'playbook_code','') = '' or coalesce(p_payload->>'title','') = '' then raise exception 'playbook_code/title required' using errcode='22023'; end if;
  if coalesce(p_payload->>'incident_type','') not in ('playback_failure','streaming_degradation','buffer_spike','decoder_failure','queue_stall','scheduler_drift','store_offline','api_failure','db_latency','ai_service_failure') then raise exception 'invalid incident_type' using errcode='22023'; end if;
  if p_payload->'steps' is null or jsonb_array_length(coalesce(p_payload->'steps','[]'::jsonb)) = 0 then raise exception 'steps required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' then raise exception 'source_version/input_hash required' using errcode='22023'; end if;
  select * into v_existing from public.ai_playbooks where input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'playbook', to_jsonb(v_existing)); end if;
  insert into public.ai_playbooks(playbook_code, incident_type, title, steps, source_incident_ids, evidence, source_version, input_hash, created_by)
  values (p_payload->>'playbook_code', p_payload->>'incident_type', p_payload->>'title', p_payload->'steps',
    coalesce(p_payload->'source_incident_ids','[]'::jsonb), p_payload->'evidence', p_payload->>'source_version', p_payload->>'input_hash', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_playbooks where id = v_id;
  return jsonb_build_object('idempotent', false, 'playbook', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_playbook_save(jsonb) to authenticated;

create or replace function public.admin_playbooks(p_incident_type text default null, p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_playbooks p
    where (p_incident_type is null or p.incident_type = p_incident_type) and (p_status is null or p.status = p_status)
    order by p.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_playbooks(text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Self-Healing Summary(Score 원시 성분 — 계산은 순수 로직).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_self_healing_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_incidents jsonb; v_recovery jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where status in ('detected','analyzing','rca_complete','twin_validated','governance_review')),
    'resolved', count(*) filter (where status = 'resolved'),
    'false_positive', count(*) filter (where status = 'false_positive'),
    'critical', count(*) filter (where severity = 'critical'),
    'avg_resolution_hours', round((extract(epoch from avg(resolved_at - detected_at)) / 3600)::numeric, 1),
    'last_incident_at', max(detected_at)
  ) into v_incidents from public.ai_incidents;
  select jsonb_build_object(
    'total', count(*),
    'twin_validated', count(*) filter (where validation_status = 'twin_validated'),
    'twin_failed', count(*) filter (where validation_status = 'twin_failed'),
    'governance_review', count(*) filter (where status = 'governance_review'),
    'succeeded', count(*) filter (where outcome = 'succeeded'),
    'failed', count(*) filter (where outcome = 'failed'),
    'pending_outcome', count(*) filter (where outcome = 'pending')
  ) into v_recovery from public.ai_recovery_candidates;
  return jsonb_build_object('incidents', v_incidents, 'recovery', v_recovery,
    'playbooks', (select count(*) from public.ai_playbooks where status <> 'deprecated'), 'generated_at', now());
end; $$;
grant execute on function public.admin_self_healing_summary() to authenticated;
