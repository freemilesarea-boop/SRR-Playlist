-- ============================================
-- 스르륵 플리 DB 스키마
-- Supabase 프로젝트에서 SQL Editor로 실행
-- ============================================

-- ============================================
-- users (auth.users를 확장)
-- ============================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  role text not null default 'user' check (role in ('user', 'admin')),
  subscription_type text not null default 'free' check (subscription_type in ('free', 'personal', 'business')),
  business_category text,
  created_at timestamptz not null default now()
);

-- ============================================
-- tracks
-- ============================================
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  genre text,
  mood text,
  audio_url text not null,
  cover_url text,
  duration int,
  created_at timestamptz not null default now()
);

-- ============================================
-- playlists
-- ============================================
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  business_category text,
  thumbnail_url text,
  description text,
  is_business_only boolean not null default false,
  time_slot text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================
-- playlist_tracks
-- ============================================
create table if not exists public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  order_index int not null default 0,
  unique(playlist_id, track_id)
);

create index if not exists idx_playlist_tracks_playlist on public.playlist_tracks(playlist_id, order_index);

-- ============================================
-- likes
-- ============================================
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, playlist_id)
);

create index if not exists idx_likes_user on public.likes(user_id);

-- ============================================
-- recent_plays
-- ============================================
create table if not exists public.recent_plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  played_at timestamptz not null default now()
);

create index if not exists idx_recent_plays_user on public.recent_plays(user_id, played_at desc);

-- ============================================
-- auto-create users row when auth user signs up
-- ============================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- Row Level Security
-- ============================================
alter table public.users enable row level security;
alter table public.tracks enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.likes enable row level security;
alter table public.recent_plays enable row level security;

-- users: 본인만 select/update, 관리자는 전체
drop policy if exists "users_select_self" on public.users;
create policy "users_select_self" on public.users for select using (auth.uid() = id);

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users for update using (auth.uid() = id);

-- tracks: 로그인 사용자 read, admin write
drop policy if exists "tracks_read_all" on public.tracks;
create policy "tracks_read_all" on public.tracks for select using (true);

drop policy if exists "tracks_admin_write" on public.tracks;
create policy "tracks_admin_write" on public.tracks for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- playlists: read all, admin write
drop policy if exists "playlists_read_all" on public.playlists;
create policy "playlists_read_all" on public.playlists for select using (true);

drop policy if exists "playlists_admin_write" on public.playlists;
create policy "playlists_admin_write" on public.playlists for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- playlist_tracks: read all, admin write
drop policy if exists "playlist_tracks_read_all" on public.playlist_tracks;
create policy "playlist_tracks_read_all" on public.playlist_tracks for select using (true);

drop policy if exists "playlist_tracks_admin_write" on public.playlist_tracks;
create policy "playlist_tracks_admin_write" on public.playlist_tracks for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- likes: 본인 데이터만
drop policy if exists "likes_select_self" on public.likes;
create policy "likes_select_self" on public.likes for select using (auth.uid() = user_id);

drop policy if exists "likes_insert_self" on public.likes;
create policy "likes_insert_self" on public.likes for insert with check (auth.uid() = user_id);

drop policy if exists "likes_delete_self" on public.likes;
create policy "likes_delete_self" on public.likes for delete using (auth.uid() = user_id);

-- recent_plays: 본인 데이터만
drop policy if exists "recent_plays_select_self" on public.recent_plays;
create policy "recent_plays_select_self" on public.recent_plays for select using (auth.uid() = user_id);

drop policy if exists "recent_plays_insert_self" on public.recent_plays;
create policy "recent_plays_insert_self" on public.recent_plays for insert with check (auth.uid() = user_id);

-- ============================================
-- Subscription requests (PayApp 연동 전 단계의 신청 큐)
-- ============================================
create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  requested_plan text not null check (requested_plan in ('personal', 'business')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sub_req_user on public.subscription_requests(user_id, created_at desc);

alter table public.subscription_requests enable row level security;

drop policy if exists "sub_req_select_self_or_admin" on public.subscription_requests;
create policy "sub_req_select_self_or_admin" on public.subscription_requests for select using (
  auth.uid() = user_id
  or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

drop policy if exists "sub_req_insert_self" on public.subscription_requests;
create policy "sub_req_insert_self" on public.subscription_requests for insert with check (auth.uid() = user_id);

drop policy if exists "sub_req_admin_update" on public.subscription_requests;
create policy "sub_req_admin_update" on public.subscription_requests for update using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- ============================================
-- Storage buckets + 정책
-- (대시보드에서 audio, covers 두 버킷을 Public 으로 만든 뒤 아래 정책을 적용)
-- ============================================

-- public read (둘 다 익명 read 가능)
drop policy if exists "audio_public_read" on storage.objects;
create policy "audio_public_read" on storage.objects for select using (bucket_id = 'audio');

drop policy if exists "covers_public_read" on storage.objects;
create policy "covers_public_read" on storage.objects for select using (bucket_id = 'covers');

-- 인증 사용자만 업로드 (관리자 페이지에서 업로드)
drop policy if exists "audio_authed_write" on storage.objects;
create policy "audio_authed_write" on storage.objects for insert with check (
  bucket_id = 'audio' and auth.role() = 'authenticated'
);

drop policy if exists "covers_authed_write" on storage.objects;
create policy "covers_authed_write" on storage.objects for insert with check (
  bucket_id = 'covers' and auth.role() = 'authenticated'
);

-- 관리자만 삭제
drop policy if exists "audio_admin_delete" on storage.objects;
create policy "audio_admin_delete" on storage.objects for delete using (
  bucket_id = 'audio'
  and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

drop policy if exists "covers_admin_delete" on storage.objects;
create policy "covers_admin_delete" on storage.objects for delete using (
  bucket_id = 'covers'
  and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
