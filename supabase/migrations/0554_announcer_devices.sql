-- 0554_announcer_devices.sql
--
-- 안내방송 전용 플레이어 2단계 — 켜짐 상태(heartbeat)와 중복 송출 방지.
--
-- 왜
--   매장에 음악 플레이어와 안내방송 전용 플레이어를 함께 켜 두면 같은 안내가 두 번 나갔다.
--   안내 전용 기기가 살아 있으면 음악 플레이어는 안내를 내보내지 않고, 안내 전용 기기가
--   꺼지면(heartbeat 끊김) 음악 플레이어가 다시 받는다 — 자동 failover.
--
-- 설계
--   · announcer_devices — 안내 전용 창 하나 = 한 줄 (user_id + 창 instance_id).
--     brand_player_sessions 에 섞지 않는다: 그 테이블은 음악 재생 장애 감시(incident)의
--     근거라, 음악을 틀지 않는 안내 전용 기기가 들어가면 "무음 매장" 오탐이 난다.
--   · "같은 매장" = 같은 로그인 계정(user_id). 송출 범위(_store_in_enterprise)도 계정 기준이다.
--   · armed(첫 터치로 소리 허용됨)인 기기만 대신 송출할 수 있다고 본다 — 터치 전인 안내
--     전용 기기 때문에 음악 플레이어가 안내를 놓치면 안 된다.
--   · 온라인 판정: 마지막 heartbeat 150초 이내 (클라이언트 주기 60초).

create table if not exists public.announcer_devices (
  user_id               uuid        not null references auth.users(id) on delete cascade,
  instance_id           text        not null check (char_length(instance_id) between 1 and 80),
  brand_id              uuid,
  enterprise_account_id uuid,
  armed                 boolean     not null default false,
  user_agent            text,
  last_seen_at          timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  primary key (user_id, instance_id)
);

create index if not exists idx_announcer_devices_ea_seen
  on public.announcer_devices (enterprise_account_id, last_seen_at desc);

-- 직접 접근 없음 — 아래 SECURITY DEFINER RPC 로만.
alter table public.announcer_devices enable row level security;

create or replace function public.announcer_heartbeat(
  p_instance_id text,
  p_brand_id    uuid    default null,
  p_armed       boolean default false,
  p_user_agent  text    default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea  uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_instance_id is null or char_length(p_instance_id) not between 1 and 80 then
    raise exception 'invalid_instance_id';
  end if;
  if p_brand_id is not null then
    select b.enterprise_account_id into v_ea from public.brand_accounts b where b.id = p_brand_id;
  end if;

  insert into public.announcer_devices (user_id, instance_id, brand_id, enterprise_account_id, armed, user_agent, last_seen_at)
  values (v_uid, p_instance_id, p_brand_id, v_ea, coalesce(p_armed, false), left(p_user_agent, 300), now())
  on conflict (user_id, instance_id) do update
     set brand_id              = coalesce(excluded.brand_id, announcer_devices.brand_id),
         enterprise_account_id = coalesce(excluded.enterprise_account_id, announcer_devices.enterprise_account_id),
         armed                 = excluded.armed,
         user_agent            = coalesce(excluded.user_agent, announcer_devices.user_agent),
         last_seen_at          = now();

  -- 오래된 줄 정리 (이 계정 것만, 하루 지난 것)
  delete from public.announcer_devices
   where user_id = v_uid and last_seen_at < now() - interval '1 day';

  return jsonb_build_object('success', true, 'at', now());
end;
$$;

-- 창을 닫을 때 바로 내려 음악 플레이어가 즉시 이어받게 한다 (실패해도 150초 뒤 자연 만료).
create or replace function public.announcer_goodbye(p_instance_id text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.announcer_devices where user_id = auth.uid() and instance_id = p_instance_id;
$$;

-- 0552 판정 + 이 계정에 살아 있는 안내 전용 기기가 있는가.
create or replace function public.my_announcement_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'eligible', public.my_announcement_eligible(),
    'announcer_online', exists (
      select 1 from public.announcer_devices d
       where d.user_id = auth.uid() and d.armed
         and d.last_seen_at > now() - interval '150 seconds'),
    'checked_at', now());
$$;

revoke all on function public.announcer_heartbeat(text, uuid, boolean, text) from public, anon;
revoke all on function public.announcer_goodbye(text) from public, anon;
revoke all on function public.my_announcement_status() from public, anon;
grant execute on function public.announcer_heartbeat(text, uuid, boolean, text) to authenticated;
grant execute on function public.announcer_goodbye(text) to authenticated;
grant execute on function public.my_announcement_status() to authenticated;
