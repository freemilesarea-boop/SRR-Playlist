-- 0448 — Phase ALGO-8D: Streaming v2 Session Identity Normalization View Fix (view-side)
--
-- 목적:
--   ALGO-8C(0447)로 verified 는 0→8 회복됐으나, v2_eligible_streams 에서 player_type 이 milestone row 에
--   ARTIST_PREVIEW 로 고정되어 eligible/settlement 가 1건만 회복되는 잔여 병목을 해결한다.
--   v2_eligible_streams 를 stream_sessions_v2 LEFT JOIN 으로 재작성하여 identity 판정을 session 확정 기준으로 정규화.
--
-- 근본원인(ALGO-2E/2D, 실데이터 확인):
--   record_stream_event_v2(0412:284-298)가 play_30s insert 시 _v2_resolve_player_type 로 재분류하여
--   session=USER 인 milestone 을 ARTIST_PREVIEW 로 라벨링하고, 동시에 ineligible_reason=lower(player_type)=
--   'artist_preview' 를 함께 동결한다. 즉 하나의 mislabel 이 (a) player_type 과 (b) ineligible_reason 두 필드를
--   동시에 오염시킨다. 두 필드 모두 session identity 에서 재도출되어야 정상 eligible 로 회복된다.
--   확인: verified 8건 중 7건이 milestone=ARTIST_PREVIEW·ineligible_reason='artist_preview' 이지만 session=USER.
--
-- 접근(view-side only):
--   • CREATE OR REPLACE VIEW v2_eligible_streams 만 사용. 원본 이벤트/세션 row 무수정(append-only·감사 안전).
--   • normalized_player_type = session(authoritative) → ingest → 'ANONYMOUS' fallback.
--   • identity-derived ineligible_reason(artist_preview/admin_preview/preview/system)은 session 이 authoritative
--     non-preview(USER 등)일 때만 무력화(is_ineligible_effective=false). 실제 사유(unreleased/muted_play/
--     low_player_volume)는 그대로 유지 → fraud/eligibility 정책 불변, mislabel 아티팩트만 정규화.
--   • 기존 34개 컬럼명/순서/타입 유지 후 정규화 컬럼 append (settlement 파생 view 자동 반영).
--
-- 절대 원칙:
--   • Playback/Queue/Scheduler/Settlement v1/Chart/Fraud 정책/Prediction/RL/Decision/Governance 무변경.
--   • Production Apply/실제 Runtime Apply/Canary 금지. stream_ingest_v2/stream_sessions_v2 원본 row 수정 금지.
--   • Additive Migration Only · CREATE OR REPLACE VIEW 만 · Backfill UPDATE/DELETE/Trigger/Runtime 함수 변경 금지.
--   • 0447(verified view fix) 적용을 전제로 한다. Apply 순서: 0447 → 0448.
--
-- 참고: player_type 컬럼(기존)은 원본 milestone 값을 그대로 노출(호환 유지). 정규화 값은 normalized_player_type 신규 컬럼.

create or replace view public.v2_eligible_streams as
select
  -- ▼ 기존 34개 컬럼(0412 정의) — 이름/순서/타입 그대로 유지 (전부 v2_verified_streams 통과값)
  v.id,
  v.event_type,
  v.track_id,
  v.user_id,
  v.anonymous_id,
  v.player_type,
  v.brand_id,
  v.store_id,
  v.enterprise_account_id,
  v.playlist_id,
  v.device_id,
  v.device_class,
  v.session_token,
  v.client_reported_seconds,
  v.verified_seconds,
  v.heartbeat_verified,
  v.player_volume,
  v.player_muted,
  v.visibility_state,
  v.background_state,
  v.network_state,
  v.battery_saver,
  v.eligible_reason,
  v.ineligible_reason,
  v.fraud_score,
  v.stream_quality,
  v.dispute_status,
  v.created_by_runtime,
  v.source_page,
  v.user_agent,
  v.client_ip,
  v.ingest_source,
  v.raw_payload,
  v.created_at,
  -- ▼ 신규 append 컬럼 (identity 정규화 근거 노출)
  upper(coalesce(nullif(s.player_type, ''), nullif(v.player_type, ''), 'ANONYMOUS')) as normalized_player_type,
  case
    when nullif(s.player_type, '') is not null then 'session'
    when nullif(v.player_type, '') is not null then 'ingest'
    else 'fallback'
  end as identity_source,
  v.player_type as original_player_type,
  s.player_type as session_player_type,
  (s.player_type is not null and s.player_type is distinct from v.player_type) as identity_mismatch,
  -- identity-derived ineligible 을 session authoritative 기준으로 재평가한 유효 ineligible 여부
  (case
     when v.ineligible_reason is null then false
     when lower(v.ineligible_reason) in ('artist_preview','admin_preview','preview','system')
          and nullif(s.player_type, '') is not null
          and upper(s.player_type) not in ('ARTIST_PREVIEW','ADMIN_PREVIEW','PREVIEW','SYSTEM')
       then false                       -- mislabel 아티팩트 → session=USER 이므로 무력화
     else true                          -- 실제 사유(unreleased/muted/low_volume 등) 유지
   end) as is_ineligible_effective
from public.v2_verified_streams v
left join public.stream_sessions_v2 s on s.session_token = v.session_token
where
  -- identity 정규화된 player_type 기준 preview 제외 (SYSTEM 은 0412 semantics 보존)
  upper(coalesce(nullif(s.player_type, ''), nullif(v.player_type, ''), 'ANONYMOUS'))
    not in ('ARTIST_PREVIEW','PREVIEW','ADMIN_PREVIEW','SYSTEM')
  and coalesce(v.player_volume, 1) >= 0.1
  and coalesce(v.player_muted, false) = false
  -- session-normalized ineligible (mislabel 아티팩트만 무력화, 실제 사유 유지)
  and (case
         when v.ineligible_reason is null then false
         when lower(v.ineligible_reason) in ('artist_preview','admin_preview','preview','system')
              and nullif(s.player_type, '') is not null
              and upper(s.player_type) not in ('ARTIST_PREVIEW','ADMIN_PREVIEW','PREVIEW','SYSTEM')
           then false
         else true
       end) = false
  and coalesce(v.fraud_score, 0) < 60
  and coalesce(v.dispute_status, 'none') = 'none';

comment on view public.v2_eligible_streams is
  'ALGO-8D — session-authoritative eligible (identity normalization). milestone 에 고정된 player_type/'
  'ineligible_reason mislabel 을 stream_sessions_v2 LEFT JOIN 으로 정규화. 원본 row 무수정. 0447(verified view fix) 전제. '
  'identity-derived ineligible(artist_preview 등)만 무력화하고 실제 사유(unreleased/muted/low_volume)는 유지. '
  'v2_settlement_eligible_streams 는 파생으로 자동 반영.';
