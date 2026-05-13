-- ============================================
-- 0010_storage_buckets_public.sql
--
-- audio / covers 버킷이 PUBLIC 인지 보장. 멱등.
-- (대시보드에서 누락된 경우, 또는 실수로 private 으로 바뀐 경우 자동 복구)
--
-- 권한:
--   storage.buckets 은 supabase_storage_admin 가 소유.
--   postgres role 은 보통 modify 가능 (Supabase pooler 의 service_role 또는
--   직접 connection 으로 실행 시).
--   권한 부족 시 raise warning 으로 안내만 하고 계속 진행.
-- ============================================

do $$
begin
  insert into storage.buckets (id, name, public)
  values
    ('audio', 'audio', true),
    ('covers', 'covers', true)
  on conflict (id) do update set public = excluded.public;
  raise notice 'storage.buckets: audio/covers public=true 확인 완료';
exception
  when insufficient_privilege then
    raise warning
      'storage.buckets 수정 권한 없음 — Supabase 대시보드 → Storage 에서 '
      'audio, covers 버킷을 직접 Public 으로 설정해주세요.';
  when undefined_table then
    raise warning 'storage.buckets 테이블 없음 — Supabase storage 가 설정되지 않은 환경';
end;
$$;

-- 현재 상태 확인 (워크플로우 로그에 노출됨)
select id, public, created_at from storage.buckets where id in ('audio', 'covers');
