-- 0510 — 네이티브 앱(iOS/Android) 푸시 디바이스 토큰
--
-- 기존 public.push_subscriptions 는 Web Push 전용 형태(endpoint/p256dh/auth)라
-- 네이티브 토큰을 담을 수 없다. 네이티브는 전송 방식 자체가 다르다:
--   • android → FCM 등록 토큰 (FCM HTTP v1)
--   • ios     → APNs 디바이스 토큰 (APNs HTTP/2, p8 키)
-- 그래서 별도 테이블로 두고, send-push 가 두 경로로 나눠 보낸다.
--
-- 토큰은 기기+앱 단위로 유일하다. 같은 기기에서 다른 계정으로 로그인하면
-- 토큰의 주인이 바뀌어야 하므로 unique(token) 에 user_id 갱신을 건다
-- (그대로 두면 이전 사용자에게 알림이 계속 간다).

create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null,
  platform text not null check (platform in ('ios', 'android')),
  device_model text,
  app_version text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (token)
);

create index if not exists device_push_tokens_user_idx on public.device_push_tokens(user_id);

alter table public.device_push_tokens enable row level security;

-- 본인 토큰만 조회/삭제. 저장은 아래 security definer 함수로만.
drop policy if exists device_push_tokens_select_own on public.device_push_tokens;
create policy device_push_tokens_select_own on public.device_push_tokens
  for select using (auth.uid() = user_id);

drop policy if exists device_push_tokens_delete_own on public.device_push_tokens;
create policy device_push_tokens_delete_own on public.device_push_tokens
  for delete using (auth.uid() = user_id);

-- 토큰 저장/갱신. 기기 재설치·계정 전환 시 같은 토큰이 다시 올 수 있다.
create or replace function public.save_device_push_token(
  p_token text,
  p_platform text,
  p_device_model text default null,
  p_app_version text default null
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
  if p_token is null or length(btrim(p_token)) = 0 then
    raise exception 'token required';
  end if;
  if p_platform not in ('ios', 'android') then
    raise exception 'invalid platform';
  end if;

  insert into public.device_push_tokens(user_id, token, platform, device_model, app_version, last_seen_at)
  values (v_user, btrim(p_token), p_platform, p_device_model, p_app_version, now())
  on conflict (token) do update
    -- 계정 전환 시 주인을 옮긴다 — 이전 사용자에게 알림이 계속 가지 않도록.
    set user_id = excluded.user_id,
        platform = excluded.platform,
        device_model = excluded.device_model,
        app_version = excluded.app_version,
        last_seen_at = now();
end;
$$;

revoke all on function public.save_device_push_token(text, text, text, text) from public, anon;
grant execute on function public.save_device_push_token(text, text, text, text) to authenticated;

create or replace function public.delete_device_push_token(p_token text)
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
  delete from public.device_push_tokens
   where user_id = v_user and token = p_token;
end;
$$;

revoke all on function public.delete_device_push_token(text) from public, anon;
grant execute on function public.delete_device_push_token(text) to authenticated;

-- 발송용 — service_role 만.
create or replace function public.list_device_push_tokens_for(p_user_id uuid)
returns table (
  token text,
  platform text
)
language sql
security definer
set search_path = public
as $$
  select token, platform
  from public.device_push_tokens
  where user_id = p_user_id;
$$;

revoke all on function public.list_device_push_tokens_for(uuid) from public, anon, authenticated;
grant execute on function public.list_device_push_tokens_for(uuid) to service_role;

-- FCM UNREGISTERED / APNs BadDeviceToken 응답 시 정리.
create or replace function public.delete_device_push_token_by_value(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.device_push_tokens where token = p_token;
$$;

revoke all on function public.delete_device_push_token_by_value(text) from public, anon, authenticated;
grant execute on function public.delete_device_push_token_by_value(text) to service_role;
