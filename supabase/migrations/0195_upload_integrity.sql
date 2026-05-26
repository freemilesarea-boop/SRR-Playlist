-- 0195 — 업로드 무결성 레이어 (additive). submit_artist_release 는 절대 변경하지 않는다.
-- 목적: batch 단위 추적 / 동일 파일 중복 탐지 / 업로드 누락 탐지 / transcode 결과 추적 /
--       retry 안전성 / 브라우저 refresh 상태 복구 / race condition 분석.
-- 연결: upload_integrity_logs.created_track_id → tracks.id, tracks.upload_batch_id ← batch.

-- tracks 에 batch 링크 컬럼만 additive 추가 (기존 앱/검수/배포 영향 없음).
alter table public.tracks add column if not exists upload_batch_id uuid;
create index if not exists idx_tracks_upload_batch on public.tracks(upload_batch_id) where upload_batch_id is not null;

-- 업로드 배치 (한 번의 "제출" 단위).
create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null,
  browser_session_id text,
  total_tracks int not null default 0,
  status text not null default 'active' check (status in ('active','integrity_failed','completed')),
  integrity jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_upload_batches_owner on public.upload_batches(owner_user_id, created_at desc);
alter table public.upload_batches enable row level security;
drop policy if exists upload_batches_owner_read on public.upload_batches;
create policy upload_batches_owner_read on public.upload_batches for select
  using (owner_user_id = auth.uid() or exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 곡별 업로드 무결성 로그 (immutable client_track_id 기준).
create table if not exists public.upload_integrity_logs (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.upload_batches(id) on delete cascade,
  client_track_id text not null,
  owner_user_id uuid not null,
  original_filename text,
  normalized_filename text,
  file_size bigint,
  mime_type text,
  sha256 text,
  transcode_status text,           -- pending | skipped | passthrough | transcoded | failed
  upload_status text,              -- queued | preparing | transcoding | quality_checking | uploading | submitting | submitted | failed | needs_reselect | cancelled
  failure_reason text,             -- ffmpeg_timeout | unsupported_codec | decode_failed | transcoding_failed | corrupted_audio | quality_failed | duplicate | upload_failed | submit_failed | preflight_failed
  created_track_id uuid,
  browser_session_id text,
  retry_count int not null default 0,
  detail jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (batch_id, client_track_id)
);
create index if not exists idx_uil_batch on public.upload_integrity_logs(batch_id);
create index if not exists idx_uil_owner on public.upload_integrity_logs(owner_user_id, created_at desc);
create index if not exists idx_uil_track on public.upload_integrity_logs(created_track_id) where created_track_id is not null;
create index if not exists idx_uil_sha on public.upload_integrity_logs(sha256) where sha256 is not null;
alter table public.upload_integrity_logs enable row level security;
drop policy if exists uil_owner_read on public.upload_integrity_logs;
create policy uil_owner_read on public.upload_integrity_logs for select
  using (owner_user_id = auth.uid() or exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ---------------------------------------------------------------------
-- record_upload_integrity — 곡별 무결성 로그 upsert (owner 전용).
--   batch row 보장(없으면 생성) + tracks.upload_batch_id 링크.
--   client_track_id 는 immutable key. 같은 (batch, client_track_id) 재호출은 update.
-- ---------------------------------------------------------------------
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
  p_detail jsonb default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if p_batch_id is null or coalesce(btrim(p_client_track_id),'') = '' then
    raise exception 'batch_id and client_track_id required';
  end if;

  -- batch 보장 (owner 일치 검증 — 타인 batch 에 기록 금지)
  insert into public.upload_batches(id, owner_user_id, browser_session_id)
  values (p_batch_id, v_uid, p_browser_session_id)
  on conflict (id) do update set updated_at = now()
  where public.upload_batches.owner_user_id = v_uid;
  if not exists (select 1 from public.upload_batches b where b.id = p_batch_id and b.owner_user_id = v_uid) then
    raise exception 'batch owner mismatch' using errcode='42501';
  end if;

  -- created_track_id 가 있으면 본인 소유 트랙인지 확인 후 batch 링크
  if p_created_track_id is not null then
    if not exists (select 1 from public.tracks t where t.id = p_created_track_id and t.owner_user_id = v_uid) then
      raise exception 'track owner mismatch' using errcode='42501';
    end if;
    update public.tracks set upload_batch_id = p_batch_id
      where id = p_created_track_id and owner_user_id = v_uid and upload_batch_id is distinct from p_batch_id;
  end if;

  insert into public.upload_integrity_logs(
    batch_id, client_track_id, owner_user_id, original_filename, normalized_filename,
    file_size, mime_type, sha256, transcode_status, upload_status, failure_reason,
    created_track_id, browser_session_id, detail
  ) values (
    p_batch_id, btrim(p_client_track_id), v_uid, p_original_filename, p_normalized_filename,
    p_file_size, p_mime_type, nullif(btrim(coalesce(p_sha256,'')),''), p_transcode_status, p_upload_status, p_failure_reason,
    p_created_track_id, p_browser_session_id, p_detail
  )
  on conflict (batch_id, client_track_id) do update set
    original_filename = coalesce(excluded.original_filename, public.upload_integrity_logs.original_filename),
    normalized_filename = coalesce(excluded.normalized_filename, public.upload_integrity_logs.normalized_filename),
    file_size = coalesce(excluded.file_size, public.upload_integrity_logs.file_size),
    mime_type = coalesce(excluded.mime_type, public.upload_integrity_logs.mime_type),
    sha256 = coalesce(excluded.sha256, public.upload_integrity_logs.sha256),
    transcode_status = coalesce(excluded.transcode_status, public.upload_integrity_logs.transcode_status),
    -- 'submitted'(성공 확정)은 뒤늦게 도착하는 비동기 기록(preparing 등)에 의해 되돌려지지 않도록 보호.
    upload_status = case when public.upload_integrity_logs.upload_status = 'submitted'
                         then 'submitted'
                         else coalesce(excluded.upload_status, public.upload_integrity_logs.upload_status) end,
    failure_reason = case when public.upload_integrity_logs.upload_status = 'submitted'
                          then public.upload_integrity_logs.failure_reason
                          else excluded.failure_reason end,
    created_track_id = coalesce(excluded.created_track_id, public.upload_integrity_logs.created_track_id),
    browser_session_id = coalesce(excluded.browser_session_id, public.upload_integrity_logs.browser_session_id),
    detail = coalesce(excluded.detail, public.upload_integrity_logs.detail),
    -- retry: 직전이 failed 였는데 다시 preparing(새 시도 시작)으로 진입할 때만 +1 (실제 재시도 횟수)
    retry_count = case when excluded.upload_status = 'preparing' and public.upload_integrity_logs.upload_status = 'failed'
                       then public.upload_integrity_logs.retry_count + 1
                       else public.upload_integrity_logs.retry_count end,
    updated_at = now()
  returning id into v_id;

  update public.upload_batches set
    total_tracks = (select count(*) from public.upload_integrity_logs l where l.batch_id = p_batch_id),
    updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.record_upload_integrity(uuid, text, text, text, text, bigint, text, text, text, text, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- artist_batch_integrity_check — 배치 제출 후 서버측 무결성 자가 점검.
--   hard issue 발견 시 batch.status='integrity_failed' (관리자 확인 전 재제출 차단 신호).
-- ---------------------------------------------------------------------
create or replace function public.artist_batch_integrity_check(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_issues jsonb := '[]'::jsonb;
  v_hard int := 0;
  r record;
begin
  if v_uid is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if not exists (select 1 from public.upload_batches b where b.id = p_batch_id and b.owner_user_id = v_uid) then
    raise exception 'batch not found' using errcode='42501';
  end if;

  -- 1) submitted 인데 created_track_id 없음 (링크 누락) — hard
  for r in select client_track_id, original_filename from public.upload_integrity_logs
           where batch_id = p_batch_id and upload_status = 'submitted' and created_track_id is null loop
    v_issues := v_issues || jsonb_build_object('severity','hard','type','missing_track','client_track_id',r.client_track_id,'filename',r.original_filename);
    v_hard := v_hard + 1;
  end loop;

  -- 2) submitted 인데 실제 tracks 행이 없거나 audio_url/storage_path 누락 — hard
  for r in select l.client_track_id, l.created_track_id
           from public.upload_integrity_logs l
           where l.batch_id = p_batch_id and l.upload_status='submitted' and l.created_track_id is not null
             and not exists (select 1 from public.tracks t where t.id=l.created_track_id
                             and t.owner_user_id=v_uid and t.audio_url is not null and t.storage_path is not null) loop
    v_issues := v_issues || jsonb_build_object('severity','hard','type','track_incomplete','client_track_id',r.client_track_id,'track_id',r.created_track_id);
    v_hard := v_hard + 1;
  end loop;

  -- 3) 서로 다른 트랙이 동일 audio_url / storage_path 공유 — hard (절대 발생하면 안 됨)
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

  -- 4) 동일 파일(sha256)이 여러 client_track_id 로 제출 — warning (정상 dedup 이지만 사용자에게 안내)
  for r in select sha256, count(*) c from public.upload_integrity_logs
           where batch_id = p_batch_id and sha256 is not null and upload_status='submitted'
           group by sha256 having count(*) > 1 loop
    v_issues := v_issues || jsonb_build_object('severity','warning','type','duplicate_file','sha256',left(r.sha256,12),'count',r.c);
  end loop;

  update public.upload_batches set
    status = case when v_hard > 0 then 'integrity_failed' else 'completed' end,
    integrity = jsonb_build_object('checked_at', now(), 'hard', v_hard, 'issues', v_issues),
    updated_at = now()
  where id = p_batch_id;

  return jsonb_build_object('ok', v_hard = 0, 'hard', v_hard, 'issues', v_issues);
end; $$;
grant execute on function public.artist_batch_integrity_check(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- get_my_upload_batch — 새로고침 후 owner 가 배치 상태를 재구성(reconcile)하기 위한 조회.
-- ---------------------------------------------------------------------
create or replace function public.get_my_upload_batch(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized' using errcode='42501'; end if;
  if not exists (select 1 from public.upload_batches b where b.id = p_batch_id and b.owner_user_id = auth.uid()) then
    return null;
  end if;
  select jsonb_build_object(
    'batch', (select to_jsonb(b.*) from public.upload_batches b where b.id = p_batch_id),
    'logs', (select coalesce(jsonb_agg(jsonb_build_object(
        'client_track_id', l.client_track_id, 'original_filename', l.original_filename,
        'upload_status', l.upload_status, 'transcode_status', l.transcode_status,
        'failure_reason', l.failure_reason, 'created_track_id', l.created_track_id,
        'sha256', l.sha256, 'retry_count', l.retry_count,
        'track_status', (select t.release_status from public.tracks t where t.id = l.created_track_id),
        'updated_at', l.updated_at
      ) order by l.created_at), '[]'::jsonb)
      from public.upload_integrity_logs l where l.batch_id = p_batch_id)
  ) into v;
  return v;
end; $$;
grant execute on function public.get_my_upload_batch(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- admin_upload_batch_integrity — 관리자: batch_id 또는 track_id 로 무결성/연결 확인.
-- ---------------------------------------------------------------------
create or replace function public.admin_upload_batch_integrity(p_batch_id uuid default null, p_track_id uuid default null, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_bid uuid := p_batch_id;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only' using errcode='42501';
  end if;
  if v_bid is null and p_track_id is not null then
    select upload_batch_id into v_bid from public.tracks where id = p_track_id;
  end if;

  if v_bid is not null then
    select jsonb_build_object(
      'batch', (select to_jsonb(b.*) from public.upload_batches b where b.id = v_bid),
      'owner_email', (select au.email from public.upload_batches b join auth.users au on au.id=b.owner_user_id where b.id=v_bid),
      'logs', (select coalesce(jsonb_agg(jsonb_build_object(
          'client_track_id', l.client_track_id, 'original_filename', l.original_filename,
          'file_size', l.file_size, 'mime_type', l.mime_type, 'sha256', l.sha256,
          'transcode_status', l.transcode_status, 'upload_status', l.upload_status,
          'failure_reason', l.failure_reason, 'created_track_id', l.created_track_id,
          'retry_count', l.retry_count,
          'track_title', (select t.title from public.tracks t where t.id=l.created_track_id),
          'track_status', (select t.release_status from public.tracks t where t.id=l.created_track_id),
          'audio_url', (select t.audio_url from public.tracks t where t.id=l.created_track_id),
          'storage_path', (select t.storage_path from public.tracks t where t.id=l.created_track_id)
        ) order by l.created_at), '[]'::jsonb)
        from public.upload_integrity_logs l where l.batch_id = v_bid)
    ) into v;
    return v;
  end if;

  -- batch 미지정: 최근 integrity_failed / active 배치 목록
  select coalesce(jsonb_agg(row_to_json(x) order by x.created_at desc), '[]'::jsonb) into v from (
    select b.id as batch_id, b.status, b.total_tracks, b.created_at, b.integrity,
      (select au.email from auth.users au where au.id=b.owner_user_id) as owner_email
    from public.upload_batches b order by b.created_at desc limit greatest(1, p_limit)) x;
  return jsonb_build_object('batches', v);
end; $$;
grant execute on function public.admin_upload_batch_integrity(uuid, uuid, int) to authenticated;
