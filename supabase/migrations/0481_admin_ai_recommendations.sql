-- ============================================
-- 0481_admin_ai_recommendations.sql
--
-- Phase AI-RECOMMENDATION-1 — AI Recommendation Engine.
--
-- Recommendation Feed 는 **실시간으로 기존 KPI 를 재사용해 계산**한다(새 KPI 생성 없음,
-- LLM 추론 없음). 이 마이그레이션은 **추천 계산 로직을 만들지 않는다** — 오직 관리자의
-- 결정(Dismiss/Resolve)과 이력(History)을 저장하는 스냅샷 레지스트리만 추가한다.
--
-- 절대 조건 준수:
--   - 기존 Dashboard/KPI/RPC/Action Center/Automation 무변경(재사용만).
--   - Evidence(근거 KPI) 없는 추천 저장 불가 — set_state 는 evidence 스냅샷 필수.
--   - Confidence 는 데이터 충족률(0~100), NaN/Infinity 금지(numeric clamp).
--   - 추천 실행은 기존 Action Center Command/Dashboard 링크 재사용(여기서 실행 안 함).
--
-- 흐름:
--   1) 프론트가 기존 KPI 로 추천을 실시간 계산(Feed) — DB 무관.
--   2) 관리자가 Dismiss/Resolve → admin_recommendation_set_state 로 스냅샷 기록.
--   3) Feed 는 admin_recommendation_active_states(오늘 처리된 rule_key)로 숨김 처리.
--   ※ 동일 rule_key 는 KST 일자 단위로 1행(upsert) — 중복 이력 방지.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

create table if not exists public.admin_ai_recommendations (
  id           uuid primary key default gen_random_uuid(),
  rule_key     text not null,
  gen_date     date not null,                 -- KST 기준 생성 일자
  category     text not null check (category in ('member','revenue','artist','business','streaming','operations','system','automation')),
  priority     text not null check (priority in ('critical','high','medium','low','info')),
  confidence   numeric not null default 0 check (confidence >= 0 and confidence <= 100),
  score        int not null default 0 check (score >= 0 and score <= 100),
  title        text not null,
  message      text,
  evidence     jsonb not null,                -- 근거 KPI 스냅샷(필수)
  action_ref   text,                          -- Action Center action id 또는 dashboard 링크 키
  state        text not null check (state in ('dismissed','resolved')),
  command_id   uuid,                          -- 관련 Action Command(선택)
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (rule_key, gen_date)
);

comment on table public.admin_ai_recommendations is
  'AI-RECOMMENDATION-1 — 추천 결정(Dismiss/Resolve) 스냅샷/이력. 추천 계산은 프론트가 기존 KPI 재사용; 이 표는 관리자 결정만 저장.';

create index if not exists idx_ai_reco_created_at on public.admin_ai_recommendations (created_at desc);
create index if not exists idx_ai_reco_category on public.admin_ai_recommendations (category);

-- ─────────────────────────────────────────────────────────────────────────
-- 관리자 결정 기록(Dismiss/Resolve). evidence 필수 — 근거 없는 추천 저장 거부.
-- 동일 rule_key 의 오늘(KST) 스냅샷을 upsert.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_set_state(
  p_rule_key   text,
  p_category   text,
  p_priority   text,
  p_confidence numeric,
  p_score      int,
  p_title      text,
  p_message    text,
  p_evidence   jsonb,
  p_action_ref text,
  p_state      text,
  p_command_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_conf numeric := least(100, greatest(0, coalesce(p_confidence, 0)));
  v_score int := least(100, greatest(0, coalesce(p_score, 0)));
  v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  perform public._admin_growth_guard();

  if coalesce(p_rule_key,'') = '' then
    raise exception 'rule_key required' using errcode = '22023';
  end if;
  if p_state not in ('dismissed','resolved') then
    raise exception 'invalid state: %', p_state using errcode = '22023';
  end if;
  if p_category not in ('member','revenue','artist','business','streaming','operations','system','automation') then
    raise exception 'invalid category: %', p_category using errcode = '22023';
  end if;
  if p_priority not in ('critical','high','medium','low','info') then
    raise exception 'invalid priority: %', p_priority using errcode = '22023';
  end if;
  -- 근거(Evidence) 없는 추천 저장 금지.
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then
    raise exception 'evidence required (근거 없는 추천 저장 금지)' using errcode = '22023';
  end if;

  insert into public.admin_ai_recommendations(
    rule_key, gen_date, category, priority, confidence, score, title, message, evidence, action_ref, state, command_id, created_by, updated_at
  ) values (
    p_rule_key, v_today, p_category, p_priority, v_conf, v_score, p_title, p_message, p_evidence, nullif(p_action_ref,''), p_state, p_command_id, auth.uid(), now()
  )
  on conflict (rule_key, gen_date) do update set
    state = excluded.state, priority = excluded.priority, confidence = excluded.confidence, score = excluded.score,
    title = excluded.title, message = excluded.message, evidence = excluded.evidence, action_ref = excluded.action_ref,
    command_id = coalesce(excluded.command_id, public.admin_ai_recommendations.command_id), updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'state', p_state);
end;
$$;

grant execute on function public.admin_recommendation_set_state(text, text, text, numeric, int, text, text, jsonb, text, text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 오늘(KST) 처리된 rule_key/state — Feed 에서 dismissed/resolved 숨김용.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_active_states()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_object_agg(rule_key, state), '{}'::jsonb)
  into v_result
  from public.admin_ai_recommendations
  where gen_date = (now() at time zone 'Asia/Seoul')::date;
  return jsonb_build_object('states', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_recommendation_active_states() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 추천 이력(History). category 필터.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recommendation_history(
  p_limit int default 50,
  p_category text default null
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
    select r.id, r.rule_key, r.gen_date, r.category, r.priority, r.confidence, r.score,
           r.title, r.message, r.evidence, r.action_ref, r.state, r.command_id,
           r.created_at, r.updated_at, u.nickname as created_by_name
    from public.admin_ai_recommendations r
    left join public.users u on u.id = r.created_by
    where p_category is null or r.category = p_category
    order by r.created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_recommendation_history(int, text) to authenticated;
