-- 0531_admin_member_list_timeout_indexes.sql
--
-- 관리자 "회원관리" 화면이 아예 뜨지 않던 문제.
--   canceling statement due to statement timeout (code 57014)
--
-- admin_member_list 는 회원 1명마다 다음 둘을 부른다:
--   (a) cross join lateral member_playback_totals(u.id)
--   (b) (select max(ve.created_at) from visitor_events ve where ve.user_id = u.id)
--
-- (a) member_playback_totals 는 stream_sessions_v2 를 user_id 로 3번 조회하는데
--     이 테이블에는 user_id 인덱스가 없었다 — pkey 는 session_token 이고 나머지는
--     (device_id, created_at) 뿐이었다. 그래서 호출 1회가 74,938행 Seq Scan 이 됐다
--     (실측 13.5ms, Rows Removed by Filter: 74,917). 회원 252명 × 3회 ≈ 10초 →
--     8초 statement timeout 초과.
--     stream_events 쪽은 idx_stream_events_user 가 이미 있어 문제가 아니었다.
--
-- (b) 는 idx_visitor_events_created_at 를 역순으로 타면서 해당 회원이 아닌 행을
--     호출당 12,784행씩 걸러냈다 (5.2ms × 100행 ≈ 519ms).
--     (user_id, created_at desc) 면 그 회원의 최신 1행을 바로 집는다.
--
-- 적용 후 실측: 전체 쿼리 timeout(>8,000ms) → 210ms.
--   · member_playback_totals  : 0.83ms/호출
--   · visitor_events 최신 접속 : Index Only Scan 0.007ms/호출
--
-- 함수 본문은 건드리지 않는다. 느렸던 이유가 인덱스 부재였기 때문에,
-- 쿼리를 다시 쓰는 것보다 인덱스를 더하는 쪽이 작고 되돌리기 쉽다.

create index if not exists idx_stream_sessions_v2_user
  on public.stream_sessions_v2 (user_id);

create index if not exists idx_visitor_events_user_created
  on public.visitor_events (user_id, created_at desc);
