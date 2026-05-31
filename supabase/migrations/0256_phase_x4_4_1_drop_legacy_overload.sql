-- 0256 — Phase X4.4.1 v2 Event Production Verification (hotfix)
--
-- 발견: X4.3 (14-param) + X4.3.1 (15-param with evidence_json) 두 overload 공존 →
--       PostgREST RPC 호출 시 "function is not unique" 에러로 frontend emit 모두 실패.
-- 조치: 구 14-param 버전 DROP. 15-param 버전이 모든 호출 처리 (evidence_json default null).

drop function if exists public.log_playback_event_v2(
  uuid, text, text, numeric, numeric, numeric, numeric, boolean, uuid, uuid, text, text, text, text
);

-- 정책: 15-param 버전 (0254) 은 그대로 유지. 변경 없음.
