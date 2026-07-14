-- 0511_admin_ai_executive_strategy.sql
-- Phase AI-OPS-8 — Executive Intelligence, Business Strategy & Decision Intelligence Center.
--
-- 실제 경영 데이터 분석 결과(추측 없음):
--   MRR 실측: subscriptions(status in active/cancel_scheduled)의 current_amount 합(0474 분석
--     — 할인 후 실청구액). ARR = MRR×12 는 '추정' 명시.
--   매출 실측: payment_orders(status='paid', amount, paid_at). 정산 실측: artist_settlements
--     .final_payout_amount(0060). 계약 실측: artist_contracts(status/signed_at/expires_at, 0057).
--   활성 기업: users(account_type='business', withdrawn_at null). 활성 매장/플레이어/스트리밍
--     시간: playback_events_v2(distinct business_id/user_id, listened_seconds).
--   AI 추천 채택률: ai_operations(0504) approved/(approved+rejected) — 결정된 건 기준.
--   CAC/마케팅 비용: 데이터 없음 → cost_unknown. LTV: churn 실측 가능 시만 산출(순수 로직).
--
-- 원칙:
--   * AI 는 추천과 근거만 제공 — 자동 계약/정산/가격/요금제/플레이리스트 변경·자동 영업·
--     자동 의사결정 없음. 모든 Decision 은 사람이 사유와 함께 확정.
--   * 모든 추천은 Recommendation/Reason/Evidence/Confidence/Alternative/Expected Benefit/
--     Risk/Human Approval 포함(서버 검증).
--   * Daily Briefing 은 수동 생성(자동 스케줄/cron 미지원 — 정직 표기). 원본 미변경(집계만).
--   * 순이익은 '추정'(비용 데이터 없음 → cost_unknown 반영). Trigger 없음 · 삭제 RPC 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Executive Briefing — 실측 snapshot 저장(일자별 idempotent).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_briefings (
  id                  uuid primary key default gen_random_uuid(),
  briefing_date       date not null unique,
  snapshot            jsonb not null default '{}'::jsonb,   -- 실측 집계(생성 시점)
  highlights          jsonb not null default '[]'::jsonb,   -- 어제 대비/주요 계약/장애/위험/할 일
  recommendations_ref jsonb not null default '[]'::jsonb,   -- Top 추천 참조(실행 아님)
  limitations         jsonb not null default '["수동 생성 — 자동 스케줄 미지원","참고 자료 — 실제 조치 아님"]'::jsonb,
  generated_by        uuid,
  created_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Executive Decision — Explainable 추천 + 사람 결정(자동 의사결정 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_decisions (
  id                  uuid primary key default gen_random_uuid(),
  decision_code       text not null unique,
  category            text not null check (category in ('target_industry','target_brand','playlist_expansion','contract_renewal','region_focus','risk_priority','pricing_review','capacity_investment','manual')),
  recommendation      text not null,
  reason              text not null,
  evidence            jsonb not null default '[]'::jsonb,
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  alternatives        jsonb not null default '[]'::jsonb,
  expected_benefit    text not null,
  risk                text not null,
  decision_status     text not null default 'proposed' check (decision_status in ('proposed','under_review','approved_reference','rejected','deferred','expired','invalidated')),
  human_decision_reason text,
  decided_by          uuid,
  decided_at          timestamptz,
  limitations         jsonb not null default '["추천/근거만 — 자동 실행·자동 영업·자동 의사결정 없음"]'::jsonb,
  source_version      text not null default 'execstrat_v1(0511)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_dec on public.ai_executive_decisions (decision_status, created_at desc);

create table if not exists public.ai_executive_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('briefing_generated','decision_proposed','decision_reviewed','decision_approved_reference','decision_rejected','decision_deferred','scenario_evaluated','report_viewed_reference')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_evt on public.ai_executive_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 경영 지표 실측 집계(읽기 전용 — 원본 미변경).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_business_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_mrr numeric; v_rev_30d numeric; v_rev_prev_30d numeric;
begin
  perform public._admin_growth_guard();
  select coalesce(sum(current_amount), 0) into v_mrr from public.subscriptions where status in ('active','cancel_scheduled');
  select coalesce(sum(amount), 0) into v_rev_30d from public.payment_orders where status = 'paid' and paid_at >= now() - interval '30 days';
  select coalesce(sum(amount), 0) into v_rev_prev_30d from public.payment_orders where status = 'paid' and paid_at >= now() - interval '60 days' and paid_at < now() - interval '30 days';
  select jsonb_build_object(
    'mrr_actual', v_mrr,
    'arr_estimated', v_mrr * 12,                             -- 추정 — Actual 아님
    'revenue_30d', v_rev_30d,
    'revenue_prev_30d', v_rev_prev_30d,
    'revenue_mom_pct', case when v_rev_prev_30d > 0 then round((v_rev_30d - v_rev_prev_30d) / v_rev_prev_30d * 100, 1) end,  -- 이전 0 → null
    'net_profit', 'cost_unknown',                            -- 비용 데이터 없음 — 순이익 추정 불가
    'subscriptions_active', (select count(*) from public.subscriptions where status in ('active','cancel_scheduled')),
    'subscriptions_by_plan', (select coalesce(jsonb_object_agg(plan_type, n), '{}'::jsonb) from (select plan_type, count(*) n from public.subscriptions where status in ('active','cancel_scheduled') group by plan_type) x),
    'subscriptions_canceled', (select count(*) from public.subscriptions where status = 'canceled'),
    'churn_rate_pct', (select case when count(*) > 0 then round(count(*) filter (where status = 'canceled')::numeric / count(*) * 100, 1) end from public.subscriptions),
    'active_businesses', (select count(*) from public.users where account_type = 'business' and withdrawn_at is null),
    'active_artists', (select count(*) from public.users where account_type = 'artist' and withdrawn_at is null),
    'active_stores_30d', (select count(distinct business_id) from public.playback_events_v2 where created_at >= now() - interval '30 days'),
    'active_players_30d', (select count(distinct user_id) from public.playback_events_v2 where created_at >= now() - interval '30 days'),
    'streaming_hours_30d', (select round(coalesce(sum(listened_seconds), 0) / 3600.0, 1) from public.playback_events_v2 where created_at >= now() - interval '30 days'),
    'tracks_total', (select count(*) from public.tracks),
    'contracts_signed_total', (select count(*) from public.artist_contracts where status = 'signed'),
    'contracts_new_30d', (select count(*) from public.artist_contracts where signed_at >= now() - interval '30 days'),
    'contracts_pending', (select count(*) from public.artist_contracts where status = 'pending_signature'),
    'contracts_expiring_90d', (select count(*) from public.artist_contracts where status = 'signed' and expires_at is not null and expires_at < now() + interval '90 days'),
    'settlement_total_payout', (select coalesce(sum(final_payout_amount), 0) from public.artist_settlements),
    'ai_adoption_rate_pct', (select case when count(*) filter (where status in ('approved','rejected')) > 0
        then round(count(*) filter (where status = 'approved')::numeric / count(*) filter (where status in ('approved','rejected')) * 100, 1) end
      from public.ai_operations),                            -- 결정된 건 기준 — 없으면 null(insufficient)
    'generated_at', now()
  ) into v;
  return v;
end; $$;
grant execute on function public.admin_executive_business_summary() to authenticated;

create or replace function public.admin_executive_growth_series(p_months int default 6)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_months int := greatest(1, least(coalesce(p_months,6), 24)); v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'months', v_months,
    'new_businesses', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', n) order by m), '[]'::jsonb) from (
      select date_trunc('month', created_at)::date m, count(*) n from public.users where account_type = 'business' and created_at >= date_trunc('month', now()) - make_interval(months => v_months - 1) group by 1) x),
    'new_artists', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', n) order by m), '[]'::jsonb) from (
      select date_trunc('month', created_at)::date m, count(*) n from public.users where account_type = 'artist' and created_at >= date_trunc('month', now()) - make_interval(months => v_months - 1) group by 1) x),
    'new_tracks', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', n) order by m), '[]'::jsonb) from (
      select date_trunc('month', created_at)::date m, count(*) n from public.tracks where created_at >= date_trunc('month', now()) - make_interval(months => v_months - 1) group by 1) x),
    'new_signed_contracts', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'count', n) order by m), '[]'::jsonb) from (
      select date_trunc('month', signed_at)::date m, count(*) n from public.artist_contracts where signed_at >= date_trunc('month', now()) - make_interval(months => v_months - 1) group by 1) x),
    'monthly_paid_revenue', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'amount', a) order by m), '[]'::jsonb) from (
      select date_trunc('month', paid_at)::date m, sum(amount) a from public.payment_orders where status = 'paid' and paid_at >= date_trunc('month', now()) - make_interval(months => v_months - 1) group by 1) x),
    'growth_by_industry', (select coalesce(jsonb_agg(jsonb_build_object('industry', k, 'count', n) order by n desc), '[]'::jsonb) from (
      select coalesce(business_category, '(미분류)') k, count(*) n from public.users where account_type = 'business' and withdrawn_at is null group by 1 order by n desc limit 10) x),
    'generated_at', now()
  ) into v;
  return v;
end; $$;
grant execute on function public.admin_executive_growth_series(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Briefing 생성(수동 — 자동 스케줄 없음) / 조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_briefing_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_executive_briefings; v_snapshot jsonb;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 131072 then raise exception 'payload too large (128KB limit)' using errcode='22023'; end if;
  v_snapshot := public.admin_executive_business_summary();   -- 생성 시점 실측 집계
  insert into public.ai_executive_briefings (briefing_date, snapshot, highlights, recommendations_ref, generated_by)
  values (coalesce(nullif(p_payload->>'briefing_date','')::date, (now() at time zone 'Asia/Seoul')::date),
    v_snapshot, coalesce(p_payload->'highlights','[]'::jsonb), coalesce(p_payload->'recommendations_ref','[]'::jsonb), auth.uid())
  on conflict (briefing_date) do update set snapshot = excluded.snapshot, highlights = excluded.highlights,
    recommendations_ref = excluded.recommendations_ref, generated_by = auth.uid()
  returning * into v_row;
  insert into public.ai_executive_events(event_type, ref_id, detail, actor_id) values ('briefing_generated', v_row.id, v_row.briefing_date::text, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_executive_briefing_save(jsonb) to authenticated;

create or replace function public.admin_executive_briefings(p_limit int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,30), 100)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.briefing_date desc), '[]'::jsonb) into v_items from (
    select * from public.ai_executive_briefings order by briefing_date desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_executive_briefings(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Decision — Explainable 필수 검증 + 사람 결정.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_decision_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_executive_decisions; v_existing public.ai_executive_decisions; v_conf numeric;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  -- Explainable AI 필수: Recommendation/Reason/Evidence/Confidence/Alternative/Expected Benefit/Risk.
  if coalesce(p_payload->>'decision_code','') = '' or coalesce(p_payload->>'recommendation','') = '' or coalesce(p_payload->>'reason','') = ''
     or coalesce(p_payload->>'expected_benefit','') = '' or coalesce(p_payload->>'risk','') = '' or coalesce(p_payload->>'idempotency_key','') = '' then
    raise exception 'decision_code/recommendation/reason/expected_benefit/risk/idempotency_key 필수(Explainable)' using errcode='22023';
  end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if p_payload->'alternatives' is null or jsonb_array_length(coalesce(p_payload->'alternatives','[]'::jsonb)) = 0 then raise exception 'alternative required (대안 없는 추천 금지)' using errcode='22023'; end if;
  v_conf := nullif(p_payload->>'confidence','')::numeric;
  if v_conf is not null and (v_conf <> v_conf or v_conf < 0 or v_conf > 100) then raise exception 'confidence 0~100(NaN 금지)' using errcode='22023'; end if;
  select * into v_existing from public.ai_executive_decisions where idempotency_key = p_payload->>'idempotency_key';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'decision', to_jsonb(v_existing)); end if;
  insert into public.ai_executive_decisions (decision_code, category, recommendation, reason, evidence, confidence, alternatives, expected_benefit, risk, idempotency_key, created_by)
  values (p_payload->>'decision_code', coalesce(nullif(p_payload->>'category',''),'manual'), p_payload->>'recommendation', p_payload->>'reason',
    p_payload->'evidence', v_conf, p_payload->'alternatives', p_payload->>'expected_benefit', p_payload->>'risk',
    p_payload->>'idempotency_key', auth.uid())
  returning * into v_row;
  insert into public.ai_executive_events(event_type, ref_id, detail, actor_id) values ('decision_proposed', v_row.id, v_row.recommendation, auth.uid());
  return jsonb_build_object('idempotent', false, 'decision', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_executive_decision_save(jsonb) to authenticated;

create or replace function public.admin_executive_decision_decide(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_executive_decisions;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('under_review','approved_reference','rejected','deferred','expired','invalidated') then
    raise exception 'invalid status(자동 의사결정/실행 상태 없음)' using errcode='22023';
  end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (사유 없는 결정 금지 — Human Approval 필수)' using errcode='22023'; end if;
  select * into v_row from public.ai_executive_decisions where id = p_id;
  if v_row.id is null then raise exception 'decision not found' using errcode='P0002'; end if;
  if v_row.decision_status in ('rejected','expired','invalidated') then raise exception 'decision finalized' using errcode='22023'; end if;
  update public.ai_executive_decisions set decision_status = p_status, human_decision_reason = p_reason,
    decided_by = auth.uid(), decided_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_executive_events(event_type, ref_id, detail, actor_id)
  values (case p_status when 'approved_reference' then 'decision_approved_reference'
                        when 'rejected' then 'decision_rejected'
                        when 'deferred' then 'decision_deferred'
                        else 'decision_reviewed' end, p_id, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_executive_decision_decide(uuid, text, text) to authenticated;

create or replace function public.admin_executive_decisions(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_executive_decisions d where (p_status is null or d.decision_status = p_status)
    order by d.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_executive_decisions(text, int) to authenticated;

create or replace function public.admin_executive_audit(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_executive_events order by created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_executive_audit(int) to authenticated;
