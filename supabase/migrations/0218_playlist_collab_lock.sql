-- 0218 — 플레이리스트 협업 advisory lock (이미 prod 적용)
--
-- 큐레이터 / 관리자가 같은 플리를 동시에 편집할 때 충돌 방지.
-- 강제 차단 X — 다른 사용자가 활성 편집 중이면 경고만 표시,
-- 명시적 선택으로 "그래도 편집" (force_takeover) 가능. 5분 이상 stale 자동 takeover.

create table if not exists public.playlist_locks (
  playlist_id uuid primary key references public.playlists(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

alter table public.playlist_locks enable row level security;

drop policy if exists playlist_locks_select_own on public.playlist_locks;
create policy playlist_locks_select_own on public.playlist_locks
  for select using (auth.uid() = user_id);

drop policy if exists playlist_locks_delete_own on public.playlist_locks;
create policy playlist_locks_delete_own on public.playlist_locks
  for delete using (auth.uid() = user_id);

create or replace function public.acquire_or_check_lock(p_playlist_id uuid)
returns table (
  locked_by_me boolean,
  other_user_id uuid,
  other_nickname text,
  other_since_at timestamptz,
  other_heartbeat_at timestamptz,
  other_is_stale boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_existing record;
  v_stale_threshold interval := interval '5 minutes';
begin
  if v_me is null then
    raise exception 'unauthorized';
  end if;

  select pl.user_id, pl.acquired_at, pl.heartbeat_at, u.nickname
    into v_existing
  from public.playlist_locks pl
  left join public.users u on u.id = pl.user_id
  where pl.playlist_id = p_playlist_id;

  if v_existing.user_id is null then
    insert into public.playlist_locks(playlist_id, user_id) values (p_playlist_id, v_me);
    return query select true, null::uuid, null::text, null::timestamptz, null::timestamptz, null::boolean;
    return;
  end if;

  if v_existing.user_id = v_me then
    update public.playlist_locks set heartbeat_at = now() where playlist_id = p_playlist_id;
    return query select true, null::uuid, null::text, null::timestamptz, null::timestamptz, null::boolean;
    return;
  end if;

  if now() - v_existing.heartbeat_at > v_stale_threshold then
    update public.playlist_locks
       set user_id = v_me, acquired_at = now(), heartbeat_at = now()
     where playlist_id = p_playlist_id;
    return query select true, null::uuid, null::text, null::timestamptz, null::timestamptz, null::boolean;
    return;
  end if;

  return query select
    false,
    v_existing.user_id,
    coalesce(v_existing.nickname, '다른 사용자')::text,
    v_existing.acquired_at,
    v_existing.heartbeat_at,
    false;
end;
$$;

revoke all on function public.acquire_or_check_lock(uuid) from public, anon;
grant execute on function public.acquire_or_check_lock(uuid) to authenticated;

create or replace function public.release_playlist_lock(p_playlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then return; end if;
  delete from public.playlist_locks
   where playlist_id = p_playlist_id and user_id = v_me;
end;
$$;

revoke all on function public.release_playlist_lock(uuid) from public, anon;
grant execute on function public.release_playlist_lock(uuid) to authenticated;

create or replace function public.force_takeover_playlist_lock(p_playlist_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'unauthorized';
  end if;
  insert into public.playlist_locks(playlist_id, user_id, acquired_at, heartbeat_at)
  values (p_playlist_id, v_me, now(), now())
  on conflict (playlist_id) do update
    set user_id = v_me, acquired_at = now(), heartbeat_at = now();
end;
$$;

revoke all on function public.force_takeover_playlist_lock(uuid) from public, anon;
grant execute on function public.force_takeover_playlist_lock(uuid) to authenticated;
