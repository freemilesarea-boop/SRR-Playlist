-- 0216 — PWA Web Push 알림 인프라
--
-- 매장 사장님이 자리 비운 사이 매장 모드 중단/자동 전환 실패 등 운영 이벤트를
-- 폰 push 로 즉시 알림. 무료 체험 만료/음원 검수 등 다른 워크플로도 재사용.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subs_select_own on public.push_subscriptions;
create policy push_subs_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists push_subs_delete_own on public.push_subscriptions;
create policy push_subs_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthorized';
  end if;
  insert into public.push_subscriptions(user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
  values (v_user, p_endpoint, p_p256dh, p_auth, p_user_agent, now())
  on conflict (user_id, endpoint) do update
    set p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'unauthorized';
  end if;
  delete from public.push_subscriptions
   where user_id = v_user and endpoint = p_endpoint;
end;
$$;

revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;

create or replace function public.list_push_subscriptions_for(p_user_id uuid)
returns table (
  endpoint text,
  p256dh text,
  auth text
)
language sql
security definer
set search_path = public
as $$
  select endpoint, p256dh, auth
  from public.push_subscriptions
  where user_id = p_user_id;
$$;

revoke all on function public.list_push_subscriptions_for(uuid) from public, anon, authenticated;
grant execute on function public.list_push_subscriptions_for(uuid) to service_role;

create or replace function public.delete_push_subscription_by_endpoint(p_endpoint text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.delete_push_subscription_by_endpoint(text) from public, anon, authenticated;
grant execute on function public.delete_push_subscription_by_endpoint(text) to service_role;
