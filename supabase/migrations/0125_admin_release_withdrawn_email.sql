-- 0125 — 탈퇴 회원 이메일/identity 해제 (동일 이메일 재가입 허용)
--   auth.users.email 을 masked 로 변경 + auth.identities 해제(이메일/구글 모두). users row·이력 보존.
--   admin/withdrawn/admin-role 가드. idempotent(email_released_at). original_email 보존.
create or replace function public.admin_release_withdrawn_email(p_user_id uuid, p_reason text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_role text; v_withdrawn timestamptz; v_email text; v_masked text; v_released timestamptz;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  perform public._admin_user_action_guards(p_user_id);

  select role, withdrawn_at into v_role, v_withdrawn from public.users where id = p_user_id;
  if v_role = 'admin' then raise exception 'admin 계정은 처리할 수 없습니다'; end if;
  if v_withdrawn is null then raise exception '탈퇴 처리되지 않은 회원입니다 — 먼저 탈퇴 처리를 진행하세요'; end if;

  select email_released_at into v_released from public.users where id = p_user_id;
  if v_released is not null then
    return jsonb_build_object('ok', true, 'already_released', true);
  end if;

  select email into v_email from auth.users where id = p_user_id;
  v_masked := 'withdrawn+' || p_user_id::text || '@withdrawn.deudda.local';

  -- 원본 이메일 보존 (정산/계약 식별) + 해제 시각 기록
  update public.users
    set original_email = coalesce(original_email, v_email),
        email_released_at = now()
    where id = p_user_id;

  -- auth 이메일 해제 → 동일 이메일로 신규 가입 가능
  update auth.users
    set email = v_masked, email_change = '',
        email_change_token_new = '', email_change_token_current = ''
    where id = p_user_id;

  -- 이메일/구글 identity 해제 → 재가입 시 새 user 로 생성 (기존 탈퇴 row 는 이력으로 보존)
  delete from auth.identities where user_id = p_user_id;

  begin
    perform admin_log_operation('admin_member_actions', 'member', 'warning', 'completed',
      format('release withdrawn email %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'original_email', v_email, 'masked_email', v_masked, 'reason', p_reason),
      p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'original_email', v_email, 'masked_email', v_masked);
end; $function$;
