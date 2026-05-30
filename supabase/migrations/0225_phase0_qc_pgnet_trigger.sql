-- 0225 — Phase 0 AI QC: 자동 enqueue 트리거 + 실패 추적
--
-- 흐름:
--   tracks INSERT (audio_url 있음) OR UPDATE release_status → submitted/review_pending
--   → tg_track_enqueue_qc → enqueue_track_qc → pg_net → Modal qc-single endpoint
--
-- 보안: body._auth 에 app_internal_secrets('qc_worker_secret') 값을 함께 전송 (0223).
-- 격리: 트리거 실패해도 트랙 INSERT 는 진행 (BEGIN/EXCEPTION 블록).
-- 재시도: list_tracks_needing_qc + qc_enqueue_log 가 자연 retry 큐 역할.

create extension if not exists pg_net with schema extensions;

-- 시도/실패 로그
create table if not exists public.qc_enqueue_log (
  id bigserial primary key,
  track_id uuid not null references public.tracks(id) on delete cascade,
  request_id bigint,
  status text not null default 'queued',   -- queued / skipped / failed
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists qc_enqueue_log_track_idx on public.qc_enqueue_log(track_id);
create index if not exists qc_enqueue_log_status_idx on public.qc_enqueue_log(status, created_at desc);

alter table public.qc_enqueue_log enable row level security;
drop policy if exists qc_enqueue_log_admin_read on public.qc_enqueue_log;
create policy qc_enqueue_log_admin_read on public.qc_enqueue_log for select
  using (exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- pg_net 비동기 호출 함수
create or replace function public.enqueue_track_qc(p_track_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_audio_url text;
  v_request_id bigint;
  v_secret text;
  v_modal_url constant text := 'https://freemilesarea-boop--qc-single.modal.run';
begin
  select audio_url into v_audio_url from public.tracks where id = p_track_id;
  if v_audio_url is null or length(btrim(v_audio_url)) = 0 then
    insert into public.qc_enqueue_log(track_id, status, reason)
      values (p_track_id, 'skipped', 'no_audio_url');
    return null;
  end if;

  select value into v_secret from public.app_internal_secrets where key = 'qc_worker_secret';

  select net.http_post(
    url := v_modal_url,
    body := jsonb_build_object(
      'track_id', p_track_id::text,
      'audio_url', v_audio_url,
      '_auth', coalesce(v_secret, '')
    ),
    headers := '{"content-type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000
  ) into v_request_id;

  insert into public.qc_enqueue_log(track_id, request_id, status)
    values (p_track_id, v_request_id, 'queued');

  return v_request_id;
end;
$$;
revoke all on function public.enqueue_track_qc(uuid) from public, anon, authenticated;
grant execute on function public.enqueue_track_qc(uuid) to service_role;

-- 트리거 함수: INSERT 또는 release_status transition 시 자동 enqueue
create or replace function public._tg_track_enqueue_qc()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.audio_url is not null and length(btrim(new.audio_url)) > 0 then
      begin
        perform public.enqueue_track_qc(new.id);
      exception when others then
        insert into public.qc_enqueue_log(track_id, status, reason)
          values (new.id, 'failed', 'trigger_exception: ' || SQLERRM);
      end;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.release_status in ('submitted','review_pending')
       and old.release_status is distinct from new.release_status
       and new.audio_url is not null then
      begin
        perform public.enqueue_track_qc(new.id);
      exception when others then
        insert into public.qc_enqueue_log(track_id, status, reason)
          values (new.id, 'failed', 'trigger_exception: ' || SQLERRM);
      end;
    end if;
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists tg_track_enqueue_qc on public.tracks;
create trigger tg_track_enqueue_qc
  after insert or update of release_status on public.tracks
  for each row execute function public._tg_track_enqueue_qc();
