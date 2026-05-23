-- 0126 — 탈퇴/보정 시 이메일 자동 해제 연결 (additive, 비파괴)
--   admin_withdraw_user / admin_repair_withdrawn_user 가 처리 끝에 admin_release_withdrawn_email 호출.
--   실패해도 탈퇴/보정 자체는 유지(begin/exception). 동일 이메일 재가입을 탈퇴 시점에 보장.
create or replace function public.admin_withdraw_user(p_user_id uuid, p_reason text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_canceled_subs int := 0; v_target_role text; v_already_withdrawn timestamptz;
  v_masked boolean := false; v_released boolean := false;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  perform public._admin_user_action_guards(p_user_id);

  select role, withdrawn_at into v_target_role, v_already_withdrawn from public.users where id = p_user_id;
  if v_target_role = 'admin' then raise exception 'admin 계정은 탈퇴 처리할 수 없습니다'; end if;
  if v_already_withdrawn is not null then
    return jsonb_build_object('ok', true, 'already_withdrawn', true, 'canceled_subs', 0, 'pii_masked', false);
  end if;

  update public.subscriptions
    set status = 'cancel_scheduled', auto_renew = false,
        cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, '[admin withdraw] ' || coalesce(p_reason, ''))
    where user_id = p_user_id and status in ('active', 'payment_waiting');
  get diagnostics v_canceled_subs = row_count;

  update public.users
    set withdrawn_at = now(), withdrawn_reason = coalesce(p_reason, withdrawn_reason),
        membership_tier = 'free', subscription_type = 'free'
    where id = p_user_id;

  if (select pii_masked_at from public.users where id = p_user_id) is null then
    begin perform public.admin_mask_user_pii(p_user_id); v_masked := true;
    exception when others then v_masked := false; end;
  end if;

  begin perform public.admin_release_withdrawn_email(p_user_id, p_reason); v_released := true;
  exception when others then v_released := false; end;

  begin
    perform admin_log_operation('admin_member_actions', 'member', 'warning', 'completed',
      format('withdraw user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'reason', p_reason, 'canceled_subs', v_canceled_subs,
                         'pii_masked', v_masked, 'email_released', v_released),
      p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'canceled_subs', v_canceled_subs, 'pii_masked', v_masked, 'email_released', v_released);
end; $function$;

create or replace function public.admin_repair_withdrawn_user(p_user_id uuid, p_reason text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_withdrawn timestamptz; v_role text; v_tier text;
  v_masked boolean := false; v_tier_fixed boolean := false; v_subs int := 0; v_released boolean := false;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  perform public._admin_user_action_guards(p_user_id);

  select withdrawn_at, role, membership_tier into v_withdrawn, v_role, v_tier from public.users where id = p_user_id;
  if v_role = 'admin' then raise exception 'admin 계정은 처리할 수 없습니다'; end if;
  if v_withdrawn is null then raise exception '탈퇴 처리되지 않은 회원입니다 — 먼저 탈퇴 처리를 진행하세요'; end if;

  update public.subscriptions
    set status = 'cancel_scheduled', auto_renew = false,
        cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, '[admin withdraw-repair] ' || coalesce(p_reason, ''))
    where user_id = p_user_id and status in ('active', 'payment_waiting');
  get diagnostics v_subs = row_count;

  if coalesce(v_tier, '') <> 'free' then
    update public.users set membership_tier = 'free', subscription_type = 'free' where id = p_user_id;
    v_tier_fixed := true;
  end if;

  if p_reason is not null then
    update public.users set withdrawn_reason = coalesce(withdrawn_reason, p_reason) where id = p_user_id;
  end if;

  if (select pii_masked_at from public.users where id = p_user_id) is null then
    begin perform public.admin_mask_user_pii(p_user_id); v_masked := true;
    exception when others then v_masked := false; end;
  end if;

  if (select email_released_at from public.users where id = p_user_id) is null then
    begin perform public.admin_release_withdrawn_email(p_user_id, p_reason); v_released := true;
    exception when others then v_released := false; end;
  end if;

  begin
    perform admin_log_operation('admin_member_actions', 'member', 'warning', 'completed',
      format('repair withdrawn user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'masked', v_masked, 'tier_fixed', v_tier_fixed,
                         'canceled_subs', v_subs, 'email_released', v_released, 'reason', p_reason),
      p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'pii_masked', v_masked, 'tier_fixed', v_tier_fixed,
                            'canceled_subs', v_subs, 'email_released', v_released);
end; $function$;
