-- 0388 — Artist settlement visibility lockdown
--
-- 정책 (운영자 명시):
--   아티스트는 관리자 확정(finalized) 정산 데이터만 봐야 한다.
--   "오늘/이번 달 실시간 예상 정산금" / "재생수 기반 실시간 금액" /
--   "관리자 확정 전 금액" 노출 금지.
--
-- artist_settlements.status 의미 (0060 schema):
--   pending      — 관리자가 아직 확정하지 않은 row. (생성 직후 default)
--                  → 아티스트 노출 금지 ❌
--   carried_over — 5만원 미만 → 다음 달 이월 (확정 결과) ✅
--   payable      — 지급 예정 (확정 완료) ✅
--   paid         — 지급 완료 ✅
--   held         — 보류 (KYC/계좌 미비) — 금액은 확정됨 ✅
--   disputed     — 분쟁 — 금액은 확정됨, 상태만 분쟁 ✅
--
-- 따라서 아티스트 노출 허용 status 집합:
--   {'carried_over','payable','paid','held','disputed'}
--   = NOT 'pending'.
--
-- 수정:
--   §1  get_my_settlements        — WHERE status <> 'pending' 추가
--   §2  get_my_settlement_detail  — WHERE status <> 'pending' 추가
--   §3  RLS artist_settlements_select_self    — status <> 'pending' 추가
--   §4  RLS settlement_items_select_self      — parent settlement.status <> 'pending' 추가
--   §5  diagnostics — 현재 데이터 분포 출력
--
-- 관리자 RPC / RLS 영향 0:
--   admin RPC (`admin_*`, security definer) 들과 admin RLS 정책은 동일하게
--   모든 status 접근 가능. 이 마이그는 아티스트 표면만 차단.
--
-- 절대 무수정:
--   artist_settlements / settlement_items 테이블 컬럼/CHECK
--   admin RPC (admin_generate_settlements / admin_finalize_settlement / 등)
--   settlement_versioning (0348) is_current 의미
--   기존 admin UI / admin RLS 정책

-- ============================================================
-- §1. get_my_settlements — pending 제외
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
    and s.status <> 'pending'     -- 0388: 미확정 row 차단
  order by s.settlement_month desc;
end;
$$;
revoke all on function public.get_my_settlements() from public, anon;
grant execute on function public.get_my_settlements() to authenticated;


-- ============================================================
-- §2. get_my_settlement_detail — pending 직접 조회 차단
-- ============================================================
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
  where s.id = p_id
    and s.artist_user_id = v_uid
    and s.status <> 'pending';    -- 0388: 미확정 row 차단
  return v_result;
end;
$$;
revoke all on function public.get_my_settlement_detail(uuid) from public, anon;
grant execute on function public.get_my_settlement_detail(uuid) to authenticated;


-- ============================================================
-- §3. RLS artist_settlements_select_self — pending 차단
-- ============================================================
-- 아티스트가 직접 supabase.from('artist_settlements').select() 한 경우에도
-- pending row 가 응답에 나오면 안 됨. admin (role='admin') 정책은 별도라 영향 없음.
drop policy if exists "artist_settlements_select_self" on public.artist_settlements;
create policy "artist_settlements_select_self" on public.artist_settlements
  for select using (
    artist_user_id = auth.uid()
    and status <> 'pending'
  );


-- ============================================================
-- §4. RLS settlement_items_select_self — parent pending 차단
-- ============================================================
-- settlement_items 는 artist_user_id 컬럼 직접 보유하지만,
-- 부모 settlement 가 pending 이면 child 도 노출 금지.
drop policy if exists "settlement_items_select_self" on public.settlement_items;
create policy "settlement_items_select_self" on public.settlement_items
  for select using (
    artist_user_id = auth.uid()
    and exists (
      select 1 from public.artist_settlements s
       where s.id = settlement_items.settlement_id
         and s.status <> 'pending'
    )
  );


-- ============================================================
-- §5. Diagnostics — 현재 데이터 분포
-- ============================================================
do $$
declare
  v_pending     int;
  v_other       int;
  v_pending_amt bigint;
begin
  select count(*) into v_pending
    from public.artist_settlements where status = 'pending';
  select count(*) into v_other
    from public.artist_settlements where status <> 'pending';
  select coalesce(sum(total_settlement_amount), 0) into v_pending_amt
    from public.artist_settlements where status = 'pending';

  raise notice '0388 — artist_settlements: pending=% (%원), confirmed=%',
    v_pending, v_pending_amt, v_other;
  raise notice '0388 — get_my_settlements 와 RLS 가 pending row % 건을 아티스트 응답에서 제외함',
    v_pending;
end$$;
