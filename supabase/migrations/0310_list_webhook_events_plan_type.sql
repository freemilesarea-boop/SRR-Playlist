-- 0310 — list_recent_webhook_events 에 plan_type 컬럼 추가 (X6.24)
--
-- 배경:
--   X6.22 부터 artist_general / artist_student 신규 플랜이 추가되면서
--   동일 가격(6,900원 = business / artist_general, 4,900원 = individual /
--   artist_student) 충돌이 발생.
--   PaymentSyncTool 에서 강제 승인할 때 가격만으로 plan_type 을 추론하면
--   business 와 artist_general 을 구분 불가 → 관리자 실수 가능.
--
-- 해결:
--   webhook event 의 matched_order_id (payment_orders.id) 에서 plan_type 을
--   조인하여 row.plan_type 으로 노출. 매칭되지 않은 이벤트는 NULL.
--   UI 는 row.plan_type 을 우선 사용하고, NULL 일 때만 가격 기반 추론 +
--   가격이 ambiguous 한 경우 운영자에게 에러 토스트.
--
-- 영향: 기존 컬럼 순서는 모두 보존, 마지막에 plan_type 만 append.
--   반환 타입이 변경되므로 DROP 후 재생성 필요.

drop function if exists public.list_recent_webhook_events(text, integer, integer);

create or replace function public.list_recent_webhook_events(
  p_search text default null::text,
  p_minutes integer default 60,
  p_limit integer default 50
)
returns table(
  id uuid, event_key text, order_no text, user_id uuid,
  payapp_mul_no text, payapp_rebill_no text,
  pay_state integer, state_label text, price integer,
  linkval_verified boolean, processed_at timestamptz, reasons text,
  matched_user_id uuid, matched_user_email text,
  matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text,
  processing_error text, paid_candidate boolean, approval_no text,
  created_at timestamptz,
  plan_type text  -- ✅ X6.24 신규
)
language plpgsql security definer set search_path = public as $$
declare v_search text := btrim(coalesce(p_search, ''));
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;
  return query
  select e.id, e.event_key, e.order_no, e.user_id, e.payapp_mul_no, e.payapp_rebill_no,
         e.pay_state,
         coalesce(e.state_label, public._payapp_state_label(e.pay_state)) as state_label,
         e.price, e.linkval_verified, e.processed_at,
         coalesce(e.raw_payload->'_verification'->>'reasons','')::text as reasons,
         e.matched_user_id, au.email::text as matched_user_email,
         e.matched_order_id, e.matched_subscription_id,
         e.membership_updated, e.final_membership_tier, e.processing_error,
         e.paid_candidate, e.approval_no, e.created_at,
         po.plan_type as plan_type
  from public.payapp_webhook_events as e
  left join auth.users as au on au.id = e.matched_user_id
  left join public.payment_orders as po on po.id = e.matched_order_id
  where e.created_at > now() - make_interval(mins => greatest(1, p_minutes))
    and (v_search = '' or e.payapp_mul_no = v_search or e.order_no = v_search
         or e.raw_payload::text ilike '%' || v_search || '%')
  order by e.created_at desc
  limit greatest(1, p_limit);
end;
$$;
