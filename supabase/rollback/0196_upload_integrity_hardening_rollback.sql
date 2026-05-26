-- Rollback for 0196_upload_integrity_hardening.sql
-- 0196 은 전부 additive (신규 컬럼/신규 함수 + check_batch_integrity 강화).
-- 롤백 시 신규 함수/컬럼 제거하고 check_batch_integrity 를 0194 원본으로 되돌린다.
-- ⚠ 신규 컬럼(original_filesize/final_filesize/transcoding_status) drop 시 해당 감사값만 사라짐.
--   기존 0194 로그/곡 데이터에는 영향 없음. 클라이언트(0196 빌드)는 record_upload_integrity2 를
--   호출하므로, 롤백하려면 프론트도 이전 빌드로 함께 되돌려야 한다(그렇지 않으면 무결성 로깅만 실패, 업로드 자체는 best-effort 라 성공).

begin;

drop function if exists public.get_my_batch_status(uuid);
drop function if exists public.record_upload_integrity2(uuid, text, uuid, text, text, text, text, text, numeric, boolean, text, text, bigint, bigint, text);

-- check_batch_integrity 0194 원본 복원
create or replace function public.check_batch_integrity(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_success int; v_sha int; v_path int; v_dups jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select count(*) filter (where upload_status='success'),
         count(distinct final_audio_sha256) filter (where upload_status='success' and final_audio_sha256 is not null),
         count(distinct final_storage_path) filter (where upload_status='success' and final_storage_path is not null)
    into v_success, v_sha, v_path
  from public.upload_integrity_logs where batch_id = p_batch_id and (user_id = v_uid or exists (select 1 from public.users u where u.id=v_uid and u.role='admin'));
  select coalesce(jsonb_agg(jsonb_build_object('sha', final_audio_sha256, 'files', files, 'n', n)), '[]'::jsonb) into v_dups from (
    select final_audio_sha256, count(*) n, jsonb_agg(original_filename) files from public.upload_integrity_logs
    where batch_id = p_batch_id and upload_status='success' and final_audio_sha256 is not null group by final_audio_sha256 having count(*) > 1) d;
  return jsonb_build_object('ok', (v_success = v_sha and v_success = v_path), 'success_count', v_success, 'distinct_sha', v_sha, 'distinct_path', v_path, 'duplicate_groups', v_dups);
end; $$;
grant execute on function public.check_batch_integrity(uuid) to authenticated;

alter table public.upload_integrity_logs
  drop column if exists original_filesize,
  drop column if exists final_filesize,
  drop column if exists transcoding_status;

commit;
