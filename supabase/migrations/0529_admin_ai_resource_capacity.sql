-- 0529_admin_ai_resource_capacity.sql
-- Phase AI-OPS-26 — Enterprise Resource Intelligence, Capacity Planning &
-- Operational Optimization Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   Capacity 원본: ai_capacity_metrics/ai_capacity_snapshots(0508 — 실측 usage/limit/headroom).
--   비용 원본: ai_cost_snapshots(0508 — provider actual/estimated).
--   사용량 Proxy 원본: playback_events_v2(일별 볼륨/세션 — 0253), tracks/playlists/users(행 수 실측).
--   CPU/Memory/GPU/Network/AI Token/Inference Queue 실측 원본 없음(APM·모델 사용 로그 없음)
--     → resource_unavailable 유지(임의 생성 금지).
--
-- Resource 정직성(전부 강제):
--   * 자동 서버 증설/축소/인프라 변경/AI 모델 변경/Capacity·비용·계약 변경 없음.
--   * Capacity ≠ Demand. Utilization ≠ Efficiency. Bottleneck ≠ Root Cause.
--   * Forecast ≠ Actual. Recommendation ≠ Operational Decision.
--   * Unknown 유지(null→0 금지). 표본 부족 sample_too_small. 근거 부족 resource_unverified.
--   * Resource 상태는 active/maintenance/deprecated/unknown 4종만.
--   * Trigger 없음 · 삭제 RPC 없음 · 원본(0508) 미변경 · 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Resource Registry — 사람 등록만(자동 증설/축소 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_resource_registry (
  id                  uuid primary key default gen_random_uuid(),
  resource_code       text not null unique,
  resource_kind       text not null check (resource_kind in ('compute','storage','database','network','ai_model','cloud_service','external_service')),
  title               text not null,
  description         text,
  provider            text,
  capacity_reference  numeric check (capacity_reference is null or capacity_reference >= 0),   -- 사람 입력 참조(null 유지 — Capacity ≠ Demand)
  capacity_unit       text,
  linked_metric_ids   jsonb not null default '[]'::jsonb,        -- ai_capacity_metrics(0508) 실존 검증
  resource_status     text not null default 'unknown' check (resource_status in ('active','maintenance','deprecated','unknown')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Capacity ≠ Demand","등록 참조 — 자동 증설/축소 없음"]'::jsonb,
  source_version      text not null default 'resource_v1(0529)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_res_reg on public.ai_resource_registry (resource_kind, resource_status, created_at desc);

-- Capacity/Utilization/AI/Efficiency/Forecast/Bottleneck/Briefing/권고/Audit 는 Event 통합(테이블 최소화 — 신규 테이블 2개뿐).
create table if not exists public.ai_resource_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('resource_registered','resource_reviewed','resource_deprecated','capacity_assessed','utilization_analyzed','ai_resource_analyzed','infra_efficiency_analyzed','capacity_forecasted','bottleneck_analyzed','operational_efficiency_analyzed','waste_review_noted','capacity_pressure_noted','resource_briefing_recorded','resource_recommendation_created','external_resource_reference','resource_monitoring_noted')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_res_evt on public.ai_resource_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 요약 — 자원/Capacity 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_resource_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'registry_total', (select count(*) from public.ai_resource_registry),
    'registry_by_kind', (select coalesce(jsonb_object_agg(resource_kind, n), '{}'::jsonb) from (select resource_kind, count(*) n from public.ai_resource_registry group by resource_kind) x),
    'registry_by_status', (select coalesce(jsonb_object_agg(resource_status, n), '{}'::jsonb) from (select resource_status, count(*) n from public.ai_resource_registry group by resource_status) x),
    -- Capacity 실측(0508 참조 — 원본 미변경):
    'capacity_actuals', jsonb_build_object(
      'capacity_metrics_active_0508', (select count(*) from public.ai_capacity_metrics where is_active = true),
      'capacity_metrics_total_0508', (select count(*) from public.ai_capacity_metrics),
      'capacity_snapshots_0508', (select count(*) from public.ai_capacity_snapshots),
      'snapshot_status_latest', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select s.status, count(*) n from public.ai_capacity_snapshots s
        where s.created_at > now() - interval '30 days' group by s.status) x),
      'cost_snapshots_90d_0508', (select count(*) from public.ai_cost_snapshots where period_end > now() - interval '90 days'),
      'playback_events_30d', (select count(*) from public.playback_events_v2 where created_at > now() - interval '30 days'),
      'distinct_sessions_30d', (select count(distinct session_id) from public.playback_events_v2 where created_at > now() - interval '30 days' and session_id is not null),
      'tracks_rows', (select count(*) from public.tracks),
      'playlists_rows', (select count(*) from public.playlists),
      'users_rows', (select count(*) from public.users)
    ),
    'resource_unavailable', jsonb_build_array('cpu_usage','memory_usage','gpu_usage','network_usage','ai_token_consumption','inference_queue_length','model_processing_time','apm_metrics'),   -- 실측 원본 없음
    'no_auto_scale_up', true, 'no_auto_scale_down', true, 'no_auto_infra_change', true, 'no_auto_model_change', true,
    'capacity_is_not_demand', true, 'utilization_is_not_efficiency', true, 'bottleneck_is_not_root_cause', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Resource 등록·검토 — 사람 RPC 만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_resource_register_create(
  p_code text, p_kind text, p_title text, p_evidence jsonb,
  p_description text default null, p_provider text default null,
  p_capacity numeric default null, p_unit text default null,
  p_metric_ids jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수(사람 등록 — 자동 등록 없음)'; end if;
  if p_kind not in ('compute','storage','database','network','ai_model','cloud_service','external_service') then raise exception '허용되지 않는 resource_kind'; end if;
  if p_capacity is not null and p_capacity < 0 then raise exception 'capacity 는 0 이상(null 유지 가능)'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(resource_unverified 방지)'; end if;
  v_cnt := jsonb_array_length(coalesce(p_metric_ids, '[]'::jsonb));
  if v_cnt > 20 then raise exception 'metric 연결 20개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_capacity_metrics m where m.id in (select (jsonb_array_elements_text(p_metric_ids))::uuid);
    if v_found <> v_cnt then raise exception 'capacity metric(0508) 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_resource_registry where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_resource_registry (resource_code, resource_kind, title, description, provider, capacity_reference, capacity_unit, linked_metric_ids, evidence, idempotency_key, created_by)
  values (p_code, p_kind, left(p_title, 200), p_description, p_provider, p_capacity, p_unit, coalesce(p_metric_ids, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_resource_events (event_type, ref_id, detail, actor_id) values ('resource_registered', v_id, p_code || ' (' || p_kind || ') — 사람 등록(자동 증설/축소 없음)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'resource_status', 'unknown', 'infra_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_resource_register_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('active','maintenance','deprecated','unknown') then raise exception 'Resource 상태는 active/maintenance/deprecated/unknown 4종만'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수(자동 인프라 변경 없음)'; end if;
  select resource_status, created_by into v_cur, v_creator from public.ai_resource_registry where id = p_id for update;
  if v_cur is null then raise exception 'resource 없음'; end if;
  if v_cur = 'deprecated' then raise exception '종결 상태(deprecated)에서 재결정 불가'; end if;
  if v_creator is not null and v_creator = v_uid and p_status = 'deprecated' then
    v_warnings := jsonb_build_array('self_review_warning: 등록자와 판정자가 동일');
  end if;
  update public.ai_resource_registry
     set resource_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  v_evt := case when p_status = 'deprecated' then 'resource_deprecated' else 'resource_reviewed' end;
  insert into public.ai_resource_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (인프라 자동 변경 아님)', v_uid);
  return jsonb_build_object('ok', true, 'resource_status', p_status, 'warnings', v_warnings, 'infra_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_resource_register_list(p_kind text default null, p_limit int default 100)
returns setof public.ai_resource_registry language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_resource_registry where (p_kind is null or resource_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 사용량 일별 실측 시계열 — Capacity Trend/Forecast 원자료(예측은 클라이언트).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_resource_usage_timeline(p_days int default 30)
returns table (day date, playback_events bigint, play_starts bigint, distinct_sessions bigint)
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  perform public._admin_growth_guard();
  v_days := least(greatest(coalesce(p_days, 30), 7), 120);
  return query
  with days as (select generate_series((now() - (v_days - 1 || ' days')::interval)::date, now()::date, '1 day')::date as d),
  ev as (
    select created_at::date d, count(*) total,
           count(*) filter (where event_type = 'play_start') starts,
           count(distinct session_id) filter (where session_id is not null) sessions
    from public.playback_events_v2 where created_at > now() - (v_days || ' days')::interval group by 1
  )
  select days.d, coalesce(ev.total, 0), coalesce(ev.starts, 0), coalesce(ev.sessions, 0)
  from days left join ev on ev.d = days.d
  order by days.d asc;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Governance Event / Audit — Capacity/Utilization/AI/Efficiency/Forecast/
--    Bottleneck/Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_resource_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('capacity_assessed','utilization_analyzed','ai_resource_analyzed','infra_efficiency_analyzed','capacity_forecasted','bottleneck_analyzed','operational_efficiency_analyzed','waste_review_noted','capacity_pressure_noted','resource_briefing_recorded','resource_recommendation_created','external_resource_reference','resource_monitoring_noted') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_resource_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'capacity_forecasted' then ' (Forecast ≠ Actual)'
      when p_kind = 'bottleneck_analyzed' then ' (Bottleneck ≠ Root Cause)'
      when p_kind = 'utilization_analyzed' then ' (Utilization ≠ Efficiency)'
      when p_kind = 'resource_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'capacity_assessed' then ' (Capacity ≠ Demand)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'scaled', false, 'infra_changed', false, 'cost_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_resource_audit(p_limit int default 100)
returns setof public.ai_resource_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_resource_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_resource_registry enable row level security;
alter table public.ai_resource_events enable row level security;

comment on table public.ai_resource_registry is 'AI-OPS-26 — Resource Registry(사람 등록만 — 4상태·자동 증설/축소 없음·Capacity ≠ Demand).';
comment on table public.ai_resource_events is 'AI-OPS-26 — Resource Audit(event_type whitelist 16종·Capacity/Utilization/AI/Efficiency/Forecast/Bottleneck 통합).';
