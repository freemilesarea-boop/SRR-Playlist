-- ============================================
-- 0493_admin_strategy.sql
--
-- Phase AI-MUSIC-5 — Autonomous Optimization Strategy Engine.
--
-- Prediction 결과를 기반으로 AI 가 Context 별 최적화 전략 후보를 생성·평가한다(전략 제안·시뮬레이션
-- 전용). 자동 Playlist/Scheduler/Queue/Playback/Recommendation/Weight/Rollout/Experiment 변경 없음 —
-- 운영자 승인 후에만 이후 Phase 에서 사용 가능.
--
--   Strategy Generator · Ranking · ROI · Cost · Risk · Multi-Strategy Simulation · Conflict ·
--   Dependency Graph · Optimization Plan · Strategy Memory
--
-- 전략 생성/평가는 **프론트 optimizationStrategy.ts(순수 로직·단위 테스트)**가 수행하며, 원천은
-- 기존 RPC 를 최대 재사용한다(admin_context_detail/trend/drift/prediction_scan — AI-M2~M4).
-- 이 마이그레이션은 **Strategy Memory 저장소 1개 + CRUD/집계 RPC 만** 추가한다(실시간 계산으로
-- 충분한 생성/랭킹/시뮬레이션은 저장하지 않음).
--
-- 절대 조건: 기존 Context/Predictive 정의 변경 금지(재사용) · 미존재 KPI 생성 금지 · Sample 부족이면
--   Strategy/ROI/Simulation 생성 금지(프론트 gate) · 점수 0~100 clamp · NaN 금지 · SECURITY DEFINER
--   + search_path 고정 · 관리자 가드 · Evidence 필수 · 접근은 RPC 만(저장소 직접 grant 없음).
-- ============================================

-- 가드 _admin_growth_guard()(0472) 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- Strategy Memory 저장소 — 생성 전략 + 운영자 승인/기각 + Outcome. 접근은 RPC 만.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.strategy_snapshots (
  id            uuid primary key default gen_random_uuid(),
  context_key   text not null,
  strategy_type text not null,
  target        text,
  roi_score     int,
  risk_score    int,
  cost_score    int,
  confidence    int,
  expected_gain jsonb not null default '{}'::jsonb,   -- {completion,skip,listening,health}
  evidence      jsonb not null default '[]'::jsonb,
  status        text not null default 'active' check (status in ('active','approved','dismissed','resolved')),
  outcome       text check (outcome in ('improved','neutral','degraded')),
  before_kpi    jsonb,
  after_kpi     jsonb,
  created_by    uuid,
  resolved_by   uuid,
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
comment on table public.strategy_snapshots is
  'AI-MUSIC-5 — Strategy Memory. 최적화 전략 후보 + 운영자 승인/기각 + Outcome. 자동 실행/학습 금지.';
create index if not exists idx_strategy_snap on public.strategy_snapshots (context_key, created_at desc);
create index if not exists idx_strategy_status on public.strategy_snapshots (status, created_at desc);

-- 전략 저장(생성 후보 기록). ROI/Risk/Cost/Confidence clamp · Evidence 필수.
create or replace function public.admin_strategy_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_row public.strategy_snapshots;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'context_key','') = '' then raise exception 'context_key required' using errcode='22023'; end if;
  if coalesce(p_payload->>'strategy_type','') = '' then raise exception 'strategy_type required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'evidence required (Explainable Strategy — Evidence 없는 전략 저장 금지)' using errcode='22023';
  end if;

  insert into public.strategy_snapshots(
    context_key, strategy_type, target, roi_score, risk_score, cost_score, confidence, expected_gain, evidence, before_kpi, created_by
  ) values (
    p_payload->>'context_key', p_payload->>'strategy_type', nullif(p_payload->>'target',''),
    least(100, greatest(0, nullif(p_payload->>'roi_score','')::int)),
    least(100, greatest(0, nullif(p_payload->>'risk_score','')::int)),
    least(100, greatest(0, nullif(p_payload->>'cost_score','')::int)),
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)),
    coalesce(p_payload->'expected_gain','{}'::jsonb), p_payload->'evidence', p_payload->'before_kpi', auth.uid()
  ) returning id into v_id;

  select * into v_row from public.strategy_snapshots where id = v_id;
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_strategy_save(jsonb) to authenticated;

-- 전략 조회.
create or replace function public.admin_strategy_memory(
  p_context_key text default null, p_status text default null, p_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.strategy_snapshots s
    where (p_context_key is null or s.context_key = p_context_key)
      and (p_status is null or s.status = p_status)
    order by s.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end;
$$;
grant execute on function public.admin_strategy_memory(text, text, int) to authenticated;

-- 전략 승인/기각/Outcome 기록(운영자 수동). 자동 실행 없음.
create or replace function public.admin_strategy_resolve(
  p_id uuid, p_status text, p_outcome text default null, p_after_kpi jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.strategy_snapshots;
begin
  perform public._admin_growth_guard();
  if p_status not in ('approved','dismissed','resolved') then
    raise exception 'invalid status (approved/dismissed/resolved)' using errcode='22023';
  end if;
  if p_outcome is not null and p_outcome not in ('improved','neutral','degraded') then
    raise exception 'invalid outcome' using errcode='22023';
  end if;

  update public.strategy_snapshots
    set status = p_status, outcome = p_outcome, after_kpi = coalesce(p_after_kpi, after_kpi),
        resolved_by = auth.uid(), resolved_at = now()
    where id = p_id
    returning * into v_row;
  if v_row.id is null then raise exception 'not found' using errcode='P0002'; end if;
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_strategy_resolve(uuid, text, text, jsonb) to authenticated;

-- Strategy Learning 집계 — 상태 분포/Type별 성공률(Historical Failure 참고용). 자동 학습 없음.
create or replace function public.admin_strategy_learning(p_context_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_by_status jsonb; v_by_type jsonb; v_totals jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb) into v_by_status from (
    select status, count(*) cnt from public.strategy_snapshots
    where (p_context_key is null or context_key = p_context_key) group by status
  ) s;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.total desc), '[]'::jsonb) into v_by_type from (
    select strategy_type,
      count(*) as total,
      count(*) filter (where status in ('approved','resolved')) as approved,
      count(*) filter (where status='dismissed') as dismissed,
      count(*) filter (where outcome='improved') as improved,
      count(*) filter (where outcome='degraded') as degraded,
      round(avg(roi_score)::numeric,1) as avg_roi
    from public.strategy_snapshots
    where (p_context_key is null or context_key = p_context_key)
    group by strategy_type
  ) t;

  select to_jsonb(x) into v_totals from (
    select count(*) as total,
      count(*) filter (where status in ('approved','resolved')) as approved,
      count(*) filter (where status='dismissed') as dismissed,
      count(*) filter (where outcome is not null) as resolved_outcomes,
      count(*) filter (where outcome='improved') as improved,
      count(*) filter (where outcome='degraded') as degraded
    from public.strategy_snapshots
    where (p_context_key is null or context_key = p_context_key)
  ) x;

  return jsonb_build_object('context_key', p_context_key, 'by_status', v_by_status, 'by_type', v_by_type, 'totals', v_totals, 'generated_at', now());
end;
$$;
grant execute on function public.admin_strategy_learning(text) to authenticated;
