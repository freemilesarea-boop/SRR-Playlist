-- 0192 — 역할 기반 관리자 권한(RBAC). additive. 기존 role='admin' = super_admin 으로 호환.
create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, email text not null,
  role text not null check (role in ('super_admin','content_admin','curator_admin','sales_admin','reviewer')),
  invited_by uuid, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists uq_admin_users_email on public.admin_users(lower(email));
create unique index if not exists uq_admin_users_user on public.admin_users(user_id) where user_id is not null;
alter table public.admin_users enable row level security;
drop policy if exists admin_users_read on public.admin_users;
create policy admin_users_read on public.admin_users for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create table if not exists public.admin_action_log (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid, action text not null, target_email text, target_id uuid,
  detail jsonb, created_at timestamptz not null default now()
);
create index if not exists idx_aal_created on public.admin_action_log(created_at desc);
alter table public.admin_action_log enable row level security;
drop policy if exists aal_read on public.admin_action_log;
create policy aal_read on public.admin_action_log for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

insert into public.admin_users (user_id, email, role, is_active)
select u.id, coalesce(au.email, u.id::text), 'super_admin', true
from public.users u left join auth.users au on au.id=u.id
where u.role='admin'
on conflict (user_id) where user_id is not null do nothing;

create or replace function public.current_admin_role()
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    (select a.role from public.admin_users a
       where a.is_active and (a.user_id = auth.uid()
         or lower(a.email) = lower((select email from auth.users where id = auth.uid())))
       order by case a.role when 'super_admin' then 0 else 1 end limit 1),
    (case when exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then 'super_admin' else null end));
$$;
create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path to 'public' as $$ select public.current_admin_role() = 'super_admin'; $$;
create or replace function public.can_manage_admins() returns boolean language sql stable security definer set search_path to 'public' as $$ select public.current_admin_role() = 'super_admin'; $$;
create or replace function public.can_override_guardrails() returns boolean language sql stable security definer set search_path to 'public' as $$ select public.current_admin_role() = 'super_admin'; $$;
create or replace function public.can_manage_tracks() returns boolean language sql stable security definer set search_path to 'public' as $$ select public.current_admin_role() in ('super_admin','content_admin'); $$;
create or replace function public.can_manage_sales() returns boolean language sql stable security definer set search_path to 'public' as $$ select public.current_admin_role() in ('super_admin','sales_admin'); $$;
create or replace function public.can_manage_curation() returns boolean language sql stable security definer set search_path to 'public' as $$ select public.current_admin_role() in ('super_admin','curator_admin'); $$;
create or replace function public.can_review_tracks() returns boolean language sql stable security definer set search_path to 'public' as $$ select public.current_admin_role() in ('super_admin','content_admin','reviewer'); $$;
create or replace function public.admin_my_permissions()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('role', public.current_admin_role(), 'is_super_admin', public.is_super_admin(),
    'can_manage_admins', public.can_manage_admins(), 'can_override_guardrails', public.can_override_guardrails(),
    'can_manage_tracks', public.can_manage_tracks(), 'can_manage_sales', public.can_manage_sales(),
    'can_manage_curation', public.can_manage_curation(), 'can_review_tracks', public.can_review_tracks());
$$;
grant execute on function public.admin_my_permissions() to authenticated;
grant execute on function public.current_admin_role() to authenticated;
