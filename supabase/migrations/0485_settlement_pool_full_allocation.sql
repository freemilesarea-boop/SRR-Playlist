-- ============================================================================
-- 0485_settlement_pool_full_allocation.sql
-- 정산 배분 정합성 — "모든 스트리밍 · 모든 수익풀"이 빠짐없이 배분되도록.
--
-- ── 진단 (실측) ──────────────────────────────────────────────────────────────
-- 월별 수익풀과 실제 아티스트 배분액을 대조한 결과 두 종류의 오류가 있었다.
--
--   월     수익풀      배분액      미배분        원인
--   5월    90,650      90,632          18        정상(floor 반올림)
--   6월   103,900       4,866      99,034        결제 버그 시점 매출로 산정됨
--   7월   150,450     160,194      -9,744        재계산 안 된 유령 행
--
--   (1) 6월 과소배분 — 6월 정산은 payment_orders.paid_at 오기재(0481/0483 이전)
--       상태에서 만들어졌다. 당시 settlement_period_month='2026-06' 인 매출이
--       거의 없어 풀의 5%만 배분됐다. 결제 버그가 정산까지 전파된 것이다.
--       재생성이 불가능했으므로(0484 이전) 그대로 굳어 있었다.
--
--   (2) 7월 초과배분 — 재생성 아티스트 열거가
--         "그 달 스트림 보유" ∪ "이전 달 미지급 정산 보유" ∪ "그 달 조정 대상"
--       이라, 예전 산정에는 있었지만 지금은 어디에도 안 걸리는 아티스트(트랙이
--       정산 대상에서 빠진 경우 등)가 루프에서 누락된다. 그 행은 옛 금액을 그대로
--       유지하므로 월 합계가 풀을 초과한다.
--       실측: 아티스트 1명의 gross 10,028 이 2026-07-21 산정값 그대로 잔존
--       (150,166 + 10,028 = 160,194 = 초과분과 정확히 일치).
--
-- ── 조치 ────────────────────────────────────────────────────────────────────
-- (A) 아티스트 열거에 "그 달에 이미 정산행이 있는 아티스트"를 추가한다.
--     → 유령 행이 사라진다. 스트림이 없어졌으면 gross 0 으로 정정되고 이월분만 남는다.
--
-- (B) admin_regenerate_settlements_range(from, to) — 월 연쇄 재생성.
--     과거 달을 다시 산정하려면 그 달 행이 다음 달로 병합(carried_over)된 상태를
--     먼저 풀어야 하고, 이후 달도 순서대로 다시 계산해야 이월 체인이 맞는다.
--     이 함수가 [해제 → 재산정] 을 from..to 로 순차 수행한다.
--
-- (C) admin_settlement_pool_reconciliation(from, to) — 월별 풀 대조 리포트.
--     수익풀 대비 실제 배분액과 미배분 잔액을 상시 확인할 수 있게 한다.
--     정상이면 미배분은 아티스트 수 단위의 floor 반올림 오차(수백 원)뿐이다.
--
-- ── 검증 (롤백 트랜잭션) ────────────────────────────────────────────────────
-- (A) 적용 후 5→6→7 연쇄 재생성 결과:
--   월     수익풀      배분액     미배분    정산건수
--   5월    90,650      90,634        16          7
--   6월   103,900     103,767       133         32
--   7월   150,450     150,166       284         38
--   전 월이 반올림 오차 이내로 수렴. 7월 지급액 83,651 → 153,628.
--
-- ── 안전성 ──────────────────────────────────────────────────────────────────
-- · 병합 해제는 status <> 'paid' 행만 대상 — 지급완료 정산은 손대지 않는다.
-- · 재생성 자체는 0484 규약을 그대로 따른다(스냅샷 보존, paid 는 차액 조정).
-- · 연쇄 재생성은 admin 전용, 최대 24개월, 미래 월 금지.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) 아티스트 열거 확장 — 유령 행 제거
--     전체 함수를 다시 쓰지 않고 열거 UNION 만 정확히 교체한다.
--     대상 문자열이 없으면 즉시 실패시켜 조용한 오적용을 막는다.
-- ----------------------------------------------------------------------------
do $$
declare v_src text; v_old text; v_new text;
begin
  v_src := pg_get_functiondef('public.admin_generate_monthly_settlement(date,boolean)'::regprocedure);

  v_old := E'      union\n'
        || E'      select adj.artist_user_id from public.settlement_adjustments adj\n'
        || E'      where adj.apply_to_month = p_month and adj.applied = false\n'
        || E'    ) u';

  v_new := E'      union\n'
        || E'      select adj.artist_user_id from public.settlement_adjustments adj\n'
        || E'      where adj.apply_to_month = p_month and adj.applied = false\n'
        || E'      union\n'
        || E'      -- 0485: 이 달에 이미 정산행이 있는 아티스트는 반드시 재계산한다.\n'
        || E'      --   빠뜨리면 옛 산정액이 그대로 남아 수익풀을 초과 배분한다(실측 7월 +10,028).\n'
        || E'      select s2.artist_user_id from public.artist_settlements s2\n'
        || E'      where s2.settlement_month = p_month\n'
        || E'    ) u';

  if position(v_old in v_src) = 0 then
    raise exception '0485(A) patch target not found — function body changed unexpectedly';
  end if;
  execute replace(v_src, v_old, v_new);
end $$;

-- ----------------------------------------------------------------------------
-- (C) 월별 수익풀 대조 리포트
-- ----------------------------------------------------------------------------
create or replace function public.admin_settlement_pool_reconciliation(
  p_from date default null, p_to date default null
)
returns table(
  settlement_month date, revenue bigint, pool_ratio numeric, pool bigint,
  distributed_gross bigint, unallocated bigint,
  settlement_rows int, payable_rows int, total_payout bigint, total_carried bigint
)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  with months as (
    select distinct po.settlement_period_month as m
      from public.payment_orders po
     where po.status = 'paid' and po.settlement_period_month is not null
    union
    select distinct s.settlement_month from public.artist_settlements s
  ),
  base as (
    select m.m,
           coalesce((select sum(po.amount) from public.payment_orders po
                      where po.status='paid' and po.settlement_period_month = m.m), 0)::bigint as rev,
           coalesce((select pl.pool_revenue_ratio from public.settlement_policies pl
                      where pl.effective_from <= m.m
                      order by pl.effective_from desc limit 1), 0.5) as ratio
    from months m
    where (p_from is null or m.m >= date_trunc('month', p_from)::date)
      and (p_to   is null or m.m <= date_trunc('month', p_to)::date)
  ),
  agg as (
    select s.settlement_month as m,
           coalesce(sum(s.gross_settlement_amount), 0)::bigint as dist,
           count(*)::int as rows_n,
           count(*) filter (where s.meets_min_payout)::int as payable_n,
           coalesce(sum(s.final_payout_amount), 0)::bigint as payout,
           coalesce(sum(s.carried_over_amount), 0)::bigint as carried
    from public.artist_settlements s group by s.settlement_month
  )
  select b.m,
         b.rev,
         b.ratio,
         floor(b.rev * b.ratio)::bigint,
         coalesce(a.dist, 0),
         floor(b.rev * b.ratio)::bigint - coalesce(a.dist, 0),
         coalesce(a.rows_n, 0),
         coalesce(a.payable_n, 0),
         coalesce(a.payout, 0),
         coalesce(a.carried, 0)
  from base b left join agg a on a.m = b.m
  order by b.m;
end;
$$;

revoke all on function public.admin_settlement_pool_reconciliation(date, date) from public;
grant execute on function public.admin_settlement_pool_reconciliation(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- (B) 월 연쇄 재생성
-- ----------------------------------------------------------------------------
create or replace function public.admin_regenerate_settlements_range(p_from date, p_to date)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_from date; v_to date; v_m date;
  v_res jsonb; v_out jsonb := '[]'::jsonb;
  v_released int;
  v_cur_month date := (date_trunc('month', (now() at time zone 'Asia/Seoul')))::date;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  v_from := date_trunc('month', p_from)::date;
  v_to   := date_trunc('month', p_to)::date;

  if v_from > v_to then raise exception 'p_from must be <= p_to'; end if;
  if v_to > v_cur_month then raise exception 'cannot regenerate future months (max %)', v_cur_month; end if;
  if (extract(year from age(v_to, v_from)) * 12 + extract(month from age(v_to, v_from))) > 24 then
    raise exception 'range too wide (max 24 months)';
  end if;

  v_m := v_from;
  while v_m <= v_to loop
    -- 이 달 행이 다음 달로 병합돼 있으면 먼저 해제해야 재산정 대상이 된다.
    -- 지급완료(paid) 행은 제외 — 실제 송금 기록은 건드리지 않는다.
    update public.artist_settlements s
       set status = coalesce(s.pre_merge_status, 'pending'),
           carryover_applied = false,
           merged_into_settlement_id = null,
           carried_over_to_month = null,
           auto_merged_at = null,
           pre_merge_status = null
     where s.settlement_month = v_m
       and s.merged_into_settlement_id is not null
       and s.status <> 'paid';
    get diagnostics v_released = row_count;

    select public.admin_generate_monthly_settlement(v_m, false) into v_res;

    v_out := v_out || jsonb_build_object(
      'month', v_m,
      'released_carryover', v_released,
      'generated', v_res->'generated',
      'overwritten', v_res->'overwritten',
      'skipped', v_res->'skipped',
      'payable', v_res->'payable',
      'total_gross', v_res->'total_gross',
      'total_final_payout', v_res->'total_final_payout',
      'total_carried_over', v_res->'total_carried_over',
      'paid_delta_adjusted', v_res->'paid_delta_adjusted'
    );

    v_m := (v_m + interval '1 month')::date;
  end loop;

  insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
  values ('settlement_ready', 'warning',
    to_char(v_from,'YYYY-MM') || ' ~ ' || to_char(v_to,'YYYY-MM') || ' 정산 연쇄 재산정 완료',
    '수익풀 전액 배분 기준으로 해당 기간 정산을 다시 산정했습니다. '
    || 'admin_settlement_pool_reconciliation() 으로 월별 미배분 잔액을 확인한 뒤 지급을 진행하세요.',
    jsonb_build_object('from', v_from, 'to', v_to, 'months', v_out), 0, now());

  return jsonb_build_object('ok', true, 'from', v_from, 'to', v_to, 'months', v_out);
end;
$$;

revoke all on function public.admin_regenerate_settlements_range(date, date) from public;
grant execute on function public.admin_regenerate_settlements_range(date, date) to authenticated;
