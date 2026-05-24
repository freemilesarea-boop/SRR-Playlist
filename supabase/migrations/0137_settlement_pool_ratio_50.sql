-- 0137 — 정산 풀 비율 70% → 50% (additive only).
--   settlement_policies 는 append-only 이력 테이블. 기존 70%(2024-01-01) row 는 수정/삭제하지 않고
--   신규 50% 정책을 INSERT 한다. 정산 RPC(admin_generate_monthly_settlement)는
--   effective_from <= 정산월 중 가장 최신 정책을 선택하므로, 2026-05 정산부터 자동으로 50% 적용.
--   기존 70% 로 마감된 정산이 있으면 그 snapshot 은 그대로 유지(재계산 없음).
insert into public.settlement_policies (
  effective_from, pool_revenue_ratio, company_fee_ratio, withholding_tax_ratio,
  min_payout_amount, min_payout_basis, note
) values (
  '2026-05-01', 0.50, 0.20, 0.033, 50000, 'gross',
  '정산 풀 비율 50% 로 조정 (플랫폼 운영비/서버/스토리지/스트리밍 트래픽/추천 알고리즘/영업인 수수료 확장 반영). 회사 수수료 20%, 원천징수 3.3%, 최소 지급 5만원(공제 전) 유지.'
) on conflict (effective_from) do nothing;

-- admin_get_monthly_streaming_summary: 하드코딩 0.70 fallback 제거.
--   값은 항상 settlement_policies(해당 월 유효 정책)에서 가져온다. 정책이 전혀 없는
--   비정상 상황의 안전 기본값만 현행 표준 0.50 으로 통일(과거 0.70 잔존 제거).
create or replace function public.admin_get_monthly_streaming_summary(
  p_month_start date default (date_trunc('month', now() at time zone 'Asia/Seoul'))::date)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare
  v_month_start date := date_trunc('month', p_month_start)::date;          -- 항상 1일로 정규화
  v_month_end   date := (v_month_start + interval '1 month' - interval '1 day')::date;
  v_start_ts timestamptz := v_month_start::timestamp at time zone 'Asia/Seoul';
  v_end_ts   timestamptz := (v_month_start + interval '1 month')::timestamp at time zone 'Asia/Seoul';
  v_total bigint; v_eligible bigint; v_tracks bigint; v_artists bigint;
  v_revenue numeric; v_pool_ratio numeric; v_estimated bigint; v_ready bigint;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  -- 스트리밍 집계 (정산 기준: milestone_30s · eligible_for_payout)
  select
    coalesce(count(*) filter (where event_type = 'milestone_30s'), 0),
    coalesce(count(*) filter (where event_type = 'milestone_30s' and eligible_for_payout = true), 0),
    coalesce(count(distinct track_id) filter (where event_type = 'milestone_30s'), 0)
  into v_total, v_eligible, v_tracks
  from public.stream_events
  where created_at >= v_start_ts and created_at < v_end_ts;

  -- 참여 아티스트 수 (스트리밍된 트랙의 owner)
  select coalesce(count(distinct t.owner_user_id), 0)
  into v_artists
  from public.stream_events se
  join public.tracks t on t.id = se.track_id
  where se.created_at >= v_start_ts and se.created_at < v_end_ts
    and se.event_type = 'milestone_30s';

  -- 월간 매출 (payment_orders 단일 진실원천과 동일 기준)
  select coalesce(sum(amount), 0) into v_revenue
  from public.payment_orders
  where status = 'paid' and refunded_at is null
    and paid_at >= v_start_ts and paid_at < v_end_ts;

  -- 정산 풀 비율 (해당 월에 유효한 정책 — 단일 진실원천). 정책이 없을 때만 현행 표준 0.50.
  select pool_revenue_ratio into v_pool_ratio
  from public.settlement_policies
  where effective_from <= v_month_end
  order by effective_from desc limit 1;
  v_pool_ratio := coalesce(v_pool_ratio, 0.50);

  v_estimated := round(v_revenue * v_pool_ratio);

  -- 지급 준비된 정산 금액 (해당 월 settlement 중 payable/paid)
  select coalesce(sum(final_payout_amount), 0) into v_ready
  from public.artist_settlements
  where settlement_month = v_month_start and status in ('payable', 'paid');

  return jsonb_build_object(
    'month_start', v_month_start,
    'month_end', v_month_end,
    'total_stream_count', v_total,
    'eligible_stream_count', v_eligible,
    'excluded_stream_count', v_total - v_eligible,
    'unique_tracks', v_tracks,
    'unique_artists', v_artists,
    'estimated_revenue', coalesce(v_estimated, 0),
    'settlement_ready_amount', coalesce(v_ready, 0),
    'pool_revenue_ratio', v_pool_ratio
  );
end; $function$;
grant execute on function public.admin_get_monthly_streaming_summary(date) to authenticated;
