-- 0420 — Phase ALGO-3: Settlement v2 Engine (Shadow Settlement)
--
-- 목적:
--   차세대 정산 엔진(v2)을 shadow 로 구축. Revenue Weight 기반 pro-rata + Explain + Audit.
--   실제 지급 미사용 (shadow only). ALGO-4 에서 전환 여부 결정.
--
-- 절대 원칙:
--   • v1 무변경: admin_generate_monthly_settlement / artist_settlements / settlement_items /
--     streaming_revenues / enterprise settlement / settlement UI 전부 그대로.
--   • additive only — 신규 테이블 4 + 신규 RPC. 기존 테이블/함수 drop·rename·alter 없음.
--   • v2 는 실제 payout 에 사용 금지. 계산·비교·설명(관측)만.
--   • stream_source 파라미터: 'v1_basis'(현 검증용 — v1 과 동일 eligible 기준) /
--     'v2_shadow'(v2_settlement_eligible_streams — shadow 누적 후 사용).

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블 (v2, immutable snapshot — 재실행 시 새 run/version, 기존 보존)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.settlement_generation_runs_v2 (
  id                    uuid primary key default gen_random_uuid(),
  settlement_month      date not null,
  run_at                timestamptz not null default now(),
  run_by                uuid,
  dry_run               boolean not null default true,
  stream_source         text not null default 'v1_basis',
  version               integer not null default 1,
  policy_id             uuid,
  policy_snapshot       jsonb,
  platform_revenue      bigint,
  pool_revenue          bigint,
  total_eligible_streams bigint,
  total_verified_streams bigint,
  total_revenue_weight  numeric,
  confidence_avg        numeric,
  artist_count          integer,
  fraud_count           bigint default 0,
  rejected_count        bigint default 0,
  player_type_breakdown jsonb,
  total_gross           bigint,
  total_company_fee     bigint,
  total_agent_fee       bigint,
  total_net             bigint,
  total_final           bigint,
  total_carried_over    bigint,
  notes                 text
);
create index if not exists sgr_v2_month_idx on public.settlement_generation_runs_v2(settlement_month, run_at desc);

create table if not exists public.artist_settlements_v2 (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null references public.settlement_generation_runs_v2(id) on delete cascade,
  settlement_month      date not null,
  artist_user_id        uuid not null,
  policy_id             uuid,
  eligible_stream_count bigint not null default 0,
  verified_stream_count bigint not null default 0,
  revenue_weight        numeric not null default 0,
  confidence_avg        numeric,
  gross_amount          bigint not null default 0,
  company_fee_amount    bigint not null default 0,
  agent_fee_amount      bigint not null default 0,
  agent_commission_rate numeric,
  adjustments_amount    bigint not null default 0,
  previous_carried_amount bigint not null default 0,
  artist_net_amount     bigint not null default 0,
  total_amount          bigint not null default 0,
  meets_min_payout      boolean not null default false,
  withholding_tax_amount bigint not null default 0,
  final_amount          bigint not null default 0,
  carried_over_amount   bigint not null default 0,
  explain_payload       jsonb,
  snapshot              jsonb,
  version               integer not null default 1,
  created_at            timestamptz not null default now()
);
create index if not exists as_v2_run_idx on public.artist_settlements_v2(run_id);
create index if not exists as_v2_month_artist_idx on public.artist_settlements_v2(settlement_month, artist_user_id);

create table if not exists public.settlement_items_v2 (
  id                    uuid primary key default gen_random_uuid(),
  settlement_v2_id      uuid not null references public.artist_settlements_v2(id) on delete cascade,
  run_id                uuid not null,
  artist_user_id        uuid not null,
  track_id              uuid,
  track_code            text,
  track_title           text,
  eligible_stream_count bigint not null default 0,
  revenue_weight        numeric not null default 0,
  pool_revenue_share    bigint not null default 0,
  created_at            timestamptz not null default now()
);
create index if not exists si_v2_settlement_idx on public.settlement_items_v2(settlement_v2_id);

create table if not exists public.streaming_revenues_v2 (
  id                    uuid primary key default gen_random_uuid(),
  run_id                uuid not null,
  revenue_month         date not null,
  artist_user_id        uuid not null,
  track_id              uuid,
  eligible_stream_count bigint not null default 0,
  revenue_weight        numeric not null default 0,
  total_pool_revenue    bigint,
  total_revenue_weight  numeric,
  gross_artist_amount   bigint,
  policy_id             uuid,
  computed_at           timestamptz not null default now()
);
create index if not exists sr_v2_run_idx on public.streaming_revenues_v2(run_id);

alter table public.settlement_generation_runs_v2 enable row level security;
alter table public.artist_settlements_v2 enable row level security;
alter table public.settlement_items_v2 enable row level security;
alter table public.streaming_revenues_v2 enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname='sgr_v2_admin_read') then create policy sgr_v2_admin_read on public.settlement_generation_runs_v2 for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='as_v2_admin_read') then create policy as_v2_admin_read on public.artist_settlements_v2 for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='si_v2_admin_read') then create policy si_v2_admin_read on public.settlement_items_v2 for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='sr_v2_admin_read') then create policy sr_v2_admin_read on public.streaming_revenues_v2 for select using (public._is_super_admin()); end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. Revenue Weight Engine (초기 계수 1 — 구조만. ALGO-5+ 에서 실계수)
--    weight = eligible × confidence × listening_quality × store_quality × track_eligibility
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._settlement_v2_revenue_weight(
  p_eligible numeric, p_confidence numeric default 1, p_listening_quality numeric default 1,
  p_store_quality numeric default 1, p_track_eligibility numeric default 1)
returns numeric
language sql immutable set search_path to 'public'
as $$
  select coalesce(p_eligible,0) * coalesce(p_confidence,1) * coalesce(p_listening_quality,1)
       * coalesce(p_store_quality,1) * coalesce(p_track_eligibility,1);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Shadow Generator (v1 무호출·무변경). stream_source 로 basis 선택.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_monthly_settlement_v2(
  p_month date, p_dry_run boolean default true, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_src text := case when p_stream_source in ('v1_basis','v2_shadow') then p_stream_source else 'v1_basis' end;
  v_policy record;
  v_month_start timestamptz; v_month_end timestamptz;
  v_platform_revenue bigint; v_pool bigint;
  v_total_streams bigint; v_total_weight numeric;
  v_run_id uuid; v_ver integer;
  v_artist record; v_track record; v_sales record;
  v_gross bigint; v_company bigint; v_agent bigint; v_net bigint; v_prev bigint; v_total bigint;
  v_meets boolean; v_tax bigint; v_final bigint; v_carry bigint;
  v_track_streams bigint; v_track_weight numeric; v_track_amt bigint;
  v_settle_id uuid;
  v_sum_gross bigint:=0; v_sum_company bigint:=0; v_sum_agent bigint:=0; v_sum_net bigint:=0; v_sum_final bigint:=0; v_sum_carry bigint:=0;
  v_artist_count int:=0;
  v_explain jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  select * into v_policy from public.settlement_policies where effective_from <= p_month order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'no settlement policy for %', p_month; end if;
  v_month_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  select coalesce(sum(po.amount),0)::bigint into v_platform_revenue
    from public.payment_orders po where po.status='paid' and po.settlement_period_month = p_month;
  v_pool := floor(v_platform_revenue * v_policy.pool_revenue_ratio);

  -- 다음 버전 번호
  select coalesce(max(version),0)+1 into v_ver from public.settlement_generation_runs_v2 where settlement_month=p_month;

  -- 월 eligible 스트림 집계 (source 별). 임시 결과를 temp 로.
  create temp table _elig(artist_user_id uuid, track_id uuid, eligible_count bigint) on commit drop;
  if v_src = 'v2_shadow' then
    insert into _elig
      select et.artist_user_id, s.track_id, count(*)
      from public.v2_settlement_eligible_streams s
      join public.eligible_settlement_tracks et on et.track_id = s.track_id
      where s.created_at >= v_month_start and s.created_at < v_month_end
      group by et.artist_user_id, s.track_id;
  else
    insert into _elig
      select et.artist_user_id, se.track_id, count(*)
      from public.stream_events se
      join public.eligible_settlement_tracks et on et.track_id = se.track_id
      where se.event_type='milestone_30s' and se.is_effective=true and se.eligible_for_payout=true
        and se.created_at >= v_month_start and se.created_at < v_month_end
      group by et.artist_user_id, se.track_id;
  end if;

  select coalesce(sum(eligible_count),0) into v_total_streams from _elig;
  select coalesce(sum(public._settlement_v2_revenue_weight(eligible_count)),0) into v_total_weight from _elig;

  insert into public.settlement_generation_runs_v2 (settlement_month, run_by, dry_run, stream_source, version, policy_id, policy_snapshot,
    platform_revenue, pool_revenue, total_eligible_streams, total_verified_streams, total_revenue_weight, confidence_avg, notes)
  values (p_month, v_uid, p_dry_run, v_src, v_ver, v_policy.id, to_jsonb(v_policy),
    v_platform_revenue, v_pool, v_total_streams, v_total_streams, v_total_weight, 1.0,
    'ALGO-3 shadow settlement v2. NOT used for payout.')
  returning id into v_run_id;

  for v_artist in select distinct artist_user_id from _elig loop
    v_gross := 0;
    -- 아티스트 gross = Σ track pro-rata (weight 기준)
    for v_track in
      select e.track_id, e.eligible_count, t.title, t.track_code
      from _elig e join public.tracks t on t.id = e.track_id
      where e.artist_user_id = v_artist.artist_user_id
    loop
      v_track_streams := v_track.eligible_count;
      v_track_weight := public._settlement_v2_revenue_weight(v_track_streams);
      if v_total_weight = 0 or v_track_weight = 0 then v_track_amt := 0;
      else v_track_amt := floor(v_pool::numeric * v_track_weight / v_total_weight)::bigint; end if;
      v_gross := v_gross + v_track_amt;
      if not p_dry_run then
        insert into public.streaming_revenues_v2 (run_id, revenue_month, artist_user_id, track_id, eligible_stream_count, revenue_weight, total_pool_revenue, total_revenue_weight, gross_artist_amount, policy_id)
        values (v_run_id, p_month, v_artist.artist_user_id, v_track.track_id, v_track_streams, v_track_weight, v_pool, v_total_weight, v_track_amt, v_policy.id);
      end if;
    end loop;

    v_company := floor(v_gross * v_policy.company_fee_ratio)::bigint;
    select u.sales_agent_id, sa.commission_rate, sa.code into v_sales
      from public.users u left join public.sales_agents sa on sa.id=u.sales_agent_id where u.id=v_artist.artist_user_id;
    v_agent := case when v_sales.commission_rate is not null then floor(v_gross * v_sales.commission_rate / 100.0)::bigint else 0 end;
    v_net := greatest(v_gross - v_company - v_agent, 0);

    -- shadow carryover: 직전 v2 미달분 (동일 source 최신 run)
    select coalesce(sum(carried_over_amount),0) into v_prev
      from public.artist_settlements_v2 a
      join public.settlement_generation_runs_v2 r on r.id=a.run_id and r.stream_source=v_src
      where a.artist_user_id=v_artist.artist_user_id and a.settlement_month < p_month
        and a.version = (select max(a2.version) from public.artist_settlements_v2 a2 where a2.artist_user_id=a.artist_user_id and a2.settlement_month=a.settlement_month);
    v_prev := coalesce(v_prev,0);
    v_total := v_net + v_prev;

    if v_total < v_policy.min_payout_amount then v_meets := false;
    elsif v_policy.min_payout_basis = 'gross' then v_meets := true;
    else v_meets := ((v_total - floor(v_total*v_policy.withholding_tax_ratio)) >= v_policy.min_payout_amount); end if;

    if v_meets then v_tax := floor(v_total*v_policy.withholding_tax_ratio)::bigint; v_final := greatest(v_total-v_tax,0); v_carry := 0;
    else v_tax := 0; v_final := 0; v_carry := v_total; end if;

    v_explain := jsonb_build_object(
      'revenue_pool', v_pool, 'total_eligible_streams', v_total_streams, 'total_revenue_weight', v_total_weight,
      'artist_eligible_streams', (select sum(eligible_count) from _elig where artist_user_id=v_artist.artist_user_id),
      'artist_revenue_weight', (select sum(public._settlement_v2_revenue_weight(eligible_count)) from _elig where artist_user_id=v_artist.artist_user_id),
      'artist_share_pct', case when v_total_weight=0 then 0 else round((select sum(public._settlement_v2_revenue_weight(eligible_count)) from _elig where artist_user_id=v_artist.artist_user_id)/v_total_weight*100,4) end,
      'steps', jsonb_build_array(
        jsonb_build_object('step','gross', 'value', v_gross, 'formula','floor(pool × artist_weight / total_weight)'),
        jsonb_build_object('step','company_fee','value', -v_company, 'rate', v_policy.company_fee_ratio),
        jsonb_build_object('step','agent_fee','value', -v_agent, 'rate', v_sales.commission_rate),
        jsonb_build_object('step','artist_net','value', v_net),
        jsonb_build_object('step','carryover','value', v_prev),
        jsonb_build_object('step','total','value', v_total),
        jsonb_build_object('step','min_payout_gate','value', v_meets, 'min', v_policy.min_payout_amount),
        jsonb_build_object('step','withholding_tax','value', -v_tax, 'rate', v_policy.withholding_tax_ratio),
        jsonb_build_object('step','final','value', v_final),
        jsonb_build_object('step','carried_over','value', v_carry)));

    if not p_dry_run then
      insert into public.artist_settlements_v2 (run_id, settlement_month, artist_user_id, policy_id,
        eligible_stream_count, verified_stream_count, revenue_weight, confidence_avg,
        gross_amount, company_fee_amount, agent_fee_amount, agent_commission_rate, adjustments_amount,
        previous_carried_amount, artist_net_amount, total_amount, meets_min_payout, withholding_tax_amount,
        final_amount, carried_over_amount, explain_payload, snapshot, version)
      values (v_run_id, p_month, v_artist.artist_user_id, v_policy.id,
        (select sum(eligible_count) from _elig where artist_user_id=v_artist.artist_user_id),
        (select sum(eligible_count) from _elig where artist_user_id=v_artist.artist_user_id),
        (select sum(public._settlement_v2_revenue_weight(eligible_count)) from _elig where artist_user_id=v_artist.artist_user_id), 1.0,
        v_gross, v_company, v_agent, v_sales.commission_rate, 0,
        v_prev, v_net, v_total, v_meets, v_tax, v_final, v_carry, v_explain, to_jsonb(v_policy), v_ver)
      returning id into v_settle_id;
      insert into public.settlement_items_v2 (settlement_v2_id, run_id, artist_user_id, track_id, track_code, track_title, eligible_stream_count, revenue_weight, pool_revenue_share)
        select v_settle_id, v_run_id, v_artist.artist_user_id, e.track_id, t.track_code, t.title, e.eligible_count,
               public._settlement_v2_revenue_weight(e.eligible_count),
               case when v_total_weight=0 then 0 else floor(v_pool::numeric*public._settlement_v2_revenue_weight(e.eligible_count)/v_total_weight)::bigint end
        from _elig e join public.tracks t on t.id=e.track_id where e.artist_user_id=v_artist.artist_user_id;
    end if;

    v_sum_gross:=v_sum_gross+v_gross; v_sum_company:=v_sum_company+v_company; v_sum_agent:=v_sum_agent+v_agent;
    v_sum_net:=v_sum_net+v_net; v_sum_final:=v_sum_final+v_final; v_sum_carry:=v_sum_carry+v_carry; v_artist_count:=v_artist_count+1;
  end loop;

  update public.settlement_generation_runs_v2 set artist_count=v_artist_count, total_gross=v_sum_gross,
    total_company_fee=v_sum_company, total_agent_fee=v_sum_agent, total_net=v_sum_net, total_final=v_sum_final, total_carried_over=v_sum_carry
   where id=v_run_id;

  return jsonb_build_object('ok',true,'run_id',v_run_id,'version',v_ver,'dry_run',p_dry_run,'stream_source',v_src,
    'settlement_month',p_month,'platform_revenue',v_platform_revenue,'pool_revenue',v_pool,
    'total_eligible_streams',v_total_streams,'total_revenue_weight',v_total_weight,'artist_count',v_artist_count,
    'total_gross',v_sum_gross,'total_company_fee',v_sum_company,'total_agent_fee',v_sum_agent,
    'total_net',v_sum_net,'total_final',v_sum_final,'total_carried_over',v_sum_carry,
    'note','SHADOW ONLY — not used for payout');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Compare v1 vs v2 (관리자 조회). 최신 v2 run vs 저장된 v1 artist_settlements.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_v2_compare(p_month date, p_stream_source text default 'v1_basis')
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.settlement_generation_runs_v2 where settlement_month=p_month and stream_source=coalesce(p_stream_source,'v1_basis') order by version desc limit 1;

  select jsonb_build_object(
    'settlement_month', p_month, 'v2_run_id', v_run,
    'summary', (select jsonb_build_object(
        'v1_gross', coalesce(sum(v1.gross_settlement_amount),0), 'v2_gross', coalesce(sum(v2.gross_amount),0),
        'v1_net', coalesce(sum(v1.artist_net_settlement),0), 'v2_net', coalesce(sum(v2.artist_net_amount),0),
        'v1_final', coalesce(sum(v1.final_payout_amount),0), 'v2_final', coalesce(sum(v2.final_amount),0),
        'artists_v1', count(distinct v1.artist_user_id), 'artists_v2', count(distinct v2.artist_user_id),
        'net_match_count', count(*) filter (where coalesce(v1.artist_net_settlement,0)=coalesce(v2.artist_net_amount,0)),
        'net_diff_count', count(*) filter (where coalesce(v1.artist_net_settlement,0)<>coalesce(v2.artist_net_amount,0)))
      from public.artist_settlements v1
      full outer join public.artist_settlements_v2 v2
        on v2.artist_user_id=v1.artist_user_id and v2.settlement_month=v1.settlement_month and v2.run_id=v_run
      where coalesce(v1.settlement_month,p_month)=p_month),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'artist_user_id', coalesce(v1.artist_user_id,v2.artist_user_id),
        'v1_gross', v1.gross_settlement_amount, 'v2_gross', v2.gross_amount,
        'v1_net', v1.artist_net_settlement, 'v2_net', v2.artist_net_amount,
        'v1_final', v1.final_payout_amount, 'v2_final', v2.final_amount,
        'net_diff', coalesce(v2.artist_net_amount,0)-coalesce(v1.artist_net_settlement,0)) order by abs(coalesce(v2.artist_net_amount,0)-coalesce(v1.artist_net_settlement,0)) desc), '[]'::jsonb)
      from public.artist_settlements v1
      full outer join public.artist_settlements_v2 v2
        on v2.artist_user_id=v1.artist_user_id and v2.settlement_month=v1.settlement_month and v2.run_id=v_run
      where coalesce(v1.settlement_month,p_month)=p_month)
  ) into v;
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Overview + Explain (관리자 조회)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_v2_overview(p_month date default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_run public.settlement_generation_runs_v2%rowtype; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into v_run from public.settlement_generation_runs_v2
    where (p_month is null or settlement_month=p_month) order by run_at desc limit 1;
  if not found then return jsonb_build_object('has_data', false); end if;
  v := jsonb_build_object('has_data', true, 'run', to_jsonb(v_run),
    'top_artists', (select coalesce(jsonb_agg(jsonb_build_object('id',id,'artist_user_id',artist_user_id,'gross',gross_amount,'net',artist_net_amount,'final',final_amount,'eligible',eligible_stream_count) order by gross_amount desc), '[]'::jsonb)
      from (select * from public.artist_settlements_v2 where run_id=v_run.id order by gross_amount desc limit 20) x));
  return v;
end;
$$;

create or replace function public.admin_get_settlement_v2_explain(p_settlement_v2_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select jsonb_build_object('settlement', to_jsonb(a), 'explain', a.explain_payload,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('track_id',i.track_id,'track_title',i.track_title,'eligible',i.eligible_stream_count,'weight',i.revenue_weight,'share',i.pool_revenue_share) order by i.pool_revenue_share desc),'[]'::jsonb) from public.settlement_items_v2 i where i.settlement_v2_id=a.id))
    into v from public.artist_settlements_v2 a where a.id=p_settlement_v2_id;
  if v is null then raise exception 'settlement v2 not found'; end if;
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- F. 권한 (전부 super_admin)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_generate_monthly_settlement_v2(date,boolean,text)',
    'public.admin_settlement_v2_compare(date,text)',
    'public.admin_settlement_v2_overview(date)',
    'public.admin_get_settlement_v2_explain(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.artist_settlements_v2 is
  'ALGO-3 — Shadow Settlement v2. Revenue-weight pro-rata + Explain payload. 실제 지급 미사용(관측/비교). v1 artist_settlements 무변경.';
comment on function public.admin_generate_monthly_settlement_v2(date,boolean,text) is
  'ALGO-3 — Shadow Settlement Generator v2. stream_source: v1_basis(검증)/v2_shadow. 실 payout 미사용. v1 함수 무호출.';
