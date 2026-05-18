-- 0085 — P0 fix: process_due_scheduled_releases ambiguous column reference
--
-- 증상:
-- ERROR: 42702: column reference "track_code" is ambiguous
-- DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- 원인:
-- 0076 에서 정의된 RETURNS TABLE(track_id uuid, track_code text, ...) 의 OUT 컬럼명이
-- PL/pgSQL 내부에서 변수로 노출되어, FOR r IN SELECT id, track_code FROM tracks ... 절에서
-- "track_code" 가 변수인지 테이블 컬럼인지 모호. 호출 즉시 42702 raise.
--
-- 영향:
-- - 예약 발매 워커 (process-scheduled-releases Edge Function) 완전 동작 불능
-- - admin UI '예약 발매 처리' 버튼 클릭 시 500 에러
-- - scheduled → released 자동 전환 자체가 일어나지 않음
--
-- 조치:
-- - FOR 루프 SELECT 에 alias (t.id AS tid, t.track_code AS tcode 등) 사용
-- - 결과 컬럼 할당 시 변수에서 가져옴 (track_id := r.tid 등)
-- - 0084 의 anon REVOKE 도 함께 적용 (REVOKE FROM PUBLIC, anon)

CREATE OR REPLACE FUNCTION public.process_due_scheduled_releases()
RETURNS TABLE(track_id uuid, track_code text, status text, error text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare r record;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role'
     and not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'service_role or admin only';
  end if;

  for r in
    select t.id AS tid, t.track_code AS tcode, t.release_date AS rdate
    from public.tracks t
    where t.release_status = 'scheduled'
      and t.release_date is not null
      and t.release_date <= current_date
      and t.source_type = 'artist_upload'
    order by t.release_date asc
    limit 200
  loop
    begin
      update public.tracks set release_status='released', released_at=now() where id = r.tid;
      track_id := r.tid;
      track_code := r.tcode;
      status := 'released';
      error := null;
      return next;
    exception when others then
      insert into public.release_failures (track_id, kind, error_code, error_message, context)
      values (r.tid, 'auto_release', SQLSTATE, SQLERRM,
              jsonb_build_object('release_date', r.rdate));
      track_id := r.tid;
      track_code := r.tcode;
      status := 'failed';
      error := SQLERRM;
      return next;
    end;
  end loop;
end;
$function$;

GRANT EXECUTE ON FUNCTION public.process_due_scheduled_releases() TO service_role, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_due_scheduled_releases() FROM PUBLIC, anon;

NOTIFY pgrst, 'reload schema';
