-- 0091 — 큐레이팅/자동 다음곡 P1 안정화
--
-- 1) recommend_similar_tracks: audio_health_status IN ('ok','unknown', NULL) 만 추천
-- 2) recommend_tracks_by_context: 동일 가드 추가
--
-- 정책:
-- - 추천 결과로 자동 큐에 들어가는 트랙은 깨진 음원 제외
-- - released / public / audio_url not null 기존 가드는 유지
-- - NULL 은 unknown 취급 (검사 전 트랙도 일단 허용)
-- - 'unreachable' / 'wrong_mime' / 'empty' / 'error' 만 차단
--
-- (DDL 전체는 mcp__apply_migration 0091_recommend_audio_health_filter 에 적용됨.)

-- 핵심 변경: 두 RPC 본문 WHERE 절에 한 줄 추가
--   and coalesce(t.audio_health_status, 'unknown') in ('ok','unknown')

-- 함수 본문 보존을 위해 idempotent CREATE OR REPLACE 사용 — 동일 본문 재실행 가능.

NOTIFY pgrst, 'reload schema';
