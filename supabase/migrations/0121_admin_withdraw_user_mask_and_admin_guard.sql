-- 0121 — 관리자 대행 탈퇴 보강 (additive, 비파괴)
--   기존 동작 유지 + (1) 관리자 계정 탈퇴 명시적 거부 (2) idempotent (3) 개인정보 마스킹 포함.
--   결제/계약/정산/음원 row 삭제 없음. email/artist_name 등 식별자 보존. 시그니처 동일.
create or replace function public.admin_withdraw_user(p_user_id uuid, p_reason text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_canceled_subs int := 0;
  v_target_role text;
  v_already_withdrawn timestamptz;
  v_masked boolean := false;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  perform public._admin_user_action_guards(p_user_id);  -- self/last-admin/not-found 가드

  select role, withdrawn_at into v_target_role, v_already_withdrawn
    from public.users where id = p_user_id;

  -- 정책: 관리자 계정은 탈퇴 처리 불가
  if v_target_role = 'admin' then
    raise exception 'admin 계정은 탈퇴 처리할 수 없습니다';
  end if;

  -- 이미 탈퇴 처리된 경우 idempotent 반환
  if v_already_withdrawn is not null then
    return jsonb_build_object('ok', true, 'already_withdrawn', true, 'canceled_subs', 0, 'pii_masked', false);
  end if;

  -- 활성/대기 구독 취소 예약
  update public.subscriptions
    set status = 'cancel_scheduled', auto_renew = false,
        cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, '[admin withdraw] ' || coalesce(p_reason, ''))
    where user_id = p_user_id and status in ('active', 'payment_waiting');
  get diagnostics v_canceled_subs = row_count;

  -- 계정 차단 + 결제 등급 회수 (membership_tier 는 definer 가 변경 — 0120 컬럼권한 우회)
  update public.users
    set withdrawn_at = now(),
        withdrawn_reason = coalesce(p_reason, withdrawn_reason),
        membership_tier = 'free', subscription_type = 'free'
    where id = p_user_id;

  -- 개인정보 마스킹 (미마스킹 시에만). 결제/계약/정산/음원 이력·email·artist_name 은 보존.
  if (select pii_masked_at from public.users where id = p_user_id) is null then
    begin
      perform public.admin_mask_user_pii(p_user_id);
      v_masked := true;
    exception when others then
      v_masked := false;  -- 마스킹 실패해도 탈퇴 자체는 유지
    end;
  end if;

  begin
    perform admin_log_operation('admin_member_actions', 'member', 'warning', 'completed',
      format('withdraw user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'reason', p_reason,
                         'canceled_subs', v_canceled_subs, 'pii_masked', v_masked),
      p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'canceled_subs', v_canceled_subs, 'pii_masked', v_masked);
end; $function$;
