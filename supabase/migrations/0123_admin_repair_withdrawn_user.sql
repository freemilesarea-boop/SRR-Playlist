-- 0123 — 이미 탈퇴된 회원의 누락 상태 보정 (additive, 비파괴)
--   탈퇴는 됐으나 마스킹/티어/구독취소가 누락된 경우(구버전 RPC·마스킹 버그로 발생) 안전하게 보정.
--   재탈퇴 아님 — withdrawn_at 이 이미 있는 회원에만 동작. idempotent. 이력/식별자 보존.
create or replace function public.admin_repair_withdrawn_user(p_user_id uuid, p_reason text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_withdrawn timestamptz; v_role text; v_tier text;
  v_masked boolean := false; v_tier_fixed boolean := false; v_subs int := 0;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  perform public._admin_user_action_guards(p_user_id);  -- self/last-admin/not-found

  select withdrawn_at, role, membership_tier into v_withdrawn, v_role, v_tier
    from public.users where id = p_user_id;

  if v_role = 'admin' then raise exception 'admin 계정은 처리할 수 없습니다'; end if;
  if v_withdrawn is null then
    raise exception '탈퇴 처리되지 않은 회원입니다 — 먼저 탈퇴 처리를 진행하세요';
  end if;

  -- 활성/대기 구독 정리
  update public.subscriptions
    set status = 'cancel_scheduled', auto_renew = false,
        cancel_requested_at = coalesce(cancel_requested_at, now()),
        cancel_reason = coalesce(cancel_reason, '[admin withdraw-repair] ' || coalesce(p_reason, ''))
    where user_id = p_user_id and status in ('active', 'payment_waiting');
  get diagnostics v_subs = row_count;

  -- 결제 등급 보정
  if coalesce(v_tier, '') <> 'free' then
    update public.users set membership_tier = 'free', subscription_type = 'free' where id = p_user_id;
    v_tier_fixed := true;
  end if;

  -- 사유 비어있으면 보강
  if p_reason is not null then
    update public.users set withdrawn_reason = coalesce(withdrawn_reason, p_reason) where id = p_user_id;
  end if;

  -- 개인정보 마스킹 (미마스킹 시에만)
  if (select pii_masked_at from public.users where id = p_user_id) is null then
    begin
      perform public.admin_mask_user_pii(p_user_id);
      v_masked := true;
    exception when others then
      v_masked := false;
    end;
  end if;

  begin
    perform admin_log_operation('admin_member_actions', 'member', 'warning', 'completed',
      format('repair withdrawn user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'masked', v_masked, 'tier_fixed', v_tier_fixed,
                         'canceled_subs', v_subs, 'reason', p_reason),
      p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'pii_masked', v_masked, 'tier_fixed', v_tier_fixed, 'canceled_subs', v_subs);
end; $function$;
