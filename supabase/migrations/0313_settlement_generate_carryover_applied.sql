-- 0313 — admin_generate_monthly_settlement 이 이월 소비 표시 (X6.25)
--
-- 변경:
--   - 직전 정산의 carried_over_amount 를 prev_carried 로 합산할 때, 그
--     원본 row 의 carryover_applied=true 로 표시 (audit/UI 용).
--   - 수동 이월 (is_manual_carryover=true) 과 자동 이월 (false) 동일 처리.
--   - dry_run 일 때는 표시하지 않음.
--
-- 보존:
--   - 기존 합산 로직 그대로 (status in 'carried_over','payable','paid','held','disputed').
--   - PII 미완료 자동 held 처리 그대로.

create or replace function public.admin_generate_monthly_settlement(p_month date, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_month_start timestamptz; v_month_end timestamptz;
  v_policy record;
  v_platform_revenue bigint; v_pool_revenue bigint; v_total_streams bigint;
  v_artist record; v_existing record; v_payout record; v_sales_agent record;
  v_artist_email text;
  v_gross bigint; v_company_fee bigint; v_agent_fee bigint; v_artist_net bigint;
  v_prev_carried bigint; v_prev_id uuid;  -- ✅ X6.25 추가
  v_total bigint; v_meets_min boolean;
  v_withholding bigint; v_final_payout bigint; v_carried_over bigint;
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
  v_carryover_consumed int := 0;  -- ✅ X6.25 추가
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
  where po.status = 'paid'
    and coalesce(po.paid_at, po.created_at) >= v_month_start
    and coalesce(po.paid_at, po.created_at) <  v_month_end;
  v_pool_revenue := floor(v_platform_revenue * v_policy.pool_revenue_ratio);

  select coalesce(count(*), 0)::bigint into v_total_streams
  from public.stream_events se
  join public.eligible_settlement_tracks et on et.track_id = se.track_id
  where se.event_type = 'milestone_30s' and se.is_effective = true
    and se.eligible_for_payout = true
    and se.created_at >= v_month_start and se.created_at < v_month_end;

  for v_artist in
    select et.artist_user_id, count(distinct et.track_id) as track_count
    from public.eligible_settlement_tracks et
    where exists (
      select 1 from public.stream_events se
      where se.track_id = et.track_id and se.event_type = 'milestone_30s'
        and se.is_effective = true and se.eligible_for_payout = true
        and se.created_at >= v_month_start and se.created_at < v_month_end
    )
    group by et.artist_user_id
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

    v_pii_ready := public.artist_payout_account_ready(v_artist.artist_user_id);

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
      else v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
      end if;
      v_gross := v_gross + v_track_amount;
      if not p_dry_run then
        insert into public.streaming_revenues (
          revenue_month, artist_user_id, track_id, track_code,
          stream_count, total_pool_revenue, total_pool_streams,
          gross_artist_amount, policy_id
        ) values (
          p_month, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
          v_track_streams, v_pool_revenue, v_total_streams, v_track_amount, v_policy.id
        ) on conflict (revenue_month, artist_user_id, track_id) do update set
          stream_count = excluded.stream_count,
          total_pool_revenue = excluded.total_pool_revenue,
          total_pool_streams = excluded.total_pool_streams,
          gross_artist_amount = excluded.gross_artist_amount,
          policy_id = excluded.policy_id, computed_at = now();
      end if;
    end loop;

    v_company_fee := floor(v_gross * v_policy.company_fee_ratio)::bigint;

    select u.sales_agent_id, sa.commission_rate, sa.code into v_sales_agent
    from public.users u
    left join public.sales_agents sa on sa.id = u.sales_agent_id
    where u.id = v_artist.artist_user_id;

    if v_sales_agent.sales_agent_id is not null and v_sales_agent.commission_rate is not null then
      v_agent_fee := floor(v_gross * v_sales_agent.commission_rate / 100.0)::bigint;
    else v_agent_fee := 0; end if;
    v_artist_net := greatest(v_gross - v_company_fee - v_agent_fee, 0);

    -- ✅ X6.25: 직전 정산 id + carried_over_amount 동시 캡처
    select id, coalesce(carried_over_amount, 0)::bigint
      into v_prev_id, v_prev_carried
    from public.artist_settlements
    where artist_user_id = v_artist.artist_user_id
      and settlement_month < p_month
      and status in ('carried_over','payable','paid','held','disputed')
    order by settlement_month desc limit 1;
    v_prev_carried := coalesce(v_prev_carried, 0);
    v_total := v_artist_net + v_prev_carried;

    if v_policy.min_payout_basis = 'gross' then
      v_meets_min := (v_total >= v_policy.min_payout_amount);
    else
      v_meets_min := ((v_total - floor(v_total * v_policy.withholding_tax_ratio)) >= v_policy.min_payout_amount);
    end if;

    if v_meets_min then
      v_withholding := floor(v_total * v_policy.withholding_tax_ratio)::bigint;
      v_final_payout := v_total - v_withholding; v_carried_over := 0;
    else
      v_withholding := 0; v_final_payout := 0; v_carried_over := v_total;
    end if;

    select pa.id, pa.bank_name, pa.account_holder, pa.account_number into v_payout
    from public.artist_payout_accounts pa
    where pa.user_id = v_artist.artist_user_id and pa.verification_status = 'verified';

    select au.email::text into v_artist_email from auth.users au where au.id = v_artist.artist_user_id;

    if not v_pii_ready then
      v_final_status := 'held'; v_final_held_reason := 'pii_incomplete';
      v_held_count := v_held_count + 1;
    else
      v_final_status := 'pending'; v_final_held_reason := null;
    end if;

    v_sum_gross := v_sum_gross + v_gross;
    v_sum_company := v_sum_company + v_company_fee;
    v_sum_agent := v_sum_agent + v_agent_fee;
    v_sum_final := v_sum_final + v_final_payout;
    v_sum_carried := v_sum_carried + v_carried_over;
    if v_meets_min then v_payable := v_payable + 1; else v_carried_count := v_carried_count + 1; end if;

    if not p_dry_run then
      if v_existing.id is not null then
        delete from public.settlement_items where settlement_id = v_existing.id;
        v_settlement_id := v_existing.id;
        v_overwritten := v_overwritten + 1;
        update public.artist_settlements set
          policy_id = v_policy.id,
          gross_settlement_amount = v_gross, company_fee_amount = v_company_fee,
          sales_agent_id = v_sales_agent.sales_agent_id,
          sales_agent_code = v_sales_agent.code,
          sales_agent_commission_rate = v_sales_agent.commission_rate,
          sales_agent_fee_amount = v_agent_fee,
          artist_net_settlement = v_artist_net,
          previous_carried_amount = v_prev_carried,
          total_settlement_amount = v_total, meets_min_payout = v_meets_min,
          withholding_tax_amount = v_withholding,
          final_payout_amount = v_final_payout, carried_over_amount = v_carried_over,
          payout_account_id = v_payout.id, payout_bank_name = v_payout.bank_name,
          payout_account_holder = v_payout.account_holder,
          masked_account_number = public._mask_account_number(v_payout.account_number),
          artist_email = v_artist_email,
          status = v_final_status, held_reason = v_final_held_reason
        where id = v_existing.id;
      else
        insert into public.artist_settlements (
          settlement_month, artist_user_id, policy_id,
          gross_settlement_amount, company_fee_amount,
          sales_agent_id, sales_agent_code, sales_agent_commission_rate, sales_agent_fee_amount,
          artist_net_settlement, previous_carried_amount, total_settlement_amount,
          meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
          payout_account_id, payout_bank_name, payout_account_holder, masked_account_number,
          artist_email, status, held_reason, created_by
        ) values (
          p_month, v_artist.artist_user_id, v_policy.id,
          v_gross, v_company_fee, v_sales_agent.sales_agent_id, v_sales_agent.code,
          v_sales_agent.commission_rate, v_agent_fee,
          v_artist_net, v_prev_carried, v_total,
          v_meets_min, v_withholding, v_final_payout, v_carried_over,
          v_payout.id, v_payout.bank_name, v_payout.account_holder,
          public._mask_account_number(v_payout.account_number),
          v_artist_email, v_final_status, v_final_held_reason, v_uid
        ) returning id into v_settlement_id;
        v_generated := v_generated + 1;
      end if;

      -- ✅ X6.25: 직전 정산의 carryover 가 실제로 소비되었으면 표시
      if v_prev_id is not null and v_prev_carried > 0 then
        update public.artist_settlements as s
        set carryover_applied = true,
            updated_at = now()
        where s.id = v_prev_id and s.carryover_applied = false;
        if found then
          v_carryover_consumed := v_carryover_consumed + 1;
        end if;
      end if;

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
        if v_track_streams > 0 then
          v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
          insert into public.settlement_items (
            settlement_id, artist_user_id, track_id, track_code, track_title,
            stream_count, pool_revenue_share,
            isrc, release_date, release_title, rights_holder_name
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
    'ok', true, 'run_id', v_run_id, 'dry_run', p_dry_run,
    'settlement_month', p_month,
    'platform_revenue', v_platform_revenue, 'pool_revenue', v_pool_revenue,
    'total_pool_streams', v_total_streams,
    'generated', v_generated, 'overwritten', v_overwritten, 'skipped', v_skipped,
    'payable', v_payable, 'carried_over', v_carried_count,
    'held_pii_incomplete', v_held_count,
    'carryover_consumed', v_carryover_consumed,
    'total_gross', v_sum_gross, 'total_company_fee', v_sum_company,
    'total_sales_agent_fee', v_sum_agent,
    'total_final_payout', v_sum_final, 'total_carried_over', v_sum_carried,
    'skipped_artists', v_skipped_arr,
    'filters_applied', jsonb_build_array('is_effective', 'eligible_for_payout', 'pii_readiness'),
    'note', 'X6.25: manual carryover 포함 + carryover_applied 표시'
  );
end; $$;
