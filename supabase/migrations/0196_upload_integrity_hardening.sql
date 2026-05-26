-- 0196 — 업로드 무결성 2차 강화 (additive). submit_artist_release 불변.
--  1) upload_integrity_logs.created_track_id UNIQUE(부분) — 1 track ↔ 1 log (다중 연결 차단)
--  2) upload_status 상태 회귀 방지(submitted/forward-chain backward 금지) — RPC state progression guard
--  3) orphan storage 탐지(storage_path 기록 + 24h+ 미연결) — 관리자 cleanup
--  7) integrity_failed 발생 시 admin_action_log 경고 + integrity_failed 비가역(관리자 clear 전까지)
-- (4 audio_url 재생검증 / 5 메모리 / 6 concurrency / 8 checksum 은 클라이언트 측에서 처리)

-- storage_path 기록(미연결 orphan 탐지에 필요) + cover
alter table public.upload_integrity_logs add column if not exists storage_path text;
alter table public.upload_integrity_logs add column if not exists cover_storage_path text;
create index if not exists idx_uil_storage_path on public.upload_integrity_logs(storage_path) where storage_path is not null;

-- 1) created_track_id UNIQUE(부분). 기존 중복은 가장 이른 것만 남기고 unlink.
with ranked as (
  select id, row_number() over (partition by created_track_id order by created_at) rn
  from public.upload_integrity_logs where created_track_id is not null
)
update public.upload_integrity_logs l
  set created_track_id = null, failure_reason = coalesce(l.failure_reason, 'duplicate')
from ranked r where r.id = l.id and r.rn > 1;

create unique index if not exists uq_uil_created_track
  on public.upload_integrity_logs(created_track_id) where created_track_id is not null;

-- 2) 상태 rank (forward chain 만 1..7, 그 외 side-state=0)
create or replace function public._upload_status_rank(s text)
returns int language sql immutable as $$
  select case s
    when 'queued' then 1 when 'preparing' then 2 when 'transcoding' then 3
    when 'quality_checking' then 4 when 'uploading' then 5 when 'submitting' then 6
    when 'submitted' then 7 else 0 end;
$$;

-- record_upload_integrity 재정의 (p_storage_path/p_cover_storage_path 추가 + state guard + unique-safe link).
drop function if exists public.record_upload_integrity(uuid, text, text, text, text, bigint, text, text, text, text, text, uuid, jsonb);
create or replace function public.record_upload_integrity(
  p_batch_id uuid,
  p_client_track_id text,
  p_browser_session_id text default null,
  p_original_filename text default null,
  p_normalized_filename text default null,
  p_file_size bigint default null,
  p_mime_type text default null,
  p_sha256 text default null,
  p_transcode_status text default null,
  p_upload_status text default null,
  p_failure_reason text default null,
  p_created_track_id uuid default null,
  p_detail jsonb default null,
  p_storage_path text default null,
  p_cover_storage_path text default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_linked boolean := false; v_dup boolean := false;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_batch_id is null or coalesce(btrim(p_client_track_id),'') = '' then
    raise exception 'batch_id and client_track_id required';
  end if;

  insert into public.upload_batches(id, owner_user_id, browser_session_id)
  values (p_batch_id, v_uid, p_browser_session_id)
  on conflict (id) do update set updated_at = now()
  where public.upload_batches.owner_user_id = v_uid;
  if not exists (select 1 from public.upload_batches b where b.id = p_batch_id and b.owner_user_id = v_uid) then
    raise exception 'batch owner mismatch' using errcode='42501';
  end if;

  -- 무결성 로그 upsert (created_track_id 는 아래에서 별도 link — unique 충돌 안전)
  insert into public.upload_integrity_logs(
    batch_id, client_track_id, owner_user_id, original_filename, normalized_filename,
    file_size, mime_type, sha256, transcode_status, upload_status, failure_reason,
    browser_session_id, detail, storage_path, cover_storage_path
  ) values (
    p_batch_id, btrim(p_client_track_id), v_uid, p_original_filename, p_normalized_filename,
    p_file_size, p_mime_type, nullif(btrim(coalesce(p_sha256,'')),''), p_transcode_status, p_upload_status, p_failure_reason,
    p_browser_session_id, p_detail, nullif(btrim(coalesce(p_storage_path,'')),''), nullif(btrim(coalesce(p_cover_storage_path,'')),'')
  )
  on conflict (batch_id, client_track_id) do update set
    original_filename = coalesce(excluded.original_filename, public.upload_integrity_logs.original_filename),
    normalized_filename = coalesce(excluded.normalized_filename, public.upload_integrity_logs.normalized_filename),
    file_size = coalesce(excluded.file_size, public.upload_integrity_logs.file_size),
    mime_type = coalesce(excluded.mime_type, public.upload_integrity_logs.mime_type),
    sha256 = coalesce(excluded.sha256, public.upload_integrity_logs.sha256),
    storage_path = coalesce(excluded.storage_path, public.upload_integrity_logs.storage_path),
    cover_storage_path = coalesce(excluded.cover_storage_path, public.upload_integrity_logs.cover_storage_path),
    transcode_status = coalesce(excluded.transcode_status, public.upload_integrity_logs.transcode_status),
    -- 상태 회귀 방지: submitted 는 절대 후퇴 금지, forward-chain 은 더 낮은 단계로 후퇴 금지(retry 시 failed→preparing 은 허용)
    upload_status = case
      when public.upload_integrity_logs.upload_status = 'submitted' then 'submitted'
      when excluded.upload_status is null then public.upload_integrity_logs.upload_status
      when public._upload_status_rank(excluded.upload_status) > 0
           and public._upload_status_rank(public.upload_integrity_logs.upload_status) > 0
           and public._upload_status_rank(excluded.upload_status) < public._upload_status_rank(public.upload_integrity_logs.upload_status)
        then public.upload_integrity_logs.upload_status
      else excluded.upload_status end,
    failure_reason = case when public.upload_integrity_logs.upload_status = 'submitted'
                          then public.upload_integrity_logs.failure_reason else excluded.failure_reason end,
    browser_session_id = coalesce(excluded.browser_session_id, public.upload_integrity_logs.browser_session_id),
    detail = coalesce(excluded.detail, public.upload_integrity_logs.detail),
    retry_count = case when excluded.upload_status = 'preparing' and public.upload_integrity_logs.upload_status = 'failed'
                       then public.upload_integrity_logs.retry_count + 1 else public.upload_integrity_logs.retry_count end,
    updated_at = now()
  returning id into v_id;

  -- created_track_id link (1 track ↔ 1 log). 본인 트랙 + unique 충돌 시 중복으로 처리.
  if p_created_track_id is not null then
    if not exists (select 1 from public.tracks t where t.id = p_created_track_id and t.owner_user_id = v_uid) then
      raise exception 'track owner mismatch' using errcode='42501';
    end if;
    begin
      update public.upload_integrity_logs
        set created_track_id = p_created_track_id, updated_at = now()
        where batch_id = p_batch_id and client_track_id = btrim(p_client_track_id);
      v_linked := true;
    exception when unique_violation then
      -- 이미 다른 client_track_id 가 이 트랙을 점유(동일 파일 중복 업로드) → link 하지 않고 duplicate 표시
      v_dup := true;
      update public.upload_integrity_logs
        set created_track_id = null, failure_reason = 'duplicate',
            upload_status = case when upload_status = 'submitted' then 'failed' else upload_status end,
            updated_at = now()
        where batch_id = p_batch_id and client_track_id = btrim(p_client_track_id);
    end;
    if v_linked then
      update public.tracks set upload_batch_id = p_batch_id
        where id = p_created_track_id and owner_user_id = v_uid and upload_batch_id is distinct from p_batch_id;
    end if;
  end if;

  update public.upload_batches set
    total_tracks = (select count(*) from public.upload_integrity_logs l where l.batch_id = p_batch_id),
    updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'linked', v_linked, 'duplicate', v_dup);
end; $$;
grant execute on function public.record_upload_integrity(uuid, text, text, text, text, bigint, text, text, text, text, text, uuid, jsonb, text, text) to authenticated;

-- artist_batch_integrity_check 재정의: integrity_failed 비가역 + admin_action_log 경고 + storage orphan 힌트.
create or replace function public.artist_batch_integrity_check(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_issues jsonb := '[]'::jsonb;
  v_hard int := 0;
  v_new_status text;
  r record;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if not exists (select 1 from public.upload_batches b where b.id = p_batch_id and b.owner_user_id = v_uid) then
    raise exception 'batch not found' using errcode='42501';
  end if;

  for r in select client_track_id, original_filename from public.upload_integrity_logs
           where batch_id = p_batch_id and upload_status = 'submitted' and created_track_id is null loop
    v_issues := v_issues || jsonb_build_object('severity','hard','type','missing_track','client_track_id',r.client_track_id,'filename',r.original_filename);
    v_hard := v_hard + 1;
  end loop;

  for r in select l.client_track_id, l.created_track_id
           from public.upload_integrity_logs l
           where l.batch_id = p_batch_id and l.upload_status='submitted' and l.created_track_id is not null
             and not exists (select 1 from public.tracks t where t.id=l.created_track_id
                             and t.owner_user_id=v_uid and t.audio_url is not null and t.storage_path is not null) loop
    v_issues := v_issues || jsonb_build_object('severity','hard','type','track_incomplete','client_track_id',r.client_track_id,'track_id',r.created_track_id);
    v_hard := v_hard + 1;
  end loop;

  for r in select t.audio_url, count(distinct t.id) c
           from public.tracks t where t.upload_batch_id = p_batch_id and t.audio_url is not null
           group by t.audio_url having count(distinct t.id) > 1 loop
    v_issues := v_issues || jsonb_build_object('severity','hard','type','dup_audio_url','audio_url',r.audio_url,'count',r.c);
    v_hard := v_hard + 1;
  end loop;
  for r in select t.storage_path, count(distinct t.id) c
           from public.tracks t where t.upload_batch_id = p_batch_id and t.storage_path is not null
           group by t.storage_path having count(distinct t.id) > 1 loop
    v_issues := v_issues || jsonb_build_object('severity','hard','type','dup_storage_path','storage_path',r.storage_path,'count',r.c);
    v_hard := v_hard + 1;
  end loop;

  for r in select sha256, count(*) c from public.upload_integrity_logs
           where batch_id = p_batch_id and sha256 is not null and upload_status='submitted'
           group by sha256 having count(*) > 1 loop
    v_issues := v_issues || jsonb_build_object('severity','warning','type','duplicate_file','sha256',left(r.sha256,12),'count',r.c);
  end loop;

  -- integrity_failed 는 비가역(관리자 clear 전까지) — 한 번 실패면 자동 completed 로 내려가지 않음.
  select case when v_hard > 0 then 'integrity_failed'
              when b.status = 'integrity_failed' then 'integrity_failed'
              else 'completed' end into v_new_status
  from public.upload_batches b where b.id = p_batch_id;

  update public.upload_batches set
    status = v_new_status,
    integrity = jsonb_build_object('checked_at', now(), 'hard', v_hard, 'issues', v_issues),
    updated_at = now()
  where id = p_batch_id;

  -- 7) integrity_failed 발생 시 관리자 경고(admin_action_log) — 신규 hard 일 때만.
  if v_hard > 0 then
    insert into public.admin_action_log(actor_user_id, action, target_id, detail)
    values (v_uid, 'upload_integrity_failed', null, jsonb_build_object('batch_id', p_batch_id, 'hard', v_hard, 'issues', v_issues));
  end if;

  return jsonb_build_object('ok', v_hard = 0, 'hard', v_hard, 'issues', v_issues, 'status', v_new_status);
end; $$;
grant execute on function public.artist_batch_integrity_check(uuid) to authenticated;

-- 3) orphan storage 탐지: 업로드는 됐으나(storage_path 기록) 트랙 미연결 + 24h 경과.
create or replace function public.admin_list_upload_orphans(p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at), '[]'::jsonb) into v from (
    select l.storage_path, l.batch_id, l.client_track_id, l.original_filename, l.file_size,
           l.failure_reason, l.created_at,
           (select au.email from auth.users au where au.id = l.owner_user_id) as owner_email
    from public.upload_integrity_logs l
    where l.storage_path is not null
      and l.created_track_id is null
      and l.created_at < now() - interval '24 hours'
      and not exists (select 1 from public.tracks t where t.storage_path = l.storage_path)
    order by l.created_at limit greatest(1, p_limit)) x;
  return jsonb_build_object('orphans', v);
end; $$;
grant execute on function public.admin_list_upload_orphans(int) to authenticated;

-- 7) integrity_failed 배치 개수(관리자 badge) + 관리자 clear(검토 완료 후 잠금 해제)
create or replace function public.admin_integrity_failed_count()
returns int language sql stable security definer set search_path to 'public' as $$
  select case when exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
              then (select count(*)::int from public.upload_batches where status='integrity_failed')
              else 0 end;
$$;
grant execute on function public.admin_integrity_failed_count() to authenticated;

create or replace function public.admin_clear_batch_integrity(p_batch_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then
    raise exception 'admin only' using errcode='42501';
  end if;
  update public.upload_batches set status='completed', updated_at=now() where id=p_batch_id and status='integrity_failed';
  insert into public.admin_action_log(actor_user_id, action, target_id, detail)
  values (v_uid, 'upload_integrity_cleared', null, jsonb_build_object('batch_id', p_batch_id, 'note', nullif(btrim(coalesce(p_note,'')),'')));
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_clear_batch_integrity(uuid, text) to authenticated;
