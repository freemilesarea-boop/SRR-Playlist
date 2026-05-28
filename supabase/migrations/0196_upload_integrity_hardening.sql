-- 0196 — 업로드 무결성 강화 (additive only). 0194 위에 보강.
--   목적: "다른 곡이 잘못 등록되는 것" 방지/감지 강화.
--   - upload_integrity_logs 에 filesize / transcoding_status 추가 (감사 필드 보강)
--   - record_upload_integrity2: 실패 로그 + filesize/transcoding_status 포함 (기존 함수 유지, 신규 overload 아님 — 별도 이름)
--   - check_batch_integrity: final sha NULL 도 무결성 위반으로 판정 (vacuous pass 방지) + failed_count 반환
--   - get_my_batch_status: 새로고침 복구용 — batch 내 client_track_id ↔ track_id ↔ 상태 조회
-- DROP/RENAME 없음. 기존 0194 객체는 그대로 둔다.

-- 1) 감사 컬럼 추가 (additive)
alter table public.upload_integrity_logs
  add column if not exists original_filesize bigint,
  add column if not exists final_filesize bigint,
  add column if not exists transcoding_status text;

-- 2) record_upload_integrity2 — 성공/실패 모두 기록 + filesize/transcoding_status
create or replace function public.record_upload_integrity2(
  p_batch_id uuid, p_client_track_id text, p_track_id uuid,
  p_original_filename text, p_source_fingerprint text,
  p_original_sha256 text, p_final_sha256 text, p_storage_path text,
  p_duration numeric, p_transcoded boolean, p_status text, p_error text default null,
  p_original_filesize bigint default null, p_final_filesize bigint default null,
  p_transcoding_status text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false); end if;
  insert into public.upload_integrity_logs(
    user_id, batch_id, client_track_id, track_id, original_filename, source_file_fingerprint,
    original_sha256, final_audio_sha256, final_storage_path, audio_duration, transcoded,
    upload_status, error, original_filesize, final_filesize, transcoding_status)
  values (
    v_uid, p_batch_id, p_client_track_id, p_track_id, p_original_filename, p_source_fingerprint,
    p_original_sha256, p_final_sha256, p_storage_path, p_duration, p_transcoded,
    coalesce(p_status, 'success'), p_error, p_original_filesize, p_final_filesize, p_transcoding_status)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.record_upload_integrity2(uuid, text, uuid, text, text, text, text, text, numeric, boolean, text, text, bigint, bigint, text) to authenticated;

-- 3) check_batch_integrity 강화 — NULL final sha 도 위반으로 판정 (CREATE OR REPLACE, 시그니처 동일)
create or replace function public.check_batch_integrity(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_success int; v_sha int; v_path int; v_nullsha int; v_failed int; v_dups jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select
    count(*) filter (where upload_status='success'),
    count(distinct final_audio_sha256) filter (where upload_status='success' and final_audio_sha256 is not null),
    count(distinct final_storage_path) filter (where upload_status='success' and final_storage_path is not null),
    count(*) filter (where upload_status='success' and final_audio_sha256 is null),
    count(*) filter (where upload_status='failed')
    into v_success, v_sha, v_path, v_nullsha, v_failed
  from public.upload_integrity_logs
  where batch_id = p_batch_id and (user_id = v_uid or exists (select 1 from public.users u where u.id=v_uid and u.role='admin'));
  select coalesce(jsonb_agg(jsonb_build_object('sha', final_audio_sha256, 'files', files, 'n', n)), '[]'::jsonb) into v_dups from (
    select final_audio_sha256, count(*) n, jsonb_agg(original_filename) files from public.upload_integrity_logs
    where batch_id = p_batch_id and upload_status='success' and final_audio_sha256 is not null group by final_audio_sha256 having count(*) > 1) d;
  return jsonb_build_object(
    'ok', (v_success = v_sha and v_success = v_path and v_nullsha = 0),
    'success_count', v_success, 'distinct_sha', v_sha, 'distinct_path', v_path,
    'null_sha_count', v_nullsha, 'failed_count', v_failed, 'duplicate_groups', v_dups);
end; $$;
grant execute on function public.check_batch_integrity(uuid) to authenticated;

-- 4) get_my_batch_status — 새로고침 복구용. batch 내 client_track_id 별 등록 상태.
create or replace function public.get_my_batch_status(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_track_id', client_track_id,
    'track_id', track_id,
    'original_filename', original_filename,
    'upload_status', upload_status,
    'final_audio_sha256', final_audio_sha256,
    'transcoding_status', transcoding_status,
    'created_at', created_at) order by created_at), '[]'::jsonb)
  into v_result
  from public.upload_integrity_logs
  where batch_id = p_batch_id and user_id = v_uid;
  return v_result;
end; $$;
grant execute on function public.get_my_batch_status(uuid) to authenticated;
