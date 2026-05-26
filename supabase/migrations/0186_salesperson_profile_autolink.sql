-- 0186 — 영업인 본인 식별 + 이메일 자동연결. sales_agents.user_id 미연결 영업인을 로그인 시 자동 링크.
-- (메뉴 미노출 원인: 모든 sales_agents.user_id 가 null → is_agent 항상 false. 본인 이메일 매칭으로 자동 연결.)
create or replace function public.get_my_salesperson_profile()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_email text; v_agent record;
begin
  if v_uid is null then return jsonb_build_object('is_salesperson', false); end if;
  -- 1) 이미 연결된 활성 영업인
  select * into v_agent from public.sales_agents where user_id = v_uid and is_active limit 1;
  -- 2) 미연결 + 이메일 매칭 → 자동 연결 (본인 이메일 기준)
  if v_agent.id is null then
    select email into v_email from auth.users where id = v_uid;
    if v_email is not null and btrim(v_email) <> '' then
      update public.sales_agents set user_id = v_uid, updated_at = now()
      where id = (
        select id from public.sales_agents
        where user_id is null and is_active and lower(email) = lower(v_email)
        order by created_at limit 1)
      returning * into v_agent;
    end if;
  end if;
  if v_agent.id is null then return jsonb_build_object('is_salesperson', false); end if;
  return jsonb_build_object(
    'is_salesperson', true, 'sales_agent_id', v_agent.id, 'code', v_agent.code,
    'commission_rate', v_agent.commission_rate, 'name', v_agent.name);
end; $$;
grant execute on function public.get_my_salesperson_profile() to authenticated;

-- 관리자: 영업인 ↔ 로그인 계정 수동 연결
create or replace function public.admin_link_sales_agent_account(p_agent_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  update public.sales_agents set user_id = p_user_id, updated_at = now() where id = p_agent_id;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_link_sales_agent_account(uuid, uuid) to authenticated;
