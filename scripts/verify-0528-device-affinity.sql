-- 0528 device affinity 회귀 검증 — 빈 PostgreSQL 에서 손으로 돌린다.
--
-- 2026-09-15 숙대점을 그대로 재현한다:
--   SESSION A  매장 재생기(200시간 전 설치) · 30분째 무응답 · incident 가 지목
--   SESSION B  같은 계정, 다른 기기(1시간 전) · 지금 살아 있음
--
-- 실측 결과(PostgreSQL 16, 0522 스캐폴드 위):
--   0522 규칙: healthy_checks 2 → RESOLVED   ❌ FALSE RECOVERY
--   0528 규칙: healthy_checks 0 → DOWN 유지  ✅
--
-- 쓰는 법(운영 DB 에 절대 돌리지 않는다 — 빈 로컬 DB 전용):
--   psql -f <선행 스캐폴드> && psql -f 0522 && psql -f 0527 && psql -f 0528
--   psql -f scripts/verify-0528-device-affinity.sql
--
-- ※ supabase/migrations 밖에 두는 이유: 마이그레이션 러너와 중복 prefix 린터가
--    이 파일을 마이그레이션으로 오인하면 안 된다.

\set QUIET on
truncate public.brand_player_sessions, public.brand_player_incidents, public.admin_notifications;
insert into public.users values ('11111111-1111-1111-1111-111111111111','store','s');
insert into public.brand_accounts values ('22222222-2222-2222-2222-222222222222','테스트브랜드');
-- SESSION A = 감시 대상 매장 재생기. 200시간 전 설치, 30분째 무응답.
insert into public.brand_player_sessions (id, brand_id, user_id, created_at, last_seen_at, user_agent, last_audio_progress_at, current_track_started_at)
values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', now()-interval '200 hours', now()-interval '30 minutes',
        'Mozilla/5.0 (Linux; Android 10; K)', now()-interval '30 minutes', now()-interval '30 minutes');
-- SESSION B = 같은 계정, 다른 기기. 1시간 전 열림, 지금 살아 있음.
insert into public.brand_player_sessions (id, brand_id, user_id, created_at, last_seen_at, user_agent, last_audio_progress_at, current_track_started_at)
values ('bbbbbbbb-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', now()-interval '1 hour', now(),
        'Mozilla/5.0 (Windows NT 10.0; Win64)', now(), now());
-- SESSION A 를 지목한 열린 incident (2026-09-15 c3bdc4a1 과 같은 모양)
insert into public.brand_player_incidents (brand_id, brand_name, store_user_id, store_label, session_id,
       status, detection, opened_at, suspected_at, down_notified_at, notified_at, healthy_checks)
values ('22222222-2222-2222-2222-222222222222','테스트브랜드','11111111-1111-1111-1111-111111111111',
        '테스트매장','aaaaaaaa-0000-0000-0000-000000000001','offline','silence',
        now()-interval '25 minutes', now()-interval '25 minutes', now()-interval '23 minutes',
        now()-interval '23 minutes', 0);
\set QUIET off
select '--- canonical 이 누구인가 ---' as step;
select session_id, device, heartbeat_age_seconds from public._brand_player_liveness(1440);
select '--- 감지기 2회 실행 (healthy_checks 2 면 RESOLVE 조건) ---' as step;
select public.detect_brand_player_incidents() ->> 'resolved' as resolved_1;
select public.detect_brand_player_incidents() ->> 'resolved' as resolved_2;
select '--- incident 최종 상태 ---' as step;
select left(session_id::text,8) as target, status, healthy_checks,
       case when resolved_at is null then 'DOWN 유지 ✅' else 'RESOLVED ❌ FALSE RECOVERY' end as verdict
  from public.brand_player_incidents;
