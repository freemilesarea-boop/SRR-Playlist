-- 0367c — Enterprise Phase 1-8 (split C): Storage bucket + objects policy
--
-- 의존: 0367a (enterprise_settlement_profiles), 0367b (RPC).
-- 적용 전 0367a + 0367b sanity 확인 필수.
--
-- 가장 위험한 부분 — Dashboard 의 postgres role 이 storage 권한 부족 / 컬럼 차이로
-- 실패할 수 있음. 실패해도 0367a/b 의 객체는 이미 적용된 상태.
--
-- 만약 이 파일이 실패하면 다음 fallback 순서로 시도:
--   1. allowed_mime_types / file_size_limit 컬럼 부재 가능성 → minimal INSERT 만 시도
--   2. storage.objects 정책 생성 실패 → Dashboard UI 의 "Buckets > Policies"
--      에서 수동 등록
--
-- 절대 원칙: bucket 만 생성, 기존 storage 구조 변경 0.

-- ============================================================
-- 1) Storage bucket — enterprise-documents (private)
--    file_size_limit 20MB / pdf/jpg/png/webp 만
-- ============================================================
do $$
begin
  -- 1단계: full INSERT (file_size_limit + allowed_mime_types 포함)
  begin
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('enterprise-documents', 'enterprise-documents', false, 20971520,
            array['application/pdf','image/jpeg','image/png','image/webp'])
    on conflict (id) do update set
      public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
    raise notice 'Bucket FULL insert: OK';
  exception when others then
    raise notice 'Bucket FULL insert 실패 (% %), minimal 재시도', sqlstate, sqlerrm;
    -- 2단계 fallback: minimal INSERT (id/name/public 만)
    begin
      insert into storage.buckets (id, name, public)
      values ('enterprise-documents', 'enterprise-documents', false)
      on conflict (id) do update set public = excluded.public;
      raise notice 'Bucket MINIMAL insert: OK';
    exception when others then
      raise warning 'Bucket MINIMAL insert 실패: % %', sqlstate, sqlerrm;
      raise warning '→ Dashboard UI 의 Storage > Buckets 에서 수동 생성 필요';
    end;
  end;
end$$;


-- ============================================================
-- 2) Storage RLS policy — HQ own folder / super_admin all
-- ============================================================
do $$
begin
  begin
    drop policy if exists "ed_hq_manage" on storage.objects;
    create policy "ed_hq_manage" on storage.objects
      for all
      using (
        bucket_id = 'enterprise-documents'
        and (
          public._is_super_admin()
          or exists (
            select 1 from public.enterprise_accounts ea
             where ea.id::text = (storage.foldername(name))[1]
               and ea.auth_user_id is not null
               and ea.auth_user_id = auth.uid()
               and ea.deleted_at is null
          )
        )
      )
      with check (
        bucket_id = 'enterprise-documents'
        and (
          public._is_super_admin()
          or exists (
            select 1 from public.enterprise_accounts ea
             where ea.id::text = (storage.foldername(name))[1]
               and ea.auth_user_id is not null
               and ea.auth_user_id = auth.uid()
               and ea.deleted_at is null
          )
        )
      );
    raise notice 'Storage policy ed_hq_manage: OK';
  exception when others then
    raise warning 'Storage policy 실패: % %', sqlstate, sqlerrm;
    raise warning '→ Dashboard UI 의 Storage > Policies 에서 수동 등록 필요';
  end;
end$$;


-- ============================================================
-- 3) Diagnostics
-- ============================================================
do $$
declare
  v_bucket int;
  v_policy int;
  v_bucket_public boolean;
  v_bucket_size bigint;
  v_bucket_mime text[];
begin
  select count(*) into v_bucket from storage.buckets where id = 'enterprise-documents';

  select public, file_size_limit, allowed_mime_types
    into v_bucket_public, v_bucket_size, v_bucket_mime
    from storage.buckets where id = 'enterprise-documents' limit 1;

  select count(*) into v_policy from pg_policy
   where polname = 'ed_hq_manage'
     and polrelid = 'storage.objects'::regclass;

  raise notice '====== 0367c Storage Diagnostics ======';
  raise notice 'bucket enterprise-documents: % / 1', v_bucket;
  raise notice '  public: % (expect false)', v_bucket_public;
  raise notice '  file_size_limit: % bytes (expect 20971520)', v_bucket_size;
  raise notice '  allowed_mime_types: %', v_bucket_mime;
  raise notice 'storage.objects policy ed_hq_manage: % / 1', v_policy;
  raise notice '=======================================';

  if v_bucket = 1 and v_policy = 1 then
    raise notice '0367c COMPLETE — Storage bucket + policy ready';
  elsif v_bucket = 1 then
    raise warning '0367c PARTIAL — bucket OK, policy 누락 (Dashboard UI 수동 등록 필요)';
  else
    raise warning '0367c INCOMPLETE — bucket 누락';
  end if;
end$$;
