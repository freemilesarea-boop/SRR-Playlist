-- ============================================
-- 0049_paid_state_cancel_misroute_fix.sql
--
-- 운영 증상:
--   사용자가 정상 결제 → PayApp state=64 webhook 정상 도착 →
--   payapp_webhook_events.membership_updated=true 인데
--   final_membership_tier='free', state_label='정기결제 해지' 로 기록됨.
--   결과: users.membership_tier 가 'free' 로 회수되어 PaymentSuccessPage 가
--   "권한 동기화 중" 에서 영원히 멈춤.
--
-- 원인:
--   payapp-feedback Edge Function 의 isCancelSubscriptionWebhook() 가
--   canceldate / cancel_at / stopdate 같은 날짜 필드 단독으로 cancel 트리거.
--   PayApp 가 정상 paid webhook 에도 이 필드들을 미래 만료일 의미로 echo 하기
--   때문에 false positive → _internal_apply_payapp_subscription_cancel_event
--   호출 → 즉시 free 회수.
--
-- 수정 (코드측 — 이 마이그레이션 외):
--   1) supabase/functions/payapp-feedback/index.ts
--      - isCancelSubscriptionWebhook 의 날짜 필드 단독 트리거 제거.
--      - isSubCancel 조건에 !isPaidState 추가 (paid 우선 보장).
--      → 향후 webhook 은 정상 paid 로 처리됨.
--
-- 수정 (DB측 — 이 마이그레이션):
--   1) 위 버그로 잘못 회수된 기존 user/order 1회 자동 백필.
--      대상: payapp_webhook_events 중
--        pay_state = 64
--        AND state_label = '정기결제 해지'  (cancel handler 가 찍은 라벨)
--        AND final_membership_tier = 'free'
--        AND membership_updated = true
--      → admin_backfill_paid_order_by_mul_no(mul_no) 호출로 paid_event 재적용.
--   2) payment_orders / users 를 realtime publication 에 추가 (PaymentSuccess
--      Page 가 실시간 구독으로 즉시 반영 가능하도록).
-- ============================================

-- ---------- 1) 백필: cancel 로 잘못 라우팅된 paid webhook 복구 ----------
do $$
declare
  v_row record;
  v_apply record;
  v_count integer := 0;
  v_failed integer := 0;
begin
  for v_row in
    select ev.payapp_mul_no, ev.id
    from public.payapp_webhook_events ev
    where ev.pay_state = 64
      and ev.state_label = '정기결제 해지'
      and ev.final_membership_tier = 'free'
      and ev.membership_updated = true
      and ev.payapp_mul_no is not null
    order by ev.created_at desc
  loop
    begin
      select * into v_apply
      from public.admin_backfill_paid_order_by_mul_no(v_row.payapp_mul_no);
      v_count := v_count + 1;
      raise notice 'backfilled mul_no=% → tier=%',
        v_row.payapp_mul_no, coalesce(v_apply.final_membership_tier, '?');
    exception when others then
      v_failed := v_failed + 1;
      raise notice 'backfill failed mul_no=%: %', v_row.payapp_mul_no, sqlerrm;
    end;
  end loop;
  raise notice '[0049] paid_state cancel-misroute backfill: success=% failed=%',
    v_count, v_failed;
end $$;

-- ---------- 2) Realtime publication — payment_orders / users ----------
-- payment_orders 의 UPDATE 를 PaymentSuccessPage 가 구독해서 webhook 처리
-- 즉시 반영하기 위함. users 도 membership_tier 변경 감지용.
-- 이미 publication 에 있으면 무시 (idempotent).
do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    begin
      alter publication supabase_realtime add table public.payment_orders;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.users;
    exception when duplicate_object then null;
    end;
  else
    raise notice '[0049] supabase_realtime publication not present, skipping';
  end if;
end $$;

-- 확인
select
  '[0049] check' as label,
  (select count(*) from public.payapp_webhook_events
    where pay_state = 64 and state_label = '정기결제 해지'
      and final_membership_tier = 'free' and membership_updated = true)
    as still_stuck_after_backfill,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'payment_orders')
    as payment_orders_in_realtime,
  (select count(*) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'users')
    as users_in_realtime;
