-- ============================================
-- 0053_state4_trigger_autopromote.sql
--
-- 진짜 원인 (이전 마이그레이션 0050/0052 가 작동 안 한 이유):
--   payapp-feedback EF 가 state=4 webhook 에 대해 _internal_apply_payapp_event
--   router 를 호출하지 않음. PAYAPP_ACTIONABLE_STATES = {64, 8, 32, 9, 70, 71}
--   로 state=4 가 빠져있어, state=4 도착 시 그냥 payment_orders.status='requested'
--   만 갱신하고 종료. router 의 v_is_state_4_paid 분기는 실행조차 안 됨.
--
-- 해결 (EF 재배포 불필요):
--   1) BEFORE INSERT trigger on payapp_webhook_events
--      - state=4 + linkval_verified=true + price>0 인 webhook 이 들어오면
--        자동으로 router 호출 → 0052 로직으로 paid 승격 여부 판정
--      - 승격 시 NEW row 의 membership_updated / final_membership_tier 등 즉시
--        세팅 (insert 와 같은 transaction)
--      - paid_event 가 payment_orders / subscriptions / users 업데이트도 함께
--   2) BEFORE UPDATE trigger on payment_orders / subscriptions
--      - 'paid' → 'requested'/'pending'/'waiting' 같은 권한 약화 reversion 차단.
--        EF 가 state=4 처리 시 status='requested' 로 되돌리려 해도 trigger 가
--        보호 → 'paid' 유지.
--      - 'refunded' / 'canceled' 로의 정상 전환은 허용.
--   3) 기존 stuck state=4 row 일괄 backfill.
-- ============================================

-- ---------- 1) payment_orders 'paid' 다운그레이드 차단 ----------
create or replace function public._trg_block_payment_paid_downgrade()
returns trigger language plpgsql as $$
begin
  -- paid → requested/pending/waiting/failed 로의 reversion 차단.
  -- refunded / canceled 로의 정상 전환은 허용.
  if OLD.status = 'paid' and NEW.status in ('requested','pending','waiting','failed') then
    NEW.status := 'paid';
    NEW.paid_at := OLD.paid_at;
    NEW.payapp_state := OLD.payapp_state;
    NEW.payapp_state_label := OLD.payapp_state_label;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_block_payment_paid_downgrade on public.payment_orders;
create trigger trg_block_payment_paid_downgrade
  before update on public.payment_orders
  for each row execute function public._trg_block_payment_paid_downgrade();

-- ---------- 2) subscriptions 'active' 다운그레이드 차단 ----------
create or replace function public._trg_block_subscription_active_downgrade()
returns trigger language plpgsql as $$
begin
  if OLD.status = 'active' and NEW.status in ('pending','payment_waiting') then
    NEW.status := 'active';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_block_subscription_active_downgrade on public.subscriptions;
create trigger trg_block_subscription_active_downgrade
  before update on public.subscriptions
  for each row execute function public._trg_block_subscription_active_downgrade();

-- ---------- 3) state=4 webhook 자동 promote trigger ----------
create or replace function public._trg_promote_state4_to_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_apply record;
  v_plan text;
  v_candidate_order_no text;
begin
  if NEW.pay_state <> 4 or NEW.linkval_verified is not true
     or NEW.price is null or NEW.price <= 0 or NEW.payapp_mul_no is null then
    return NEW;
  end if;

  v_plan := case when NEW.price = 6900 then 'business' else 'individual' end;
  v_candidate_order_no := coalesce(
    nullif(btrim(NEW.order_no), ''),
    nullif(btrim(NEW.raw_payload->>'var1'), ''),
    nullif(btrim(NEW.raw_payload->>'order_no'), '')
  );

  begin
    select * into v_apply from public._internal_apply_payapp_event(
      p_payapp_mul_no := NEW.payapp_mul_no,
      p_pay_state := 4,
      p_amount := NEW.price,
      p_plan_type := v_plan,
      p_buyer_email := NEW.raw_payload->>'recvemail',
      p_buyer_phone := NEW.raw_payload->>'recvphone',
      p_event_at := coalesce(NEW.created_at, now()),
      p_approval_no := coalesce(
        NEW.raw_payload->>'approval_no',
        NEW.raw_payload->>'apv_no',
        NEW.raw_payload->>'card_apv_no'
      ),
      p_goodname := NEW.raw_payload->>'goodname',
      p_order_no := v_candidate_order_no,
      p_source := 'trigger_state4_auto',
      p_raw_payload := NEW.raw_payload
    );

    if v_apply.membership_updated then
      NEW.matched_user_id := v_apply.matched_user_id;
      NEW.matched_order_id := v_apply.matched_order_id;
      NEW.matched_subscription_id := v_apply.matched_subscription_id;
      NEW.membership_updated := true;
      NEW.final_membership_tier := v_apply.final_membership_tier;
      NEW.state_label := '승인완료 (state4 auto)';
      NEW.processed_at := coalesce(NEW.processed_at, now());
      NEW.processing_error := null;
    end if;
  exception when others then
    raise notice '[trg_state4] error mul_no=%: %', NEW.payapp_mul_no, sqlerrm;
  end;

  return NEW;
end;
$$;

drop trigger if exists trg_promote_state4_to_paid on public.payapp_webhook_events;
create trigger trg_promote_state4_to_paid
  before insert on public.payapp_webhook_events
  for each row execute function public._trg_promote_state4_to_paid();

-- ---------- 4) 기존 stuck state=4 row 일괄 백필 ----------
do $$
declare
  v_row record;
  v_apply record;
  v_count integer := 0;
  v_failed integer := 0;
  v_plan text;
  v_candidate_order_no text;
begin
  for v_row in
    select ev.id, ev.payapp_mul_no, ev.price, ev.raw_payload, ev.order_no, ev.created_at
    from public.payapp_webhook_events ev
    where ev.pay_state = 4
      and ev.linkval_verified = true
      and ev.membership_updated = false
      and ev.price is not null and ev.price > 0
      and ev.payapp_mul_no is not null
    order by ev.created_at asc
  loop
    v_plan := case when v_row.price = 6900 then 'business' else 'individual' end;
    v_candidate_order_no := coalesce(
      nullif(btrim(v_row.order_no), ''),
      nullif(btrim(v_row.raw_payload->>'var1'), ''),
      nullif(btrim(v_row.raw_payload->>'order_no'), '')
    );

    begin
      select * into v_apply from public._internal_apply_payapp_event(
        p_payapp_mul_no := v_row.payapp_mul_no,
        p_pay_state := 4,
        p_amount := v_row.price,
        p_plan_type := v_plan,
        p_buyer_email := v_row.raw_payload->>'recvemail',
        p_buyer_phone := v_row.raw_payload->>'recvphone',
        p_event_at := v_row.created_at,
        p_approval_no := coalesce(
          v_row.raw_payload->>'approval_no',
          v_row.raw_payload->>'apv_no',
          v_row.raw_payload->>'card_apv_no'
        ),
        p_goodname := v_row.raw_payload->>'goodname',
        p_order_no := v_candidate_order_no,
        p_source := 'backfill_0053_state4_trigger',
        p_raw_payload := v_row.raw_payload
      );

      if v_apply.membership_updated then
        update public.payapp_webhook_events ev
        set matched_user_id = v_apply.matched_user_id,
            matched_order_id = v_apply.matched_order_id,
            matched_subscription_id = v_apply.matched_subscription_id,
            membership_updated = true,
            final_membership_tier = v_apply.final_membership_tier,
            state_label = '승인완료 (state4 backfill)',
            processing_error = null,
            processed_at = coalesce(ev.processed_at, now())
        where ev.id = v_row.id;
        v_count := v_count + 1;
        raise notice '[0053] state4 backfill mul_no=% → tier=%',
          v_row.payapp_mul_no, coalesce(v_apply.final_membership_tier,'?');
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise notice '[0053] state4 backfill FAILED mul_no=%: %', v_row.payapp_mul_no, sqlerrm;
    end;
  end loop;
  raise notice '[0053] state4 trigger backfill: success=% failed=%', v_count, v_failed;
end $$;

-- ---------- 5) 확인 ----------
select
  '[0053] check' as label,
  (select count(*) from public.payapp_webhook_events
    where pay_state = 4 and linkval_verified = true and membership_updated = false)
    as still_stuck_state4,
  (select count(*) from pg_trigger
    where tgname = 'trg_promote_state4_to_paid'
      and tgrelid = 'public.payapp_webhook_events'::regclass)
    as autopromote_trigger_installed,
  (select count(*) from pg_trigger
    where tgname = 'trg_block_payment_paid_downgrade'
      and tgrelid = 'public.payment_orders'::regclass)
    as paid_protection_trigger_installed;
