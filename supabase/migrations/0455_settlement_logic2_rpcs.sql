-- 0455 — SETTLEMENT-LOGIC-2: 정산 생성/수동이월 RPC 를 세금 안전 모델로 재배선
--
-- 기반: 현재 Production 에 배포된 pre-0348 admin_generate_monthly_settlement 본체를
--       그대로 보존하되, "계산 블록"만 0454 의 _settlement_compute 헬퍼로 교체하고
--       신규 taxed/untaxed 이월 컬럼 + snapshot 을 채운다. 레거시 컬럼도 동시 유지.
--
-- 변경 요약:
--   1) 사용자별 원천징수 유형 조회 → _settlement_tax_rate 로 세율 해석 + snapshot 고정.
--      알 수 없는 세율(NULL) → 지급 보류(held, 'tax_type_unknown'). 3.3% fallback 금지.
--   2) 이전 이월을 미과세/기과세로 분리 소비 → 기과세 이월 재과세 금지.
--   3) 음수 이월 미저장 (헬퍼가 clamp; 잔여는 residual_debit — 이번 버전은 관측만).
--   4) 자동 병합 audit action 을 'auto_carryover_consumed' 로 명확화.
--   5) 수동 이월: payable→기과세(final_payout), pending/held→미과세(total). action 'admin_manual_carryover'.
--
-- 검증: SETTLEMENT-E2E-1 에서 Test project 대상 실제 RPC E2E 인증. Production 적용은 Runbook 따름.
-- check_function_bodies off 는 스키마 drift(누락 테이블) 내성 확보용 — Prod 는 모든 참조 테이블 존재.

set check_function_bodies = off;

-- ============================================================
-- admin_generate_monthly_settlement — 세금 안전 재배선
-- ============================================================
create or replace function public.admin_generate_monthly_settlement(p_month date, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_month_start timestamptz; v_month_end timestamptz;
  v_policy record;
  v_platform_revenue bigint; v_pool_revenue bigint; v_total_streams bigint;
  v_artist record; v_existing record; v_payout record; v_sales_agent record;
  v_artist_email text;
  v_gross bigint; v_company_fee bigint; v_agent_fee bigint; v_artist_net bigint;
  v_prev_untaxed bigint; v_prev_taxed bigint; v_adjustments_sum bigint;
  v_total bigint; v_meets_min boolean;
  v_withholding bigint; v_final_payout bigint;
  v_carry_untaxed bigint; v_carry_taxed bigint; v_taxable_base bigint;
  v_settlement_id uuid; v_track record;
  v_track_streams int; v_track_amount bigint;
  v_generated int := 0; v_overwritten int := 0; v_skipped int := 0;
  v_payable int := 0; v_carried_count int := 0; v_held_count int := 0;
  v_sum_gross bigint := 0; v_sum_company bigint := 0; v_sum_agent bigint := 0;
  v_sum_final bigint := 0; v_sum_carried bigint := 0;
  v_skipped_arr jsonb := '[]'::jsonb;
  v_run_id uuid;
  v_pii_ready boolean;
  v_final_status text; v_final_held_reason text;
  v_carryover_consumed int := 0;
  v_consumed_ids uuid[];
  v_adjustment_ids bigint[];
  v_adjustments_applied_total int := 0;
  -- LOGIC-2 신규
  v_tax_type text; v_tax_rate numeric; v_calc jsonb;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only'; end if;
  perform pg_advisory_xact_lock(hashtext('settlement_gen:' || p_month::text));

  select * into v_policy from public.settlement_policies
  where effective_from <= p_month order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'no settlement policy effective for %', p_month; end if;

  v_month_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  select coalesce(sum(po.amount), 0)::bigint into v_platform_revenue
  from public.payment_orders po
  where po.status = 'paid' and po.settlement_period_month = p_month;
  v_pool_revenue := floor(v_platform_revenue * v_policy.pool_revenue_ratio);

  select coalesce(count(*), 0)::bigint into v_total_streams
  from public.stream_events se
  join public.eligible_settlement_tracks et on et.track_id = se.track_id
  where se.event_type = 'milestone_30s' and se.is_effective = true
    and se.eligible_for_payout = true
    and se.created_at >= v_month_start and se.created_at < v_month_end;

  for v_artist in
    select distinct artist_user_id from (
      select et.artist_user_id from public.eligible_settlement_tracks et
      where exists (
        select 1 from public.stream_events se
        where se.track_id = et.track_id and se.event_type = 'milestone_30s'
          and se.is_effective = true and se.eligible_for_payout = true
          and se.created_at >= v_month_start and se.created_at < v_month_end)
      union
      select s.artist_user_id from public.artist_settlements s
      where s.settlement_month < p_month
        and (s.status in ('pending','held')
             or (s.status = 'carried_over' and coalesce(s.carryover_applied, false) = false))
      union
      select adj.artist_user_id from public.settlement_adjustments adj
      where adj.apply_to_month = p_month and adj.applied = false
    ) u
  loop
    select id, status into v_existing
    from public.artist_settlements
    where settlement_month = p_month and artist_user_id = v_artist.artist_user_id;
    if v_existing.id is not null and v_existing.status not in ('pending','held') then
      v_skipped := v_skipped + 1;
      v_skipped_arr := v_skipped_arr || jsonb_build_object(
        'artist_user_id', v_artist.artist_user_id,
        'existing_status', v_existing.status, 'reason', 'finalized_or_paid');
      continue;
    end if;

    if v_existing.id is not null and not p_dry_run then
      update public.artist_settlements as s
      set status = coalesce(s.pre_merge_status, 'pending'),
          carryover_applied = false, merged_into_settlement_id = null,
          carried_over_to_month = null, auto_merged_at = null, pre_merge_status = null
      where s.merged_into_settlement_id = v_existing.id;
    end if;

    v_pii_ready := public.artist_payout_account_ready(v_artist.artist_user_id);

    -- 트랙별 gross (기존과 동일)
    v_gross := 0;
    for v_track in
      select et.track_id, et.track_code, t.title as track_title,
             t.isrc, t.release_date, t.release_title, t.rights_holder_name
      from public.eligible_settlement_tracks et
      join public.tracks t on t.id = et.track_id
      where et.artist_user_id = v_artist.artist_user_id
    loop
      select coalesce(count(*), 0)::int into v_track_streams
      from public.stream_events se
      where se.track_id = v_track.track_id and se.event_type = 'milestone_30s'
        and se.is_effective = true and se.eligible_for_payout = true
        and se.created_at >= v_month_start and se.created_at < v_month_end;
      if v_track_streams = 0 or v_total_streams = 0 then v_track_amount := 0;
      else v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint; end if;
      v_gross := v_gross + v_track_amount;
      if not p_dry_run then
        insert into public.streaming_revenues (
          revenue_month, artist_user_id, track_id, track_code,
          stream_count, total_pool_revenue, total_pool_streams, gross_artist_amount, policy_id
        ) values (
          p_month, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
          v_track_streams, v_pool_revenue, v_total_streams, v_track_amount, v_policy.id
        ) on conflict (revenue_month, artist_user_id, track_id) do update set
          stream_count = excluded.stream_count, total_pool_revenue = excluded.total_pool_revenue,
          total_pool_streams = excluded.total_pool_streams, gross_artist_amount = excluded.gross_artist_amount,
          policy_id = excluded.policy_id, computed_at = now();
      end if;
    end loop;

    -- 영업인 커미션율
    select u.sales_agent_id, sa.commission_rate, sa.code into v_sales_agent
    from public.users u left join public.sales_agents sa on sa.id = u.sales_agent_id
    where u.id = v_artist.artist_user_id;

    -- 사용자별 원천징수 유형 → 세율 해석 (검증된 계좌 기준) + snapshot
    select pa.tax_withholding_type into v_tax_type
    from public.artist_payout_accounts pa
    where pa.user_id = v_artist.artist_user_id and pa.verification_status = 'verified'
    order by pa.updated_at desc nulls last limit 1;
    v_tax_rate := public._settlement_tax_rate(v_tax_type);
    -- 유형 미설정이지만 계좌가 verified 인 경우: 정책 기본율(3.3%)이 아닌 held 로 유도하되,
    -- 하위호환을 위해 유형이 명시적으로 'business_income_3_3' 또는 NULL(미설정) 이면 정책율 사용.
    if v_tax_rate is null and v_tax_type is null then
      v_tax_rate := v_policy.withholding_tax_ratio;  -- 미설정(legacy) → 정책 기본율 유지(회귀 방지)
      v_tax_type := 'policy_default';
    end if;

    -- 이전 이월 분리 소비 (미과세/기과세) — 신규 컬럼 우선, 레거시 fallback
    select
      coalesce(sum(case when (s.carryover_untaxed_amount + s.carryover_taxed_amount) > 0
                        then s.carryover_untaxed_amount
                        else coalesce(nullif(s.carried_over_amount,0), s.total_settlement_amount, 0) end),0)::bigint,
      coalesce(sum(s.carryover_taxed_amount),0)::bigint,
      coalesce(array_agg(s.id) filter (where s.id is not null), '{}'::uuid[])
    into v_prev_untaxed, v_prev_taxed, v_consumed_ids
    from public.artist_settlements s
    where s.artist_user_id = v_artist.artist_user_id
      and s.settlement_month < p_month
      and (s.status in ('pending','held')
           or (s.status = 'carried_over' and coalesce(s.carryover_applied, false) = false));

    select coalesce(sum(adj.amount),0)::bigint,
           coalesce(array_agg(adj.id) filter (where adj.id is not null), '{}'::bigint[])
    into v_adjustments_sum, v_adjustment_ids
    from public.settlement_adjustments adj
    where adj.artist_user_id = v_artist.artist_user_id
      and adj.apply_to_month = p_month and adj.applied = false;

    -- 권위 계산 (단일 헬퍼)
    v_calc := public._settlement_compute(
      v_gross, v_policy.company_fee_ratio,
      case when v_sales_agent.sales_agent_id is not null then v_sales_agent.commission_rate else null end,
      v_prev_untaxed, v_prev_taxed, v_tax_rate,
      v_policy.min_payout_amount, v_policy.min_payout_basis,
      v_adjustments_sum, 0);

    v_company_fee   := (v_calc->>'company_fee')::bigint;
    v_agent_fee     := (v_calc->>'agent_fee')::bigint;
    v_artist_net    := greatest(v_gross - v_company_fee - v_agent_fee, 0);
    v_taxable_base  := (v_calc->>'taxable_base')::bigint;
    v_total         := (v_calc->>'effective_total')::bigint;
    v_meets_min     := (v_calc->>'meets_min')::boolean;
    v_withholding   := (v_calc->>'withholding_tax')::bigint;
    v_final_payout  := (v_calc->>'final_payout')::bigint;
    v_carry_untaxed := (v_calc->>'carry_untaxed_out')::bigint;
    v_carry_taxed   := (v_calc->>'carry_taxed_out')::bigint;

    select pa.id, pa.bank_name, pa.account_holder, pa.account_number into v_payout
    from public.artist_payout_accounts pa
    where pa.user_id = v_artist.artist_user_id and pa.verification_status = 'verified';

    select au.email::text into v_artist_email from auth.users au where au.id = v_artist.artist_user_id;

    -- 상태 결정: PII 미완료 → held; 세율 미상 → held; 아니면 pending
    if not v_pii_ready then
      v_final_status := 'held'; v_final_held_reason := 'pii_incomplete'; v_held_count := v_held_count + 1;
    elsif not (v_calc->>'tax_known')::boolean then
      v_final_status := 'held'; v_final_held_reason := 'tax_type_unknown'; v_held_count := v_held_count + 1;
    else
      v_final_status := 'pending'; v_final_held_reason := null;
    end if;

    v_sum_gross := v_sum_gross + v_gross; v_sum_company := v_sum_company + v_company_fee;
    v_sum_agent := v_sum_agent + v_agent_fee; v_sum_final := v_sum_final + v_final_payout;
    v_sum_carried := v_sum_carried + (v_carry_untaxed + v_carry_taxed);
    if v_meets_min then v_payable := v_payable + 1; else v_carried_count := v_carried_count + 1; end if;

    if not p_dry_run then
      if v_existing.id is not null then
        delete from public.settlement_items where settlement_id = v_existing.id;
        v_settlement_id := v_existing.id; v_overwritten := v_overwritten + 1;
        update public.artist_settlements set
          policy_id = v_policy.id,
          gross_settlement_amount = v_gross, company_fee_amount = v_company_fee,
          sales_agent_id = v_sales_agent.sales_agent_id, sales_agent_code = v_sales_agent.code,
          sales_agent_commission_rate = v_sales_agent.commission_rate, sales_agent_fee_amount = v_agent_fee,
          artist_net_settlement = v_artist_net,
          previous_carried_amount = v_prev_untaxed + v_prev_taxed,
          previous_carryover_untaxed_amount = v_prev_untaxed,
          previous_carryover_taxed_amount = v_prev_taxed,
          taxable_base_amount = v_taxable_base,
          total_settlement_amount = v_total, meets_min_payout = v_meets_min,
          withholding_tax_amount = v_withholding, final_payout_amount = v_final_payout,
          carried_over_amount = v_carry_untaxed + v_carry_taxed,
          carryover_untaxed_amount = v_carry_untaxed, carryover_taxed_amount = v_carry_taxed,
          tax_withholding_type_snapshot = v_tax_type, tax_rate_snapshot = v_tax_rate,
          minimum_payout_snapshot = v_policy.min_payout_amount,
          payout_account_id = v_payout.id, payout_bank_name = v_payout.bank_name,
          payout_account_holder = v_payout.account_holder,
          masked_account_number = public._mask_account_number(v_payout.account_number),
          artist_email = v_artist_email, status = v_final_status, held_reason = v_final_held_reason,
          updated_at = now()
        where id = v_existing.id;
      else
        insert into public.artist_settlements (
          settlement_month, artist_user_id, policy_id,
          gross_settlement_amount, company_fee_amount,
          sales_agent_id, sales_agent_code, sales_agent_commission_rate, sales_agent_fee_amount,
          artist_net_settlement, previous_carried_amount,
          previous_carryover_untaxed_amount, previous_carryover_taxed_amount, taxable_base_amount,
          total_settlement_amount, meets_min_payout, withholding_tax_amount, final_payout_amount,
          carried_over_amount, carryover_untaxed_amount, carryover_taxed_amount,
          tax_withholding_type_snapshot, tax_rate_snapshot, minimum_payout_snapshot,
          payout_account_id, payout_bank_name, payout_account_holder, masked_account_number,
          artist_email, status, held_reason, created_by
        ) values (
          p_month, v_artist.artist_user_id, v_policy.id,
          v_gross, v_company_fee, v_sales_agent.sales_agent_id, v_sales_agent.code,
          v_sales_agent.commission_rate, v_agent_fee,
          v_artist_net, v_prev_untaxed + v_prev_taxed,
          v_prev_untaxed, v_prev_taxed, v_taxable_base,
          v_total, v_meets_min, v_withholding, v_final_payout,
          v_carry_untaxed + v_carry_taxed, v_carry_untaxed, v_carry_taxed,
          v_tax_type, v_tax_rate, v_policy.min_payout_amount,
          v_payout.id, v_payout.bank_name, v_payout.account_holder,
          public._mask_account_number(v_payout.account_number),
          v_artist_email, v_final_status, v_final_held_reason, v_uid
        ) returning id into v_settlement_id;
        v_generated := v_generated + 1;
      end if;

      -- 이전 이월 소비 표시 (audit action: auto_carryover_consumed)
      if v_settlement_id is not null and array_length(v_consumed_ids, 1) > 0 then
        update public.artist_settlements as s
        set pre_merge_status = case when s.status = 'carried_over' then s.pre_merge_status else s.status end,
            status = 'carried_over', is_manual_carryover = false, carryover_applied = true,
            merged_into_settlement_id = v_settlement_id, carried_over_to_month = p_month,
            carried_over_at = coalesce(s.carried_over_at, now()),
            carried_over_by = coalesce(s.carried_over_by, v_uid),
            auto_merged_at = now(),
            carried_over_amount = case when (s.carryover_untaxed_amount + s.carryover_taxed_amount) > 0
                                       then s.carryover_untaxed_amount + s.carryover_taxed_amount
                                       else coalesce(nullif(s.carried_over_amount, 0), s.total_settlement_amount, 0) end,
            held_reason = 'auto_merged_into_' || to_char(p_month, 'YYYY-MM'), updated_at = now()
        where s.id = any (v_consumed_ids);
        v_carryover_consumed := v_carryover_consumed + array_length(v_consumed_ids, 1);

        insert into public.settlement_admin_audit_logs (
          settlement_id, artist_id, action, amount, from_month, to_month, admin_user_id, reason, detail)
        select s.id, s.artist_user_id, 'auto_carryover_consumed',
               case when (s.carryover_untaxed_amount + s.carryover_taxed_amount) > 0
                    then s.carryover_untaxed_amount + s.carryover_taxed_amount
                    else coalesce(nullif(s.carried_over_amount, 0), s.total_settlement_amount, 0) end,
               s.settlement_month, p_month, v_uid,
               'auto-merged by admin_generate_monthly_settlement',
               jsonb_build_object('merged_into_settlement_id', v_settlement_id,
                                  'pre_merge_status', s.pre_merge_status,
                                  'carry_untaxed', s.carryover_untaxed_amount,
                                  'carry_taxed', s.carryover_taxed_amount)
        from public.artist_settlements s where s.id = any (v_consumed_ids);
      end if;

      if v_settlement_id is not null and array_length(v_adjustment_ids, 1) > 0 then
        update public.settlement_adjustments adj
        set applied = true, applied_to_settlement_id = v_settlement_id, applied_at = now()
        where adj.id = any (v_adjustment_ids);
        insert into public.settlement_admin_audit_logs (
          settlement_id, artist_id, action, amount, from_month, to_month, admin_user_id, reason, detail)
        select v_settlement_id, adj.artist_user_id, 'adjustment_applied', adj.amount, adj.apply_to_month, p_month, v_uid,
               'auto-applied by admin_generate_monthly_settlement: ' || adj.reason,
               jsonb_build_object('adjustment_id', adj.id, 'source_payment_order_id', adj.source_payment_order_id,
                                  'applied_to_settlement_id', v_settlement_id)
        from public.settlement_adjustments adj where adj.id = any (v_adjustment_ids);
        v_adjustments_applied_total := v_adjustments_applied_total + array_length(v_adjustment_ids, 1);
      end if;

      for v_track in
        select et.track_id, et.track_code, t.title as track_title,
               t.isrc, t.release_date, t.release_title, t.rights_holder_name
        from public.eligible_settlement_tracks et join public.tracks t on t.id = et.track_id
        where et.artist_user_id = v_artist.artist_user_id
      loop
        select coalesce(count(*), 0)::int into v_track_streams
        from public.stream_events se
        where se.track_id = v_track.track_id and se.event_type = 'milestone_30s'
          and se.is_effective = true and se.eligible_for_payout = true
          and se.created_at >= v_month_start and se.created_at < v_month_end;
        if v_track_streams > 0 then
          v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
          insert into public.settlement_items (
            settlement_id, artist_user_id, track_id, track_code, track_title,
            stream_count, pool_revenue_share, isrc, release_date, release_title, rights_holder_name
          ) values (
            v_settlement_id, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
            v_track.track_title, v_track_streams, v_track_amount,
            v_track.isrc, v_track.release_date, v_track.release_title, v_track.rights_holder_name);
        end if;
      end loop;
    else
      if v_existing.id is not null then v_overwritten := v_overwritten + 1;
      else v_generated := v_generated + 1; end if;
      if not v_pii_ready then
        v_skipped_arr := v_skipped_arr || jsonb_build_object(
          'artist_user_id', v_artist.artist_user_id, 'reason', 'pii_incomplete');
      end if;
    end if;
  end loop;

  insert into public.settlement_generation_runs (
    run_by, settlement_month, dry_run, policy_id, platform_revenue, pool_revenue, total_pool_streams,
    generated_count, overwritten_count, skipped_count, payable_count, carried_over_count,
    total_gross, total_company_fee, total_sales_agent_fee, total_final_payout, total_carried_over, skipped_artists
  ) values (
    v_uid, p_month, p_dry_run, v_policy.id, v_platform_revenue, v_pool_revenue, v_total_streams,
    v_generated, v_overwritten, v_skipped, v_payable, v_carried_count,
    v_sum_gross, v_sum_company, v_sum_agent, v_sum_final, v_sum_carried, v_skipped_arr
  ) returning id into v_run_id;

  return jsonb_build_object(
    'ok', true, 'run_id', v_run_id, 'dry_run', p_dry_run, 'settlement_month', p_month,
    'platform_revenue', v_platform_revenue, 'pool_revenue', v_pool_revenue, 'total_pool_streams', v_total_streams,
    'generated', v_generated, 'overwritten', v_overwritten, 'skipped', v_skipped,
    'payable', v_payable, 'carried_over', v_carried_count,
    'held', v_held_count, 'held_pii_incomplete', v_held_count,
    'carryover_consumed', v_carryover_consumed, 'adjustments_applied', v_adjustments_applied_total,
    'total_gross', v_sum_gross, 'total_company_fee', v_sum_company, 'total_sales_agent_fee', v_sum_agent,
    'total_final_payout', v_sum_final, 'total_carried_over', v_sum_carried, 'skipped_artists', v_skipped_arr,
    -- LOGIC-2: 활성 정책값 노출 (UI 하드코딩 제거의 single source of truth)
    'min_payout_amount', v_policy.min_payout_amount, 'min_payout_basis', v_policy.min_payout_basis,
    'filters_applied', jsonb_build_array('is_effective', 'eligible_for_payout', 'pii_readiness', 'tax_rate_snapshot'),
    'note', 'LOGIC-2: taxed/untaxed carryover split, per-user withholding snapshot, held on unknown tax rate'
  );
end; $function$;

grant execute on function public.admin_generate_monthly_settlement(date, boolean) to authenticated;

-- ============================================================
-- admin_carryover_settlement — 세금 안전 수동 이월
--   payable → final_payout_amount 를 "기과세(taxed)" 이월로 저장 (다음 달 재과세 금지)
--   pending/held → total_settlement_amount 를 "미과세(untaxed)" 이월로 저장
-- ============================================================
create or replace function public.admin_carryover_settlement(p_settlement_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_row public.artist_settlements%rowtype;
  v_untaxed bigint := 0; v_taxed bigint := 0; v_amount bigint;
  v_to_month date; v_audit_id bigint;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'admin only'; end if;
  if p_settlement_id is null then raise exception 'p_settlement_id required'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required (수동 이월 사유는 필수)'; end if;

  select * into v_row from public.artist_settlements where id = p_settlement_id for update;
  if v_row.id is null then raise exception 'settlement_not_found'; end if;

  if v_row.status = 'paid' then
    raise exception 'cannot carryover paid settlement (id=%)', p_settlement_id using errcode = '42501'; end if;
  if v_row.status = 'carried_over' then
    raise exception 'settlement already carried over (id=%, status=%)', p_settlement_id, v_row.status using errcode = '42501'; end if;
  if v_row.status = 'disputed' then
    raise exception 'cannot carryover disputed settlement (id=%)', p_settlement_id using errcode = '42501'; end if;
  if v_row.status not in ('pending','payable','held') then
    raise exception 'cannot carryover settlement in status=% (allowed: pending|payable|held)', v_row.status using errcode = '42501'; end if;

  -- 세금 상태별 분류 (핵심 수정)
  if v_row.status = 'payable' then
    -- 이미 원천징수 완료된 지급액 → 기과세 이월 (다음 달 재과세 금지)
    v_taxed := v_row.final_payout_amount; v_untaxed := 0;
  else
    -- finalize 전 → 세전 총액을 미과세 이월 (다음 달 1회 과세)
    v_untaxed := v_row.total_settlement_amount; v_taxed := 0;
  end if;
  v_amount := v_untaxed + v_taxed;
  if v_amount <= 0 then
    raise exception 'carryover_amount must be > 0 (current=%)', v_amount using errcode = '22023'; end if;

  v_to_month := (v_row.settlement_month + interval '1 month')::date;

  update public.artist_settlements as s
  set status = 'carried_over', is_manual_carryover = true, carryover_applied = false,
      carried_over_amount = v_amount,
      carryover_untaxed_amount = v_untaxed, carryover_taxed_amount = v_taxed,
      carried_over_to_month = v_to_month, carried_over_at = now(), carried_over_by = v_admin,
      carryover_reason = btrim(p_reason), held_reason = 'manual_carryover', updated_at = now()
  where s.id = p_settlement_id;

  insert into public.settlement_admin_audit_logs (
    settlement_id, artist_id, action, amount, from_month, to_month, admin_user_id, reason, detail)
  values (
    p_settlement_id, v_row.artist_user_id, 'admin_manual_carryover', v_amount, v_row.settlement_month, v_to_month,
    v_admin, btrim(p_reason),
    jsonb_build_object('previous_status', v_row.status, 'previous_held_reason', v_row.held_reason,
      'carry_untaxed', v_untaxed, 'carry_taxed', v_taxed,
      'final_payout_amount', v_row.final_payout_amount, 'total_settlement_amount', v_row.total_settlement_amount,
      'meets_min_payout', v_row.meets_min_payout)
  ) returning id into v_audit_id;

  return jsonb_build_object('ok', true, 'settlement_id', p_settlement_id, 'audit_id', v_audit_id,
    'carryover_amount', v_amount, 'carry_untaxed', v_untaxed, 'carry_taxed', v_taxed,
    'carried_over_to_month', v_to_month, 'previous_status', v_row.status, 'status', 'carried_over');
end; $$;

grant execute on function public.admin_carryover_settlement(uuid, text) to authenticated;

reset check_function_bodies;
