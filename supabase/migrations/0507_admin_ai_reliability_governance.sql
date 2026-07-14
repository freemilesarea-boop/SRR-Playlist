-- 0507_admin_ai_reliability_governance.sql
-- Phase AI-OPS-4 — Service Reliability Objectives, Error Budget Governance & Release Risk Control.
--
-- 실제 Telemetry 분석 결과(추측 없음):
--   playback_events_v2(0253)  : play_start/play_complete/skip/like/player_error + created_at
--                               → playback SLI(error-free/completion/start-success proxy) 실측 가능
--   ai_governance_events(0496): violation_detected/violation_blocked + evidence
--                               → constitution compliance / audit completeness 실측 가능
--   store_monitoring_status(0353 view): last_seen_at 기반 is_online(5분) — **현재 시점 스냅샷만**,
--                               heartbeat 히스토리 없음 → 기간형 Availability(uptime) 미지원,
--                               point-in-time online ratio 만 provisional 지원
--   stream_ingest_v2(0477 분석): stream_quality 전부 null → Streaming Quality SLI 미지원
--   queue/scheduler/API/DB latency telemetry: 미수집 → 해당 Domain unsupported
--
-- 원칙:
--   * 실제 Telemetry 없는 SLI 생성 금지 — metric_code whitelist 는 실측 6종만
--   * total=0 이면 sli_value=null(0 나눗셈/null→0 변환 금지) · 데이터 공백을 정상 시간으로 계산 금지
--   * 관측 불가 시간을 Availability 100% 로 계산 금지(기간형 uptime SLI 자체를 미지원 처리)
--   * AI 가 SLI/SLO 를 생성·수정 불가 — 관리자 승인 + change_reason + Audit 필수, 삭제 RPC 없음
--   * SLO Versioning — 새 버전은 새 행(previous_version_id), 과거 기간 소급 적용 금지
--   * 자동 Change Freeze/Release 차단/Rollback/Deploy 없음 — 권고와 사람 결정 기록만
--   * Trigger 없음 · Production Entity(playlists/queue/scheduler/playback 등) 변경 없음

-- ─────────────────────────────────────────────────────────────────────────
-- 1) SLI 정의 — 사람이 승인한 실측 지표만(whitelist).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_reliability_indicators (
  id                  uuid primary key default gen_random_uuid(),
  indicator_code      text not null unique,
  domain              text not null check (domain in ('playback','streaming_quality','availability','queue','scheduler','store_player','api','database','ai_decision','governance','fleet')),
  title               text not null,
  description         text,
  metric_code         text not null check (metric_code in ('player_error_free_ratio','completion_ratio','playback_start_success_ratio','constitution_compliance_ratio','audit_completeness_ratio','store_online_ratio_point_in_time')),
  metric_type         text not null default 'ratio' check (metric_type in ('ratio')),           -- 비율형만 — Error Budget 공식 적용 가능 범위
  aggregation_type    text not null default 'good_over_total' check (aggregation_type in ('good_over_total','point_in_time')),
  good_event_definition  text not null,
  total_event_definition text not null,
  source_type         text not null check (source_type in ('playback_events_v2','ai_governance_events','store_monitoring_status')),
  source_version      text not null default 'reliability_v1(0507)',
  scope_type          text not null default 'global' check (scope_type in ('global','store','industry','fleet')),
  is_active           boolean not null default false,
  limitations         jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  created_by          uuid,
  approved_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_rel_ind_domain on public.ai_reliability_indicators (domain, is_active);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) SLO — Policy Versioning(새 버전 = 새 행, 과거 소급 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_reliability_objectives (
  id                  uuid primary key default gen_random_uuid(),
  objective_code      text not null,
  indicator_id        uuid not null references public.ai_reliability_indicators(id),
  scope_type          text not null default 'global' check (scope_type in ('global','store','industry','fleet')),
  scope_id            text,
  target_value        numeric not null check (target_value >= 0 and target_value <= 100),
  compliance_window   text not null check (compliance_window in ('rolling_1h','rolling_6h','rolling_24h','rolling_7d','rolling_28d')),
  minimum_sample      int not null default 50 check (minimum_sample >= 1),
  minimum_data_coverage numeric not null default 50 check (minimum_data_coverage >= 0 and minimum_data_coverage <= 100),
  severity            text not null default 'medium' check (severity in ('low','medium','high','critical')),
  error_budget_policy jsonb not null default '{}'::jsonb,
  burn_rate_policy    jsonb not null default '{}'::jsonb,
  effective_from      timestamptz not null default now(),
  effective_to        timestamptz,
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','pending_approval','active','superseded','archived','blocked')),
  version             int not null default 1 check (version >= 1),
  change_reason       text not null,
  checksum            text not null,
  previous_version_id uuid references public.ai_reliability_objectives(id),
  approved_by         uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (objective_code, version)
);
create index if not exists idx_rel_obj_status on public.ai_reliability_objectives (lifecycle_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) SLI Snapshot — 실측 집계 Evidence(시간당 idempotent).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_reliability_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  indicator_id        uuid not null references public.ai_reliability_indicators(id),
  window_code         text not null check (window_code in ('rolling_1h','rolling_6h','rolling_24h','rolling_7d','rolling_28d','point_in_time')),
  period_start        timestamptz,
  period_end          timestamptz not null,
  good_events         bigint,
  total_events        bigint,
  sli_value           numeric check (sli_value is null or (sli_value >= 0 and sli_value <= 100)),  -- total=0 → null 유지
  sample_size         bigint,
  data_coverage       numeric check (data_coverage is null or (data_coverage >= 0 and data_coverage <= 100)),
  status              text not null check (status in ('available','provisional','insufficient_data','data_gap','unsupported','invalid')),
  source_version      text not null default 'reliability_v1(0507)',
  input_hash          text not null,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  calculated_at       timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  unique (indicator_id, window_code, period_end)
);
create index if not exists idx_rel_snap on public.ai_reliability_snapshots (indicator_id, window_code, period_end desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 사람 결정 기록 — Freeze Decision / Reliability Certification(실행 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_reliability_decisions (
  id                  uuid primary key default gen_random_uuid(),
  decision_type       text not null check (decision_type in ('freeze_decision','certification')),
  decision            text not null check (decision in (
    -- freeze_decision (사람 선택 7종 — 시스템이 Freeze 를 실행하지 않음)
    'continue_changes','restrict_high_risk_changes','temporary_freeze_requested','freeze_accepted_reference','freeze_rejected','emergency_exception_requested','invalidated',
    -- certification (사람 판정 6종 — 자동 Certification 없음)
    'reliability_certified','reliability_certified_with_conditions','reliability_at_risk','reliability_not_certified','insufficient_data','cert_invalidated')),
  scope               text,
  reason              text not null,
  period_start        timestamptz,
  period_end          timestamptz,
  expires_at          timestamptz,
  risk_snapshot       jsonb not null default '{}'::jsonb,
  freeze_reference    jsonb,                     -- 외부 수동 Freeze 참고 기록(동작 여부 자동 단정 없음)
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  decided_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_rel_dec on public.ai_reliability_decisions (decision_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Reliability Event(Audit) — Production 차단 로그 아님.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_reliability_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('sli_calculated','slo_activated','slo_changed','slo_met','slo_at_risk','slo_breached','error_budget_low','error_budget_exhausted','burn_rate_elevated','burn_rate_critical','release_risk_detected','freeze_recommended','freeze_rejected','freeze_accepted_reference','reliability_review_started','reliability_certified','reliability_not_certified','indicator_saved')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_rel_evt on public.ai_reliability_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 초기 SLI 정의 Seed — 실측 가능한 6종만(관리자 활성화 전 is_active=false).
--    Streaming/Queue/Scheduler/API/DB 는 Telemetry 부재로 등록 자체 불가(whitelist 차단).
-- ─────────────────────────────────────────────────────────────────────────
insert into public.ai_reliability_indicators (indicator_code, domain, title, description, metric_code, aggregation_type, good_event_definition, total_event_definition, source_type, scope_type, is_active, limitations, evidence)
values
  ('sli_playback_error_free', 'playback', 'Player Error-Free Ratio', '전체 playback 이벤트 중 player_error 가 아닌 비율', 'player_error_free_ratio', 'good_over_total', 'playback_events_v2 이벤트 중 event_type <> player_error', 'playback_events_v2 전체 이벤트', 'playback_events_v2', 'global', false, '["세션 단위 아님 — 이벤트 단위 비율"]'::jsonb, '[{"label":"source","value":"playback_events_v2(0253) 실측"}]'::jsonb),
  ('sli_playback_completion', 'playback', 'Completion Ratio', 'play_complete / (play_complete + skip)', 'completion_ratio', 'good_over_total', 'event_type = play_complete', 'event_type in (play_complete, skip)', 'playback_events_v2', 'global', false, '["청취 지속시간 기반 아님 — 이벤트 카운트 기반"]'::jsonb, '[{"label":"source","value":"playback_events_v2(0253) 실측"}]'::jsonb),
  ('sli_playback_start_success', 'playback', 'Playback Start Success (proxy)', 'play_complete / play_start — 시작 대비 완료 proxy', 'playback_start_success_ratio', 'good_over_total', 'event_type = play_complete', 'event_type = play_start', 'playback_events_v2', 'global', false, '["start→complete 직접 세션 연결 없음(proxy)","동시 재생 시 비율 왜곡 가능"]'::jsonb, '[{"label":"source","value":"playback_events_v2(0253) 실측"}]'::jsonb),
  ('sli_constitution_compliance', 'governance', 'Constitution Compliance Ratio', 'Governance 이벤트 중 violation_detected 가 아닌 비율', 'constitution_compliance_ratio', 'good_over_total', 'ai_governance_events 중 event_type <> violation_detected', 'ai_governance_events 전체', 'ai_governance_events', 'global', false, '["Governance 이벤트가 기록된 활동에 한정"]'::jsonb, '[{"label":"source","value":"ai_governance_events(0496) 실측"}]'::jsonb),
  ('sli_audit_completeness', 'governance', 'Audit Completeness Ratio', 'Governance 이벤트 중 evidence 가 비어있지 않은 비율', 'audit_completeness_ratio', 'good_over_total', 'evidence jsonb array length > 0', 'ai_governance_events 전체', 'ai_governance_events', 'global', false, '[]'::jsonb, '[{"label":"source","value":"ai_governance_events(0496) 실측"}]'::jsonb),
  ('sli_store_online_now', 'availability', 'Store Online Ratio (point-in-time)', '현재 시점 online 매장 비율 — 기간형 uptime 아님', 'store_online_ratio_point_in_time', 'point_in_time', 'store_monitoring_status.is_online = true', 'store_monitoring_status 전체 매장', 'store_monitoring_status', 'global', false, '["heartbeat 히스토리 없음 — 기간형 Availability(uptime) 미지원","관측 불가 시간을 100%로 계산하지 않음(스냅샷만)"]'::jsonb, '[{"label":"source","value":"store_monitoring_status(0353) last_seen_at 실측"}]'::jsonb)
on conflict (indicator_code) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) SLI 정의 저장/활성화 — 사람(관리자)만, Evidence + Audit 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reliability_indicator_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_reliability_indicators;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'indicator_code','') = '' then raise exception 'indicator_code required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required (근거 없는 SLI 정의 금지)' using errcode='22023'; end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required (사람 승인 없는 SLI 변경 금지)' using errcode='22023'; end if;

  select id into v_id from public.ai_reliability_indicators where indicator_code = p_payload->>'indicator_code';
  if v_id is null then
    insert into public.ai_reliability_indicators (indicator_code, domain, title, description, metric_code, aggregation_type, good_event_definition, total_event_definition, source_type, scope_type, is_active, limitations, evidence, created_by, approved_by)
    values (p_payload->>'indicator_code', p_payload->>'domain', coalesce(p_payload->>'title', p_payload->>'indicator_code'), p_payload->>'description',
      p_payload->>'metric_code', coalesce(nullif(p_payload->>'aggregation_type',''),'good_over_total'),
      coalesce(p_payload->>'good_event_definition','—'), coalesce(p_payload->>'total_event_definition','—'),
      p_payload->>'source_type', coalesce(nullif(p_payload->>'scope_type',''),'global'),
      coalesce((p_payload->>'is_active')::boolean, false),
      coalesce(p_payload->'limitations','[]'::jsonb), p_payload->'evidence', auth.uid(),
      case when coalesce((p_payload->>'is_active')::boolean, false) then auth.uid() end)
    returning id into v_id;
  else
    update public.ai_reliability_indicators set
      is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
      limitations = coalesce(p_payload->'limitations', limitations),
      evidence = p_payload->'evidence',
      approved_by = case when coalesce((p_payload->>'is_active')::boolean, is_active) then auth.uid() else approved_by end,
      updated_at = now()
    where id = v_id;
  end if;
  insert into public.ai_reliability_events(event_type, ref_id, detail, actor_id) values ('indicator_saved', v_id, p_payload->>'change_reason', auth.uid());
  select * into v_row from public.ai_reliability_indicators where id = v_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_reliability_indicator_save(jsonb) to authenticated;

create or replace function public.admin_reliability_indicators(p_domain text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.domain, t.indicator_code), '[]'::jsonb) into v_items from (
    select * from public.ai_reliability_indicators i where (p_domain is null or i.domain = p_domain) limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_reliability_indicators(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) SLO 저장 — Versioning(새 버전 = 새 행 + 이전 superseded). AI 직접 수정 불가.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reliability_objective_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev public.ai_reliability_objectives; v_row public.ai_reliability_objectives; v_version int := 1; v_prev_id uuid; v_target numeric; v_checksum text;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'objective_code','') = '' then raise exception 'objective_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required (사람 승인 없는 SLO 변경 금지)' using errcode='22023'; end if;
  v_target := (p_payload->>'target_value')::numeric;
  if v_target is null or v_target <> v_target or v_target < 0 or v_target > 100 then raise exception 'target_value 0~100 필수(NaN 금지)' using errcode='22023'; end if;
  if not exists (select 1 from public.ai_reliability_indicators where id = (p_payload->>'indicator_id')::uuid) then raise exception 'indicator not found' using errcode='P0002'; end if;

  select * into v_prev from public.ai_reliability_objectives
  where objective_code = p_payload->>'objective_code' and lifecycle_status in ('draft','pending_approval','active')
  order by version desc limit 1;
  if v_prev.id is not null then
    v_version := v_prev.version + 1; v_prev_id := v_prev.id;
    update public.ai_reliability_objectives set lifecycle_status = 'superseded', effective_to = now(), updated_at = now() where id = v_prev.id;
  end if;
  v_checksum := md5(coalesce(p_payload->>'objective_code','') || '|' || v_target::text || '|' || coalesce(p_payload->>'compliance_window','') || '|' || v_version::text);

  insert into public.ai_reliability_objectives (objective_code, indicator_id, scope_type, scope_id, target_value, compliance_window, minimum_sample, minimum_data_coverage, severity, error_budget_policy, burn_rate_policy, lifecycle_status, version, change_reason, checksum, previous_version_id, approved_by, created_by)
  values (p_payload->>'objective_code', (p_payload->>'indicator_id')::uuid,
    coalesce(nullif(p_payload->>'scope_type',''),'global'), nullif(p_payload->>'scope_id',''),
    v_target, p_payload->>'compliance_window',
    greatest(1, coalesce((p_payload->>'minimum_sample')::int, 50)),
    least(100, greatest(0, coalesce((p_payload->>'minimum_data_coverage')::numeric, 50))),
    coalesce(nullif(p_payload->>'severity',''),'medium'),
    coalesce(p_payload->'error_budget_policy','{}'::jsonb), coalesce(p_payload->'burn_rate_policy','{}'::jsonb),
    coalesce(nullif(p_payload->>'lifecycle_status',''),'draft'), v_version, p_payload->>'change_reason', v_checksum, v_prev_id,
    case when coalesce(nullif(p_payload->>'lifecycle_status',''),'draft') = 'active' then auth.uid() end, auth.uid())
  returning * into v_row;
  insert into public.ai_reliability_events(event_type, ref_id, detail, actor_id)
  values (case when v_version = 1 and v_row.lifecycle_status = 'active' then 'slo_activated' else 'slo_changed' end, v_row.id, p_payload->>'change_reason', auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_reliability_objective_save(jsonb) to authenticated;

create or replace function public.admin_reliability_objectives(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select o.*, i.indicator_code, i.domain, i.metric_code from public.ai_reliability_objectives o
    join public.ai_reliability_indicators i on i.id = o.indicator_id
    where (p_status is null or o.lifecycle_status = p_status)
    order by o.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_reliability_objectives(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) SLI 실측 계산 — good/total 실집계, total=0 → sli null + insufficient_data.
--    Coverage: 이벤트가 존재한 시간 bucket / window 시간(공백을 정상으로 계산 안 함).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reliability_sli_compute(p_indicator_id uuid, p_window text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ind public.ai_reliability_indicators; v_hours int; v_start timestamptz; v_end timestamptz;
  v_good bigint; v_total bigint; v_sli numeric; v_observed_hours int; v_coverage numeric; v_status text;
  v_row public.ai_reliability_snapshots; v_window text := p_window;
begin
  perform public._admin_growth_guard();
  select * into v_ind from public.ai_reliability_indicators where id = p_indicator_id;
  if v_ind.id is null then raise exception 'indicator not found' using errcode='P0002'; end if;

  if v_ind.aggregation_type = 'point_in_time' then
    -- 현재 시점 스냅샷만 — 기간형 uptime 아님.
    v_window := 'point_in_time'; v_end := date_trunc('minute', now()); v_start := null;
    select count(*) filter (where is_online), count(*) into v_good, v_total from public.store_monitoring_status;
    v_coverage := null;
    v_sli := case when coalesce(v_total,0) > 0 then round(v_good::numeric / v_total * 100, 2) end;
    v_status := case when coalesce(v_total,0) = 0 then 'insufficient_data' else 'provisional' end;  -- 히스토리 없음 → 항상 provisional
  else
    if p_window is null or p_window not in ('rolling_1h','rolling_6h','rolling_24h','rolling_7d','rolling_28d') then raise exception 'invalid window' using errcode='22023'; end if;
    v_hours := case p_window when 'rolling_1h' then 1 when 'rolling_6h' then 6 when 'rolling_24h' then 24 when 'rolling_7d' then 168 else 672 end;
    v_end := date_trunc('hour', now()); v_start := v_end - make_interval(hours => v_hours);

    if v_ind.source_type = 'playback_events_v2' then
      select
        case v_ind.metric_code
          when 'player_error_free_ratio' then count(*) filter (where event_type <> 'player_error')
          when 'completion_ratio' then count(*) filter (where event_type = 'play_complete')
          when 'playback_start_success_ratio' then count(*) filter (where event_type = 'play_complete')
        end,
        case v_ind.metric_code
          when 'player_error_free_ratio' then count(*)
          when 'completion_ratio' then count(*) filter (where event_type in ('play_complete','skip'))
          when 'playback_start_success_ratio' then count(*) filter (where event_type = 'play_start')
        end,
        count(distinct date_trunc('hour', created_at))
      into v_good, v_total, v_observed_hours
      from public.playback_events_v2 where created_at >= v_start and created_at < v_end;
    elsif v_ind.source_type = 'ai_governance_events' then
      select
        case v_ind.metric_code
          when 'constitution_compliance_ratio' then count(*) filter (where event_type <> 'violation_detected')
          when 'audit_completeness_ratio' then count(*) filter (where jsonb_array_length(coalesce(evidence,'[]'::jsonb)) > 0)
        end,
        count(*), count(distinct date_trunc('hour', created_at))
      into v_good, v_total, v_observed_hours
      from public.ai_governance_events where created_at >= v_start and created_at < v_end;
    else
      raise exception 'source % 미지원', v_ind.source_type using errcode='22023';
    end if;

    v_sli := case when coalesce(v_total,0) > 0 then round(v_good::numeric / v_total * 100, 3) end;   -- total 0 → null(나눗셈 없음)
    v_coverage := case when coalesce(v_total,0) > 0 then round(least(100, v_observed_hours::numeric / v_hours * 100), 1) end;
    v_status := case when coalesce(v_total,0) = 0 then 'insufficient_data'
                     when v_coverage < 50 then 'data_gap'
                     when v_coverage < 80 then 'provisional'
                     else 'available' end;
  end if;

  insert into public.ai_reliability_snapshots (indicator_id, window_code, period_start, period_end, good_events, total_events, sli_value, sample_size, data_coverage, status, input_hash, evidence, limitations)
  values (p_indicator_id, v_window, v_start, v_end, v_good, v_total, v_sli, v_total, v_coverage, v_status,
    md5(p_indicator_id::text || '|' || v_window || '|' || v_end::text),
    jsonb_build_array(jsonb_build_object('label','source','value',v_ind.source_type), jsonb_build_object('label','actual','value',true)),
    v_ind.limitations)
  on conflict (indicator_id, window_code, period_end) do update set
    good_events = excluded.good_events, total_events = excluded.total_events, sli_value = excluded.sli_value,
    sample_size = excluded.sample_size, data_coverage = excluded.data_coverage, status = excluded.status, calculated_at = now()
  returning * into v_row;
  insert into public.ai_reliability_events(event_type, ref_id, detail, actor_id)
  values ('sli_calculated', v_row.id, format('%s %s → %s (%s)', v_ind.indicator_code, v_window, coalesce(v_sli::text,'null'), v_status), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_reliability_sli_compute(uuid, text) to authenticated;

create or replace function public.admin_reliability_snapshots(p_indicator_id uuid default null, p_window text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.period_end desc), '[]'::jsonb) into v_items from (
    select s.*, i.indicator_code, i.domain, i.metric_code from public.ai_reliability_snapshots s
    join public.ai_reliability_indicators i on i.id = s.indicator_id
    where (p_indicator_id is null or s.indicator_id = p_indicator_id) and (p_window is null or s.window_code = p_window)
    order by s.period_end desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_reliability_snapshots(uuid, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) 사람 결정 — Freeze Decision(참고 기록) / Reliability Certification(게이트).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reliability_freeze_decision(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_reliability_decisions; v_decision text := p_payload->>'decision'; v_ref jsonb := p_payload->'freeze_reference';
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if v_decision is null or v_decision not in ('continue_changes','restrict_high_risk_changes','temporary_freeze_requested','freeze_accepted_reference','freeze_rejected','emergency_exception_requested','invalidated') then
    raise exception 'invalid freeze decision' using errcode='22023';
  end if;
  if coalesce(p_payload->>'reason','') = '' then raise exception 'reason required (사유 없는 Freeze 결정 금지)' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if v_decision = 'freeze_accepted_reference' then
    if v_ref is null or coalesce(v_ref->>'external_freeze_id','') = '' or coalesce(v_ref->>'applied_by','') = '' or coalesce(v_ref->>'external_system','') = '' then
      raise exception 'freeze reference incomplete (external_freeze_id/applied_by/external_system 필수 — 실제 동작 자동 단정 없음)' using errcode='22023';
    end if;
  end if;
  insert into public.ai_reliability_decisions (decision_type, decision, scope, reason, expires_at, risk_snapshot, freeze_reference, evidence, limitations, decided_by)
  values ('freeze_decision', v_decision, nullif(p_payload->>'scope',''), p_payload->>'reason',
    nullif(p_payload->>'expires_at','')::timestamptz, coalesce(p_payload->'risk_snapshot','{}'::jsonb), v_ref,
    p_payload->'evidence', coalesce(p_payload->'limitations','["시스템이 Branch Protection/Vercel/GitHub/Scheduler 를 직접 변경하지 않음"]'::jsonb), auth.uid())
  returning * into v_row;
  insert into public.ai_reliability_events(event_type, ref_id, detail, actor_id)
  values (case v_decision when 'freeze_accepted_reference' then 'freeze_accepted_reference' when 'freeze_rejected' then 'freeze_rejected' else 'freeze_recommended' end, v_row.id, p_payload->>'reason', auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_reliability_freeze_decision(jsonb) to authenticated;

create or replace function public.admin_reliability_certify(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_reliability_decisions; v_result text := p_payload->>'decision'; v_snap_cnt int;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if v_result is null or v_result not in ('reliability_certified','reliability_certified_with_conditions','reliability_at_risk','reliability_not_certified','insufficient_data','cert_invalidated') then
    raise exception 'invalid certification result' using errcode='22023';
  end if;
  if coalesce(p_payload->>'reason','') = '' then raise exception 'reason required (자동 Certification 없음 — 사람 사유 필수)' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if v_result in ('reliability_certified','reliability_certified_with_conditions') then
    if coalesce(p_payload->>'period_start','') = '' or coalesce(p_payload->>'period_end','') = '' then raise exception '인증 기간 필수' using errcode='22023'; end if;
    select count(*) into v_snap_cnt from public.ai_reliability_snapshots
    where period_end >= (p_payload->>'period_start')::timestamptz and period_end <= (p_payload->>'period_end')::timestamptz and status in ('available','provisional');
    if v_snap_cnt = 0 then raise exception '실측 SLI Snapshot 없는 인증 금지' using errcode='22023'; end if;
    if exists (select 1 from public.ai_reliability_snapshots
               where period_end >= (p_payload->>'period_start')::timestamptz and period_end <= (p_payload->>'period_end')::timestamptz
                 and status = 'data_gap') and v_result = 'reliability_certified' then
      raise exception 'data_gap 존재 — 무조건 인증 금지(conditions 검토)' using errcode='22023';
    end if;
  end if;
  insert into public.ai_reliability_decisions (decision_type, decision, scope, reason, period_start, period_end, risk_snapshot, evidence, limitations, decided_by)
  values ('certification', v_result, nullif(p_payload->>'scope',''), p_payload->>'reason',
    nullif(p_payload->>'period_start','')::timestamptz, nullif(p_payload->>'period_end','')::timestamptz,
    coalesce(p_payload->'risk_snapshot','{}'::jsonb), p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb), auth.uid())
  returning * into v_row;
  insert into public.ai_reliability_events(event_type, ref_id, detail, actor_id)
  values (case when v_result in ('reliability_certified','reliability_certified_with_conditions') then 'reliability_certified'
               when v_result = 'reliability_not_certified' then 'reliability_not_certified' else 'reliability_review_started' end, v_row.id, p_payload->>'reason', auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_reliability_certify(jsonb) to authenticated;

create or replace function public.admin_reliability_decisions(p_type text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_reliability_decisions d where (p_type is null or d.decision_type = p_type)
    order by d.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_reliability_decisions(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) 요약 / Audit.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_reliability_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'indicators_total', (select count(*) from public.ai_reliability_indicators),
    'indicators_active', (select count(*) from public.ai_reliability_indicators where is_active),
    'objectives_active', (select count(*) from public.ai_reliability_objectives where lifecycle_status = 'active'),
    'objectives_draft', (select count(*) from public.ai_reliability_objectives where lifecycle_status in ('draft','pending_approval')),
    'snapshots_total', (select count(*) from public.ai_reliability_snapshots),
    'snapshots_data_gap', (select count(*) from public.ai_reliability_snapshots where status = 'data_gap'),
    'snapshots_insufficient', (select count(*) from public.ai_reliability_snapshots where status = 'insufficient_data'),
    'freeze_decisions', (select count(*) from public.ai_reliability_decisions where decision_type = 'freeze_decision'),
    'active_freeze_references', (select count(*) from public.ai_reliability_decisions where decision = 'freeze_accepted_reference' and (expires_at is null or expires_at > now())),
    'certifications', (select coalesce(jsonb_object_agg(decision, n), '{}'::jsonb) from (select decision, count(*) n from public.ai_reliability_decisions where decision_type = 'certification' group by decision) x),
    'last_evaluation_at', (select max(calculated_at) from public.ai_reliability_snapshots),
    'generated_at', now()
  ) into v;
  return v;
end; $$;
grant execute on function public.admin_reliability_summary() to authenticated;

create or replace function public.admin_reliability_audit(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_reliability_events order by created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_reliability_audit(int) to authenticated;
