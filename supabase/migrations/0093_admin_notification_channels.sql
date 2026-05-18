-- 0093 — 운영 알림 외부 채널 (Slack webhook / 이메일) 설정 키
--
-- 정책:
-- - 키 4종 seed (모두 운영자가 후속 입력)
-- - Edge Function dispatch-admin-notifications 가 호출 시점에 admin_settings 읽음
-- - 미설정 시 graceful skip (UI 종 + DB row 만 적립)
-- - Slack webhook URL 은 admin 만 RLS 로 읽기 (anon/authenticated read_safe 에 추가 X)

INSERT INTO public.admin_settings (key, value, description) VALUES
  ('notification_slack_webhook_url', '""'::jsonb,
   'Slack incoming webhook URL. 빈 문자열이면 비활성. 운영자만 admin RPC 로 변경'),
  ('notification_email_enabled', 'false'::jsonb,
   '이메일 알림 활성 여부. true 시 notification_email_to 로 전송'),
  ('notification_email_to', '""'::jsonb,
   '알림 수신 이메일 (쉼표 구분 다중 가능). 빈 문자열이면 비활성'),
  ('notification_min_severity', '"warning"'::jsonb,
   '외부 채널 전송 최소 severity (info / warning / error). 기본 warning')
ON CONFLICT (key) DO NOTHING;

-- 기존 authed_read_safe 정책 (default_immediate_release, stream_daily_user_track_cap) 은
-- 그대로 — 알림 채널 키 4종은 admin RLS 로만 읽기 가능 (Slack URL 노출 방지).

NOTIFY pgrst, 'reload schema';
