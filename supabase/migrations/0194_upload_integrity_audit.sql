-- 0194 — 업로드 무결성 감사. 최종 업로드 콘텐츠(변환 후 MP3) sha 추적 + self-check + 관리자 스캔. tracks 삭제 후 보존(FK 없음).
create table if not exists public.upload_integrity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid, batch_id uuid, client_track_id text, track_id uuid,
  original_filename text, source_file_fingerprint text, original_sha256 text,
  final_audio_sha256 text, final_storage_path text, audio_duration numeric,
  transcoded boolean, upload_status text, error text, created_at timestamptz not null default now()
);
create index if not exists idx_uil_user_created on public.upload_integrity_logs(user_id, created_at desc);
create index if not exists idx_uil_batch on public.upload_integrity_logs(batch_id);
create index if not exists idx_uil_finalsha on public.upload_integrity_logs(final_audio_sha256);
alter table public.upload_integrity_logs enable row level security;
drop policy if exists uil_owner_read on public.upload_integrity_logs;
create policy uil_owner_read on public.upload_integrity_logs for select using (user_id = auth.uid() or exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create or replace function public.record_upload_integrity(p_batch_id uuid, p_client_track_id text, p_track_id uuid, p_original_filename text, p_source_fingerprint text, p_original_sha256 text, p_final_sha256 text, p_storage_path text, p_duration numeric, p_transcoded boolean, p_status text, p_error text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false); end if;
  insert into public.upload_integrity_logs(user_id, batch_id, client_track_id, track_id, original_filename, source_file_fingerprint, original_sha256, final_audio_sha256, final_storage_path, audio_duration, transcoded, upload_status, error)
  values (v_uid, p_batch_id, p_client_track_id, p_track_id, p_original_filename, p_source_fingerprint, p_original_sha256, p_final_sha256, p_storage_path, p_duration, p_transcoded, coalesce(p_status,'success'), p_error) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.record_upload_integrity(uuid, text, uuid, text, text, text, text, text, numeric, boolean, text, text) to authenticated;

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
