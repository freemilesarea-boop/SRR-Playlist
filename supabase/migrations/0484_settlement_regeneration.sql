-- ============================================================================
-- 0484_settlement_regeneration.sql
-- 아티스트 정산 재생성 허용 — "언제 다시 돌려도 최신 데이터로 재산정"
--
-- ── 문제 ────────────────────────────────────────────────────────────────────
-- 관리자 화면에서 이미 생성된 달을 "실제 생성"하면 항상 실패한다
-- ("이미 확정된 항목이라 변경할 수 없습니다"). 7월초에 잘못 생성한 정산을 8월에
-- 다시 산정하려 해도 불가능했다.
--
-- 실측 진단 (2026-07 기준):
--   · 7월 정산 34건은 전부 pending(21)/held(13) — 확정·지급완료는 0건이다.
--     즉 "확정이라서" 막힌 게 아니다.
--   · 실제 예외: `streaming_revenues is immutable` (sqlstate 42501).
--     admin_generate_monthly_settlement 은 트랙별 매출을
--     `on conflict (revenue_month, artist_user_id, track_id) do update` 로 쓰는데,
--     _streaming_revenues_protect 가 UPDATE 를 전면 차단한다.
--     → 같은 달을 두 번째로 생성하면 무조건 실패. 어떤 상태든 재생성 불가였다.
--   · 뒤이어 걸리는 차단 2개:
--       _settlement_items_protect : 부모 status 가 'pending' 일 때만 DELETE 허용
--                                   → held 13건 재생성 불가
--       _artist_settlements_protect: OLD.status <> 'pending' 이면 계산금액 변경 차단
--                                   → held 금액 갱신 불가
--   · 참고: 0348(정산 버전관리)은 이 프로젝트에 적용된 적이 없다.
--     UI 의 "재생성 (VERSION+1) / version 으로 보존" 문구는 0348 을 전제로 쓰였으나
--     실제 DB 는 in-place 덮어쓰기 함수다. 이 마이그레이션은 21개 읽기 경로를
--     건드리는 버전 컬럼 도입 대신, 덮어쓰기 직전 스냅샷을 별도 append-only 테이블에
--     남겨 이력을 보존한다(읽기 경로 영향 0).
--
-- ── 조치 ────────────────────────────────────────────────────────────────────
-- (1) artist_settlement_revisions — 덮어쓰기 직전 스냅샷(정산행 + 트랙 items).
--     append-only. admin_settlement_revision_history() 로 조회.
-- (2) 재생성 세션 플래그 `srr.settlement_regen` 도입. 세 protect 트리거는 이 플래그가
--     켜진 트랜잭션(= 정산 생성 함수 내부)에서만 재계산을 허용한다. 그 밖의 모든
--     경로에서는 기존 불변성이 그대로 유지된다(무분별한 완화 아님).
-- (3) admin_generate_monthly_settlement 상태별 분기:
--       pending/held/payable/disputed → 스냅샷 후 재산정 덮어쓰기
--       paid                          → 행 불변. 재산정 차액만 다음 미지급월
--                                        settlement_adjustments 로 누적 등록
--       carried_over                  → skip (이미 다음 달로 이월 소비됨.
--                                        덮어쓰면 하류 정산이 깨진다)
--
-- ── paid 를 덮어쓰지 않는 이유 ──────────────────────────────────────────────
-- paid 는 실제로 송금이 끝난 기록이다. 덮어쓰면 장부 금액과 실제 이체액이 어긋나고
-- 그 차액이 추적되지 않는다. 대신 차액을 조정 원장(settlement_adjustments)에 올려
-- 다음 달 정산에 자연스럽게 합류시킨다 — 이 시스템이 환불 보정에 이미 쓰는 방식이다.
-- 차액은 "누적 기준"으로 계산(이미 등록된 auto_paid_recalc 합을 차감)하므로 몇 번을
-- 다시 돌려도 중복 적립되지 않는다.
--
-- ── 안전성 ──────────────────────────────────────────────────────────────────
-- · paid 정산행/그 items/그 달 streaming_revenues 는 어떤 경로로도 변경되지 않는다.
-- · 트리거 완화는 세션 플래그가 켜진 트랜잭션에 한정 — 일반 UPDATE/DELETE 는 그대로 차단.
-- · 덮어쓰기 전 스냅샷이 남으므로 이전 산정 결과를 언제든 조회·대조할 수 있다.
-- · 읽기 RPC(admin_settlement_list/detail, get_my_settlements 등) 무변경.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (1) 정산 스냅샷 이력 (append-only)
-- ----------------------------------------------------------------------------
create table if not exists public.artist_settlement_revisions (
  id                uuid primary key default gen_random_uuid(),
  settlement_id     uuid not null references public.artist_settlements(id) on delete cascade,
  settlement_month  date not null,
  artist_user_id    uuid not null,
  revision          int  not null,
  snapshot          jsonb not null,
  items_snapshot    jsonb not null default '[]'::jsonb,
  superseded_at     timestamptz not null default now(),
  superseded_by     uuid,
  reason            text,
  unique (settlement_id, revision)
);

create index if not exists artist_settlement_revisions_month_idx
  on public.artist_settlement_revisions (settlement_month desc, artist_user_id);

alter table public.artist_settlement_revisions enable row level security;
revoke all on public.artist_settlement_revisions from public, anon, authenticated;
grant select, insert on public.artist_settlement_revisions to service_role;

-- append-only 보장
create or replace function public._artist_settlement_revisions_protect()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  raise exception 'artist_settlement_revisions is append-only (%)', TG_OP using errcode = '42501';
end;
$$;

drop trigger if exists trg_artist_settlement_revisions_protect on public.artist_settlement_revisions;
create trigger trg_artist_settlement_revisions_protect
  before update or delete on public.artist_settlement_revisions
  for each row execute function public._artist_settlement_revisions_protect();

-- 관리자 조회 RPC
create or replace function public.admin_settlement_revision_history(p_settlement_id uuid)
returns table(revision int, superseded_at timestamptz, superseded_by uuid,
              reason text, snapshot jsonb, items_snapshot jsonb)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
    select r.revision, r.superseded_at, r.superseded_by, r.reason, r.snapshot, r.items_snapshot
    from public.artist_settlement_revisions r
    where r.settlement_id = p_settlement_id
    order by r.revision desc;
end;
$$;

revoke all on function public.admin_settlement_revision_history(uuid) from public;
grant execute on function public.admin_settlement_revision_history(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- (2) 재계산 게이트 — 정산 생성 함수 내부에서만 불변성 완화
-- ----------------------------------------------------------------------------
create or replace function public._settlement_regen_active()
returns boolean language sql stable set search_path to 'public'
as $$ select coalesce(current_setting('srr.settlement_regen', true), 'off') = 'on'; $$;

-- streaming_revenues: 재계산 중에는 지표 갱신 허용. 키 컬럼 변경은 여전히 금지.
create or replace function public._streaming_revenues_protect()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if TG_OP = 'UPDATE' then
    if not public._settlement_regen_active() then
      raise exception 'streaming_revenues is immutable (id=%)', OLD.id using errcode = '42501';
    end if;
    if NEW.revenue_month is distinct from OLD.revenue_month
       or NEW.artist_user_id is distinct from OLD.artist_user_id
       or NEW.track_id is distinct from OLD.track_id then
      raise exception 'streaming_revenues key columns are immutable (id=%)', OLD.id using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$$;

-- settlement_items: 재계산 중에는 부모가 paid 가 아니면 삭제 허용(재산정 후 재삽입).
create or replace function public._settlement_items_protect()
returns trigger language plpgsql set search_path to 'public'
as $$
declare v_parent_status text;
begin
  if TG_OP = 'UPDATE' then
    raise exception 'settlement_items is immutable (id=%)', OLD.id using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then
    select status into v_parent_status from public.artist_settlements where id = OLD.settlement_id;
    if v_parent_status = 'paid' then
      raise exception 'cannot delete settlement_items of paid settlement' using errcode = '42501';
    end if;
    if v_parent_status is not null and v_parent_status <> 'pending'
       and not public._settlement_regen_active() then
      raise exception 'cannot delete settlement_items of finalized settlement (parent_status=%)', v_parent_status using errcode = '42501';
    end if;
    return OLD;
  end if;
  return NEW;
end;
$$;

-- artist_settlements: 재계산 중에는 paid 외 상태의 금액 재산정 허용.
create or replace function public._artist_settlements_protect()
returns trigger language plpgsql set search_path to 'public'
as $$
declare
  v_immutable_calc_changed boolean;
  v_manual_carryover_just_set boolean;
  v_auto_merge_just_set boolean;
  v_auto_merge_just_cleared boolean;
  v_regen boolean := public._settlement_regen_active();
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'paid' then
      raise exception 'paid settlement cannot be deleted (id=%)', OLD.id using errcode = '42501';
    end if;
    return OLD;
  end if;
  -- paid 는 재계산 중에도 절대 불변 (실제 송금 완료 기록)
  if OLD.status = 'paid' then
    raise exception 'paid settlement is immutable (id=%)', OLD.id using errcode = '42501';
  end if;
  if NEW.settlement_month <> OLD.settlement_month then
    raise exception 'cannot change settlement_month of settlement %', OLD.id using errcode = '42501';
  end if;
  if NEW.artist_user_id <> OLD.artist_user_id then
    raise exception 'cannot change artist_user_id of settlement %', OLD.id using errcode = '42501';
  end if;
  -- 정책은 재산정 시 최신 정책으로 갱신될 수 있어야 한다(그 외 경로는 기존대로 금지).
  if NEW.policy_id <> OLD.policy_id and not v_regen then
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

  if OLD.status <> 'pending' and v_immutable_calc_changed and not v_regen then
    raise exception 'cannot change calculated amounts after finalize (id=%, status=%)', OLD.id, OLD.status using errcode = '42501';
  end if;

  if OLD.status <> 'pending'
     and NEW.carried_over_amount is distinct from OLD.carried_over_amount
     and not v_manual_carryover_just_set
     and not v_auto_merge_just_set
     and not v_auto_merge_just_cleared
     and not v_regen
  then
    raise exception 'cannot change carried_over_amount after finalize (id=%, status=%)', OLD.id, OLD.status using errcode = '42501';
  end if;

  return NEW;
end;
$$;

-- ----------------------------------------------------------------------------
-- (3) 정산 생성 — 상태별 재생성 분기
-- ----------------------------------------------------------------------------
create or replace function public.admin_generate_monthly_settlement(p_month date, p_dry_run boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public'
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
  -- 0484
  v_mode text;
  v_adjusted int := 0; v_sum_adjust bigint := 0;
  v_prior_delta bigint; v_delta bigint; v_adj_month date;
  v_revision int;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only'; end if;
  perform pg_advisory_xact_lock(hashtext('settlement_gen:' || p_month::text));

  -- 0484: 재계산 게이트 ON (트랜잭션 한정). protect 트리거가 이 플래그를 보고
  -- 재산정에 한해 불변성을 완화한다. paid 행은 이 플래그와 무관하게 불변.
  perform set_config('srr.settlement_regen', 'on', true);

  select * into v_policy from public.settlement_policies
  where effective_from <= p_month order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'no settlement policy effective for %', p_month; end if;

  v_month_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  -- 차액 조정이 실려야 할 달 = 다음 달과 "아직 정산되지 않은 현재 달" 중 나중 것
  v_adj_month := greatest((p_month + interval '1 month')::date,
                          (date_trunc('month', (now() at time zone 'Asia/Seoul')))::date);

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
        and (
          s.status in ('pending','held')
          or (s.status = 'carried_over' and coalesce(s.carryover_applied, false) = false)
        )
      union
      select adj.artist_user_id from public.settlement_adjustments adj
      where adj.apply_to_month = p_month and adj.applied = false
    ) u
  loop
    select id, status, artist_net_settlement into v_existing
    from public.artist_settlements
    where settlement_month = p_month and artist_user_id = v_artist.artist_user_id;

    -- 0484: 상태별 처리 모드 결정
    v_mode := case
      when v_existing.id is null      then 'create'
      when v_existing.status = 'paid' then 'paid_adjust'   -- 행 불변 + 차액 조정
      when v_existing.status = 'carried_over' then 'skip'  -- 다음 달로 소비 완료
      else 'regen'                                          -- pending/held/payable/disputed
    end;

    if v_mode = 'skip' then
      v_skipped := v_skipped + 1;
      v_skipped_arr := v_skipped_arr || jsonb_build_object(
        'artist_user_id', v_artist.artist_user_id,
        'existing_status', v_existing.status, 'reason', 'carried_over_to_next_month');
      continue;
    end if;

    if v_mode = 'regen' and not p_dry_run then
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
      -- paid 월의 트랙별 매출 기록은 송금 근거이므로 건드리지 않는다
      if not p_dry_run and v_mode <> 'paid_adjust' then
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

    -- ── paid: 행은 그대로 두고 차액만 다음 미지급월 조정으로 누적 등록 ──────────
    if v_mode = 'paid_adjust' then
      select coalesce(sum(adj.amount), 0)::bigint into v_prior_delta
      from public.settlement_adjustments adj
      where adj.source_settlement_id = v_existing.id
        and adj.reason like 'auto_paid_recalc%';

      -- 누적 기준 차액 → 몇 번을 다시 돌려도 중복 적립되지 않음
      v_delta := v_artist_net - coalesce(v_existing.artist_net_settlement, 0) - v_prior_delta;

      if v_delta <> 0 then
        v_adjusted := v_adjusted + 1;
        v_sum_adjust := v_sum_adjust + v_delta;
        if not p_dry_run then
          insert into public.settlement_adjustments
            (artist_user_id, apply_to_month, amount, reason, source_settlement_id, applied, created_by)
          values
            (v_artist.artist_user_id, v_adj_month, v_delta,
             'auto_paid_recalc: ' || to_char(p_month, 'YYYY-MM') ||
             ' 재산정 차액 (지급완료 정산은 불변 — 차액을 ' ||
             to_char(v_adj_month, 'YYYY-MM') || ' 정산에 반영)',
             v_existing.id, false, v_uid);

          insert into public.settlement_admin_audit_logs (
            settlement_id, artist_id, action, amount, from_month, to_month,
            admin_user_id, reason, detail
          ) values (
            v_existing.id, v_artist.artist_user_id, 'adjustment_applied', v_delta,
            p_month, v_adj_month, v_uid,
            'paid settlement recalculated — delta booked as adjustment',
            jsonb_build_object('old_artist_net', v_existing.artist_net_settlement,
                               'new_artist_net', v_artist_net,
                               'prior_delta_total', v_prior_delta,
                               'delta', v_delta)
          );
        end if;
      end if;

      v_skipped_arr := v_skipped_arr || jsonb_build_object(
        'artist_user_id', v_artist.artist_user_id, 'existing_status', 'paid',
        'reason', 'paid_immutable_delta_adjusted', 'delta', v_delta);
      continue;
    end if;

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
        -- 0484: 재생성 시 해제 후 재소비될 이월분 — dry-run 과 실제 실행 결과를 일치시킨다.
        --   dry-run: 아직 병합 상태 → 이 조건이 포착. 실제 실행: 이미 해제됨 → 앞 조건이 포착.
        --   두 경로가 상호배타적이라 이중 계상되지 않는다.
        or (v_mode = 'regen' and v_existing.id is not null
            and s.merged_into_settlement_id = v_existing.id)
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
        -- 0484: 덮어쓰기 직전 스냅샷 보존 (append-only)
        select coalesce(max(r.revision), 0) + 1 into v_revision
        from public.artist_settlement_revisions r where r.settlement_id = v_existing.id;

        insert into public.artist_settlement_revisions
          (settlement_id, settlement_month, artist_user_id, revision,
           snapshot, items_snapshot, superseded_by, reason)
        select s.id, s.settlement_month, s.artist_user_id, v_revision,
               to_jsonb(s),
               coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
                         from public.settlement_items i where i.settlement_id = s.id), '[]'::jsonb),
               v_uid,
               'regenerate:' || to_char(p_month, 'YYYY-MM')
        from public.artist_settlements s where s.id = v_existing.id;

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
    'adjustments_applied', v_adjustments_applied_total,
    'paid_delta_adjusted', v_adjusted,
    'paid_delta_total', v_sum_adjust,
    'paid_delta_apply_to_month', v_adj_month,
    'total_gross', v_sum_gross, 'total_company_fee', v_sum_company,
    'total_sales_agent_fee', v_sum_agent,
    'total_final_payout', v_sum_final, 'total_carried_over', v_sum_carried,
    'skipped_artists', v_skipped_arr,
    'filters_applied', jsonb_build_array('is_effective', 'eligible_for_payout', 'pii_readiness'),
    'note', '0484: regeneration enabled (paid=delta-adjust, carried_over=skip)'
  );
end; $function$;
