-- ============================================================================
-- 0404 ROLLBACK — Playback Guardrail Enforcement
-- ============================================================================
-- 신규 오버로드 get_playlist_tracks(uuid, uuid) 만 제거.
-- 기존 get_playlist_tracks(uuid) 는 절대 건드리지 않음 (시그니처 명시 drop).
-- 데이터/테이블 변경 0.
-- ============================================================================

begin;

-- 안전장치: 기존 단일-인자 함수가 존재하는지 확인(존재해야 정상). 미존재 시 경고만.
do $guard$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='get_playlist_tracks'
      and pg_get_function_identity_arguments(p.oid)='p_playlist_id uuid'
  ) then
    raise warning 'get_playlist_tracks(uuid) [기존] 이 존재하지 않음 — rollback 은 신규 오버로드만 제거하며 기존 함수에는 관여하지 않음.';
  end if;
end
$guard$;

-- 신규 두-인자 오버로드만 제거 (존재하지 않아도 무해)
drop function if exists public.get_playlist_tracks(uuid, uuid);

commit;

-- rollback 확인: existing=true, new=false 기대
select
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='get_playlist_tracks'
           and pg_get_function_identity_arguments(p.oid)='p_playlist_id uuid')                 as existing_uuid_kept,
  exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='get_playlist_tracks'
           and pg_get_function_identity_arguments(p.oid)='p_playlist_id uuid, p_store_id uuid') as new_overload_present;
