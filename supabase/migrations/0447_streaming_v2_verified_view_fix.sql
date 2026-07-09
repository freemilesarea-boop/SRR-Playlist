-- 0447 — Phase ALGO-8C: Streaming v2 Verified View Fix (view-side, opt A)
--
-- 목적:
--   ALGO-8B Runtime Apply Specification 의 권고(view-side opt A)를 구현한다.
--   v2_verified_streams 를 stream_sessions_v2 LEFT JOIN 기반으로 재작성하여, play_30s milestone row 에
--   고정된 heartbeat_verified=false / verified_seconds<30 문제(검증 타이밍 freeze)를 세션 확정값 기준으로 보정한다.
--
-- 근본원인(ALGO-2E/2D):
--   record_stream_event_v2 가 play_30s insert 시점에 세션의 verified_seconds 를 스냅샷 복사하고
--   heartbeat_verified=(verified_seconds>=30) 로 동결한다. 세션 verified_seconds 는 heartbeat 로 wall-clock
--   누적(10s 간격, 15s cap)되므로 play_30s fire 시점(≈30s)에는 아직 <30 → milestone 이 false 로 동결되고
--   이후 session 이 120~130s 확정돼도 back-fill 되지 않아 v2_verified_streams=0.
--
-- 접근(opt A · view-side only):
--   • CREATE OR REPLACE VIEW 만 사용. 원본 이벤트/세션 row 는 절대 수정하지 않는다(append-only·감사 안전).
--   • 판정 시점을 조회 시점으로 이동하여 session 의 확정 verified_seconds 를 authoritative 로 사용.
--   • 기존 34개 컬럼명/순서/타입 100% 유지(소비처 v2_eligible_streams/settlement/reconciliation 무손상) 후
--     effective 컬럼 3개를 뒤에 append (CREATE OR REPLACE VIEW 규칙: 기존 컬럼 동일 + 말미 추가만 허용).
--
-- 절대 원칙:
--   • Playback/Queue/Scheduler/Settlement v1/Chart/Fraud 정책/Prediction/RL/Decision/Governance 무변경.
--   • Production Apply/실제 Runtime Apply/Canary 금지. 기존 stream_ingest_v2/stream_sessions_v2 원본 row 수정 금지.
--   • Additive Migration Only · CREATE OR REPLACE VIEW 만 · Backfill UPDATE/DELETE/Trigger 변경 금지.
--
-- Identity mismatch(session=USER ↔ milestone=ARTIST_PREVIEW)는 본 Phase 에서 수정하지 않는다(별도 Phase).
--   → verified 는 회복되지만 eligible 은 ARTIST_PREVIEW 제외 규칙으로 일부만 회복될 수 있음(정직한 한계).

-- ─────────────────────────────────────────────────────────────────────
-- v2_verified_streams — session-authoritative 재정의 (opt A)
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_verified_streams as
select
  -- ▼ 기존 34개 컬럼(0412 정의) — 이름/순서/타입 그대로 유지 (전부 stream_ingest_v2 원본값, 무변형)
  i.id,
  i.event_type,
  i.track_id,
  i.user_id,
  i.anonymous_id,
  i.player_type,
  i.brand_id,
  i.store_id,
  i.enterprise_account_id,
  i.playlist_id,
  i.device_id,
  i.device_class,
  i.session_token,
  i.client_reported_seconds,
  i.verified_seconds,
  i.heartbeat_verified,
  i.player_volume,
  i.player_muted,
  i.visibility_state,
  i.background_state,
  i.network_state,
  i.battery_saver,
  i.eligible_reason,
  i.ineligible_reason,
  i.fraud_score,
  i.stream_quality,
  i.dispute_status,
  i.created_by_runtime,
  i.source_page,
  i.user_agent,
  i.client_ip,
  i.ingest_source,
  i.raw_payload,
  i.created_at,
  -- ▼ 신규 append 컬럼 (session 보정 근거 노출)
  greatest(coalesce(i.verified_seconds, 0), coalesce(s.verified_seconds, 0)) as verified_seconds_effective,
  (coalesce(i.heartbeat_verified, false)
    or coalesce(s.heartbeat_count, 0) > 0
    or coalesce(s.verified_seconds, 0) >= 30) as heartbeat_verified_effective,
  case
    when coalesce(i.heartbeat_verified, false) and coalesce(i.verified_seconds, 0) >= 30 then 'ingest'
    when coalesce(s.verified_seconds, 0) >= 30 and coalesce(i.verified_seconds, 0) < 30 then 'session'
    else 'mixed'
  end as verification_source
from public.stream_ingest_v2 i
left join public.stream_sessions_v2 s on s.session_token = i.session_token
where i.event_type = 'play_30s'
  and coalesce(i.visibility_state, 'visible') = 'visible'
  -- session-authoritative verified 판정 (milestone freeze 보정)
  and greatest(coalesce(i.verified_seconds, 0), coalesce(s.verified_seconds, 0)) >= 30
  and (coalesce(i.heartbeat_verified, false)
       or coalesce(s.heartbeat_count, 0) > 0
       or coalesce(s.verified_seconds, 0) >= 30);

comment on view public.v2_verified_streams is
  'ALGO-8C — session-authoritative verified (opt A). play_30s milestone verified_seconds/heartbeat freeze 를 '
  'stream_sessions_v2 LEFT JOIN 으로 조회 시점 보정. 원본 row 무수정. v2_eligible_streams/settlement 는 파생으로 자동 반영. '
  'identity mismatch(session=USER↔milestone=preview)는 미보정 — eligible 제한적 회복.';
