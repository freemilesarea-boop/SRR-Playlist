-- 0315 — 정산 생성 시 이전 미지급 자동 합산 (X6.28)
--
-- 버그:
--   admin_generate_monthly_settlement 의 prev_carried 조회가
--   `status in ('carried_over','payable','paid','held','disputed')` 로
--   pending 을 제외 + limit 1 (직전 1건만) 사용 → 5월 pending 정산이
--   6월 generate 시 흡수 안 되고, 동일 아티스트가 5월/6월 두 row 로 잔존
--   (운영 DB 7건 확인 — 66,519원 미반영).
--
-- 수정:
--   1) 이월 대상: status in ('pending','held') OR (status='carried_over'
--      AND carryover_applied=false). 이전 모든 월의 미지급/미흡수 row 를
--      SUM 으로 합산.
--   2) row 별 이월 금액 = coalesce(nullif(carried_over_amount,0),
--      total_settlement_amount, 0). pending/held 가 finalize 전이라
--      carried_over_amount=0 인 케이스 보정.
--   3) 새 row 생성/갱신 후, 소비된 prior row 들을 status='carried_over'
--      + carryover_applied=true + merged_into_settlement_id=new_id 로 표시.
--   4) regenerate 시 무한 누적 방지 — overwrite 직전 prior rows 의
--      merged_into 를 해제 (status 는 pre_merge_status 로 복원).
--
-- 스키마 추가:
--   * merged_into_settlement_id (uuid, FK self) — 이 row 가 흡수된 대상
--   * auto_merged_at (timestamptz)               — 시스템 자동 합산 시각
--   * pre_merge_status (text)                    — 합산 전 원본 status
--
-- 트리거 완화:
--   _artist_settlements_protect 가 NEW.merged_into_settlement_id 가 새로
--   set 되는 경우 (시스템 자동 합산) 에도 status/carry 필드 전환 허용.
--   기존 manual_carryover 경로는 그대로 유지.

-- ===== 1) 컬럼 추가 =====
alter table public.artist_settlements
  add column if not exists merged_into_settlement_id uuid references public.artist_settlements(id),
  add column if not exists auto_merged_at timestamptz,
  add column if not exists pre_merge_status text;

create index if not exists artist_settlements_merged_into_idx
  on public.artist_settlements (merged_into_settlement_id)
  where merged_into_settlement_id is not null;

-- ===== 2) 트리거 완화 =====
create or replace function public._artist_settlements_protect()
returns trigger language plpgsql set search_path = public as $$
declare
  v_immutable_calc_changed boolean;
  v_manual_carryover_just_set boolean;
  v_auto_merge_just_set boolean;
  v_auto_merge_just_cleared boolean;
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'paid' then
      raise exception 'paid settlement cannot be deleted (id=%)', OLD.id using errcode = '42501';
    end if;
    return OLD;
  end if;
  if OLD.status = 'paid' then
    raise exception 'paid settlement is immutable (id=%)', OLD.id using errcode = '42501';
  end if;
  if NEW.settlement_month <> OLD.settlement_month then
    raise exception 'cannot change settlement_month of settlement %', OLD.id using errcode = '42501';
  end if;
  if NEW.artist_user_id <> OLD.artist_user_id then
    raise exception 'cannot change artist_user_id of settlement %', OLD.id using errcode = '42501';
  end if;
  if NEW.policy_id <> OLD.policy_id then
    raise exception 'cannot change policy_id of settlement %', OLD.id using errcode = '42501';
  end if;

  v_manual_carryover_just_set :=
    (coalesce(OLD.is_manual_carryover, false) = false)
    and (coalesce(NEW.is_manual_carryover, false) = true);
  v_auto_merge_just_set :=
    (OLD.merged_into_settlement_id is null)
    and (NEW.merged_into_settlement_id is not null);
  v_auto_merge_just_cleared :=
    (OLD.merged_into_settlement_id is not null)
    and (NEW.merged_into_settlement_id is null);

  v_immutable_calc_changed :=
    NEW.gross_settlement_amount is distinct from OLD.gross_settlement_amount or
    NEW.company_fee_amount is distinct from OLD.company_fee_amount or
    NEW.sales_agent_fee_amount is distinct from OLD.sales_agent_fee_amount or
    NEW.artist_net_settlement is distinct from OLD.artist_net_settlement or
    NEW.previous_carried_amount is distinct from OLD.previous_carried_amount or
    NEW.total_settlement_amount is distinct from OLD.total_settlement_amount or
    NEW.withholding_tax_amount is distinct from OLD.withholding_tax_amount or
    NEW.final_payout_amount is distinct from OLD.final_payout_amount or
    NEW.meets_min_payout is distinct from OLD.meets_min_payout;

  if OLD.status <> 'pending' and v_immutable_calc_changed then
    raise exception 'cannot change calculated amounts after finalize (id=%, status=%)', OLD.id, OLD.status using errcode = '42501';
  end if;

  -- X6.28: carried_over_amount 변경 허용 케이스 확장
  --   (a) manual carryover 신규 진입 — 기존 X6.25 정책
  --   (b) auto-merge 시스템 합산 — merged_into_settlement_id 신규 set
  --   (c) un-merge — merged_into_settlement_id 해제 (regenerate 시)
  if OLD.status <> 'pending'
     and NEW.carried_over_amount is distinct from OLD.carried_over_amount
     and not v_manual_carryover_just_set
     and not v_auto_merge_just_set
     and not v_auto_merge_just_cleared
  then
    raise exception 'cannot change carried_over_amount after finalize (id=%, status=%)', OLD.id, OLD.status using errcode = '42501';
  end if;

  return NEW;
end;
$$;

-- ===== 3) admin_generate_monthly_settlement 새 합산 로직 =====
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
  v_prev_carried bigint;
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
  v_carryover_consumed int := 0;
  v_consumed_ids uuid[];
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

  -- 이번 달 스트림이 있는 아티스트 + 스트림 없어도 직전 미지급 잔액 있는 아티스트 모두 처리
  for v_artist in
    select distinct artist_user_id from (
      select et.artist_user_id
      from public.eligible_settlement_tracks et
      where exists (
        select 1 from public.stream_events se
        where se.track_id = et.track_id and se.event_type = 'milestone_30s'
          and se.is_effective = true and se.eligible_for_payout = true
          and se.created_at >= v_month_start and se.created_at < v_month_end
      )
      union
      select s.artist_user_id from public.artist_settlements s
      where s.settlement_month < p_month
        and (
          s.status in ('pending','held')
          or (s.status = 'carried_over' and coalesce(s.carryover_applied, false) = false)
        )
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

    -- X6.28: regenerate 시 prior 누적 방지 — 기존 row 가 흡수했던 prior 들 해제
    if v_existing.id is not null and not p_dry_run then
      update public.artist_settlements as s
      set status = coalesce(s.pre_merge_status, 'pending'),
          carryover_applied = false,
          merged_into_settlement_id = null,
          carried_over_to_month = null,
          auto_merged_at = null,
          pre_merge_status = null
      where s.merged_into_settlement_id = v_existing.id;
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

    -- ✅ X6.28: 모든 미지급 prior row 의 effective 금액 SUM
    --    행별: carried_over_amount 가 0 이 아니면 그 값, 아니면 total_settlement_amount
    --    (pending/held 가 finalize 전 0 인 케이스 보정)
    select
      coalesce(sum(
        coalesce(nullif(s.carried_over_amount, 0), s.total_settlement_amount, 0)
      ), 0)::bigint,
      coalesce(array_agg(s.id) filter (where s.id is not null), '{}'::uuid[])
    into v_prev_carried, v_consumed_ids
    from public.artist_settlements s
    where s.artist_user_id = v_artist.artist_user_id
      and s.settlement_month < p_month
      and (
        s.status in ('pending','held')
        or (s.status = 'carried_over' and coalesce(s.carryover_applied, false) = false)
      );

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
          status = v_final_status, held_reason = v_final_held_reason,
          updated_at = now()
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

      -- ✅ X6.28: SUM 에 들어간 prior row 들을 시스템 자동 합산으로 표시
      if v_settlement_id is not null and array_length(v_consumed_ids, 1) > 0 then
        update public.artist_settlements as s
        set pre_merge_status = case
              when s.status = 'carried_over' then s.pre_merge_status
              else s.status
            end,
            status = 'carried_over',
            is_manual_carryover = false,
            carryover_applied = true,
            merged_into_settlement_id = v_settlement_id,
            carried_over_to_month = p_month,
            carried_over_at = coalesce(s.carried_over_at, now()),
            carried_over_by = coalesce(s.carried_over_by, v_uid),
            auto_merged_at = now(),
            carried_over_amount = coalesce(nullif(s.carried_over_amount, 0), s.total_settlement_amount, 0),
            held_reason = 'auto_merged_into_' || to_char(p_month, 'YYYY-MM'),
            updated_at = now()
        where s.id = any (v_consumed_ids);
        v_carryover_consumed := v_carryover_consumed + array_length(v_consumed_ids, 1);

        insert into public.settlement_admin_audit_logs (
          settlement_id, artist_id, action, amount, from_month, to_month,
          admin_user_id, reason, detail
        )
        select s.id, s.artist_user_id, 'manual_carryover',
               coalesce(nullif(s.carried_over_amount, 0), s.total_settlement_amount, 0),
               s.settlement_month, p_month, v_uid,
               'auto-merged by admin_generate_monthly_settlement',
               jsonb_build_object('merged_into_settlement_id', v_settlement_id,
                                  'pre_merge_status', s.pre_merge_status)
        from public.artist_settlements s where s.id = any (v_consumed_ids);
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
    'note', 'X6.28: pending/held auto-merge + multi-month SUM consolidation'
  );
end; $$;
