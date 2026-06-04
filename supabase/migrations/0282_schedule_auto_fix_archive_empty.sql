-- 0282 — Schedule 빈 플리 자동 fix + 빈 플리 archive (X6.0.1 매장 납품 가드)
--
-- 배경:
--   매장 모드 신고: 사용자 schedule 이 같은 이름의 구버전 빈 플리(0곡)를 가리켜
--   재생 시 큐 비어 "재생 가능한 음악이 없어요" 토스트.
--   원인: 큐레이션 후 새 플리 생성 시 schedule.playlist_id 갱신 누락.
--
-- 이 마이그레이션:
--   1) playlists.archived_at 컬럼 추가 (soft archive)
--   2) snapshot 테이블 생성 (수정 전/후 보존)
--   3) 자동 fix 실행:
--      - schedule 이 가리키는 playlist 중 playlist_tracks=0 또는 get_playlist_tracks=0 인 경우만 대상
--      - 매칭 우선순위:
--        a) 같은 title + playable>0 + daypart 일치
--        b) 같은 title + playable>0
--        c) 같은 business_category + daypart 일치 + playable>0
--      - 후보 중 정렬: daypart 일치 desc → created_at desc → playable desc
--      - 후보 없으면 수정 안 함 (snapshot 에 reason 기록)
--   4) 어떤 schedule 도 가리키지 않는 빈 플리 → archived_at = now()
--   5) playlist_tracks 원본 변경 없음.
--
-- 멱등: 이미 archived 된 plist 는 skip, 이미 fix 된 schedule 은 skip.

-- ===== A. archived_at 컬럼 =====
alter table public.playlists
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

create index if not exists idx_playlists_archived
  on public.playlists(archived_at)
  where archived_at is not null;

-- ===== B. snapshot 테이블 =====
create table if not exists public._x6_schedule_fix_snapshot (
  id bigserial primary key,
  schedule_id uuid,
  user_id uuid,
  slot_name text,
  old_playlist_id uuid,
  old_playlist_title text,
  old_playable_count int,
  new_playlist_id uuid,
  new_playlist_title text,
  new_playable_count int,
  match_strategy text,  -- 'title_exact_daypart' / 'title_exact' / 'category_daypart' / 'no_match'
  action text,           -- 'updated' / 'skipped_no_candidate' / 'skipped_not_empty'
  fixed_at timestamptz default now()
);

create table if not exists public._x6_playlist_archive_snapshot (
  id bigserial primary key,
  playlist_id uuid,
  title text,
  business_category text,
  daypart text,
  archived_at timestamptz default now()
);
