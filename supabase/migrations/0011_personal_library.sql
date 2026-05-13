-- ============================================
-- 0011_personal_library.sql
--
-- 개인 라이브러리 스키마 보강 (스펙: Personal Library Phase):
--   1) recently_played_tracks: playlist_id 컬럼 + UNIQUE(user_id, track_id)
--   2) continue_listening: user 당 1행 (큐 전체 + 재생 상태 jsonb) 로 재구성
--
-- 주의:
--   기존 0005 의 continue_listening 은 (user_id, track_id) 복합 PK + 단일 위치만
--   저장하던 구조. 새 스키마는 user 당 1행 + queue jsonb. 호환 불가하므로 DROP+CREATE.
--   기존 데이터는 클라이언트 localStorage 폴백이 있어 손실 영향 낮음.
-- ============================================

-- ----------------------
-- 1) recently_played_tracks
-- ----------------------
alter table public.recently_played_tracks
  add column if not exists playlist_id uuid references public.playlists(id) on delete set null;

create index if not exists idx_recently_played_playlist
  on public.recently_played_tracks(playlist_id);

-- 같은 user_id+track_id 중복 정리 — 최신 played_at 만 남김
delete from public.recently_played_tracks a
using public.recently_played_tracks b
where a.user_id is not null
  and a.user_id = b.user_id
  and a.track_id = b.track_id
  and a.played_at < b.played_at;

-- (user_id, track_id) 유일성 — anonymous (user_id IS NULL) 행은 다중 허용
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'recently_played_user_track_unique'
  ) then
    alter table public.recently_played_tracks
      add constraint recently_played_user_track_unique
      unique (user_id, track_id);
  end if;
end;
$$;

-- ----------------------
-- 2) continue_listening 재구성 — user 당 1행, full state
-- ----------------------
drop table if exists public.continue_listening cascade;

create table public.continue_listening (
  user_id uuid primary key references public.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  playlist_id uuid references public.playlists(id) on delete set null,
  queue jsonb not null default '[]'::jsonb,
  current_index int not null default 0,
  position_sec int not null default 0,
  duration_sec int not null default 0,
  volume numeric(3,2) not null default 0.80 check (volume >= 0 and volume <= 1),
  shuffle boolean not null default false,
  repeat_mode text not null default 'off' check (repeat_mode in ('off','all','one')),
  business_mode boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists idx_continue_listening_updated
  on public.continue_listening(updated_at desc);

alter table public.continue_listening enable row level security;

drop policy if exists "continue_listening_all_self" on public.continue_listening;
create policy "continue_listening_all_self" on public.continue_listening
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- admin select 허용 (분석/지원 용도)
drop policy if exists "continue_listening_admin_select" on public.continue_listening;
create policy "continue_listening_admin_select" on public.continue_listening
  for select using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

comment on table public.continue_listening is
  '사용자당 1행. 마지막 재생 큐+상태 (재진입 복원용). 큐는 jsonb 배열로 TrackRow 스냅샷.';

-- 확인 출력
select
  count(*) as total_users_with_continue,
  max(updated_at) as last_save
from public.continue_listening;
