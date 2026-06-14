-- 0340 — Phase 6: CLAP embedding 자동 파이프라인 완성 (X6.73)
--
-- 배경:
--   X6.55~57 Colab/Modal worker 코드 완성, X1.2 인프라 (pgvector, track_embeddings,
--   playlist_centroids, store_track_embedding RPC) 완성. 그러나 trigger + queue +
--   dispatcher 연결이 빠져 active=0건. README 가 "자동 트리거는 다음 PR" 로 미뤄둠.
--
--   현재 데이터: 847 tracks pending (released + audio_url + no embedding).
--
-- 설계 (외부 컴퓨트 = "embed backend" 추상화):
--   1) track_embedding_jobs 큐 — dedup, 재시도, audit
--   2) tracks.release_status='released' 트리거 → enqueue
--   3) admin_embedding_backfill_enqueue() — 기존 847건 일괄 enqueue
--   4) dispatch_embedding_jobs() — pg_net 으로 backend HTTP 호출
--      backend URL 은 admin_settings.embed_backend_url 에서 읽음
--      (Modal endpoint OR Supabase Edge Function URL 둘 다 가능 — endpoint-agnostic)
--   5) pg_cron 5분 간격 dispatch (rate limit 안전)
--   6) admin RPCs — queue status / recent jobs / 수동 backfill

-- =============================================================================
-- 1. track_embedding_jobs 큐
-- =============================================================================
create table if not exists public.track_embedding_jobs (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending','dispatched','done','error','skipped')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  source text not null default 'manual',  -- 'trigger' | 'backfill' | 'manual' | 'retry'
  enqueued_at timestamptz not null default now(),
  dispatched_at timestamptz,
  finished_at timestamptz,
  error text,
  -- backend response audit (HTTP status, request_id 등)
  response jsonb,
  -- dedup: 동일 track 의 pending/dispatched 1건만
  constraint track_embedding_jobs_unique_active
    exclude (track_id with =) where (status in ('pending','dispatched'))
);

create index if not exists track_embedding_jobs_pending_idx
  on public.track_embedding_jobs (enqueued_at) where status='pending';
create index if not exists track_embedding_jobs_recent_idx
  on public.track_embedding_jobs (enqueued_at desc);

alter table public.track_embedding_jobs enable row level security;
drop policy if exists track_embed_jobs_admin_read on public.track_embedding_jobs;
create policy track_embed_jobs_admin_read on public.track_embedding_jobs for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));


-- =============================================================================
-- 2. 설정 키 (admin_settings 활용 — 기존 키-밸류 store)
--    embed_backend_url: Modal endpoint URL or Supabase Edge Function URL
--    embed_dispatch_batch_size: 한 cron 틱에서 dispatch 할 최대 건수 (rate limit 보호)
-- =============================================================================
-- (admin_settings 테이블 이미 존재 — set 함수 사용)
do $$ begin
  if not exists (select 1 from public.admin_settings where key='embed_backend_url') then
    insert into public.admin_settings (key, value)
    values ('embed_backend_url', to_jsonb(''::text));
  end if;
  if not exists (select 1 from public.admin_settings where key='embed_dispatch_batch_size') then
    insert into public.admin_settings (key, value)
    values ('embed_dispatch_batch_size', to_jsonb(5));
  end if;
end $$;


-- =============================================================================
-- 3. enqueue 헬퍼
-- =============================================================================
create or replace function public._enqueue_track_embedding(p_track_id uuid, p_source text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  -- 이미 embedding 있으면 skip
  if exists (select 1 from public.track_embeddings where track_id = p_track_id) then
    return null;
  end if;

  -- 이미 active job (pending/dispatched) 있으면 dedup (EXCLUDE 제약이 강제)
  begin
    insert into public.track_embedding_jobs (track_id, source)
    values (p_track_id, p_source)
    returning id into v_id;
  exception when exclusion_violation then
    select id into v_id from public.track_embedding_jobs
     where track_id = p_track_id and status in ('pending','dispatched')
     limit 1;
  end;
  return v_id;
end; $$;


-- =============================================================================
-- 4. 트리거 — tracks.release_status 가 released 로 전환되고 audio_url 있을 때 enqueue
-- =============================================================================
create or replace function public._tg_enqueue_track_embedding()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  -- released 전환 시 (변경된 트랜잭션만)
  if new.release_status = 'released'
     and new.audio_url is not null and new.audio_url <> ''
     and (old.release_status is distinct from new.release_status
          or old.audio_url is distinct from new.audio_url) then
    perform public._enqueue_track_embedding(new.id, 'trigger');
  end if;
  return new;
end; $$;

drop trigger if exists tg_enqueue_track_embedding on public.tracks;
create trigger tg_enqueue_track_embedding
  after insert or update on public.tracks
  for each row execute function public._tg_enqueue_track_embedding();


-- =============================================================================
-- 5. admin_embedding_backfill_enqueue — 기존 미임베딩 트랙 일괄 enqueue
-- =============================================================================
create or replace function public.admin_embedding_backfill_enqueue(p_limit int default 1000)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_enqueued int := 0;
  v_skipped int := 0;
  v_r record;
  v_id uuid;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin')
     and current_user <> 'postgres' then
    raise exception 'admin only';
  end if;

  for v_r in
    select t.id from public.tracks t
    where t.release_status='released'
      and t.audio_url is not null and t.audio_url <> ''
      and not exists (select 1 from public.track_embeddings e where e.track_id=t.id)
      and not exists (
        select 1 from public.track_embedding_jobs j
        where j.track_id=t.id and j.status in ('pending','dispatched')
      )
    order by t.created_at desc
    limit greatest(1, p_limit)
  loop
    v_id := public._enqueue_track_embedding(v_r.id, 'backfill');
    if v_id is not null then v_enqueued := v_enqueued + 1;
    else v_skipped := v_skipped + 1; end if;
  end loop;

  return jsonb_build_object('ok', true, 'enqueued', v_enqueued, 'skipped', v_skipped);
end; $$;

grant execute on function public.admin_embedding_backfill_enqueue(int) to authenticated;


-- =============================================================================
-- 6. dispatch_embedding_jobs — backend HTTP 호출 (pg_net 사용)
--    설정된 embed_backend_url 가 비어있으면 silent skip (안전).
-- =============================================================================
create or replace function public.dispatch_embedding_jobs(p_max_batch int default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_backend_url text;
  v_batch int;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_job record;
  v_request_id bigint;
  v_payload jsonb;
begin
  -- 설정 로드
  select value::text into v_backend_url
    from public.admin_settings where key='embed_backend_url';
  v_backend_url := trim(both '"' from coalesce(v_backend_url, ''));

  if v_backend_url is null or v_backend_url = '' then
    return jsonb_build_object('ok', true, 'dispatched', 0, 'skipped', 0,
      'reason', 'embed_backend_url not configured');
  end if;

  select coalesce(p_max_batch, (value::text)::int, 5) into v_batch
    from public.admin_settings where key='embed_dispatch_batch_size';
  v_batch := greatest(1, least(50, v_batch));

  -- pending 큐에서 batch 만큼 pull
  for v_job in
    select j.id, j.track_id, j.attempts,
           t.audio_url, t.title
    from public.track_embedding_jobs j
    join public.tracks t on t.id = j.track_id
    where j.status='pending'
      and j.attempts < j.max_attempts
      and t.audio_url is not null and t.audio_url <> ''
    order by j.enqueued_at
    limit v_batch
    for update skip locked
  loop
    v_payload := jsonb_build_object(
      'job_id', v_job.id,
      'track_id', v_job.track_id,
      'audio_url', v_job.audio_url,
      'title', v_job.title
    );

    -- pg_net 비동기 HTTP POST
    select net.http_post(
      url := v_backend_url,
      headers := jsonb_build_object('content-type', 'application/json'),
      body := v_payload,
      timeout_milliseconds := 60000
    ) into v_request_id;

    update public.track_embedding_jobs
       set status='dispatched',
           dispatched_at=now(),
           attempts = attempts + 1,
           response = jsonb_build_object('pg_net_request_id', v_request_id)
     where id = v_job.id;

    v_dispatched := v_dispatched + 1;
  end loop;

  return jsonb_build_object('ok', true,
    'dispatched', v_dispatched,
    'skipped', v_skipped,
    'backend_url', v_backend_url,
    'batch_size', v_batch);
end; $$;

revoke execute on function public.dispatch_embedding_jobs(int) from public, anon;
grant execute on function public.dispatch_embedding_jobs(int) to authenticated, service_role;


-- =============================================================================
-- 7. 콜백 RPC — backend 완료 시 호출 (이미 store_track_embedding 존재, 그 위 wrapper)
--    backend 가 임베딩 계산 완료 후 두 단계 호출:
--      1) store_track_embedding(track_id, embedding, model_version)
--      2) admin_mark_embedding_job_done(job_id)
--    backend 가 1번만 호출해도 OK (이 함수가 job_id 까지 마무리)
-- =============================================================================
create or replace function public.admin_mark_embedding_job_done(
  p_job_id uuid, p_success boolean default true, p_error text default null,
  p_response jsonb default null
)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if auth.uid() is null and current_user <> 'postgres'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service_role or admin only';
  end if;
  update public.track_embedding_jobs
     set status = case when p_success then 'done' else 'error' end,
         finished_at = now(),
         error = p_error,
         response = coalesce(p_response, response)
   where id = p_job_id;
  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end; $$;
grant execute on function public.admin_mark_embedding_job_done(uuid, boolean, text, jsonb) to authenticated, service_role;


-- =============================================================================
-- 8. cron — 5분 간격 dispatcher
-- =============================================================================
create or replace function public.cron_dispatch_embedding_jobs()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  return public.dispatch_embedding_jobs();
end; $$;
revoke execute on function public.cron_dispatch_embedding_jobs() from public, anon;
grant execute on function public.cron_dispatch_embedding_jobs() to service_role;


-- =============================================================================
-- 9. 운영 — dispatched > 30분 = 'error' 자동 마킹 (re-enqueue 가능)
-- =============================================================================
create or replace function public.cron_reap_stale_embedding_jobs()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  update public.track_embedding_jobs
     set status='error',
         error='dispatch timeout (>30min)',
         finished_at=now()
   where status='dispatched'
     and dispatched_at < now() - interval '30 minutes';
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'reaped', v_n);
end; $$;
revoke execute on function public.cron_reap_stale_embedding_jobs() from public, anon;
grant execute on function public.cron_reap_stale_embedding_jobs() to service_role;


-- =============================================================================
-- 10. admin 조회 RPCs
-- =============================================================================
create or replace function public.admin_embedding_pipeline_status()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'embedded', (select count(*) from public.track_embeddings),
    'released_total', (select count(*) from public.tracks
      where release_status='released' and audio_url is not null and audio_url<>''),
    'pending_no_job', (select count(*) from public.tracks t
      where t.release_status='released' and t.audio_url is not null and t.audio_url<>''
        and not exists (select 1 from public.track_embeddings e where e.track_id=t.id)
        and not exists (select 1 from public.track_embedding_jobs j
                        where j.track_id=t.id and j.status in ('pending','dispatched'))),
    'queue_pending', (select count(*) from public.track_embedding_jobs where status='pending'),
    'queue_dispatched', (select count(*) from public.track_embedding_jobs where status='dispatched'),
    'queue_done_24h', (select count(*) from public.track_embedding_jobs
      where status='done' and finished_at > now() - interval '24 hours'),
    'queue_error_24h', (select count(*) from public.track_embedding_jobs
      where status='error' and finished_at > now() - interval '24 hours'),
    'backend_url', (select value::text from public.admin_settings where key='embed_backend_url'),
    'computed_at', now()
  )
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin');
$$;
grant execute on function public.admin_embedding_pipeline_status() to authenticated;


create or replace function public.admin_list_embedding_jobs(
  p_status text default null, p_limit int default 50
)
returns table(
  id uuid, track_id uuid, track_title text, status text,
  source text, attempts int, max_attempts int,
  enqueued_at timestamptz, dispatched_at timestamptz, finished_at timestamptz,
  error text, response jsonb
) language sql stable security definer set search_path to 'public' as $$
  select j.id, j.track_id, t.title, j.status,
         j.source, j.attempts, j.max_attempts,
         j.enqueued_at, j.dispatched_at, j.finished_at,
         j.error, j.response
  from public.track_embedding_jobs j
  left join public.tracks t on t.id = j.track_id
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
    and (p_status is null or p_status='all' or j.status = p_status)
  order by j.enqueued_at desc
  limit greatest(1, p_limit);
$$;
grant execute on function public.admin_list_embedding_jobs(text, int) to authenticated;


create or replace function public.admin_retry_embedding_job(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.track_embedding_jobs
     set status='pending', error=null, dispatched_at=null, finished_at=null
   where id = p_job_id and status in ('error','dispatched');
  return jsonb_build_object('ok', true, 'job_id', p_job_id);
end; $$;
grant execute on function public.admin_retry_embedding_job(uuid) to authenticated;


-- =============================================================================
-- 11. admin_settings 헬퍼 — backend URL 설정
-- =============================================================================
create or replace function public.admin_set_embed_backend_url(p_url text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.admin_settings
     set value = to_jsonb(p_url::text)
   where key = 'embed_backend_url';
  return jsonb_build_object('ok', true, 'url', p_url);
end; $$;
grant execute on function public.admin_set_embed_backend_url(text) to authenticated;
