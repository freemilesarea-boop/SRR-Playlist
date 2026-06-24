-- 0348 — 아티스트 정산 버전 관리 (X6.45)
--
-- 요구사항:
--   1) status='pending' (또는 'held') 정산은 "실제 생성" 시 재생성 허용 — 기존 정책 유지.
--   2) 재생성 시 기존 row 를 DELETE 하지 말고 version + 1 로 새 row 생성 (이력 보존).
--   3) 동일 (settlement_month, artist_user_id) 에서 최신 version 만 is_current = true.
--   4) status 가 finalized(=payable/carried_over/paid/disputed) / paid 인 정산은 재생성 금지
--      (= pending / held 만 재생성). 기존 skip 정책 유지.
--   5) Dry-run 과 실제 생성이 동일한 산정 로직 사용 (단일 함수, p_dry_run 분기만 차이).
--   6) 관리자는 월별 정산 내역에서 이전 version 조회 가능
--      (admin_settlement_version_history RPC + 목록/상세 노출).
--   7) 기존 데이터 마이그레이션 — 모든 현재 정산을 version=1, is_current=true 로 백필.
--
-- 변경 전 동작:
--   admin_generate_monthly_settlement 가 pending/held 기존 row 를 in-place UPDATE
--   (settlement_items DELETE 후 재삽입) — 이력이 남지 않음.
--
-- 변경 후 동작:
--   기존 current row 를 is_current=false 로 봉인(supersede)하고 version+1 새 row 를
--   INSERT. 기존 row 와 그 settlement_items 는 그대로 보존됨.

-- ============================================================
-- 1) 컬럼 추가 + 백필 (요구사항 7)
-- ============================================================
alter table public.artist_settlements
  add column if not exists version int not null default 1,
  add column if not exists is_current boolean not null default true;

-- 기존 모든 정산 백필: version=1, is_current=true.
-- (UNIQUE(settlement_month, artist_user_id) 제약으로 월·아티스트당 1건이므로 안전)
update public.artist_settlements
set version = 1, is_current = true
where version is null or is_current is null or version < 1;

-- ============================================================
-- 2) 제약 / 인덱스 재구성
-- ============================================================
-- 기존 UNIQUE(settlement_month, artist_user_id) 제약 제거 (버전당 다중 row 허용)
do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'artist_settlements'
      and con.contype = 'u'
  loop
    execute format('alter table public.artist_settlements drop constraint %I', r.conname);
  end loop;
end$$;

-- version 은 (월, 아티스트) 별 유일
create unique index if not exists artist_settlements_month_artist_version_key
  on public.artist_settlements (settlement_month, artist_user_id, version);

-- 최신 version 만 is_current=true (월·아티스트당 current 1건 보장)
create unique index if not exists artist_settlements_current_unique
  on public.artist_settlements (settlement_month, artist_user_id)
  where is_current;

-- 이력 조회용
create index if not exists artist_settlements_version_history_idx
  on public.artist_settlements (settlement_month, artist_user_id, version desc);

-- ============================================================
-- 3) admin_generate_monthly_settlement — 버전 관리 적용
--    (0327 기반: in-place overwrite → supersede + version+1 insert)
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
  v_prev_carried bigint; v_adjustments_sum bigint;
  v_total bigint; v_meets_min boolean;
  v_withholding bigint; v_final_payout bigint; v_carried_over bigint;
  v_settlement_id uuid; v_track record;
  v_track_streams int; v_track_amount bigint;
  v_new_version int;
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
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only'; end if;
  perform pg_advisory_xact_lock(hashtext('settlement_gen:' || p_month::text));

  select * into v_policy from public.settlement_policies
  where effective_from <= p_month order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'no settlement policy effective for %', p_month; end if;

  v_month_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  -- X6.44: platform_revenue 는 settlement_period_month 기반 (KST 월 경계 명시)
  select coalesce(sum(po.amount), 0)::bigint into v_platform_revenue
  from public.payment_orders po
  where po.status = 'paid'
    and po.settlement_period_month = p_month;
  v_pool_revenue := floor(v_platform_revenue * v_policy.pool_revenue_ratio);

  select coalesce(count(*), 0)::bigint into v_total_streams
  from public.stream_events se
  join public.eligible_settlement_tracks et on et.track_id = se.track_id
  where se.event_type = 'milestone_30s' and se.is_effective = true
    and se.eligible_for_payout = true
    and se.created_at >= v_month_start and se.created_at < v_month_end;

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
        and s.is_current = true
        and (
          s.status in ('pending','held')
          or (s.status = 'carried_over' and coalesce(s.carryover_applied, false) = false)
        )
      union
      select adj.artist_user_id from public.settlement_adjustments adj
      where adj.apply_to_month = p_month and adj.applied = false
    ) u
  loop
    -- 현재(is_current) row 만 조회 — 이전 version 은 봉인됨
    select id, status, version into v_existing
    from public.artist_settlements
    where settlement_month = p_month
      and artist_user_id = v_artist.artist_user_id
      and is_current = true;

    -- 요구사항 4: finalized/paid (= pending/held 외) 는 재생성 금지 → skip
    if v_existing.id is not null and v_existing.status not in ('pending','held') then
      v_skipped := v_skipped + 1;
      v_skipped_arr := v_skipped_arr || jsonb_build_object(
        'artist_user_id', v_artist.artist_user_id,
        'existing_status', v_existing.status, 'reason', 'finalized_or_paid');
      continue;
    end if;

    -- 재생성 시: 직전 current 에 흡수됐던 prior-month row 들을 원복 (무한 누적 방지)
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

    -- streaming_revenues 는 immutable 트리거가 UPDATE 를 차단하므로
    -- (0060 설계 의도: RPC 는 DELETE+INSERT). 재생성 시 ON CONFLICT DO UPDATE 가
    -- 트리거에 걸리지 않도록 이 아티스트·월 snapshot 을 먼저 삭제 후 재삽입한다.
    if not p_dry_run then
      delete from public.streaming_revenues
      where revenue_month = p_month and artist_user_id = v_artist.artist_user_id;
    end if;

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

    -- 직전 미지급/미흡수 정산 합산 (current 만)
    select
      coalesce(sum(
        coalesce(nullif(s.carried_over_amount, 0), s.total_settlement_amount, 0)
      ), 0)::bigint,
      coalesce(array_agg(s.id) filter (where s.id is not null), '{}'::uuid[])
    into v_prev_carried, v_consumed_ids
    from public.artist_settlements s
    where s.artist_user_id = v_artist.artist_user_id
      and s.settlement_month < p_month
      and s.is_current = true
      and (
        s.status in ('pending','held')
        or (s.status = 'carried_over' and coalesce(s.carryover_applied, false) = false)
      );

    select
      coalesce(sum(adj.amount), 0)::bigint,
      coalesce(array_agg(adj.id) filter (where adj.id is not null), '{}'::bigint[])
    into v_adjustments_sum, v_adjustment_ids
    from public.settlement_adjustments adj
    where adj.artist_user_id = v_artist.artist_user_id
      and adj.apply_to_month = p_month
      and adj.applied = false;

    v_prev_carried := v_prev_carried + v_adjustments_sum;
    v_total := v_artist_net + v_prev_carried;

    if v_total < v_policy.min_payout_amount then
      v_meets_min := false;
    elsif v_policy.min_payout_basis = 'gross' then
      v_meets_min := true;
    else
      v_meets_min := ((v_total - floor(v_total * v_policy.withholding_tax_ratio)) >= v_policy.min_payout_amount);
    end if;

    if v_meets_min then
      v_withholding := floor(v_total * v_policy.withholding_tax_ratio)::bigint;
      v_final_payout := greatest(v_total - v_withholding, 0); v_carried_over := 0;
    else
      v_withholding := 0;
      v_final_payout := 0;
      v_carried_over := v_total;
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
        -- 요구사항 2,3: 기존 current row 를 봉인 (DELETE 금지) → version+1 새 row 생성
        update public.artist_settlements
        set is_current = false, updated_at = now()
        where id = v_existing.id;
        v_new_version := coalesce(v_existing.version, 1) + 1;
        v_overwritten := v_overwritten + 1;
      else
        v_new_version := 1;
        v_generated := v_generated + 1;
      end if;

      insert into public.artist_settlements (
        settlement_month, artist_user_id, policy_id,
        gross_settlement_amount, company_fee_amount,
        sales_agent_id, sales_agent_code, sales_agent_commission_rate, sales_agent_fee_amount,
        artist_net_settlement, previous_carried_amount, total_settlement_amount,
        meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
        payout_account_id, payout_bank_name, payout_account_holder, masked_account_number,
        artist_email, status, held_reason, created_by,
        version, is_current
      ) values (
        p_month, v_artist.artist_user_id, v_policy.id,
        v_gross, v_company_fee, v_sales_agent.sales_agent_id, v_sales_agent.code,
        v_sales_agent.commission_rate, v_agent_fee,
        v_artist_net, v_prev_carried, v_total,
        v_meets_min, v_withholding, v_final_payout, v_carried_over,
        v_payout.id, v_payout.bank_name, v_payout.account_holder,
        public._mask_account_number(v_payout.account_number),
        v_artist_email, v_final_status, v_final_held_reason, v_uid,
        v_new_version, true
      ) returning id into v_settlement_id;

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

      if v_settlement_id is not null and array_length(v_adjustment_ids, 1) > 0 then
        update public.settlement_adjustments adj
        set applied = true,
            applied_to_settlement_id = v_settlement_id,
            applied_at = now()
        where adj.id = any (v_adjustment_ids);

        insert into public.settlement_admin_audit_logs (
          settlement_id, artist_id, action, amount, from_month, to_month,
          admin_user_id, reason, detail
        )
        select v_settlement_id, adj.artist_user_id, 'adjustment_applied',
               adj.amount, adj.apply_to_month, p_month, v_uid,
               'auto-applied by admin_generate_monthly_settlement: ' || adj.reason,
               jsonb_build_object('adjustment_id', adj.id,
                                  'source_payment_order_id', adj.source_payment_order_id,
                                  'applied_to_settlement_id', v_settlement_id)
        from public.settlement_adjustments adj
        where adj.id = any (v_adjustment_ids);

        v_adjustments_applied_total := v_adjustments_applied_total + array_length(v_adjustment_ids, 1);
      end if;

      -- settlement_items 는 새 version row 에 박제 (기존 version 의 items 는 보존)
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
      -- dry_run: 산정 로직은 위와 동일, DB write 만 생략 (요구사항 6: dry-run == 실제)
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
    'adjustments_applied', v_adjustments_applied_total,
    'total_gross', v_sum_gross, 'total_company_fee', v_sum_company,
    'total_sales_agent_fee', v_sum_agent,
    'total_final_payout', v_sum_final, 'total_carried_over', v_sum_carried,
    'skipped_artists', v_skipped_arr,
    'filters_applied', jsonb_build_array('is_effective', 'eligible_for_payout', 'pii_readiness'),
    'note', 'X6.45: pending/held 재생성 시 version+1 (이력 보존), 최신만 is_current'
  );
end; $function$;

grant execute on function public.admin_generate_monthly_settlement(date, boolean) to authenticated;

-- ============================================================
-- 4) admin_settlement_list — is_current 만 + version/is_current 노출
--    (0312 기반)
-- ============================================================
drop function if exists public.admin_settlement_list(date, text, text);

create or replace function public.admin_settlement_list(
  p_month date default null,
  p_status text default null,
  p_search text default null
)
returns table(
  id uuid, settlement_month date, artist_user_id uuid,
  artist_nickname text, artist_email text,
  gross_settlement_amount bigint, company_fee_amount bigint,
  sales_agent_fee_amount bigint, artist_net_settlement bigint,
  previous_carried_amount bigint, total_settlement_amount bigint,
  meets_min_payout boolean, withholding_tax_amount bigint,
  final_payout_amount bigint, carried_over_amount bigint,
  status text, finalized_at timestamptz, paid_at timestamptz, created_at timestamptz,
  payout_account_id uuid, legal_name text,
  rrn_masked text, has_rrn boolean,
  bank_name text, masked_account_number text, account_holder text,
  has_account_number boolean,
  tax_withholding_type text, payout_account_status text,
  is_manual_carryover boolean, carryover_applied boolean,
  carried_over_to_month date, carryover_reason text,
  held_reason text,
  merged_into_settlement_id uuid, payout_memo text,
  -- X6.45 버전 관리
  version int, is_current boolean
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pattern text := case when p_search is null or length(btrim(p_search))=0
                         then null else '%' || btrim(p_search) || '%' end;
  v_key text;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  v_key := public._payout_pii_key();

  return query
  select s.id, s.settlement_month, s.artist_user_id,
    coalesce(u.nickname, '')::text, coalesce(au.email::text, '')::text,
    s.gross_settlement_amount, s.company_fee_amount, s.sales_agent_fee_amount,
    s.artist_net_settlement, s.previous_carried_amount, s.total_settlement_amount,
    s.meets_min_payout, s.withholding_tax_amount, s.final_payout_amount, s.carried_over_amount,
    s.status, s.finalized_at, s.paid_at, s.created_at,
    pa.id as payout_account_id,
    pa.legal_name,
    case when pa.rrn_encrypted is not null
         then public._mask_resident_number(pgp_sym_decrypt(pa.rrn_encrypted, v_key))
         else null end as rrn_masked,
    (pa.rrn_encrypted is not null) as has_rrn,
    coalesce(pa.bank_name, s.payout_bank_name) as bank_name,
    coalesce(s.masked_account_number,
             case when pa.account_number_encrypted is not null
                  then public._mask_account_number(pgp_sym_decrypt(pa.account_number_encrypted, v_key))
                  else null end) as masked_account_number,
    coalesce(pa.account_holder, s.payout_account_holder) as account_holder,
    (pa.account_number_encrypted is not null) as has_account_number,
    pa.tax_withholding_type,
    case
      when pa.id is null then 'missing'
      when pa.verification_status <> 'verified' then 'pending'
      when pa.rrn_encrypted is null or pa.account_number_encrypted is null
        or pa.legal_name is null or pa.tax_consent_at is null then 'verified_partial'
      else 'ready'
    end as payout_account_status,
    coalesce(s.is_manual_carryover, false) as is_manual_carryover,
    coalesce(s.carryover_applied, false) as carryover_applied,
    s.carried_over_to_month,
    s.carryover_reason,
    s.held_reason,
    s.merged_into_settlement_id,
    s.payout_memo,
    s.version,
    s.is_current
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  left join public.artist_payout_accounts pa
         on pa.id = s.payout_account_id
         or (s.payout_account_id is null and pa.user_id = s.artist_user_id and pa.verification_status = 'verified')
  where s.is_current = true
    and (p_month is null or s.settlement_month = p_month)
    and (p_status is null or s.status = p_status)
    and (v_pattern is null or coalesce(u.nickname, '') ilike v_pattern or coalesce(au.email::text, '') ilike v_pattern)
  order by s.settlement_month desc, s.created_at desc;
end;
$$;

grant execute on function public.admin_settlement_list(date, text, text) to authenticated;

-- ============================================================
-- 5) admin_settlement_version_history — 이전 version 조회 (요구사항 6)
-- ============================================================
create or replace function public.admin_settlement_version_history(
  p_settlement_month date,
  p_artist_user_id uuid
)
returns table(
  id uuid, settlement_month date, artist_user_id uuid,
  version int, is_current boolean, status text,
  gross_settlement_amount bigint, artist_net_settlement bigint,
  previous_carried_amount bigint, total_settlement_amount bigint,
  withholding_tax_amount bigint, final_payout_amount bigint,
  carried_over_amount bigint, meets_min_payout boolean,
  created_at timestamptz, updated_at timestamptz,
  finalized_at timestamptz, paid_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select s.id, s.settlement_month, s.artist_user_id,
    s.version, s.is_current, s.status,
    s.gross_settlement_amount, s.artist_net_settlement,
    s.previous_carried_amount, s.total_settlement_amount,
    s.withholding_tax_amount, s.final_payout_amount,
    s.carried_over_amount, s.meets_min_payout,
    s.created_at, s.updated_at, s.finalized_at, s.paid_at
  from public.artist_settlements s
  where s.settlement_month = p_settlement_month
    and s.artist_user_id = p_artist_user_id
  order by s.version desc;
end;
$$;

grant execute on function public.admin_settlement_version_history(date, uuid) to authenticated;

-- ============================================================
-- 6) get_my_settlements — 아티스트는 current version 만 조회
-- ============================================================
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
    and s.is_current = true
  order by s.settlement_month desc;
end;
$$;

grant execute on function public.get_my_settlements() to authenticated;

-- ============================================================
-- 7) admin_finalize_settlement — 봉인된(이전) version 잠금 (0060 기반 + is_current 가드)
-- ============================================================
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
  if not coalesce(v_sett.is_current, true) then
    raise exception 'cannot finalize superseded settlement version (id=%, version=%)',
      p_settlement_id, v_sett.version using errcode = '42501';
  end if;
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

-- ============================================================
-- 8) admin_mark_settlement_paid — 봉인된(이전) version 잠금 (0318 기반 + is_current 가드)
-- ============================================================
create or replace function public.admin_mark_settlement_paid(
  p_settlement_id uuid,
  p_payout_memo text default null,
  p_force_pii boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_sett record;
  v_before_status text;
  v_audit_id bigint;
  v_memo text := nullif(btrim(coalesce(p_payout_memo, '')), '');
begin
  if not public.is_super_admin() then raise exception 'admin only'; end if;
  if p_settlement_id is null then raise exception 'p_settlement_id required'; end if;

  perform pg_advisory_xact_lock(hashtext('settlement_paid:' || p_settlement_id::text));

  select * into v_sett from public.artist_settlements where id = p_settlement_id for update;
  if v_sett.id is null then raise exception 'settlement not found'; end if;

  -- X6.45: 봉인된 이전 version 은 지급 불가
  if not coalesce(v_sett.is_current, true) then
    raise exception 'cannot mark superseded settlement version as paid (id=%, version=%)',
      p_settlement_id, v_sett.version using errcode = '42501';
  end if;

  if v_sett.status = 'paid' then
    return jsonb_build_object(
      'ok', true, 'settlement_id', p_settlement_id, 'status', 'paid',
      'already_paid', true, 'paid_at', v_sett.paid_at
    );
  end if;

  if v_sett.status = 'carried_over' then
    raise exception 'cannot mark carried_over settlement as paid (id=%, merged_into=%)',
      p_settlement_id, v_sett.merged_into_settlement_id using errcode = '42501';
  end if;
  if v_sett.status = 'disputed' then
    raise exception 'cannot mark disputed settlement as paid — resolve dispute first (id=%)',
      p_settlement_id using errcode = '42501';
  end if;
  if v_sett.status not in ('pending','payable','held') then
    raise exception 'mark_paid not allowed for status=% (allowed: pending|payable|held)',
      v_sett.status using errcode = '42501';
  end if;

  if v_sett.merged_into_settlement_id is not null then
    raise exception 'cannot mark merged settlement as paid (id=%, merged_into=%)',
      p_settlement_id, v_sett.merged_into_settlement_id using errcode = '42501';
  end if;

  if coalesce(v_sett.final_payout_amount, 0) <= 0 then
    raise exception 'cannot mark as paid: final_payout_amount=% (정산이 finalize 또는 meets_min 통과해야 지급 가능)',
      v_sett.final_payout_amount using errcode = '22023';
  end if;

  if v_sett.status = 'held'
     and v_sett.held_reason = 'pii_incomplete'
     and not coalesce(p_force_pii, false) then
    raise exception 'PII 미완료 정산 — p_force_pii=true 로 명시적 override 필요 (id=%)',
      p_settlement_id using errcode = '42501';
  end if;

  v_before_status := v_sett.status;

  update public.artist_settlements set
    status = 'paid',
    paid_at = now(),
    paid_by = v_uid,
    payout_memo = v_memo,
    finalized_at = coalesce(finalized_at, now()),
    updated_at = now()
  where id = p_settlement_id;

  insert into public.settlement_admin_audit_logs (
    settlement_id, artist_id, action, amount, from_month, to_month,
    admin_user_id, reason, detail
  ) values (
    p_settlement_id, v_sett.artist_user_id, 'mark_paid',
    v_sett.final_payout_amount, v_sett.settlement_month, null,
    v_uid, v_memo,
    jsonb_build_object(
      'before_status', v_before_status,
      'after_status', 'paid',
      'force_pii', coalesce(p_force_pii, false),
      'held_reason_at_mark', v_sett.held_reason,
      'total_settlement_amount', v_sett.total_settlement_amount,
      'previous_carried_amount', v_sett.previous_carried_amount,
      'withholding_tax_amount', v_sett.withholding_tax_amount
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'settlement_id', p_settlement_id,
    'status', 'paid',
    'before_status', v_before_status,
    'audit_id', v_audit_id,
    'final_payout_amount', v_sett.final_payout_amount,
    'paid_at', now()
  );
end;
$$;

grant execute on function public.admin_mark_settlement_paid(uuid, text, boolean) to authenticated;
