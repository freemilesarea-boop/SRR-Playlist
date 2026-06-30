-- 0394 — enterprise-contracts 버킷 보안 (Phase 1-4)
--
-- 배경 (운영 감사 N — WARN):
--   0383 에서 enterprise-contracts 버킷이 public=true + storage SELECT 정책이
--   anon, authenticated 전체 허용(`enterprise_contracts_public_read`).
--   → 계약 PDF/DOCX 가 경로만 알면 누구나(심지어 비로그인) 직접 URL 로 열람 가능
--     (path-disclosure 시 기밀 계약 노출). file_url 로 public URL 을 저장/직링크.
--
-- 수정:
--   1) 버킷 public=false (private) 로 전환.
--   2) public_read 정책 제거 → super_admin 만 SELECT (createSignedUrl 발급용).
--   3) admin write 정책은 유지.
--   클라이언트는 file_path 로 createSignedUrl(만료형) 을 발급해 다운로드(별도 커밋).
--
-- 영향:
--   - 기존에 저장된 public file_url 직링크는 더 이상 200 이 아님 → UI 는 signed URL 로 전환.
--     (계약 파일 다운로드는 super_admin 관리자 화면에서만 사용. HQ 계약 카드는 파일 미노출 확인.)
--   - announcement 버킷(enterprise-announcements, 의도적 public 방송)은 무수정.
--   - 계약 메타데이터(enterprise_contract_files: file_path/file_url) 스키마 무수정.
--
-- 절대 무수정:
--   - enterprise-announcements 버킷/정책, 계약 RPC 본문/시그니처, 계약 테이블 스키마.

-- ============================================================
-- 1) 버킷 private 전환
-- ============================================================
update storage.buckets
   set public = false
 where id = 'enterprise-contracts';

-- ============================================================
-- 2) storage 정책 — public_read 제거 + super_admin read 로 교체
-- ============================================================
do $$
begin
  -- 위험: anon/all-authenticated read 제거
  if exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_contracts_public_read'
  ) then
    drop policy enterprise_contracts_public_read on storage.objects;
  end if;

  -- super_admin 만 SELECT (관리자가 createSignedUrl 발급 가능; signed URL 은 TTL 동안만 유효)
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_contracts_admin_read'
  ) then
    create policy enterprise_contracts_admin_read on storage.objects
      for select to authenticated
      using (bucket_id = 'enterprise-contracts' and public._is_super_admin());
  end if;

  -- write 정책(super_admin)은 0383 그대로 유지 (재생성 안 함)
end$$;

-- ============================================================
-- 3) Diagnostics
-- ============================================================
do $$
declare v_public boolean; v_pubread int; v_adminread int;
begin
  select public into v_public from storage.buckets where id='enterprise-contracts';
  select count(*) into v_pubread from pg_policies
   where schemaname='storage' and tablename='objects' and policyname='enterprise_contracts_public_read';
  select count(*) into v_adminread from pg_policies
   where schemaname='storage' and tablename='objects' and policyname='enterprise_contracts_admin_read';
  raise notice '====== 0394 enterprise-contracts bucket security ======';
  raise notice 'public=% (want false) ; public_read_policy=% (want 0) ; admin_read_policy=% (want 1)',
    v_public, v_pubread, v_adminread;
  if v_public is false and v_pubread = 0 and v_adminread = 1 then
    raise notice '0394 COMPLETE — bucket private, anon read 제거, super_admin read only';
  else
    raise warning '0394 CHECK — public=% pubread=% adminread=%', v_public, v_pubread, v_adminread;
  end if;
end$$;
