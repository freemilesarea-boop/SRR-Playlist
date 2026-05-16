-- ============================================
-- 0051_comprehensive_paid_backfill.sql
--
-- 운영 증상:
--   0049 / 0050 마이그레이션 후에도 일부 결제 row 가 stuck:
--     - 115594883 (state=64) - ⊘ free (회수)
--     - 115596616 (state=64) - ⊘ free (회수)
--     - 115596835 (state=4)  - membership 미적용
--   동일 사용자(mingseouu@gmail.com) 신규 결제가 PaymentSuccessPage 에서 timeout.
--
-- 원인 (0049 백필 silent 실패):
--   0049 의 DO 블록이 admin_backfill_paid_order_by_mul_no() 를 호출했는데
--   그 RPC 안에 _internal_is_admin_caller() / auth.uid() admin 체크가 있음.
--   migration 실행 컨텍스트에서는 auth.uid() = NULL → 'admin only' 예외 →
--   exception when others then 분기에서 silent 카운트만 += 1.
--   결과: 0049 백필이 모든 row 에서 실패했지만 migration 은 정상 종료해서
--   운영자는 알아채기 어려움.
--
-- 수정:
--   1) admin RPC 우회 — _internal_apply_payapp_paid_event 를 직접 호출.
--      해당 함수는 security definer + 자체 admin 체크 없음 → migration 컨텍
--      스트에서 정상 실행.
--   2) 두 종류 stuck row 동시 처리:
--      (A) state=64 + state_label='정기결제 해지' + final_membership_tier='free'
--          → cancel-misroute 피해자. paid_event 재적용 → tier 복구.
--      (B) state=4 + linkval_verified + membership_updated=false + rebill_no
--          → 0050 router 로직이 router 호출 시점에만 적용되므로, migration
--          이전에 도착한 webhook 들은 여전히 미처리. paid_event 직접 적용.
--   3) created_at ASC 처리 → 가장 최근 결제가 마지막에 처리되어 tier 가
--      "최신 결제의 plan_type" 으로 수렴.
--   4) idempotent — 이미 처리된 row 는 paid_event 가 멱등 처리.
-- ============================================

-- ---------- 1) cancel-misroute 복구 (state=64 가 cancel handler 로 잘못 라우팅된 케이스) ----------
do $$
declare
  v_row record;
  v_apply record;
  v_count integer := 0;
  v_failed integer := 0;
  v_plan text;
begin
  for v_row in
    select ev.id, ev.payapp_mul_no, ev.price, ev.raw_payload, ev.order_no, ev.created_at
    from public.payapp_webhook_events ev
    where ev.pay_state = 64
      and ev.state_label = '정기결제 해지'
      and ev.final_membership_tier = 'free'
      and ev.membership_updated = true
      and ev.payapp_mul_no is not null
      and ev.price is not null and ev.price > 0
    order by ev.created_at asc  -- 가장 오래된 것부터 → 최신 paid event 가 마지막에 tier 결정
  loop
    v_plan := case when v_row.price = 6900 then 'business' else 'individual' end;
    begin
      select * into v_apply from public._internal_apply_payapp_paid_event(
        p_payapp_mul_no := v_row.payapp_mul_no,
        p_amount := v_row.price,
        p_plan_type := v_plan,
        p_buyer_email := v_row.raw_payload->>'recvemail',
        p_buyer_phone := v_row.raw_payload->>'recvphone',
        p_paid_at := v_row.created_at,
        p_approval_no := coalesce(
          v_row.raw_payload->>'approval_no',
          v_row.raw_payload->>'apv_no',
          v_row.raw_payload->>'card_apv_no'
        ),
        p_goodname := v_row.raw_payload->>'goodname',
        p_order_no := coalesce(
          v_row.order_no,
          v_row.raw_payload->>'var1',
          v_row.raw_payload->>'order_no'
        ),
        p_source := 'backfill_0051_cancel_misroute',
        p_raw_payload := v_row.raw_payload
      );
      update public.payapp_webhook_events ev
      set state_label = '승인완료',
          matched_user_id = v_apply.matched_user_id,
          matched_order_id = v_apply.matched_order_id,
          matched_subscription_id = v_apply.matched_subscription_id,
          membership_updated = v_apply.membership_updated,
          final_membership_tier = v_apply.final_membership_tier,
          processing_error = case when v_apply.membership_updated then null
                                  else v_apply.message end,
          processed_at = coalesce(ev.processed_at, now())
      where ev.id = v_row.id;
      v_count := v_count + 1;
      raise notice '[0051] cancel-misroute fix mul_no=% → tier=% (msg=%)',
        v_row.payapp_mul_no,
        coalesce(v_apply.final_membership_tier,'?'),
        substr(coalesce(v_apply.message,''), 1, 120);
    exception when others then
      v_failed := v_failed + 1;
      raise notice '[0051] cancel-misroute FAILED mul_no=%: %', v_row.payapp_mul_no, sqlerrm;
    end;
  end loop;
  raise notice '[0051] cancel-misroute backfill: success=% failed=%', v_count, v_failed;
end $$;

-- ---------- 2) state=4 + rebill_no 복구 (rebillRegist 첫결제 state=64 미도착 케이스) ----------
do $$
declare
  v_row record;
  v_apply record;
  v_count integer := 0;
  v_failed integer := 0;
  v_rebill_token text;
  v_plan text;
begin
  for v_row in
    select ev.id, ev.payapp_mul_no, ev.price, ev.raw_payload, ev.order_no, ev.created_at
    from public.payapp_webhook_events ev
    where ev.pay_state = 4
      and ev.linkval_verified = true
      and ev.membership_updated = false
      and ev.price is not null and ev.price > 0
      and ev.payapp_mul_no is not null
      and (
        ev.raw_payload->>'rebill_no' is not null
        or ev.raw_payload->>'rebillno' is not null
      )
    order by ev.created_at asc
  loop
    v_rebill_token := nullif(btrim(coalesce(
      v_row.raw_payload->>'rebill_no',
      v_row.raw_payload->>'rebillno', ''
    )), '');
    v_plan := case when v_row.price = 6900 then 'business' else 'individual' end;

    begin
      select * into v_apply from public._internal_apply_payapp_paid_event(
        p_payapp_mul_no := v_row.payapp_mul_no,
        p_amount := v_row.price,
        p_plan_type := v_plan,
        p_buyer_email := v_row.raw_payload->>'recvemail',
        p_buyer_phone := v_row.raw_payload->>'recvphone',
        p_paid_at := v_row.created_at,
        p_approval_no := coalesce(
          v_row.raw_payload->>'approval_no',
          'rebill_' || coalesce(v_rebill_token, '')
        ),
        p_goodname := v_row.raw_payload->>'goodname',
        p_order_no := coalesce(
          v_row.order_no,
          v_row.raw_payload->>'var1',
          v_row.raw_payload->>'order_no'
        ),
        p_source := 'backfill_0051_state4_rebill',
        p_raw_payload := v_row.raw_payload
      );

      update public.payapp_webhook_events ev
      set matched_user_id = v_apply.matched_user_id,
          matched_order_id = v_apply.matched_order_id,
          matched_subscription_id = v_apply.matched_subscription_id,
          membership_updated = v_apply.membership_updated,
          final_membership_tier = v_apply.final_membership_tier,
          processing_error = case when v_apply.membership_updated then null
                                  else v_apply.message end,
          processed_at = coalesce(ev.processed_at, now())
      where ev.id = v_row.id;

      v_count := v_count + 1;
      raise notice '[0051] state4+rebill fix mul_no=% → tier=% (msg=%)',
        v_row.payapp_mul_no,
        coalesce(v_apply.final_membership_tier,'?'),
        substr(coalesce(v_apply.message,''), 1, 120);
    exception when others then
      v_failed := v_failed + 1;
      raise notice '[0051] state4+rebill FAILED mul_no=%: %', v_row.payapp_mul_no, sqlerrm;
    end;
  end loop;

  raise notice '[0051] state4+rebill backfill: success=% failed=%', v_count, v_failed;
end $$;

-- ---------- 3) 사후 확인 ----------
do $$
declare
  v_still_stuck_cancel integer;
  v_still_stuck_state4 integer;
begin
  select count(*) into v_still_stuck_cancel
  from public.payapp_webhook_events
  where pay_state = 64 and state_label = '정기결제 해지'
    and final_membership_tier = 'free' and membership_updated = true;

  select count(*) into v_still_stuck_state4
  from public.payapp_webhook_events
  where pay_state = 4 and linkval_verified = true and membership_updated = false
    and (raw_payload->>'rebill_no' is not null or raw_payload->>'rebillno' is not null);

  raise notice '[0051] AFTER backfill: still_stuck_cancel=%, still_stuck_state4_rebill=%',
    v_still_stuck_cancel, v_still_stuck_state4;
end $$;

-- 확인 SELECT (Supabase Dashboard 에서 결과 확인용)
select
  '[0051] check' as label,
  (select count(*) from public.payapp_webhook_events
    where pay_state = 64 and state_label = '정기결제 해지'
      and final_membership_tier = 'free' and membership_updated = true)
    as still_stuck_cancel_misroute,
  (select count(*) from public.payapp_webhook_events
    where pay_state = 4 and linkval_verified = true and membership_updated = false
      and (raw_payload->>'rebill_no' is not null or raw_payload->>'rebillno' is not null))
    as still_stuck_state4_rebill;
