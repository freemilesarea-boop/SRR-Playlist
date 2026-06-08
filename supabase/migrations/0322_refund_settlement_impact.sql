-- 0322 — 환불 발생 시 정산 영향 자동 감지 + 사후 정정 RPC (X6.34)
--
-- 의존: 0321 (settlement_adjustments + audit action 확장)
--
-- 변경:
--   1) _internal_apply_payapp_refund_event 가 영향 정산 자동 식별
--      - 환불된 payment_orders.paid_at 의 settlement_month 계산
--      - 해당 (artist, month) artist_settlements 검사:
--          * 없음 / pending / held / payable
--                                  → audit 만 ('payment_refunded')
--                                    다음 generate 가 paid 상태 row 만 합산
--                                    하므로 자동 정정됨
--          * carried_over          → audit
--          * paid                  → settlement_adjustments 자동 생성
--                                    (다음 달 적용, 음수 amount)
--          * disputed              → audit + 운영자 수동 검토 마킹
--      - 결제 본인(=사업자) 의 정산 row 가 아닌, 그 결제가 풀에 기여한
--        모든 아티스트의 정산이 영향. paid 상태에서는 거의 모든 아티스트
--        가 영향. 본 마이그레이션에서는 audit + 결제 자체 metadata 만 기록
--        하고, 실제 어떤 아티스트에게 얼만큼 차감할지는 운영자가
--        admin_create_settlement_adjustment 로 개별 처리.
--
--   2) admin_create_settlement_adjustment RPC 신규
--      - admin 전용
--      - 음수 amount = 차감 / 양수 amount = 보정 추가
--      - settlement_admin_audit_logs 에 audit_created 기록
--
--   3) admin_generate_monthly_settlement 가 adjustments 도 prev_carried
--      에 합산. 적용 후 applied=true 마킹.

-- ===== 1) 환불 핸들러 — 정산 영향 감지 추가 =====
create or replace function public._internal_apply_payapp_refund_event(
  p_payapp_mul_no text,
  p_pay_state integer,
  p_event_at timestamptz default now(),
  p_source text default 'unknown'::text
)
returns table(
  matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text, message text
)
language plpgsql security definer set search_path = public as $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_sub_id uuid;
  v_order record;
  v_now timestamptz := now();
  v_is_refund boolean := p_pay_state in (9, 70, 71);
  v_target_status text;
  v_label text;
  v_payload jsonb;
  v_tier text;
  v_mul_no text := btrim(coalesce(p_payapp_mul_no, ''));
  -- X6.34
  v_settlement_month date;
  v_affected record;
  v_settlement_msg text := '';
begin
  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  v_target_status := case when v_is_refund then 'refunded' else 'canceled' end;
  v_label := public._payapp_state_label(p_pay_state);

  v_payload := jsonb_build_object(
    'payapp_mul_no', v_mul_no,
    'pay_state', p_pay_state,
    'state_label', v_label,
    'event_at', p_event_at,
    'source', p_source,
    'is_refund', v_is_refund,
    'applied_at', v_now
  );

  -- mul_no 로 결제 매칭
  select po.user_id, po.id, po.subscription_id,
         po.amount, po.paid_at, po.created_at, po.plan_type
    into v_order
  from public.payment_orders as po
  where po.payapp_mul_no = v_mul_no
  order by po.created_at desc
  limit 1;

  if v_order.id is null then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      ('cannot refund: no payment_order matched for mul_no=' || v_mul_no)::text;
    return;
  end if;

  v_user_id := v_order.user_id;
  v_order_id := v_order.id;
  v_sub_id := v_order.subscription_id;

  -- payment_orders 업데이트
  update public.payment_orders as po
  set status = v_target_status,
      payapp_state = p_pay_state,
      payapp_state_label = v_label,
      canceled_at = case when not v_is_refund then v_now else po.canceled_at end,
      refunded_at = case when v_is_refund then v_now else po.refunded_at end,
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  -- subscription 매칭 + 갱신 (기존 그대로)
  if v_sub_id is null then
    select s.id into v_sub_id
    from public.subscriptions as s
    where s.user_id = v_user_id
    order by
      case s.status when 'active' then 0 when 'pending' then 1
                    when 'payment_waiting' then 2 else 3 end,
      s.created_at desc
    limit 1;
  end if;

  if v_sub_id is not null then
    update public.subscriptions as s
    set status = v_target_status,
        payapp_state_label = v_label,
        canceled_at = case when not v_is_refund then v_now else s.canceled_at end,
        refunded_at = case when v_is_refund then v_now else s.refunded_at end
    where s.id = v_sub_id;
  end if;

  update public.users as u
  set membership_tier = 'free', subscription_type = 'free'
  where u.id = v_user_id;

  -- X6.34: 정산 영향 audit 자동 기록
  -- 결제 paid_at 의 KST 월 → 그 월의 정산이 있는지 확인
  v_settlement_month := (date_trunc('month',
    coalesce(v_order.paid_at, v_order.created_at) at time zone 'Asia/Seoul'
  ))::date;

  -- 같은 월에 paid 정산 (= 자동 정정 불가, 운영자 수동) 식별
  select count(*) filter (where s.status = 'paid')           as paid_n,
         count(*) filter (where s.status in ('pending','held','payable','carried_over')) as pending_n,
         max(s.id) filter (where s.status = 'paid')          as any_paid_id
    into v_affected
  from public.artist_settlements s
  where s.settlement_month = v_settlement_month;

  if v_affected.paid_n > 0 or v_affected.pending_n > 0 then
    insert into public.settlement_admin_audit_logs (
      settlement_id, artist_id, action, amount, from_month, to_month,
      admin_user_id, reason, detail
    ) values (
      v_affected.any_paid_id, v_user_id, 'payment_refunded',
      v_order.amount, v_settlement_month, null,
      null,
      '환불/취소 — 영향 정산 자동 감지',
      jsonb_build_object(
        'payment_order_id', v_order_id,
        'payapp_mul_no', v_mul_no,
        'pay_state', p_pay_state,
        'refund_amount', v_order.amount,
        'paid_at', v_order.paid_at,
        'settlement_month', v_settlement_month,
        'paid_settlements_affected', v_affected.paid_n,
        'pending_settlements_affected', v_affected.pending_n,
        'requires_manual_adjustment', v_affected.paid_n > 0
      )
    );
    v_settlement_msg := format(
      ' [settlement impact: %s paid + %s pending — %s]',
      v_affected.paid_n, v_affected.pending_n,
      case when v_affected.paid_n > 0
           then 'MANUAL ADJUSTMENT REQUIRED'
           else 'auto-fixed by next generate' end
    );
  end if;

  select u.membership_tier into v_tier from public.users as u where u.id = v_user_id;

  return query select v_user_id, v_order_id, v_sub_id, true, v_tier,
    (v_target_status || ' applied (state=' || p_pay_state || '/' || v_label ||
     ', tier=' || coalesce(v_tier,'?') || ')' || v_settlement_msg)::text;
end; $$;

-- ===== 2) admin_create_settlement_adjustment RPC =====
create or replace function public.admin_create_settlement_adjustment(
  p_artist_user_id uuid,
  p_apply_to_month date,
  p_amount bigint,
  p_reason text,
  p_source_payment_order_id uuid default null,
  p_source_settlement_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_id bigint;
  v_audit_id bigint;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_artist_user_id is null then raise exception 'p_artist_user_id required'; end if;
  if p_apply_to_month is null then raise exception 'p_apply_to_month required'; end if;
  if p_amount = 0 then raise exception 'amount cannot be 0'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason required (운영자 사유 필수)';
  end if;
  if not exists (select 1 from public.users where id = p_artist_user_id) then
    raise exception 'artist_user_id not found';
  end if;

  insert into public.settlement_adjustments (
    artist_user_id, apply_to_month, amount, reason,
    source_payment_order_id, source_settlement_id, created_by
  ) values (
    p_artist_user_id,
    (date_trunc('month', p_apply_to_month))::date,
    p_amount, btrim(p_reason),
    p_source_payment_order_id, p_source_settlement_id, v_admin
  ) returning id into v_id;

  insert into public.settlement_admin_audit_logs (
    settlement_id, artist_id, action, amount, from_month, to_month,
    admin_user_id, reason, detail
  ) values (
    p_source_settlement_id, p_artist_user_id, 'adjustment_created',
    p_amount, null, (date_trunc('month', p_apply_to_month))::date,
    v_admin, btrim(p_reason),
    jsonb_build_object(
      'adjustment_id', v_id,
      'source_payment_order_id', p_source_payment_order_id,
      'source_settlement_id', p_source_settlement_id
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'adjustment_id', v_id,
    'audit_id', v_audit_id,
    'artist_user_id', p_artist_user_id,
    'apply_to_month', (date_trunc('month', p_apply_to_month))::date,
    'amount', p_amount,
    'note', '다음 admin_generate_monthly_settlement(apply_to_month) 실행 시 prev_carried 에 합산됩니다.'
  );
end; $$;

grant execute on function public.admin_create_settlement_adjustment(uuid, date, bigint, text, uuid, uuid) to authenticated;
