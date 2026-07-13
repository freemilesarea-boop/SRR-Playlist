-- ============================================
-- 0483_admin_recommendation_decision.sql
--
-- Phase AI-RECOMMENDATION-3 — Decision Intelligence & Adaptive Recommendation Ranking.
--
-- 추천 우선순위를 **실제 운영 결과(Outcome)** 기반으로 동적 계산한다. AI/LLM 이 순위를
-- 임의로 바꾸지 않으며, 순위 계산은 프론트 decisionIntel.ts(순수 로직)가 수행한다.
-- 이 마이그레이션은 **Rule/Threshold/Weight 를 자동 변경하지 않는다** — 오직:
--   1) recommendation_ranking_snapshots — 순위 스냅샷 저장(Ranking History; 선택)
--   2) admin_recommendation_decision_stats — 기존 outcomes(0482) + history(0481) 집계
--      (새 KPI/계산 없음; 원자료 count 만 반환 → 프론트가 순위/신뢰도 계산)
--
-- 절대 조건:
--   - 기존 Recommendation Rule/KPI/Root Cause/Outcome/Action/Automation 무변경(재사용만).
--   - History 없는 추천을 자동으로 상위로 올리지 않는다(집계는 사실 count 만 제공).
--   - 자동 Rule/Threshold/Weight 변경 없음(순위 계산 전용).
--   - SECURITY DEFINER + search_path 고정 + 관리자 가드 + 입력 검증 + clamp.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Ranking 스냅샷(우선순위 변화 이력용; 선택 저장). KST 일자 단위 upsert.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.recommendation_ranking_snapshots (
  id            uuid primary key default gen_random_uuid(),
  snapshot_date date not null,
  rankings      jsonb not null,     -- [{rule_key,score,rank,confidence,...}]
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (snapshot_date)
);

comment on table public.recommendation_ranking_snapshots is
  'AI-RECOMMENDATION-3 — 추천 우선순위 스냅샷(Ranking History). 순위 계산은 프론트(실제 Outcome 기반); 이 표는 이력만.';

create index if not exists idx_reco_ranking_date on public.recommendation_ranking_snapshots (snapshot_date desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Ranking 스냅샷 저장(rankings 배열 필수).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_ranking_save(p_rankings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  perform public._admin_growth_guard();

  if p_rankings is null or jsonb_typeof(p_rankings) <> 'array' or jsonb_array_length(p_rankings) = 0 then
    raise exception 'rankings must be a non-empty jsonb array' using errcode = '22023';
  end if;

  insert into public.recommendation_ranking_snapshots(snapshot_date, rankings, created_by, updated_at)
  values (v_today, p_rankings, auth.uid(), now())
  on conflict (snapshot_date) do update
    set rankings = excluded.rankings, updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'snapshot_date', v_today);
end;
$$;

grant execute on function public.admin_recommendation_ranking_save(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Ranking 스냅샷 이력(최근 N일).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_ranking_history(p_days int default 90)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 90), 365));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.snapshot_date desc), '[]'::jsonb)
  into v_result
  from (
    select s.snapshot_date, s.rankings, s.updated_at
    from public.recommendation_ranking_snapshots s
    where s.snapshot_date >= ((now() at time zone 'Asia/Seoul')::date - v_days)
    order by s.snapshot_date desc
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_recommendation_ranking_history(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Decision Stats — 기존 outcomes(0482) + history(0481) 를 recommendation_key 별
--    집계. **원자료 count 만** 반환한다(순위/신뢰도 계산은 프론트). 새 KPI 없음.
--    considered = history 기록 수, executed/improved/... = outcomes.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_decision_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  with oc as (
    select o.recommendation_key as key,
           count(*) filter (where o.outcome_status <> 'pending') as executed,
           count(*) filter (where o.outcome_status = 'improved') as improved,
           count(*) filter (where o.outcome_status = 'unchanged') as unchanged,
           count(*) filter (where o.outcome_status = 'worsened') as worsened,
           count(*) filter (where o.outcome_status = 'insufficient_data') as insufficient,
           count(*) filter (where o.outcome_status = 'pending') as pending,
           round(avg(o.delta) filter (where o.outcome_status <> 'pending')::numeric, 2) as avg_delta,
           max(o.updated_at) as last_outcome_at
    from public.recommendation_outcomes o
    group by o.recommendation_key
  ),
  hi as (
    select r.rule_key as key,
           count(*) as considered,
           count(*) filter (where r.state = 'dismissed') as dismissed,
           count(*) filter (where r.state = 'resolved') as resolved,
           max(r.created_at) as last_history_at
    from public.admin_ai_recommendations r
    group by r.rule_key
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.executed desc nulls last, t.considered desc nulls last), '[]'::jsonb)
  into v_result
  from (
    select coalesce(oc.key, hi.key) as recommendation_key,
           coalesce(hi.considered, 0) as considered,
           coalesce(hi.dismissed, 0) as dismissed,
           coalesce(hi.resolved, 0) as resolved,
           coalesce(oc.executed, 0) as executed,
           coalesce(oc.improved, 0) as improved,
           coalesce(oc.unchanged, 0) as unchanged,
           coalesce(oc.worsened, 0) as worsened,
           coalesce(oc.insufficient, 0) as insufficient,
           coalesce(oc.pending, 0) as pending,
           oc.avg_delta,
           case when coalesce(oc.improved,0) + coalesce(oc.unchanged,0) + coalesce(oc.worsened,0) > 0
                then round(100.0 * coalesce(oc.improved,0)
                     / (coalesce(oc.improved,0) + coalesce(oc.unchanged,0) + coalesce(oc.worsened,0)), 1)
                else null end as success_rate,
           greatest(coalesce(oc.last_outcome_at, 'epoch'::timestamptz), coalesce(hi.last_history_at, 'epoch'::timestamptz)) as last_at
    from oc
    full outer join hi on oc.key = hi.key
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_recommendation_decision_stats() to authenticated;
