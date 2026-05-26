-- 0192b — RBAC 관리자 관리 RPC (super_admin 전용, 마지막 super_admin 보호, audit log).
create or replace function public.admin_list_admins()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_manage_admins() then raise exception 'super_admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at), '[]'::jsonb) into v from (
    select a.id, a.user_id, a.email, a.role, a.is_active, a.created_at, a.invited_by,
      (a.user_id is not null) as linked,
      (select max(l.created_at) from public.admin_action_log l where l.actor_user_id = a.user_id) as last_action_at
    from public.admin_users a) x;
  return v;
end; $$;
grant execute on function public.admin_list_admins() to authenticated;

create or replace function public.admin_add_admin(p_email text, p_role text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_target uuid; v_id uuid; v_email text := lower(btrim(p_email));
begin
  if not public.can_manage_admins() then raise exception 'super_admin only'; end if;
  if v_email = '' then raise exception '이메일을 입력하세요'; end if;
  if p_role not in ('super_admin','content_admin','curator_admin','sales_admin','reviewer') then raise exception 'invalid role'; end if;
  select id into v_target from auth.users where lower(email) = v_email limit 1;
  insert into public.admin_users (user_id, email, role, invited_by, is_active)
  values (v_target, v_email, p_role, v_uid, true)
  on conflict (lower(email)) do update set role=excluded.role, is_active=true, user_id=coalesce(public.admin_users.user_id, excluded.user_id), updated_at=now()
  returning id into v_id;
  if v_target is not null then update public.users set role='admin' where id = v_target and role <> 'admin'; end if;
  insert into public.admin_action_log(actor_user_id, action, target_email, target_id, detail)
  values (v_uid, 'add_admin', v_email, v_id, jsonb_build_object('role', p_role, 'linked', v_target is not null));
  return jsonb_build_object('ok', true, 'id', v_id, 'linked', v_target is not null);
end; $$;
grant execute on function public.admin_add_admin(text, text) to authenticated;

create or replace function public.admin_update_admin_role(p_id uuid, p_role text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_cur record; v_super_cnt int;
begin
  if not public.can_manage_admins() then raise exception 'super_admin only'; end if;
  if p_role not in ('super_admin','content_admin','curator_admin','sales_admin','reviewer') then raise exception 'invalid role'; end if;
  select * into v_cur from public.admin_users where id = p_id;
  if v_cur.id is null then raise exception 'not found'; end if;
  if v_cur.role='super_admin' and p_role<>'super_admin' then
    select count(*) into v_super_cnt from public.admin_users where role='super_admin' and is_active;
    if v_super_cnt <= 1 then raise exception '마지막 super_admin 의 역할은 변경할 수 없습니다'; end if;
  end if;
  update public.admin_users set role=p_role, updated_at=now() where id=p_id;
  insert into public.admin_action_log(actor_user_id, action, target_email, target_id, detail)
  values (v_uid, 'update_role', v_cur.email, p_id, jsonb_build_object('from', v_cur.role, 'to', p_role));
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_update_admin_role(uuid, text) to authenticated;

create or replace function public.admin_set_admin_active(p_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_cur record; v_super_cnt int;
begin
  if not public.can_manage_admins() then raise exception 'super_admin only'; end if;
  select * into v_cur from public.admin_users where id = p_id;
  if v_cur.id is null then raise exception 'not found'; end if;
  if not p_active and v_cur.role='super_admin' and v_cur.is_active then
    select count(*) into v_super_cnt from public.admin_users where role='super_admin' and is_active;
    if v_super_cnt <= 1 then raise exception '마지막 super_admin 은 비활성화할 수 없습니다'; end if;
  end if;
  update public.admin_users set is_active=p_active, updated_at=now() where id=p_id;
  if v_cur.user_id is not null then
    if p_active then update public.users set role='admin' where id=v_cur.user_id and role<>'admin';
    else update public.users set role='user' where id=v_cur.user_id and role='admin'; end if;
  end if;
  insert into public.admin_action_log(actor_user_id, action, target_email, target_id, detail)
  values (v_uid, case when p_active then 'activate' else 'deactivate' end, v_cur.email, p_id, jsonb_build_object('role', v_cur.role));
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_set_admin_active(uuid, boolean) to authenticated;

create or replace function public.admin_recent_action_log(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public.can_manage_admins() then raise exception 'super_admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v from (
    select l.id, l.action, l.target_email, l.detail, l.created_at,
      (select email from auth.users au where au.id=l.actor_user_id) as actor_email
    from public.admin_action_log l order by l.created_at desc limit greatest(1,p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_recent_action_log(int) to authenticated;
