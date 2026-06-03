-- 0275 — Anti-abuse: daily user×track cap (KST 기준 일 3회) (X6.0)
--
-- 문제: 동일 계정이 동일 음원을 하루 종일 반복 재생하여 차트/정산/추천 점수를 인위적으로 부풀림.
--
-- 정책: stream_events 의 milestone_30s 이벤트 기준
--   - 동일 user_id + 동일 track_id + 동일 KST date 조합은 하루 최대 3회만 유효
--   - 4회차부터 is_effective=false, excluded_reason='daily_user_track_cap'
--   - 원본 row 는 보존 (삭제/수정 안 함). 단지 effective 플래그만 설정.
--
-- 적용 범위 (이 마이그레이션):
--   ✓ stream_events (charts / settlement / behavior_score / artist analytics 의 단일 진입점)
--   ✗ playback_events_v2 (dual-run 중 — 본격 적용 시 후속 migration 으로)
--   ✗ track_play_events (per-playlist fit 점수용 — 다른 어뷰징 패턴)
--
-- 익명 (user_id IS NULL) 이벤트는 본 정책 비적용 (계정 단위 어뷰징 정의)
-- 단, anonymous 어뷰징 추후 정책은 별도 후속 작업.
--
-- ===== A. 컬럼 추가 (additive only) =====

alter table public.stream_events
  add column if not exists is_effective boolean not null default true,
  add column if not exists excluded_reason text,
  add column if not exists daily_user_track_rank int,
  add column if not exists effective_play_date_kst date;

-- 인덱스
create index if not exists idx_stream_events_effective_milestone
  on public.stream_events (track_id, created_at desc)
  where event_type = 'milestone_30s' and is_effective = true;

create index if not exists idx_stream_events_user_track_kst_date
  on public.stream_events (user_id, track_id, effective_play_date_kst)
  where user_id is not null and event_type = 'milestone_30s';

create index if not exists idx_stream_events_excluded_reason
  on public.stream_events (excluded_reason, effective_play_date_kst desc)
  where excluded_reason is not null;

-- ===== B. 백필 (기존 row rank 계산) =====
-- milestone_30s + user_id IS NOT NULL 에 대해 KST date 단위 rank 부여.
-- rank <= 3 → is_effective=true; rank > 3 → is_effective=false + excluded_reason.

with ranked as (
  select id,
    (created_at at time zone 'Asia/Seoul')::date as kst_date,
    row_number() over (
      partition by user_id, track_id, (created_at at time zone 'Asia/Seoul')::date
      order by created_at asc, id asc
    ) as rnk
  from public.stream_events
  where user_id is not null and event_type = 'milestone_30s'
)
update public.stream_events se set
  effective_play_date_kst = r.kst_date,
  daily_user_track_rank = r.rnk,
  is_effective = case when r.rnk <= 3 then true else false end,
  excluded_reason = case when r.rnk > 3 then 'daily_user_track_cap' else null end
from ranked r
where r.id = se.id;

-- 비-milestone 또는 anonymous: KST date 만 채움 (is_effective 기본 true 유지)
update public.stream_events
set effective_play_date_kst = (created_at at time zone 'Asia/Seoul')::date
where effective_play_date_kst is null;

-- ===== C. INSERT 트리거 (신규 row 자동 분류) =====

create or replace function public._stream_events_set_effective()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_rank int;
  v_kst_date date;
begin
  v_kst_date := (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;
  new.effective_play_date_kst := v_kst_date;

  -- 정책 적용 대상: milestone_30s + 로그인 사용자
  if new.event_type = 'milestone_30s' and new.user_id is not null then
    select count(*) + 1 into v_rank
    from public.stream_events
    where user_id = new.user_id
      and track_id = new.track_id
      and event_type = 'milestone_30s'
      and effective_play_date_kst = v_kst_date;

    new.daily_user_track_rank := v_rank;
    if v_rank > 3 then
      new.is_effective := false;
      new.excluded_reason := 'daily_user_track_cap';
    else
      -- 명시 입력 무시: 정책상 true (호출자가 임의로 false 못 주게)
      new.is_effective := true;
      new.excluded_reason := null;
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists trg_stream_events_set_effective on public.stream_events;
create trigger trg_stream_events_set_effective
  before insert on public.stream_events
  for each row execute function public._stream_events_set_effective();

-- ===== D. 권한 (helper 는 trigger 만 호출) =====
revoke all on function public._stream_events_set_effective() from public, anon, authenticated;
