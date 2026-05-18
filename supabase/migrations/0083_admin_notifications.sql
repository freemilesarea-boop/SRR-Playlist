-- 0083 — admin_notifications 테이블 + RPC (운영 알림 시스템)
--
-- 정책:
-- - severity: info / warning / error
-- - kind: 'audio_health_issue' / 'scheduled_release_failed' / 'worker_summary' / 기타
-- - context jsonb 에 상세 메타 (status, http_status, summary, error 등)
-- - admin 만 SELECT/UPDATE(read_at), service_role 만 INSERT
-- - 알림 발송 실패가 워커 실행에 영향 주지 않게 호출측 try/catch

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','error')),
  title text NOT NULL,
  body text,
  context jsonb,
  track_id uuid REFERENCES public.tracks(id) ON DELETE SET NULL,
  read_at timestamptz,
  read_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_notif_unread
  ON public.admin_notifications (created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_admin_notif_created
  ON public.admin_notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_notif_kind
  ON public.admin_notifications (kind, created_at DESC);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_notif_admin_read ON public.admin_notifications;
CREATE POLICY admin_notif_admin_read ON public.admin_notifications
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));
DROP POLICY IF EXISTS admin_notif_block_mutate ON public.admin_notifications;
CREATE POLICY admin_notif_block_mutate ON public.admin_notifications
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
REVOKE INSERT, UPDATE, DELETE ON public.admin_notifications FROM public, authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.admin_notifications TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.admin_notifications_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.create_admin_notification(
  p_kind text, p_severity text, p_title text,
  p_body text DEFAULT NULL, p_context jsonb DEFAULT NULL,
  p_track_id uuid DEFAULT NULL
)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_id bigint;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role'
     and not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'service_role or admin only';
  end if;
  if p_severity not in ('info','warning','error') then
    raise exception 'invalid severity: %', p_severity;
  end if;
  insert into public.admin_notifications (kind, severity, title, body, context, track_id)
  values (p_kind, p_severity, p_title, nullif(btrim(coalesce(p_body,'')),''), p_context, p_track_id)
  returning id into v_id;
  return v_id;
end; $function$;
GRANT EXECUTE ON FUNCTION public.create_admin_notification(text, text, text, text, jsonb, uuid) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_notifications(
  p_only_unread boolean DEFAULT false, p_limit int DEFAULT 50
)
RETURNS TABLE (
  id bigint, kind text, severity text, title text, body text,
  context jsonb, track_id uuid, track_code text, track_title text,
  read_at timestamptz, read_by uuid, created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  select n.id, n.kind, n.severity, n.title, n.body, n.context, n.track_id,
         t.track_code, t.title,
         n.read_at, n.read_by, n.created_at
  from public.admin_notifications n
  left join public.tracks t on t.id = n.track_id
  where (not p_only_unread or n.read_at is null)
  order by n.created_at desc
  limit greatest(1, p_limit);
end; $function$;
GRANT EXECUTE ON FUNCTION public.admin_list_notifications(boolean, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_notification_unread_count()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select count(*)::int into v from public.admin_notifications where read_at is null;
  return v;
end; $function$;
GRANT EXECUTE ON FUNCTION public.admin_notification_unread_count() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_notification_read(p_id bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.admin_notifications set read_at = now(), read_by = v_uid
  where id = p_id and read_at is null;
end; $function$;
GRANT EXECUTE ON FUNCTION public.admin_mark_notification_read(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_mark_all_notifications_read()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.admin_notifications set read_at = now(), read_by = v_uid where read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end; $function$;
GRANT EXECUTE ON FUNCTION public.admin_mark_all_notifications_read() TO authenticated;

NOTIFY pgrst, 'reload schema';
