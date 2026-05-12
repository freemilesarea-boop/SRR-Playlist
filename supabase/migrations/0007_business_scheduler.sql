-- ============================================
-- 0007_business_scheduler.sql
-- 매장 자동 스케줄러 — 영업시간/요일별 플레이리스트 전환
-- ============================================

-- ============================================
-- business_profiles
-- ============================================
create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  store_name text,
  business_type text,
  timezone text not null default 'Asia/Seoul',
  open_time time,
  close_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_profiles_user on public.business_profiles(user_id);

alter table public.business_profiles enable row level security;

drop policy if exists "business_profiles_select_self_or_admin" on public.business_profiles;
create policy "business_profiles_select_self_or_admin" on public.business_profiles
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

drop policy if exists "business_profiles_all_self" on public.business_profiles;
create policy "business_profiles_all_self" on public.business_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- business_music_schedules
-- ============================================
create table if not exists public.business_music_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  day_of_week int not null check (day_of_week >= 0 and day_of_week <= 6),
  slot_name text not null,
  start_time time not null,
  end_time time not null,
  playlist_id uuid references public.playlists(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create index if not exists idx_bms_user on public.business_music_schedules(user_id);
create index if not exists idx_bms_day on public.business_music_schedules(user_id, day_of_week);
create index if not exists idx_bms_active on public.business_music_schedules(is_active);

alter table public.business_music_schedules enable row level security;

drop policy if exists "bms_select_self_or_admin" on public.business_music_schedules;
create policy "bms_select_self_or_admin" on public.business_music_schedules
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

drop policy if exists "bms_all_self" on public.business_music_schedules;
create policy "bms_all_self" on public.business_music_schedules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- business_schedule_events (선택적 로그)
-- ============================================
create table if not exists public.business_schedule_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade,
  schedule_id uuid references public.business_music_schedules(id) on delete set null,
  playlist_id uuid references public.playlists(id) on delete set null,
  event_type text not null check (event_type in ('started','switched','stopped')),
  created_at timestamptz not null default now()
);

create index if not exists idx_bse_user on public.business_schedule_events(user_id, created_at desc);

alter table public.business_schedule_events enable row level security;

drop policy if exists "bse_insert_self" on public.business_schedule_events;
create policy "bse_insert_self" on public.business_schedule_events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "bse_select_self_or_admin" on public.business_schedule_events;
create policy "bse_select_self_or_admin" on public.business_schedule_events
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- updated_at 자동 갱신 트리거
-- ============================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_bp_touch on public.business_profiles;
create trigger trg_bp_touch before update on public.business_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_bms_touch on public.business_music_schedules;
create trigger trg_bms_touch before update on public.business_music_schedules
  for each row execute function public.touch_updated_at();
