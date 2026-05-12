-- ============================================
-- 개발용 — 차트 테스트 데이터 시드
-- 운영 DB 에는 적용하지 마세요!
--
-- 사용 방법:
--   1) Supabase Dashboard → SQL Editor 에 붙여넣기 → Run
--   2) /charts 페이지에서 결과 확인
--
-- 효과:
--   - 30개 더미 트랙 각각에 무작위 분포로 stream_events 추가
--   - 일간/주간/월간 차트 모두에 데이터가 채워짐
--
-- 정리:
--   delete from public.stream_events where session_id like 'dev-seed-%';
-- ============================================

-- 1) 기존 dev seed 이벤트 정리 (재실행 안전)
delete from public.stream_events
where session_id like 'dev-seed-%';

-- 2) 일간 이벤트 (오늘 안, 상위 트랙일수록 많이)
with ranked as (
  select id, duration,
    row_number() over (order by created_at desc) as rn
  from public.tracks
  limit 30
)
insert into public.stream_events
  (user_id, track_id, session_id, listened_seconds, completed, event_type, created_at)
select
  null,
  r.id,
  'dev-seed-' || gen_random_uuid()::text,
  coalesce(r.duration, 180),
  false,
  'milestone_30s',
  now() - (random() * interval '20 hours')
from ranked r
cross join generate_series(1, greatest(1, 35 - r.rn::int)::int) g;

-- 3) 주간 이벤트 (최근 7일)
with ranked as (
  select id, duration,
    row_number() over (order by created_at desc) as rn
  from public.tracks
  limit 30
)
insert into public.stream_events
  (user_id, track_id, session_id, listened_seconds, completed, event_type, created_at)
select
  null,
  r.id,
  'dev-seed-' || gen_random_uuid()::text,
  coalesce(r.duration, 180),
  (g % 3 = 0),
  'milestone_30s',
  now() - (random() * interval '6 days') - interval '1 day'
from ranked r
cross join generate_series(1, greatest(3, (35 - r.rn::int) * 3)::int) g;

-- 4) 월간 이벤트 (최근 30일)
with ranked as (
  select id, duration,
    row_number() over (order by created_at desc) as rn
  from public.tracks
  limit 30
)
insert into public.stream_events
  (user_id, track_id, session_id, listened_seconds, completed, event_type, created_at)
select
  null,
  r.id,
  'dev-seed-' || gen_random_uuid()::text,
  coalesce(r.duration, 180),
  (g % 4 = 0),
  'milestone_30s',
  now() - (random() * interval '25 days') - interval '5 days'
from ranked r
cross join generate_series(1, greatest(5, (35 - r.rn::int) * 7)::int) g;

-- 5) complete 이벤트 일부
with ranked as (
  select id, duration,
    row_number() over (order by created_at desc) as rn
  from public.tracks
  limit 30
)
insert into public.stream_events
  (user_id, track_id, session_id, listened_seconds, completed, event_type, created_at)
select
  null,
  r.id,
  'dev-seed-' || gen_random_uuid()::text,
  coalesce(r.duration, 180),
  true,
  'complete',
  now() - (random() * interval '30 days')
from ranked r
cross join generate_series(1, greatest(1, (35 - r.rn::int)::int / 2)) g;

-- 6) 확인 — 상위 10곡
select rank, title, artist, play_count
from public.get_track_chart('daily', 10);
