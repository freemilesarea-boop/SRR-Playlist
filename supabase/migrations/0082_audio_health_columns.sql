-- 0082 — tracks.audio_health 컬럼 + 헬스체크 워커 RPC + 관리자 조회 RPC
--
-- 정책:
-- - audio_health_status: unknown / ok / unreachable / wrong_mime / empty / error
-- - HEAD 요청 결과 기록 (content_type, content_length)
-- - 즉시 삭제/숨김 X — admin 이 패널에서 결정 (UI 표시 + 수동 takedown)
-- - Edge Function 'check-audio-health' 가 service_role 로 호출 → 본 RPC 로 결과 기록

ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS audio_health_status text NOT NULL DEFAULT 'unknown'
    CHECK (audio_health_status IN ('unknown','ok','unreachable','wrong_mime','empty','error')),
  ADD COLUMN IF NOT EXISTS audio_health_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS audio_health_error text,
  ADD COLUMN IF NOT EXISTS audio_content_type text,
  ADD COLUMN IF NOT EXISTS audio_content_length bigint;

CREATE INDEX IF NOT EXISTS idx_tracks_audio_health
  ON public.tracks (audio_health_status, audio_health_checked_at DESC)
  WHERE audio_health_status <> 'unknown';

CREATE OR REPLACE FUNCTION public.update_track_audio_health(
  p_track_id uuid, p_status text,
  p_content_type text DEFAULT NULL,
  p_content_length bigint DEFAULT NULL,
  p_error text DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role'
     and not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'service_role or admin only';
  end if;
  if p_status not in ('unknown','ok','unreachable','wrong_mime','empty','error') then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.tracks set
    audio_health_status = p_status,
    audio_health_checked_at = now(),
    audio_health_error = nullif(btrim(coalesce(p_error,'')), ''),
    audio_content_type = nullif(btrim(coalesce(p_content_type,'')), ''),
    audio_content_length = p_content_length
  where id = p_track_id;
end; $function$;
GRANT EXECUTE ON FUNCTION public.update_track_audio_health(uuid, text, text, bigint, text) TO service_role, authenticated;

CREATE OR REPLACE FUNCTION public.admin_audio_health_summary()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select jsonb_build_object(
    'unknown', count(*) filter (where audio_health_status='unknown'),
    'ok',      count(*) filter (where audio_health_status='ok'),
    'unreachable', count(*) filter (where audio_health_status='unreachable'),
    'wrong_mime',  count(*) filter (where audio_health_status='wrong_mime'),
    'empty',       count(*) filter (where audio_health_status='empty'),
    'error',       count(*) filter (where audio_health_status='error'),
    'total_with_audio', count(*) filter (where audio_url is not null and length(btrim(audio_url))>0),
    'last_check_at', max(audio_health_checked_at)
  )
  from public.tracks where audio_url is not null and length(btrim(audio_url))>0
  into v;
  return v;
end; $function$;
GRANT EXECUTE ON FUNCTION public.admin_audio_health_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_audio_health_issues(p_limit int DEFAULT 100)
RETURNS TABLE (
  track_id uuid, track_code text, title text, artist text,
  release_status text, visibility_status text,
  audio_url text, audio_health_status text,
  audio_health_checked_at timestamptz, audio_health_error text,
  audio_content_type text, audio_content_length bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  select t.id, t.track_code, t.title, t.artist,
         t.release_status, t.visibility_status,
         t.audio_url, t.audio_health_status,
         t.audio_health_checked_at, t.audio_health_error,
         t.audio_content_type, t.audio_content_length
  from public.tracks t
  where t.audio_health_status in ('unreachable','wrong_mime','empty','error')
    and t.audio_url is not null and length(btrim(t.audio_url))>0
  order by t.audio_health_checked_at desc nulls last
  limit greatest(1, p_limit);
end; $function$;
GRANT EXECUTE ON FUNCTION public.admin_audio_health_issues(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.pick_tracks_for_health_check(p_limit int DEFAULT 50, p_recheck_after_hours int DEFAULT 24)
RETURNS TABLE (track_id uuid, audio_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role'
     and not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'service_role or admin only';
  end if;
  return query
  select t.id, t.audio_url
  from public.tracks t
  where t.audio_url is not null and length(btrim(t.audio_url))>0
    and (
      t.audio_health_checked_at is null
      or t.audio_health_checked_at < now() - (p_recheck_after_hours || ' hours')::interval
      or t.audio_health_status in ('unreachable','error')
    )
  order by
    case when t.audio_health_checked_at is null then 0 else 1 end,
    t.audio_health_checked_at asc nulls first
  limit greatest(1, p_limit);
end; $function$;
GRANT EXECUTE ON FUNCTION public.pick_tracks_for_health_check(int, int) TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
