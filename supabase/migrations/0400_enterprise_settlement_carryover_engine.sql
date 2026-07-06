-- 0400 — Phase 3-2: Enterprise Carryover Settlement Engine
--
-- 목표:
--   0399 에서 total_commission < minimum_payout 인 경우 서버가 지급완료를 차단한다.
--   본 마이그레이션은 그 "미지급 잔액" 을 다음 달 정산에 자동으로 이월(carryover)
--   하여 minimum_payout 을 초과하는 달에 자동 지급되도록 한다.
--
-- Chain 모델:
--   각 settlement 는 다음 세 값을 새로 갖는다.
--     · previous_carryover           : 이전 달에서 넘어온 누적 이월액 (0 이 기본)
--     · carryover_source_settlement_id : 이전 달 chain 정산 id (chain 링크)
--     · carryover_applied            : 이 chain 이 종료(지급)되었는지 (bool)
--     · carryover_amount             : 이 정산이 다음 달로 넘긴 이월액 snapshot
--
--   effective_total = total_commission + previous_carryover
--
--   Generate 시:
--     · _enterprise_previous_carryover_source(ea, month) 로 이전 미지급 chain 조회
--     · previous_carryover / carryover_source_settlement_id 스냅샷
--     · source 에 carryover_amount 를 back-fill (감사 흐름 명확화)
--
--   Mark Paid 시:
--     · minimum_payout gate 를 effective_total 기준으로 재검증 (0399 강화)
--     · 지급 성공 시 chain 을 traversal 하여 모든 조상 settlement 에
--       carryover_applied = true 세팅 (chain 종료)
--
-- 절대 원칙:
--   · 기존 row 데이터 무변경 (신규 컬럼 nullable/default 0)
--   · total_commission / active_store_count / commission_rate / monthly_store_price
--     계산식 무변경 (당월 기여분은 그대로)
--   · admin_generate/mark_paid 시그니처 100% 보존, 출력 JSON 필드만 additive 추가
--   · cancelled = 보류 는 chain 을 자연스럽게 끊음 (helper 가 pending/approved 만 탐색)
--   · artist settlement / player / audio engine 무관
--
-- Audit log 신규 액션:
--   · enterprise_monthly_settlement.carryover_created   (generate 시 previous_carryover > 0)
--   · enterprise_monthly_settlement.carryover_applied   (paid 시 chain 종료)

-- ============================================================
-- 1) enterprise_monthly_settlements — carryover 컬럼 추가 (additive)
-- ============================================================
alter table public.enterprise_monthly_settlements
  add column if not exists previous_carryover           int not null default 0
    check (previous_carryover >= 0),
  add column if not exists carryover_amount             int not null default 0
    check (carryover_amount >= 0),
  add column if not exists carryover_source_settlement_id uuid
    references public.enterprise_monthly_settlements(id) on delete set null,
  add column if not exists carryover_applied            boolean not null default false;

-- chain 조회를 빠르게: (ea, month desc) partial index — 아직 종료되지 않은 미지급 chain
create index if not exists idx_ems_carryover_open
  on public.enterprise_monthly_settlements (enterprise_account_id, settlement_month desc)
  where status in ('pending','approved') and carryover_applied = false;

-- 역참조 (source→children) audit 조회용
create index if not exists idx_ems_carryover_source
  on public.enterprise_monthly_settlements (carryover_source_settlement_id)
  where carryover_source_settlement_id is not null;


-- ============================================================
-- 2) _enterprise_previous_carryover_source
--    - ea 의 (current_month 미만) 최근 pending/approved & !carryover_applied 정산을 찾아
--      chain 링크(id) + 이월 금액(effective_total) 반환.
--    - 없으면 (null, 0) 반환.
-- ============================================================
create or replace function public._enterprise_previous_carryover_source(
  p_enterprise_account_id uuid,
  p_month date
)
returns table (source_id uuid, amount int)
language sql stable security definer set search_path to 'public'
as $$
  select ems.id,
         (ems.total_commission + coalesce(ems.previous_carryover, 0))::int as amount
    from public.enterprise_monthly_settlements ems
   where ems.enterprise_account_id = p_enterprise_account_id
     and ems.settlement_month < date_trunc('month', p_month)::date
     and ems.status in ('pending','approved')
     and coalesce(ems.carryover_applied, false) = false
     and (ems.total_commission + coalesce(ems.previous_carryover, 0))
         < coalesce(ems.minimum_payout, 0)
   order by ems.settlement_month desc, ems.created_at desc
   limit 1;
$$;
revoke execute on function public._enterprise_previous_carryover_source(uuid, date) from public, anon;
grant   execute on function public._enterprise_previous_carryover_source(uuid, date) to authenticated;

comment on function public._enterprise_previous_carryover_source(uuid, date) is
  'Phase 3-2 — ea 의 이전 미지급 chain 정산 id + effective 이월금액 반환.';


-- ============================================================
-- 3) admin_generate_enterprise_monthly_settlement — carryover 반영
--    변경점:
--      (a) previous_carryover / carryover_source_settlement_id 스냅샷
--      (b) source 정산의 carryover_amount 를 back-fill (chain 흐름 명시)
--      (c) previous_carryover > 0 인 정산은 audit 에 carryover_created 로그
--      (d) 기존 total_commission / per_store / active_count 계산식 그대로
-- ============================================================
create or replace function public.admin_generate_enterprise_monthly_settlement(
  p_month date default current_date
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_ea record;
  v_contract record;
  v_cstart date;
  v_cend date;
  v_cver timestamptz;
  v_active_count int;
  v_price int;
  v_rate numeric;
  v_min int;
  v_method text;
  v_rate_source text;
  v_per_store int;
  v_total int;
  v_settlement_id uuid;
  v_existing_id uuid;
  v_has_profile boolean;
  v_prev_source_id uuid;
  v_prev_carryover int;
  v_created int := 0;
  v_skipped int := 0;
  v_carryover_created int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  for v_ea in
    select ea.id as ea_id, ea.enterprise_name
      from public.enterprise_accounts ea
     where ea.deleted_at is null
       and ea.status in ('active','invited')
       and (
         exists (select 1 from public.enterprise_settlement_profiles esp
                  where esp.enterprise_account_id = ea.id)
         or exists (select 1 from public._enterprise_active_contract(ea.id))
       )
     order by ea.enterprise_name
  loop
    -- active 매장 수
    select count(*) into v_active_count
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.ea_id
       and fs.status = 'active';

    if v_active_count = 0 then
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'enterprise_account_id', v_ea.ea_id, 'enterprise_name', v_ea.enterprise_name,
        'result', 'skipped', 'reason', 'no_active_stores');
      continue;
    end if;

    -- 이미 있는지 (cancelled 제외)
    select id into v_existing_id
      from public.enterprise_monthly_settlements
     where enterprise_account_id = v_ea.ea_id
       and settlement_month = v_month
       and status <> 'cancelled'
     limit 1;
    if v_existing_id is not null then
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'enterprise_account_id', v_ea.ea_id, 'enterprise_name', v_ea.enterprise_name,
        'result', 'skipped', 'reason', 'already_exists', 'existing_settlement_id', v_existing_id);
      continue;
    end if;

    -- 활성 계약 snapshot + effective 값 (contract > profile > default)
    select * into v_contract from public._enterprise_active_contract(v_ea.ea_id) limit 1;
    v_cstart := null; v_cend := null; v_cver := null;
    if v_contract.id is not null then
      select c.start_date, c.end_date, c.updated_at
        into v_cstart, v_cend, v_cver
        from public.enterprise_contracts c where c.id = v_contract.id;
    end if;
    v_price  := public._enterprise_monthly_store_price(v_ea.ea_id);
    v_rate   := public._enterprise_effective_commission_rate(v_ea.ea_id);
    v_min    := public._enterprise_effective_minimum_payout(v_ea.ea_id);
    v_method := public._enterprise_effective_settlement_method(v_ea.ea_id);

    select exists(select 1 from public.enterprise_settlement_profiles esp
                   where esp.enterprise_account_id = v_ea.ea_id) into v_has_profile;
    v_rate_source := case
      when v_contract.id is not null then 'contract'
      when v_has_profile             then 'profile'
      else 'default' end;

    v_per_store := floor(v_price * v_rate / 100)::int;
    v_total     := v_active_count * v_per_store;

    -- Phase 3-2 — 이전 chain 이월 조회
    v_prev_source_id := null; v_prev_carryover := 0;
    select source_id, amount
      into v_prev_source_id, v_prev_carryover
      from public._enterprise_previous_carryover_source(v_ea.ea_id, v_month);
    v_prev_carryover := coalesce(v_prev_carryover, 0);

    insert into public.enterprise_monthly_settlements
      (enterprise_account_id, settlement_month,
       active_store_count, monthly_store_price, commission_rate,
       per_store_commission, total_commission,
       contract_id, contract_no, contract_start_date, contract_end_date, contract_version,
       minimum_payout, settlement_method, rate_source,
       previous_carryover, carryover_source_settlement_id, carryover_applied,
       status, generated_by)
    values
      (v_ea.ea_id, v_month,
       v_active_count, v_price, v_rate,
       v_per_store, v_total,
       v_contract.id, v_contract.contract_no, v_cstart, v_cend, v_cver,
       v_min, v_method, v_rate_source,
       v_prev_carryover, v_prev_source_id, false,
       'pending', v_uid)
    returning id into v_settlement_id;

    -- Phase 3-2 — source(전달 정산)의 carryover_amount back-fill = 그 정산의 effective_total
    if v_prev_source_id is not null and v_prev_carryover > 0 then
      update public.enterprise_monthly_settlements
         set carryover_amount = v_prev_carryover,
             updated_at = now()
       where id = v_prev_source_id;
      v_carryover_created := v_carryover_created + 1;

      -- audit: chain 이 연결됐음을 별도 로그로 남긴다
      perform public.admin_log_operation(
        'enterprise_monthly_settlements', 'admin', 'success',
        'enterprise_monthly_settlement.carryover_created',
        format('Enterprise settlement carryover chain (%s → %s, ea=%s, amount=%s)',
          v_prev_source_id, v_settlement_id, v_ea.ea_id, v_prev_carryover),
        jsonb_build_object(
          'action', 'enterprise_monthly_settlement.carryover_created',
          'source_settlement_id', v_prev_source_id,
          'child_settlement_id',  v_settlement_id,
          'enterprise_account_id', v_ea.ea_id,
          'settlement_month', to_char(v_month, 'YYYY-MM-DD'),
          'previous_carryover', v_prev_carryover,
          'current_total_commission', v_total,
          'effective_total', v_total + v_prev_carryover,
          'minimum_payout', v_min
        ),
        v_uid, v_settlement_id::text, null, null, null
      );
    end if;

    -- items: 모든 매장 근거 (기존 로직 그대로)
    insert into public.enterprise_monthly_settlement_items
      (settlement_id, store_id, store_name, franchise_id, franchise_name,
       region_id, region_name, monthly_store_price, commission_rate,
       per_store_commission, status, reason, contract_id)
    select
      v_settlement_id, fs.store_id, fs.store_name, fs.franchise_id, f.name,
      fs.enterprise_region_id, er.region_name, v_price, v_rate,
      case when fs.status = 'active' then v_per_store else 0 end,
      case when fs.status = 'active' then 'included' else 'excluded' end,
      case fs.status
        when 'active'    then null
        when 'inactive'  then '비활성 매장'
        when 'suspended' then '정지 매장'
        else fs.status end,
      v_contract.id
      from public.franchise_stores fs
      join public.enterprise_franchises ef
        on ef.franchise_id = fs.franchise_id
       and ef.deleted_at is null
       and ef.enterprise_account_id = v_ea.ea_id
      join public.franchises f on f.id = fs.franchise_id
      left join public.enterprise_regions er on er.id = fs.enterprise_region_id;

    v_created := v_created + 1;
    v_details := v_details || jsonb_build_object(
      'enterprise_account_id', v_ea.ea_id, 'enterprise_name', v_ea.enterprise_name,
      'result', 'created', 'settlement_id', v_settlement_id,
      'active_store_count', v_active_count, 'total_commission', v_total,
      'previous_carryover', v_prev_carryover,
      'effective_total', v_total + v_prev_carryover,
      'carryover_source_settlement_id', v_prev_source_id,
      'rate_source', v_rate_source, 'contract_no', v_contract.contract_no);
  end loop;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.generate',
    format('Enterprise monthly settlement generate (%s) — created=%s skipped=%s carryover=%s',
      to_char(v_month, 'YYYY-MM'), v_created, v_skipped, v_carryover_created),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.generate',
      'settlement_month', to_char(v_month, 'YYYY-MM-DD'),
      'created', v_created, 'skipped', v_skipped,
      'carryover_created', v_carryover_created,
      'details', v_details),
    v_uid, to_char(v_month, 'YYYY-MM'), null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'settlement_month', to_char(v_month, 'YYYY-MM-DD'),
    'created', v_created, 'skipped', v_skipped,
    'carryover_created', v_carryover_created,
    'details', v_details);
end;
$$;
revoke execute on function public.admin_generate_enterprise_monthly_settlement(date) from public, anon;
grant   execute on function public.admin_generate_enterprise_monthly_settlement(date) to authenticated;


-- ============================================================
-- 4) admin_mark_paid_enterprise_monthly_settlement — effective_total gate + chain 종료
--    변경점:
--      (a) minimum_payout gate 를 effective_total (total + prev_carryover) 기준으로 재검증
--          (0399 는 total_commission 만 봤음 → 이월된 달이 실제 자동 지급되지 않는 버그 존재)
--      (b) 지급 성공 시 chain 을 recursive traversal 하여 모든 조상 정산의
--          carryover_applied = true 로 세팅 (chain 종료)
--      (c) audit 에 chain 종료 로그 (carryover_applied) 및 effective_total 기록
-- ============================================================
create or replace function public.admin_mark_paid_enterprise_monthly_settlement(
  p_settlement_id uuid,
  p_payment_reference text,
  p_admin_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.enterprise_monthly_settlements;
  v_effective_total int;
  v_chain_count int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_payment_reference), '') = '' then
    raise exception 'payment_reference required';
  end if;

  select * into v_row from public.enterprise_monthly_settlements where id = p_settlement_id;
  if v_row.id is null then raise exception 'settlement not found: %', p_settlement_id; end if;
  if v_row.status <> 'approved' then
    raise exception 'invalid transition: status=% (only approved can be marked paid)', v_row.status;
  end if;

  -- effective_total = 이번 달 정산금 + 지난 chain 에서 넘어온 이월액
  v_effective_total := coalesce(v_row.total_commission, 0) + coalesce(v_row.previous_carryover, 0);

  -- Phase 3-2 — minimum_payout gate (effective_total 기준으로 판단)
  if coalesce(v_row.minimum_payout, 0) > 0
     and v_effective_total < v_row.minimum_payout then
    perform public.admin_log_operation(
      'enterprise_monthly_settlements', 'admin', 'blocked',
      'enterprise_monthly_settlement.paid_blocked',
      format('Enterprise monthly settlement paid blocked (id=%s ea=%s total=%s prev=%s effective=%s minimum=%s reason=minimum_payout_not_met)',
        v_row.id, v_row.enterprise_account_id,
        v_row.total_commission, v_row.previous_carryover,
        v_effective_total, v_row.minimum_payout),
      jsonb_build_object(
        'action', 'enterprise_monthly_settlement.paid_blocked',
        'settlement_id', v_row.id,
        'enterprise_account_id', v_row.enterprise_account_id,
        'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
        'total_commission', v_row.total_commission,
        'previous_carryover', v_row.previous_carryover,
        'effective_total', v_effective_total,
        'minimum_payout', v_row.minimum_payout,
        'reason', 'minimum_payout_not_met',
        'payment_reference_attempted', btrim(p_payment_reference),
        'admin_note_attempted', p_admin_note
      ),
      v_uid, v_row.id::text, null, null, null
    );
    raise exception 'minimum_payout_not_met (effective=%, minimum=%)',
      v_effective_total, v_row.minimum_payout;
  end if;

  -- 지급 처리
  update public.enterprise_monthly_settlements
     set status = 'paid',
         paid_at = now(),
         paid_by = v_uid,
         payment_reference = btrim(p_payment_reference),
         admin_note = coalesce(nullif(btrim(p_admin_note), ''), admin_note),
         carryover_applied = true,
         updated_at = now()
   where id = p_settlement_id
  returning * into v_row;

  -- Phase 3-2 — chain traversal: source → source... 를 따라 올라가 모두 carryover_applied = true
  if v_row.carryover_source_settlement_id is not null then
    with recursive chain(id, source_id, depth) as (
      select ems.id, ems.carryover_source_settlement_id, 1
        from public.enterprise_monthly_settlements ems
       where ems.id = v_row.carryover_source_settlement_id
      union all
      select ems.id, ems.carryover_source_settlement_id, c.depth + 1
        from public.enterprise_monthly_settlements ems
        join chain c on c.source_id = ems.id
       where c.depth < 60      -- 최대 60개월(5년) chain 안전장치
    )
    update public.enterprise_monthly_settlements ems
       set carryover_applied = true,
           updated_at = now()
      from chain
     where ems.id = chain.id
       and coalesce(ems.carryover_applied, false) = false;
    get diagnostics v_chain_count = row_count;

    perform public.admin_log_operation(
      'enterprise_monthly_settlements', 'admin', 'success',
      'enterprise_monthly_settlement.carryover_applied',
      format('Enterprise settlement carryover chain applied (paid_id=%s ea=%s chain_len=%s effective=%s)',
        v_row.id, v_row.enterprise_account_id, v_chain_count, v_effective_total),
      jsonb_build_object(
        'action', 'enterprise_monthly_settlement.carryover_applied',
        'paid_settlement_id', v_row.id,
        'enterprise_account_id', v_row.enterprise_account_id,
        'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
        'chain_length', v_chain_count,
        'effective_total', v_effective_total,
        'previous_carryover', v_row.previous_carryover,
        'total_commission', v_row.total_commission,
        'minimum_payout', v_row.minimum_payout,
        'payment_reference', btrim(p_payment_reference)
      ),
      v_uid, v_row.id::text, null, null, null
    );
  end if;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.paid',
    format('Enterprise monthly settlement paid (%s, ea=%s, effective=%s, ref=%s)',
      to_char(v_row.settlement_month, 'YYYY-MM'),
      v_row.enterprise_account_id, v_effective_total, btrim(p_payment_reference)),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.paid',
      'settlement_id', v_row.id,
      'enterprise_account_id', v_row.enterprise_account_id,
      'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
      'total_commission', v_row.total_commission,
      'previous_carryover', v_row.previous_carryover,
      'effective_total', v_effective_total,
      'minimum_payout', v_row.minimum_payout,
      'chain_length', v_chain_count,
      'payment_reference', btrim(p_payment_reference),
      'admin_note', p_admin_note
    ),
    v_uid, v_row.id::text, null, null, null
  );

  return jsonb_build_object('success', true,
    'settlement_id', v_row.id, 'status', v_row.status, 'paid_at', v_row.paid_at,
    'effective_total', v_effective_total,
    'chain_length', v_chain_count);
end;
$$;
revoke execute on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) from public, anon;
grant   execute on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) to authenticated;

comment on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) is
  'Phase 3-2 — effective_total(=total + prev_carryover) 기준 minimum_payout gate + chain traversal 로 carryover_applied 종결 + audit.';


-- ============================================================
-- 5) admin_list_enterprise_monthly_settlements — 출력에 carryover 필드 추가
-- ============================================================
create or replace function public.admin_list_enterprise_monthly_settlements(
  p_month date default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_rows jsonb; v_total int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status is not null and p_status not in ('pending','approved','paid','cancelled') then
    raise exception 'invalid status: %', p_status;
  end if;

  select count(*) into v_total
    from public.enterprise_monthly_settlements ems
   where (p_month is null or ems.settlement_month = date_trunc('month', p_month)::date)
     and (p_status is null or ems.status = p_status);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ems.id,
    'enterprise_account_id', ems.enterprise_account_id,
    'enterprise_name', ea.enterprise_name,
    'brand_code', ea.brand_code,
    'settlement_month', to_char(ems.settlement_month, 'YYYY-MM-DD'),
    'active_store_count', ems.active_store_count,
    'monthly_store_price', ems.monthly_store_price,
    'commission_rate', ems.commission_rate,
    'per_store_commission', ems.per_store_commission,
    'total_commission', ems.total_commission,
    'previous_carryover', ems.previous_carryover,
    'carryover_amount', ems.carryover_amount,
    'carryover_source_settlement_id', ems.carryover_source_settlement_id,
    'carryover_applied', ems.carryover_applied,
    'effective_total', (ems.total_commission + coalesce(ems.previous_carryover, 0)),
    'contract_id', ems.contract_id,
    'contract_no', ems.contract_no,
    'contract_start_date', ems.contract_start_date,
    'contract_end_date', ems.contract_end_date,
    'contract_version', ems.contract_version,
    'minimum_payout', ems.minimum_payout,
    'settlement_method', ems.settlement_method,
    'rate_source', ems.rate_source,
    'status', ems.status,
    'generated_at', ems.generated_at,
    'approved_at', ems.approved_at,
    'paid_at', ems.paid_at,
    'payment_reference', ems.payment_reference,
    'admin_note', ems.admin_note
  ) order by ems.settlement_month desc, ea.enterprise_name), '[]'::jsonb)
    into v_rows
    from (
      select ems2.* from public.enterprise_monthly_settlements ems2
       where (p_month is null or ems2.settlement_month = date_trunc('month', p_month)::date)
         and (p_status is null or ems2.status = p_status)
       order by ems2.settlement_month desc, ems2.created_at desc
       limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) ems
    join public.enterprise_accounts ea on ea.id = ems.enterprise_account_id;

  return jsonb_build_object('success', true, 'total', v_total, 'rows', v_rows);
end;
$$;
revoke execute on function public.admin_list_enterprise_monthly_settlements(date, text, int, int) from public, anon;
grant   execute on function public.admin_list_enterprise_monthly_settlements(date, text, int, int) to authenticated;


-- ============================================================
-- 6) admin_get_enterprise_monthly_settlement — 상세 + carryover chain 정보
-- ============================================================
create or replace function public.admin_get_enterprise_monthly_settlement(
  p_settlement_id uuid
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_settlement public.enterprise_monthly_settlements;
  v_ea public.enterprise_accounts;
  v_items jsonb;
  v_source jsonb;
  v_child jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_settlement from public.enterprise_monthly_settlements where id = p_settlement_id;
  if v_settlement.id is null then raise exception 'settlement not found: %', p_settlement_id; end if;
  select * into v_ea from public.enterprise_accounts where id = v_settlement.enterprise_account_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'store_id', i.store_id, 'store_name', i.store_name,
    'franchise_id', i.franchise_id, 'franchise_name', i.franchise_name,
    'region_id', i.region_id, 'region_name', i.region_name,
    'monthly_store_price', i.monthly_store_price, 'commission_rate', i.commission_rate,
    'per_store_commission', i.per_store_commission, 'status', i.status, 'reason', i.reason
  ) order by i.status, i.store_name nulls last), '[]'::jsonb)
    into v_items
    from public.enterprise_monthly_settlement_items i
   where i.settlement_id = p_settlement_id;

  -- Phase 3-2 — chain source (있으면) mini-summary
  v_source := null;
  if v_settlement.carryover_source_settlement_id is not null then
    select jsonb_build_object(
      'id', s.id,
      'settlement_month', to_char(s.settlement_month, 'YYYY-MM-DD'),
      'status', s.status,
      'total_commission', s.total_commission,
      'previous_carryover', s.previous_carryover,
      'effective_total', (s.total_commission + coalesce(s.previous_carryover, 0)),
      'carryover_applied', s.carryover_applied
    ) into v_source
      from public.enterprise_monthly_settlements s
     where s.id = v_settlement.carryover_source_settlement_id;
  end if;

  -- Phase 3-2 — 다음 chain child (즉, 이 정산을 source 로 삼은 후속 정산) — 없을 수 있음
  select jsonb_build_object(
    'id', c.id,
    'settlement_month', to_char(c.settlement_month, 'YYYY-MM-DD'),
    'status', c.status,
    'total_commission', c.total_commission,
    'previous_carryover', c.previous_carryover,
    'effective_total', (c.total_commission + coalesce(c.previous_carryover, 0)),
    'carryover_applied', c.carryover_applied
  ) into v_child
    from public.enterprise_monthly_settlements c
   where c.carryover_source_settlement_id = v_settlement.id
   order by c.settlement_month desc, c.created_at desc
   limit 1;

  return jsonb_build_object(
    'success', true,
    'settlement', jsonb_build_object(
      'id', v_settlement.id,
      'enterprise_account_id', v_settlement.enterprise_account_id,
      'enterprise_name', v_ea.enterprise_name,
      'brand_code', v_ea.brand_code,
      'manager_name', v_ea.manager_name,
      'manager_email', v_ea.manager_email,
      'settlement_month', to_char(v_settlement.settlement_month, 'YYYY-MM-DD'),
      'active_store_count', v_settlement.active_store_count,
      'monthly_store_price', v_settlement.monthly_store_price,
      'commission_rate', v_settlement.commission_rate,
      'per_store_commission', v_settlement.per_store_commission,
      'total_commission', v_settlement.total_commission,
      'previous_carryover', v_settlement.previous_carryover,
      'carryover_amount', v_settlement.carryover_amount,
      'carryover_source_settlement_id', v_settlement.carryover_source_settlement_id,
      'carryover_applied', v_settlement.carryover_applied,
      'effective_total', (v_settlement.total_commission + coalesce(v_settlement.previous_carryover, 0)),
      'contract_id', v_settlement.contract_id,
      'contract_no', v_settlement.contract_no,
      'contract_start_date', v_settlement.contract_start_date,
      'contract_end_date', v_settlement.contract_end_date,
      'contract_version', v_settlement.contract_version,
      'minimum_payout', v_settlement.minimum_payout,
      'settlement_method', v_settlement.settlement_method,
      'rate_source', v_settlement.rate_source,
      'status', v_settlement.status,
      'generated_at', v_settlement.generated_at,
      'approved_at', v_settlement.approved_at,
      'paid_at', v_settlement.paid_at,
      'payment_reference', v_settlement.payment_reference,
      'admin_note', v_settlement.admin_note
    ),
    'carryover_source', v_source,
    'carryover_child',  v_child,
    'items', v_items
  );
end;
$$;
revoke execute on function public.admin_get_enterprise_monthly_settlement(uuid) from public, anon;
grant   execute on function public.admin_get_enterprise_monthly_settlement(uuid) to authenticated;


-- ============================================================
-- 7) get_my_enterprise_monthly_settlements (HQ) — carryover 필드 additive
-- ============================================================
create or replace function public.get_my_enterprise_monthly_settlements(
  p_limit int default 12
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_ea_id uuid; v_rows jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited') limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ems.id,
    'settlement_month', to_char(ems.settlement_month, 'YYYY-MM-DD'),
    'active_store_count', ems.active_store_count,
    'monthly_store_price', ems.monthly_store_price,
    'commission_rate', ems.commission_rate,
    'per_store_commission', ems.per_store_commission,
    'total_commission', ems.total_commission,
    'previous_carryover', ems.previous_carryover,
    'carryover_amount', ems.carryover_amount,
    'carryover_source_settlement_id', ems.carryover_source_settlement_id,
    'carryover_applied', ems.carryover_applied,
    'effective_total', (ems.total_commission + coalesce(ems.previous_carryover, 0)),
    'contract_id', ems.contract_id,
    'contract_no', ems.contract_no,
    'contract_start_date', ems.contract_start_date,
    'contract_end_date', ems.contract_end_date,
    'contract_version', ems.contract_version,
    'minimum_payout', ems.minimum_payout,
    'settlement_method', ems.settlement_method,
    'rate_source', ems.rate_source,
    'status', ems.status,
    'generated_at', ems.generated_at,
    'approved_at', ems.approved_at,
    'paid_at', ems.paid_at,
    'payment_reference', ems.payment_reference
  ) order by ems.settlement_month desc), '[]'::jsonb)
    into v_rows
    from (
      select * from public.enterprise_monthly_settlements
       where enterprise_account_id = v_ea_id
       order by settlement_month desc, created_at desc
       limit greatest(p_limit, 1)
    ) ems;

  return jsonb_build_object('success', true, 'rows', v_rows);
end;
$$;
revoke execute on function public.get_my_enterprise_monthly_settlements(int) from public, anon;
grant   execute on function public.get_my_enterprise_monthly_settlements(int) to authenticated;


-- ============================================================
-- 8) get_my_enterprise_monthly_settlement_items (HQ) — carryover 필드 additive
-- ============================================================
create or replace function public.get_my_enterprise_monthly_settlement_items(
  p_settlement_id uuid
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_ea_id uuid;
  v_settlement public.enterprise_monthly_settlements;
  v_items jsonb;
  v_source jsonb;
  v_child  jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited') limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_settlement from public.enterprise_monthly_settlements
   where id = p_settlement_id and enterprise_account_id = v_ea_id;
  if v_settlement.id is null then
    raise exception 'settlement not found or not owned by current HQ';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'store_id', i.store_id, 'store_name', i.store_name,
    'franchise_name', i.franchise_name, 'region_name', i.region_name,
    'monthly_store_price', i.monthly_store_price, 'commission_rate', i.commission_rate,
    'per_store_commission', i.per_store_commission, 'status', i.status, 'reason', i.reason
  ) order by i.status, i.store_name nulls last), '[]'::jsonb)
    into v_items
    from public.enterprise_monthly_settlement_items i
   where i.settlement_id = p_settlement_id;

  -- source / child chain mini-summary (HQ 는 자기 브랜드 이내 데이터만 노출)
  v_source := null;
  if v_settlement.carryover_source_settlement_id is not null then
    select jsonb_build_object(
      'id', s.id,
      'settlement_month', to_char(s.settlement_month, 'YYYY-MM-DD'),
      'status', s.status,
      'total_commission', s.total_commission,
      'previous_carryover', s.previous_carryover,
      'effective_total', (s.total_commission + coalesce(s.previous_carryover, 0)),
      'carryover_applied', s.carryover_applied
    ) into v_source
      from public.enterprise_monthly_settlements s
     where s.id = v_settlement.carryover_source_settlement_id
       and s.enterprise_account_id = v_ea_id;
  end if;

  select jsonb_build_object(
    'id', c.id,
    'settlement_month', to_char(c.settlement_month, 'YYYY-MM-DD'),
    'status', c.status,
    'total_commission', c.total_commission,
    'previous_carryover', c.previous_carryover,
    'effective_total', (c.total_commission + coalesce(c.previous_carryover, 0)),
    'carryover_applied', c.carryover_applied
  ) into v_child
    from public.enterprise_monthly_settlements c
   where c.carryover_source_settlement_id = v_settlement.id
     and c.enterprise_account_id = v_ea_id
   order by c.settlement_month desc, c.created_at desc
   limit 1;

  return jsonb_build_object(
    'success', true,
    'settlement', jsonb_build_object(
      'id', v_settlement.id,
      'settlement_month', to_char(v_settlement.settlement_month, 'YYYY-MM-DD'),
      'active_store_count', v_settlement.active_store_count,
      'monthly_store_price', v_settlement.monthly_store_price,
      'commission_rate', v_settlement.commission_rate,
      'per_store_commission', v_settlement.per_store_commission,
      'total_commission', v_settlement.total_commission,
      'previous_carryover', v_settlement.previous_carryover,
      'carryover_amount', v_settlement.carryover_amount,
      'carryover_source_settlement_id', v_settlement.carryover_source_settlement_id,
      'carryover_applied', v_settlement.carryover_applied,
      'effective_total', (v_settlement.total_commission + coalesce(v_settlement.previous_carryover, 0)),
      'contract_id', v_settlement.contract_id,
      'contract_no', v_settlement.contract_no,
      'contract_start_date', v_settlement.contract_start_date,
      'contract_end_date', v_settlement.contract_end_date,
      'contract_version', v_settlement.contract_version,
      'minimum_payout', v_settlement.minimum_payout,
      'settlement_method', v_settlement.settlement_method,
      'rate_source', v_settlement.rate_source,
      'status', v_settlement.status,
      'paid_at', v_settlement.paid_at,
      'payment_reference', v_settlement.payment_reference
    ),
    'carryover_source', v_source,
    'carryover_child',  v_child,
    'items', v_items
  );
end;
$$;
revoke execute on function public.get_my_enterprise_monthly_settlement_items(uuid) from public, anon;
grant   execute on function public.get_my_enterprise_monthly_settlement_items(uuid) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_cols int;
  v_idx  int;
  v_rpc  int;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='enterprise_monthly_settlements'
     and column_name in ('previous_carryover','carryover_amount',
                         'carryover_source_settlement_id','carryover_applied');
  select count(*) into v_idx from pg_indexes
   where schemaname='public'
     and indexname in ('idx_ems_carryover_open','idx_ems_carryover_source');
  select count(*) into v_rpc from pg_proc
   where proname in (
     '_enterprise_previous_carryover_source',
     'admin_generate_enterprise_monthly_settlement',
     'admin_mark_paid_enterprise_monthly_settlement',
     'admin_list_enterprise_monthly_settlements',
     'admin_get_enterprise_monthly_settlement',
     'get_my_enterprise_monthly_settlements',
     'get_my_enterprise_monthly_settlement_items'
   );

  raise notice '====== 0400 Carryover Engine Diagnostics ======';
  raise notice 'ems carryover columns: % / 4', v_cols;
  raise notice 'ems carryover indexes: % / 2', v_idx;
  raise notice 'RPCs present: % / 7', v_rpc;
  raise notice '===============================================';

  if v_cols = 4 and v_idx = 2 and v_rpc = 7 then
    raise notice '0400 COMPLETE — carryover engine ready';
  else
    raise warning '0400 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
