-- 0285 — share_events.method 에 'kakao_share' 추가 (X6.2 Kakao 공유)
--
-- 기존 check constraint: web_share|clipboard|qr_download|qr_view
-- 추가: kakao_share (카카오톡 공유 SDK 사용 시 적재)

alter table public.share_events drop constraint if exists share_events_method_check;
alter table public.share_events add constraint share_events_method_check
  check (method = any (array['web_share','clipboard','qr_download','qr_view','kakao_share']));
