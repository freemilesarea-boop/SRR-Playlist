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
-- ============================================

begin;

-- 안전장치: 이미 생성된 dev 이벤트가 있으면 먼저 제거 (선택적)
delete from public.stream_events
where session_id like 'dev-seed-%';

do $$
declare
  t record;
  rank int;
  base_plays int;
  daily_plays int;
  weekly_plays int;
  monthly_plays int;
  i int;
begin
  rank := 0;
  for t in
    select id, duration from public.tracks order by created_at desc limit 30
  loop
    rank := rank + 1;
    -- 상위 트랙일수록 더 많은 재생
    base_plays   := greatest(1, 35 - rank);
    daily_plays  := base_plays;
    weekly_plays := base_plays * 3;
    monthly_plays:= base_plays * 7;

    -- 오늘 재생 (milestone_30s)
    for i in 1..daily_plays loop
      insert into public.stream_events(
        user_id, track_id, playlist_id, session_id,
        listened_seconds, completed, event_type, created_at
      ) values (
        null, t.id, null, 'dev-seed-' || gen_random_uuid()::text,
        coalesce(t.duration, 180), false, 'milestone_30s',
        now() - (random() * interval '20 hours')
      );
    end loop;

    -- 최근 7일 추가
    for i in 1..weekly_plays loop
      insert into public.stream_events(
        user_id, track_id, playlist_id, session_id,
        listened_seconds, completed, event_type, created_at
      ) values (
        null, t.id, null, 'dev-seed-' || gen_random_uuid()::text,
        coalesce(t.duration, 180), (i % 3 = 0), 'milestone_30s',
        now() - (random() * interval '6 days' + interval '1 day')
      );
    end loop;

    -- 최근 30일 추가
    for i in 1..monthly_plays loop
      insert into public.stream_events(
        user_id, track_id, playlist_id, session_id,
        listened_seconds, completed, event_type, created_at
      ) values (
        null, t.id, null, 'dev-seed-' || gen_random_uuid()::text,
        coalesce(t.duration, 180), (i % 4 = 0), 'milestone_30s',
        now() - (random() * interval '25 days' + interval '6 days')
      );
    end loop;

    -- complete 이벤트도 일부
    for i in 1..(monthly_plays / 4) loop
      insert into public.stream_events(
        user_id, track_id, playlist_id, session_id,
        listened_seconds, completed, event_type, created_at
      ) values (
        null, t.id, null, 'dev-seed-' || gen_random_uuid()::text,
        coalesce(t.duration, 180), true, 'complete',
        now() - (random() * interval '30 days')
      );
    end loop;
  end loop;
end $$;

commit;

-- 확인용 — 상위 10곡
select rank, title, artist, play_count from public.get_track_chart('daily', 10);
