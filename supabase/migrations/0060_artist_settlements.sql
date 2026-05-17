-- ============================================
-- 0060_artist_settlements.sql
--
-- Phase 4 Step 2: 아티스트 정산서 본체 + immutability + RPC 8개
--
-- 안전 보장 (3중 + 4중):
--   - DB UNIQUE(month, artist) 제약
--   - pg_advisory_xact_lock per month (동시 실행 차단)
--   - status guard (pending 만 덮어씀)
--   - settlement_items 영구 immutable
--   - paid status 영구 immutable
--   - calculated 컬럼 변경 차단
--
-- 계좌번호 정책:
--   - artist_settlements 는 masked_account_number 만 snapshot (원본 X)
--   - 원본은 artist_payout_accounts 에만 (FK 로 참조)
-- ============================================

-- ----------------------
-- 1) artist_settlements 테이블
-- ----------------------
create table if not exists public.artist_settlements (
  id uuid primary key default gen_random_uuid(),
  settlement_month date not null,                 -- KST 월 1일
  artist_user_id uuid not null references public.users(id) on delete restrict,
  policy_id uuid not null references public.settlement_policies(id) on delete restrict,

  -- 산정 컬럼 (모두 양수)
  gross_settlement_amount bigint not null check (gross_settlement_amount >= 0),
  company_fee_amount bigint not null check (company_fee_amount >= 0),
  sales_agent_id uuid references public.sales_agents(id) on delete set null,
  sales_agent_commission_rate numeric(5,2),                          -- snapshot %
  sales_agent_fee_amount bigint not null default 0 check (sales_agent_fee_amount >= 0),
  artist_net_settlement bigint not null check (artist_net_settlement >= 0),
  previous_carried_amount bigint not null default 0 check (previous_carried_amount >= 0),
  total_settlement_amount bigint not null check (total_settlement_amount >= 0),

  -- 지급 판정
  meets_min_payout boolean not null,
  withholding_tax_amount bigint not null default 0 check (withholding_tax_amount >= 0),
  final_payout_amount bigint not null default 0 check (final_payout_amount >= 0),
  carried_over_amount bigint not null default 0 check (carried_over_amount >= 0),

  -- 계좌 snapshot (masked 만)
  payout_account_id uuid references public.artist_payout_accounts(id) on delete set null,
  payout_bank_name text,
  payout_account_holder text,
  masked_account_number text,

  -- 상태
  status text not null default 'pending'
    check (status in ('pending','carried_over','payable','paid','held','disputed')),
  finalized_at timestamptz,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  payout_memo text,
  held_reason text,
  dispute_reason text,
  adjustment_of_settlement_id uuid references public.artist_settlements(id) on delete set null,

  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(settlement_month, artist_user_id)
);

create index if not exists idx_artist_settlements_month
  on public.artist_settlements(settlement_month desc);
create index if not exists idx_artist_settlements_artist
  on public.artist_settlements(artist_user_id, settlement_month desc);
create index if not exists idx_artist_settlements_status
  on public.artist_settlements(status, settlement_month desc);

-- updated_at 트리거
drop trigger if exists trg_artist_settlements_updated_at on public.artist_settlements;
create trigger trg_artist_settlements_updated_at
  before update on public.artist_settlements
  for each row execute function public._touch_updated_at();

-- ----------------------
-- 2) settlement_items — INSERT only (영구 immutable)
-- ----------------------
create table if not exists public.settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.artist_settlements(id) on delete restrict,
  artist_user_id uuid not null,
  track_id uuid references public.tracks(id) on delete restrict,
  track_code text not null,
  track_title text not null,
  stream_count integer not null check (stream_count >= 0),
  pool_revenue_share bigint not null check (pool_revenue_share >= 0),
  computed_at timestamptz not null default now()
);

create index if not exists idx_settlement_items_settlement
  on public.settlement_items(settlement_id);
create index if not exists idx_settlement_items_artist
  on public.settlement_items(artist_user_id);

-- ----------------------
-- 3) settlement_generation_runs — 정산 실행 audit log
-- ----------------------
create table if not exists public.settlement_generation_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  run_by uuid references public.users(id) on delete set null,
  settlement_month date not null,
  dry_run boolean not null,
  policy_id uuid references public.settlement_policies(id) on delete set null,
  platform_revenue bigint,
  pool_revenue bigint,
  total_pool_streams bigint,
  generated_count integer not null default 0,
  overwritten_count integer not null default 0,
  skipped_count integer not null default 0,
  payable_count integer not null default 0,
  carried_over_count integer not null default 0,
  total_gross bigint not null default 0,
  total_company_fee bigint not null default 0,
  total_sales_agent_fee bigint not null default 0,
  total_final_payout bigint not null default 0,
  total_carried_over bigint not null default 0,
  skipped_artists jsonb,           -- [{artist_user_id, status, reason}, ...]
  error_message text
);

create index if not exists idx_settlement_runs_month
  on public.settlement_generation_runs(settlement_month desc, run_at desc);

-- generation_runs 도 append-only
create or replace function public._settlement_runs_protect()
returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') then
    raise exception 'settlement_generation_runs is append-only' using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_settlement_runs_protect on public.settlement_generation_runs;
create trigger trg_settlement_runs_protect
  before update or delete on public.settlement_generation_runs
  for each row execute function public._settlement_runs_protect();

-- ----------------------
-- 4) Immutability 트리거 — 모든 보호 로직 한 함수에
-- ----------------------
create or replace function public._artist_settlements_protect()
returns trigger language plpgsql as $$
declare
  v_immutable_calc_changed boolean;
begin
  -- DELETE: paid 는 영구 차단. pending 만 RPC 가 DELETE 가능 (advisory lock 내에서)
  if TG_OP = 'DELETE' then
    if OLD.status = 'paid' then
      raise exception 'paid settlement cannot be deleted (id=%)', OLD.id using errcode = '42501';
    end if;
    return OLD;
  end if;

  -- UPDATE: status 별 분기
  -- 1) paid 는 모든 컬럼 UPDATE 차단
  if OLD.status = 'paid' then
    raise exception 'paid settlement is immutable (id=%)', OLD.id using errcode = '42501';
  end if;

  -- 2) settlement_month / artist_user_id / policy_id 는 INSERT 후 변경 절대 금지
  if NEW.settlement_month <> OLD.settlement_month then
    raise exception 'cannot change settlement_month of settlement %', OLD.id using errcode = '42501';
  end if;
  if NEW.artist_user_id <> OLD.artist_user_id then
    raise exception 'cannot change artist_user_id of settlement %', OLD.id using errcode = '42501';
  end if;
  if NEW.policy_id <> OLD.policy_id then
    raise exception 'cannot change policy_id of settlement %', OLD.id using errcode = '42501';
  end if;

  -- 3) finalized 이후 (status != 'pending') 계산 컬럼 변경 차단
  v_immutable_calc_changed :=
    NEW.gross_settlement_amount    is distinct from OLD.gross_settlement_amount or
    NEW.company_fee_amount         is distinct from OLD.company_fee_amount      or
    NEW.sales_agent_fee_amount     is distinct from OLD.sales_agent_fee_amount  or
    NEW.artist_net_settlement      is distinct from OLD.artist_net_settlement   or
    NEW.previous_carried_amount    is distinct from OLD.previous_carried_amount or
    NEW.total_settlement_amount    is distinct from OLD.total_settlement_amount or
    NEW.withholding_tax_amount     is distinct from OLD.withholding_tax_amount  or
    NEW.final_payout_amount        is distinct from OLD.final_payout_amount     or
    NEW.carried_over_amount        is distinct from OLD.carried_over_amount     or
    NEW.meets_min_payout           is distinct from OLD.meets_min_payout;

  if OLD.status <> 'pending' and v_immutable_calc_changed then
    raise exception 'cannot change calculated amounts after finalize (id=%, status=%)',
      OLD.id, OLD.status using errcode = '42501';
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_artist_settlements_protect on public.artist_settlements;
create trigger trg_artist_settlements_protect
  before update or delete on public.artist_settlements
  for each row execute function public._artist_settlements_protect();

-- settlement_items: UPDATE 영구 차단. DELETE 는 settlement.status='pending' 일 때만
create or replace function public._settlement_items_protect()
returns trigger language plpgsql as $$
declare
  v_parent_status text;
begin
  if TG_OP = 'UPDATE' then
    raise exception 'settlement_items is immutable (id=%)', OLD.id using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then
    select status into v_parent_status from public.artist_settlements where id = OLD.settlement_id;
    if v_parent_status is not null and v_parent_status <> 'pending' then
      raise exception 'cannot delete settlement_items of finalized settlement (parent_status=%)',
        v_parent_status using errcode = '42501';
    end if;
    return OLD;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_settlement_items_protect on public.settlement_items;
create trigger trg_settlement_items_protect
  before update or delete on public.settlement_items
  for each row execute function public._settlement_items_protect();

-- streaming_revenues: 동일 — pending settlement 와 연결됐을 때만 변경 가능
-- (실용적으로는 RPC 가 DELETE+INSERT 하므로 UPDATE 차단만)
create or replace function public._streaming_revenues_protect()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    raise exception 'streaming_revenues is immutable (id=%)', OLD.id using errcode = '42501';
  end if;
  -- DELETE 는 RPC 가 advisory lock 내에서만 호출 — 차단 안 함
  return NEW;
end;
$$;

drop trigger if exists trg_streaming_revenues_protect on public.streaming_revenues;
create trigger trg_streaming_revenues_protect
  before update on public.streaming_revenues
  for each row execute function public._streaming_revenues_protect();

-- ----------------------
-- 5) RLS
-- ----------------------
alter table public.artist_settlements enable row level security;
alter table public.settlement_items enable row level security;
alter table public.settlement_generation_runs enable row level security;

drop policy if exists "artist_settlements_select_self" on public.artist_settlements;
create policy "artist_settlements_select_self" on public.artist_settlements
  for select using (artist_user_id = auth.uid());

drop policy if exists "artist_settlements_admin_all" on public.artist_settlements;
create policy "artist_settlements_admin_all" on public.artist_settlements
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "settlement_items_select_self" on public.settlement_items;
create policy "settlement_items_select_self" on public.settlement_items
  for select using (artist_user_id = auth.uid());

drop policy if exists "settlement_items_admin_all" on public.settlement_items;
create policy "settlement_items_admin_all" on public.settlement_items
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

drop policy if exists "settlement_runs_admin_all" on public.settlement_generation_runs;
create policy "settlement_runs_admin_all" on public.settlement_generation_runs
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 6) admin_generate_monthly_settlement — 메인 RPC
-- ----------------------
create or replace function public.admin_generate_monthly_settlement(
  p_month date,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_policy record;
  v_platform_revenue bigint;
  v_pool_revenue bigint;
  v_total_streams bigint;
  v_artist record;
  v_existing record;
  v_payout record;
  v_sales_agent record;
  v_gross bigint;
  v_company_fee bigint;
  v_agent_fee bigint;
  v_artist_net bigint;
  v_prev_carried bigint;
  v_total bigint;
  v_meets_min boolean;
  v_withholding bigint;
  v_final_payout bigint;
  v_carried_over bigint;
  v_status text;
  v_settlement_id uuid;
  v_track record;
  v_track_streams int;
  v_track_amount bigint;
  v_generated int := 0;
  v_overwritten int := 0;
  v_skipped int := 0;
  v_payable int := 0;
  v_carried_count int := 0;
  v_sum_gross bigint := 0;
  v_sum_company bigint := 0;
  v_sum_agent bigint := 0;
  v_sum_final bigint := 0;
  v_sum_carried bigint := 0;
  v_skipped_arr jsonb := '[]'::jsonb;
  v_run_id uuid;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  -- 동시 실행 차단 — 같은 월 1회만
  perform pg_advisory_xact_lock(hashtext('settlement_gen:' || p_month::text));

  -- 정책: effective_from <= p_month 중 가장 최근
  select * into v_policy
  from public.settlement_policies
  where effective_from <= p_month
  order by effective_from desc
  limit 1;
  if v_policy.id is null then
    raise exception 'no settlement policy effective for %', p_month;
  end if;

  -- KST 월 경계 (timestamptz)
  v_month_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  -- [1단계] 플랫폼 월 순매출 (paid status, KST 월 기준)
  select coalesce(sum(po.amount), 0)::bigint into v_platform_revenue
  from public.payment_orders po
  where po.status = 'paid'
    and coalesce(po.paid_at, po.created_at) >= v_month_start
    and coalesce(po.paid_at, po.created_at) <  v_month_end;

  -- [2단계] 분배 풀
  v_pool_revenue := floor(v_platform_revenue * v_policy.pool_revenue_ratio);

  -- [3단계] 전체 유효 스트림 (eligible 트랙만, milestone_30s)
  select coalesce(count(*), 0)::bigint into v_total_streams
  from public.stream_events se
  join public.eligible_settlement_tracks et on et.track_id = se.track_id
  where se.event_type = 'milestone_30s'
    and se.created_at >= v_month_start
    and se.created_at <  v_month_end;

  -- 직전월 정산 누락 경고 — block 안 함, runs 에 기록
  -- (운영자가 첫 정산 / 건너뛰기 의도일 수 있음)

  -- [4-9단계] 아티스트별 루프
  for v_artist in
    select et.artist_user_id, count(distinct et.track_id) as track_count
    from public.eligible_settlement_tracks et
    where exists (
      select 1 from public.stream_events se
      where se.track_id = et.track_id
        and se.event_type = 'milestone_30s'
        and se.created_at >= v_month_start
        and se.created_at <  v_month_end
    )
    group by et.artist_user_id
  loop
    -- 기존 정산 확인 (status guard)
    select id, status into v_existing
    from public.artist_settlements
    where settlement_month = p_month and artist_user_id = v_artist.artist_user_id;

    if v_existing.id is not null and v_existing.status <> 'pending' then
      -- 절대 수정 금지 — skip
      v_skipped := v_skipped + 1;
      v_skipped_arr := v_skipped_arr || jsonb_build_object(
        'artist_user_id', v_artist.artist_user_id,
        'existing_status', v_existing.status,
        'reason', 'finalized_or_paid — cannot overwrite'
      );
      continue;
    end if;

    -- [4단계] 트랙별 gross 계산 + [5단계] 합산
    v_gross := 0;
    for v_track in
      select et.track_id, et.track_code, t.title as track_title
      from public.eligible_settlement_tracks et
      join public.tracks t on t.id = et.track_id
      where et.artist_user_id = v_artist.artist_user_id
    loop
      select coalesce(count(*), 0)::int into v_track_streams
      from public.stream_events se
      where se.track_id = v_track.track_id
        and se.event_type = 'milestone_30s'
        and se.created_at >= v_month_start
        and se.created_at <  v_month_end;

      if v_track_streams = 0 or v_total_streams = 0 then
        v_track_amount := 0;
      else
        v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
      end if;

      v_gross := v_gross + v_track_amount;

      -- streaming_revenues UPSERT (snapshot)
      if not p_dry_run then
        insert into public.streaming_revenues (
          revenue_month, artist_user_id, track_id, track_code,
          stream_count, total_pool_revenue, total_pool_streams,
          gross_artist_amount, policy_id
        ) values (
          p_month, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
          v_track_streams, v_pool_revenue, v_total_streams,
          v_track_amount, v_policy.id
        )
        on conflict (revenue_month, artist_user_id, track_id) do update set
          stream_count = excluded.stream_count,
          total_pool_revenue = excluded.total_pool_revenue,
          total_pool_streams = excluded.total_pool_streams,
          gross_artist_amount = excluded.gross_artist_amount,
          policy_id = excluded.policy_id,
          computed_at = now();
      end if;
    end loop;

    -- [6단계] 회사 수수료
    v_company_fee := floor(v_gross * v_policy.company_fee_ratio)::bigint;

    -- [7단계] 영업인 수수료 (가입 시점 영업인, snapshot)
    select u.sales_agent_id, sa.commission_rate
      into v_sales_agent
    from public.users u
    left join public.sales_agents sa on sa.id = u.sales_agent_id
    where u.id = v_artist.artist_user_id;

    if v_sales_agent.sales_agent_id is not null
       and v_sales_agent.commission_rate is not null then
      v_agent_fee := floor(v_gross * v_sales_agent.commission_rate / 100.0)::bigint;
    else
      v_agent_fee := 0;
    end if;

    v_artist_net := greatest(v_gross - v_company_fee - v_agent_fee, 0);

    -- [8단계] 직전월 carried_over (단 1건만 참조 — 중복 방지)
    select coalesce(carried_over_amount, 0)::bigint into v_prev_carried
    from public.artist_settlements
    where artist_user_id = v_artist.artist_user_id
      and settlement_month < p_month
      and status in ('carried_over','payable','paid','held','disputed')
    order by settlement_month desc
    limit 1;
    v_prev_carried := coalesce(v_prev_carried, 0);

    v_total := v_artist_net + v_prev_carried;

    -- [9단계] 5만원 판정 (basis 에 따라)
    if v_policy.min_payout_basis = 'gross' then
      v_meets_min := (v_total >= v_policy.min_payout_amount);
    else
      -- net 기준 — 임시 withholding 계산 후 판정
      v_meets_min := ((v_total - floor(v_total * v_policy.withholding_tax_ratio)) >= v_policy.min_payout_amount);
    end if;

    -- [10-11단계] 공제 + 최종 지급액
    if v_meets_min then
      v_withholding := floor(v_total * v_policy.withholding_tax_ratio)::bigint;
      v_final_payout := v_total - v_withholding;
      v_carried_over := 0;
      v_status := 'pending';  -- finalize 전엔 pending. finalize 시 payable
    else
      v_withholding := 0;
      v_final_payout := 0;
      v_carried_over := v_total;
      v_status := 'pending';  -- finalize 전엔 pending. finalize 시 carried_over
    end if;

    -- 계좌 정보 snapshot (masked)
    select pa.id, pa.bank_name, pa.account_holder, pa.account_number
      into v_payout
    from public.artist_payout_accounts pa
    where pa.user_id = v_artist.artist_user_id and pa.verification_status = 'verified';

    -- 집계 카운터
    v_sum_gross := v_sum_gross + v_gross;
    v_sum_company := v_sum_company + v_company_fee;
    v_sum_agent := v_sum_agent + v_agent_fee;
    v_sum_final := v_sum_final + v_final_payout;
    v_sum_carried := v_sum_carried + v_carried_over;
    if v_meets_min then v_payable := v_payable + 1; else v_carried_count := v_carried_count + 1; end if;

    if not p_dry_run then
      if v_existing.id is not null then
        -- pending 덮어쓰기: settlement_items 먼저 삭제
        delete from public.settlement_items where settlement_id = v_existing.id;
        v_settlement_id := v_existing.id;
        v_overwritten := v_overwritten + 1;

        update public.artist_settlements set
          policy_id = v_policy.id,
          gross_settlement_amount = v_gross,
          company_fee_amount = v_company_fee,
          sales_agent_id = v_sales_agent.sales_agent_id,
          sales_agent_commission_rate = v_sales_agent.commission_rate,
          sales_agent_fee_amount = v_agent_fee,
          artist_net_settlement = v_artist_net,
          previous_carried_amount = v_prev_carried,
          total_settlement_amount = v_total,
          meets_min_payout = v_meets_min,
          withholding_tax_amount = v_withholding,
          final_payout_amount = v_final_payout,
          carried_over_amount = v_carried_over,
          payout_account_id = v_payout.id,
          payout_bank_name = v_payout.bank_name,
          payout_account_holder = v_payout.account_holder,
          masked_account_number = public._mask_account_number(v_payout.account_number),
          status = 'pending'
        where id = v_existing.id;
      else
        insert into public.artist_settlements (
          settlement_month, artist_user_id, policy_id,
          gross_settlement_amount, company_fee_amount,
          sales_agent_id, sales_agent_commission_rate, sales_agent_fee_amount,
          artist_net_settlement, previous_carried_amount, total_settlement_amount,
          meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
          payout_account_id, payout_bank_name, payout_account_holder, masked_account_number,
          status, created_by
        ) values (
          p_month, v_artist.artist_user_id, v_policy.id,
          v_gross, v_company_fee,
          v_sales_agent.sales_agent_id, v_sales_agent.commission_rate, v_agent_fee,
          v_artist_net, v_prev_carried, v_total,
          v_meets_min, v_withholding, v_final_payout, v_carried_over,
          v_payout.id, v_payout.bank_name, v_payout.account_holder,
          public._mask_account_number(v_payout.account_number),
          'pending', v_uid
        ) returning id into v_settlement_id;
        v_generated := v_generated + 1;
      end if;

      -- settlement_items 박제 (트랙별)
      for v_track in
        select et.track_id, et.track_code, t.title as track_title
        from public.eligible_settlement_tracks et
        join public.tracks t on t.id = et.track_id
        where et.artist_user_id = v_artist.artist_user_id
      loop
        select coalesce(count(*), 0)::int into v_track_streams
        from public.stream_events se
        where se.track_id = v_track.track_id
          and se.event_type = 'milestone_30s'
          and se.created_at >= v_month_start
          and se.created_at <  v_month_end;

        if v_track_streams > 0 then
          v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
          insert into public.settlement_items (
            settlement_id, artist_user_id, track_id, track_code, track_title,
            stream_count, pool_revenue_share
          ) values (
            v_settlement_id, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
            v_track.track_title, v_track_streams, v_track_amount
          );
        end if;
      end loop;
    else
      -- dry_run: 생성 카운트만 (settlements/items INSERT 안 함)
      if v_existing.id is not null then
        v_overwritten := v_overwritten + 1;
      else
        v_generated := v_generated + 1;
      end if;
    end if;
  end loop;

  -- generation_runs 기록 (append-only audit log)
  insert into public.settlement_generation_runs (
    run_by, settlement_month, dry_run, policy_id,
    platform_revenue, pool_revenue, total_pool_streams,
    generated_count, overwritten_count, skipped_count,
    payable_count, carried_over_count,
    total_gross, total_company_fee, total_sales_agent_fee,
    total_final_payout, total_carried_over, skipped_artists
  ) values (
    v_uid, p_month, p_dry_run, v_policy.id,
    v_platform_revenue, v_pool_revenue, v_total_streams,
    v_generated, v_overwritten, v_skipped,
    v_payable, v_carried_count,
    v_sum_gross, v_sum_company, v_sum_agent,
    v_sum_final, v_sum_carried, v_skipped_arr
  ) returning id into v_run_id;

  return jsonb_build_object(
    'ok', true,
    'run_id', v_run_id,
    'dry_run', p_dry_run,
    'settlement_month', p_month,
    'platform_revenue', v_platform_revenue,
    'pool_revenue', v_pool_revenue,
    'total_pool_streams', v_total_streams,
    'generated', v_generated,
    'overwritten', v_overwritten,
    'skipped', v_skipped,
    'payable', v_payable,
    'carried_over', v_carried_count,
    'total_gross', v_sum_gross,
    'total_company_fee', v_sum_company,
    'total_sales_agent_fee', v_sum_agent,
    'total_final_payout', v_sum_final,
    'total_carried_over', v_sum_carried,
    'skipped_artists', v_skipped_arr
  );
end;
$$;

grant execute on function public.admin_generate_monthly_settlement(date, boolean) to authenticated;

-- ----------------------
-- 7) admin_finalize_settlement — pending → payable/carried_over
-- ----------------------
create or replace function public.admin_finalize_settlement(p_settlement_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sett record;
  v_new_status text;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  select * into v_sett from public.artist_settlements where id = p_settlement_id;
  if v_sett.id is null then raise exception 'settlement not found'; end if;
  if v_sett.status <> 'pending' then
    raise exception 'can only finalize pending settlements (current=%)', v_sett.status;
  end if;

  v_new_status := case when v_sett.meets_min_payout then 'payable' else 'carried_over' end;

  update public.artist_settlements set
    status = v_new_status,
    finalized_at = now()
  where id = p_settlement_id;

  return jsonb_build_object('ok', true, 'settlement_id', p_settlement_id, 'status', v_new_status);
end;
$$;

grant execute on function public.admin_finalize_settlement(uuid) to authenticated;

-- ----------------------
-- 8) admin_mark_settlement_paid — payable → paid (이후 영구 immutable)
-- ----------------------
create or replace function public.admin_mark_settlement_paid(
  p_settlement_id uuid,
  p_payout_memo text default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sett record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  select * into v_sett from public.artist_settlements where id = p_settlement_id;
  if v_sett.id is null then raise exception 'settlement not found'; end if;
  if v_sett.status <> 'payable' then
    raise exception 'can only mark payable settlements as paid (current=%)', v_sett.status;
  end if;
  if v_sett.final_payout_amount <= 0 then
    raise exception 'cannot mark as paid: final_payout_amount=0';
  end if;

  update public.artist_settlements set
    status = 'paid',
    paid_at = now(),
    paid_by = v_uid,
    payout_memo = nullif(btrim(coalesce(p_payout_memo, '')), '')
  where id = p_settlement_id;

  return jsonb_build_object('ok', true, 'settlement_id', p_settlement_id, 'status', 'paid');
end;
$$;

grant execute on function public.admin_mark_settlement_paid(uuid, text) to authenticated;

-- ----------------------
-- 9) admin_mark_settlement_held — payable → held
-- ----------------------
create or replace function public.admin_mark_settlement_held(
  p_settlement_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sett record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'held reason required';
  end if;

  select * into v_sett from public.artist_settlements where id = p_settlement_id;
  if v_sett.id is null then raise exception 'settlement not found'; end if;
  if v_sett.status not in ('payable','pending') then
    raise exception 'can only hold pending/payable settlements (current=%)', v_sett.status;
  end if;

  update public.artist_settlements set
    status = 'held',
    held_reason = btrim(p_reason)
  where id = p_settlement_id;

  return jsonb_build_object('ok', true, 'settlement_id', p_settlement_id, 'status', 'held');
end;
$$;

grant execute on function public.admin_mark_settlement_held(uuid, text) to authenticated;

-- ----------------------
-- 10) admin_settlement_list — 관리자 목록
-- ----------------------
create or replace function public.admin_settlement_list(
  p_month date default null,
  p_status text default null,
  p_search text default null
)
returns table(
  id uuid,
  settlement_month date,
  artist_user_id uuid,
  artist_nickname text,
  artist_email text,
  gross_settlement_amount bigint,
  company_fee_amount bigint,
  sales_agent_fee_amount bigint,
  artist_net_settlement bigint,
  previous_carried_amount bigint,
  total_settlement_amount bigint,
  meets_min_payout boolean,
  withholding_tax_amount bigint,
  final_payout_amount bigint,
  carried_over_amount bigint,
  status text,
  finalized_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_pattern text := case when p_search is null or length(btrim(p_search))=0 then null
    else '%' || btrim(p_search) || '%' end;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    s.id, s.settlement_month, s.artist_user_id,
    coalesce(u.nickname, '')::text,
    coalesce(au.email::text, '')::text,
    s.gross_settlement_amount, s.company_fee_amount, s.sales_agent_fee_amount,
    s.artist_net_settlement, s.previous_carried_amount, s.total_settlement_amount,
    s.meets_min_payout, s.withholding_tax_amount, s.final_payout_amount, s.carried_over_amount,
    s.status, s.finalized_at, s.paid_at, s.created_at
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  where (p_month is null or s.settlement_month = p_month)
    and (p_status is null or s.status = p_status)
    and (
      v_pattern is null
      or coalesce(u.nickname, '') ilike v_pattern
      or coalesce(au.email::text, '') ilike v_pattern
    )
  order by s.settlement_month desc, s.created_at desc;
end;
$$;

grant execute on function public.admin_settlement_list(date, text, text) to authenticated;

-- ----------------------
-- 11) admin_settlement_detail — 상세 + items
-- ----------------------
create or replace function public.admin_settlement_detail(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_result jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'settlement', to_jsonb(s.*),
    'artist', jsonb_build_object(
      'nickname', u.nickname,
      'email', au.email,
      'artist_name', ap.artist_name
    ),
    'policy', to_jsonb(p.*),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_code', i.track_code,
        'track_title', i.track_title,
        'stream_count', i.stream_count,
        'pool_revenue_share', i.pool_revenue_share
      ) order by i.pool_revenue_share desc), '[]'::jsonb)
      from public.settlement_items i where i.settlement_id = s.id
    )
  ) into v_result
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  left join public.artist_profiles ap on ap.user_id = s.artist_user_id
  left join public.settlement_policies p on p.id = s.policy_id
  where s.id = p_id;

  return v_result;
end;
$$;

grant execute on function public.admin_settlement_detail(uuid) to authenticated;

-- ----------------------
-- 12) get_my_settlements — 아티스트 본인 목록
-- ----------------------
create or replace function public.get_my_settlements()
returns table(
  id uuid,
  settlement_month date,
  gross_settlement_amount bigint,
  artist_net_settlement bigint,
  previous_carried_amount bigint,
  total_settlement_amount bigint,
  meets_min_payout boolean,
  withholding_tax_amount bigint,
  final_payout_amount bigint,
  carried_over_amount bigint,
  status text,
  paid_at timestamptz,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  return query
  select
    s.id, s.settlement_month,
    s.gross_settlement_amount, s.artist_net_settlement,
    s.previous_carried_amount, s.total_settlement_amount,
    s.meets_min_payout, s.withholding_tax_amount, s.final_payout_amount, s.carried_over_amount,
    s.status, s.paid_at, s.created_at
  from public.artist_settlements s
  where s.artist_user_id = v_uid
  order by s.settlement_month desc;
end;
$$;

grant execute on function public.get_my_settlements() to authenticated;

-- ----------------------
-- 13) get_my_settlement_detail
-- ----------------------
create or replace function public.get_my_settlement_detail(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then return null; end if;
  select jsonb_build_object(
    'settlement', to_jsonb(s.*),
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_code', i.track_code,
        'track_title', i.track_title,
        'stream_count', i.stream_count,
        'pool_revenue_share', i.pool_revenue_share
      ) order by i.pool_revenue_share desc), '[]'::jsonb)
      from public.settlement_items i where i.settlement_id = s.id
    )
  ) into v_result
  from public.artist_settlements s
  where s.id = p_id and s.artist_user_id = v_uid;
  return v_result;
end;
$$;

grant execute on function public.get_my_settlement_detail(uuid) to authenticated;
