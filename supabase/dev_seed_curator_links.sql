-- ============================================
-- dev_seed_curator_links.sql
--
-- 개발 환경 시드:
--   1) 관리자 계정에 큐레이터 프로필 생성 (없으면)
--   2) 기존 seed playlist 중 처음 N개를 그 큐레이터로 연결
--
-- 대상 계정 결정 우선순위:
--   A) 환경변수 :seed_admin_email (psql 호출 시 -v seed_admin_email=...)
--   B) auth.users 의 'freemilesarea@gmail.com'
--   C) public.users 중 role='admin' 첫 번째
--
-- 멱등 (반복 실행 안전): on conflict 사용, 이미 연결된 플리는 건드리지 않음.
-- ============================================

\set ON_ERROR_STOP on

do $$
declare
  v_user_id uuid;
  v_handle text := 'srr-music';
  v_display_name text := '스르륵 큐레이션';
  v_bio text := '스르륵 플리 공식 큐레이션. 시간대 · 매장 · 무드 별 음악을 큐레이팅합니다.';
  v_contact text := 'freemilesarea@gmail.com';
  v_linked_count int := 0;
begin
  -- 1) admin 계정 user_id 찾기
  begin
    select id into v_user_id from auth.users where lower(email) = 'freemilesarea@gmail.com' limit 1;
  exception when undefined_table or insufficient_privilege then
    v_user_id := null;
  end;

  if v_user_id is null then
    select id into v_user_id from public.users where role = 'admin' order by created_at asc limit 1;
  end if;

  if v_user_id is null then
    raise warning 'admin 사용자 없음 — seed 건너뜀. 먼저 freemilesarea@gmail.com 계정을 생성하고 role=admin 으로 설정하세요.';
    return;
  end if;

  raise notice '대상 admin user_id = %', v_user_id;

  -- 2) 큐레이터 프로필 upsert
  insert into public.curator_profiles (
    user_id, display_name, handle, bio, contact_email,
    allow_business_contact, is_verified, is_featured
  )
  values (
    v_user_id, v_display_name, v_handle, v_bio, v_contact,
    true, true, true
  )
  on conflict (user_id) do update set
    display_name = coalesce(public.curator_profiles.display_name, excluded.display_name),
    bio = coalesce(public.curator_profiles.bio, excluded.bio),
    contact_email = coalesce(public.curator_profiles.contact_email, excluded.contact_email),
    is_verified = true,
    is_featured = true,
    updated_at = now();

  raise notice '큐레이터 프로필 보장 (handle=%)', v_handle;

  -- 3) 아직 큐레이터가 연결 안 된 플레이리스트 중 처음 6개를 본인으로 연결
  with target as (
    select id
    from public.playlists
    where created_by_user_id is null
    order by sort_order asc, created_at asc
    limit 6
  )
  update public.playlists p
  set created_by_user_id = v_user_id
  from target
  where p.id = target.id;

  get diagnostics v_linked_count = row_count;
  raise notice '플리 % 개를 큐레이터(% / @%) 에 연결', v_linked_count, v_display_name, v_handle;
end;
$$;

-- 결과 확인 (워크플로우 로그에 노출)
select
  cp.handle,
  cp.display_name,
  cp.is_verified,
  cp.is_featured,
  (select count(*) from public.playlists p where p.created_by_user_id = cp.user_id) as linked_playlists
from public.curator_profiles cp
order by cp.is_featured desc, cp.created_at desc
limit 10;
