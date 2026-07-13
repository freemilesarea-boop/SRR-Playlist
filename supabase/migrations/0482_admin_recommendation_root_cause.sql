-- ============================================
-- 0482_admin_recommendation_root_cause.sql
--
-- Phase AI-RECOMMENDATION-2 — Evidence-based Root Cause & Impact & Outcome Tracking.
--
-- 흐름: Evidence → Correlation → Root Cause Candidate → Suggested Action → Outcome
--       → Learning Signal. **원인은 LLM 이 만들지 않는다** — 실제 KPI/시계열의 방향·
--       크기·시간 정렬로만 "원인 후보(상관)"를 계산한다(프론트 rootCauseIntel.ts).
--       Correlation 을 Causation 으로 표현하지 않는다.
--
-- 이 마이그레이션은 **분석 계산 로직을 만들지 않는다**(프론트가 기존 시계열 재사용해 계산).
-- 추가하는 것은 오직:
--   1) recommendation_root_cause_snapshots — 계산된 원인 후보/충돌 근거 스냅샷(선택 저장)
--   2) recommendation_outcomes — 추천 실행 Before/After 측정 + Outcome 상태
--   3) Learning Signal 은 recommendation_outcomes 집계 RPC(별도 표 없음 — 중복/staleness 방지)
--
-- 절대 조건:
--   - Evidence(근거) 없는 Root Cause 저장 금지(candidates jsonb array 필수).
--   - Before Snapshot 없는 Outcome 생성 금지 / After 없는 Outcome 완료 금지.
--   - 동일 Command 중복 Outcome 금지(partial unique index).
--   - 점수/값 clamp, NaN/Infinity 금지. unsupported 를 supported 로 저장 금지(enum).
--   - 기존 Recommendation(0481)/Action/Automation 무변경(재사용만).
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Root Cause 스냅샷(계산 결과 저장 — 선택). candidates 필수(근거 없는 저장 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.recommendation_root_cause_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  recommendation_key text not null,
  analysis_status    text not null check (analysis_status in ('supported','insufficient_data','unsupported','conflicting')),
  candidates         jsonb not null,          -- [{metric_key,label,final_score,analysis_status,...}]
  conflicting        jsonb not null default '[]'::jsonb,
  time_window        text,
  created_by         uuid,
  generated_at       timestamptz not null default now()
);

comment on table public.recommendation_root_cause_snapshots is
  'AI-RECOMMENDATION-2 — Root Cause 후보/충돌 근거 스냅샷. 계산은 프론트(기존 시계열 재사용); 상관≠인과.';

create index if not exists idx_reco_rootcause_key on public.recommendation_root_cause_snapshots (recommendation_key, generated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Recommendation Outcome(Before/After 측정).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.recommendation_outcomes (
  id                 uuid primary key default gen_random_uuid(),
  recommendation_key text not null,
  command_id         uuid,                    -- Action Center Command 연결(선택)
  action_type        text,
  metric_key         text not null,
  direction          text not null default 'lower_better' check (direction in ('lower_better','higher_better')),
  measurement_window text not null default 'immediate' check (measurement_window in ('immediate','1h','24h','7d')),
  before_value       numeric not null,        -- Before Snapshot 필수
  before_at          timestamptz not null default now(),
  after_value        numeric,
  after_at           timestamptz,
  delta              numeric,
  outcome_status     text not null default 'pending' check (outcome_status in ('improved','unchanged','worsened','insufficient_data','pending')),
  created_by         uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.recommendation_outcomes is
  'AI-RECOMMENDATION-2 — 추천 실행 Before/After 측정 + Outcome. Before 필수, After 없이 완료 금지, 동일 Command 중복 금지.';

-- 동일 Command 중복 Outcome 방지(NULL command 는 제외).
create unique index if not exists uq_reco_outcome_command
  on public.recommendation_outcomes (command_id) where command_id is not null;
create index if not exists idx_reco_outcome_key on public.recommendation_outcomes (recommendation_key, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Root Cause 스냅샷 저장. candidates 배열 필수(근거 없는 Root Cause 금지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_root_cause_save(
  p_recommendation_key text,
  p_analysis_status    text,
  p_candidates         jsonb,
  p_conflicting        jsonb default '[]'::jsonb,
  p_time_window        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._admin_growth_guard();

  if coalesce(p_recommendation_key,'') = '' then
    raise exception 'recommendation_key required' using errcode = '22023';
  end if;
  if p_analysis_status not in ('supported','insufficient_data','unsupported','conflicting') then
    raise exception 'invalid analysis_status: %', p_analysis_status using errcode = '22023';
  end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception 'candidates must be a jsonb array (근거 없는 Root Cause 저장 금지)' using errcode = '22023';
  end if;

  insert into public.recommendation_root_cause_snapshots(
    recommendation_key, analysis_status, candidates, conflicting, time_window, created_by
  ) values (
    p_recommendation_key, p_analysis_status, p_candidates,
    coalesce(p_conflicting, '[]'::jsonb), nullif(p_time_window,''), auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.admin_recommendation_root_cause_save(text, text, jsonb, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Outcome 등록(Before Snapshot). status=pending. 동일 Command 중복 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_outcome_register(
  p_recommendation_key text,
  p_metric_key         text,
  p_before_value       numeric,
  p_command_id         uuid default null,
  p_action_type        text default null,
  p_direction          text default 'lower_better',
  p_measurement_window text default 'immediate'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._admin_growth_guard();

  if coalesce(p_recommendation_key,'') = '' or coalesce(p_metric_key,'') = '' then
    raise exception 'recommendation_key/metric_key required' using errcode = '22023';
  end if;
  if p_before_value is null or not (p_before_value = p_before_value) then  -- NaN 방지
    raise exception 'before_value required (Before Snapshot 없는 Outcome 생성 금지)' using errcode = '22023';
  end if;
  if p_direction not in ('lower_better','higher_better') then
    raise exception 'invalid direction' using errcode = '22023';
  end if;
  if p_measurement_window not in ('immediate','1h','24h','7d') then
    raise exception 'invalid measurement_window' using errcode = '22023';
  end if;

  begin
    insert into public.recommendation_outcomes(
      recommendation_key, command_id, action_type, metric_key, direction, measurement_window, before_value, before_at, outcome_status
    ) values (
      p_recommendation_key, p_command_id, p_action_type, p_metric_key, p_direction, p_measurement_window, p_before_value, now(), 'pending'
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'outcome already exists for this command (동일 Command 중복 Outcome 금지)' using errcode = '23505';
  end;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'pending');
end;
$$;

grant execute on function public.admin_recommendation_outcome_register(text, text, numeric, uuid, text, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Outcome 평가(After Snapshot). After 없이 완료 금지. delta/status 기록(Audit).
--    p_outcome_status 는 프론트 rootCauseIntel.classifyOutcome 결과(서버는 enum/전제 검증).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_outcome_evaluate(
  p_outcome_id     uuid,
  p_after_value    numeric,
  p_outcome_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.recommendation_outcomes;
  v_delta numeric;
begin
  perform public._admin_growth_guard();

  if p_outcome_status not in ('improved','unchanged','worsened','insufficient_data') then
    raise exception 'invalid outcome_status (pending 은 완료 아님)' using errcode = '22023';
  end if;
  if p_after_value is null or not (p_after_value = p_after_value) then  -- NaN 방지
    raise exception 'after_value required (After Snapshot 없는 Outcome 완료 금지)' using errcode = '22023';
  end if;

  select * into v_row from public.recommendation_outcomes where id = p_outcome_id;
  if v_row.id is null then
    raise exception 'outcome not found: %', p_outcome_id using errcode = 'P0002';
  end if;

  v_delta := p_after_value - v_row.before_value;

  update public.recommendation_outcomes set
    after_value = p_after_value, after_at = now(), delta = v_delta,
    outcome_status = p_outcome_status, updated_at = now()
  where id = p_outcome_id;

  return jsonb_build_object('ok', true, 'id', p_outcome_id, 'delta', v_delta, 'status', p_outcome_status);
end;
$$;

grant execute on function public.admin_recommendation_outcome_evaluate(uuid, numeric, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Outcome 목록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_outcomes(
  p_limit int default 50,
  p_recommendation_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select o.id, o.recommendation_key, o.command_id, o.action_type, o.metric_key, o.direction,
           o.measurement_window, o.before_value, o.before_at, o.after_value, o.after_at, o.delta,
           o.outcome_status, o.created_at, o.updated_at, u.nickname as created_by_name
    from public.recommendation_outcomes o
    left join public.users u on u.id = o.created_by
    where p_recommendation_key is null or o.recommendation_key = p_recommendation_key
    order by o.created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_recommendation_outcomes(int, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Learning Signal — recommendation_outcomes 집계(별도 표 없음; 자동 가중치 변경 없음).
--    참고 지표만 제공. success_rate = improved / (완료된 outcome).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_learning_signals()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.times_executed desc), '[]'::jsonb)
  into v_result
  from (
    select o.recommendation_key, o.action_type,
           count(*) filter (where o.outcome_status <> 'pending') as times_executed,
           count(*) filter (where o.outcome_status = 'improved') as improved_count,
           count(*) filter (where o.outcome_status = 'unchanged') as unchanged_count,
           count(*) filter (where o.outcome_status = 'worsened') as worsened_count,
           count(*) filter (where o.outcome_status = 'insufficient_data') as insufficient_count,
           case when count(*) filter (where o.outcome_status in ('improved','unchanged','worsened')) > 0
                then round(100.0 * count(*) filter (where o.outcome_status = 'improved')
                     / count(*) filter (where o.outcome_status in ('improved','unchanged','worsened')), 1)
                else null end as success_rate,
           round(avg(o.delta) filter (where o.outcome_status <> 'pending')::numeric, 2) as average_delta,
           max(o.updated_at) as last_updated_at
    from public.recommendation_outcomes o
    group by o.recommendation_key, o.action_type
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_recommendation_learning_signals() to authenticated;
