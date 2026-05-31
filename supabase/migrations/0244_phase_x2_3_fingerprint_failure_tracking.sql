-- 0244 — Phase X2.3 fingerprint failure tracking + retry policy
--
-- 배경: fpcalc -raw 가 "Error decoding audio frame (End of file)" 등으로 일부 트랙 실패.
-- 정책 (사용자 spec):
--   - 자동 삭제/차단 금지. 실패는 검수 큐로만 표시
--   - 성공 행은 그대로 보존, 실패는 별도 status 로 기록
--   - retry_count 제한으로 무한 재시도 차단
--   - 진단 메타 (download_size, content_type, error) 보존
--
-- 구성:
--   A. audio_fingerprints 컬럼 확장 (status / error / attempted_at / retry_count / download meta)
--      + fingerprint / fingerprint_hash NULL 허용 (실패 행은 지문 없음)
--   B. store_track_fingerprint 시그니처 확장 (3개 메타 인자) + retry_count 리셋
--   C. store_track_fingerprint_failure — 새 RPC
--   D. list_tracks_needing_fingerprint — retry 제한 적용
--   E. admin_fingerprint_failure_summary / admin_list_fingerprint_failures — 관리자 큐 RPC

-- ===== A. 컬럼 확장 =====
alter table public.audio_fingerprints
  alter column fingerprint drop not null,
  alter column fingerprint_hash drop not null,
  add column if not exists fingerprint_status text not null default 'success'
    check (fingerprint_status in ('success','failed')),
  add column if not exists fingerprint_error text,
  add column if not exists fingerprint_attempted_at timestamptz not null default now(),
  add column if not exists retry_count int not null default 0,
  add column if not exists download_size_bytes bigint,
  add column if not exists download_content_type text,
  add column if not exists used_fallback boolean not null default false;

create index if not exists ix_audio_fp_status on public.audio_fingerprints(fingerprint_status);
create index if not exists ix_audio_fp_attempt on public.audio_fingerprints(fingerprint_attempted_at desc);

-- ===== B. store_track_fingerprint (success) — 시그니처 확장 =====
drop function if exists public.store_track_fingerprint(uuid, bigint[], text, text, numeric, numeric, text);

create or replace function public.store_track_fingerprint(
  p_track_id              uuid,
  p_fingerprint           bigint[],
  p_fingerprint_hash      text,
  p_fingerprint_b64       text default null,
  p_duration_seconds      numeric default null,
  p_confidence            numeric default 1.0,
  p_algorithm             text default 'chromaprint-v1',
  p_download_size_bytes   bigint default null,
  p_download_content_type text default null,
  p_used_fallback         boolean default false
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audio_fingerprints(
    track_id, fingerprint, fingerprint_hash, fingerprint_b64,
    duration_seconds, confidence, algorithm,
    fingerprint_status, fingerprint_error, fingerprint_attempted_at, retry_count,
    download_size_bytes, download_content_type, used_fallback
  ) values (
    p_track_id, p_fingerprint, p_fingerprint_hash, p_fingerprint_b64,
    p_duration_seconds, p_confidence, p_algorithm,
    'success', null, now(), 0,
    p_download_size_bytes, p_download_content_type, p_used_fallback
  )
  on conflict (track_id) do update set
    fingerprint = excluded.fingerprint,
    fingerprint_hash = excluded.fingerprint_hash,
    fingerprint_b64 = excluded.fingerprint_b64,
    duration_seconds = excluded.duration_seconds,
    confidence = excluded.confidence,
    algorithm = excluded.algorithm,
    fingerprint_status = 'success',
    fingerprint_error = null,
    fingerprint_attempted_at = now(),
    retry_count = 0,
    download_size_bytes = excluded.download_size_bytes,
    download_content_type = excluded.download_content_type,
    used_fallback = excluded.used_fallback,
    created_at = now();
$$;

-- ===== C. store_track_fingerprint_failure (new) =====
create or replace function public.store_track_fingerprint_failure(
  p_track_id              uuid,
  p_error                 text,
  p_download_size_bytes   bigint default null,
  p_download_content_type text default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audio_fingerprints(
    track_id, fingerprint, fingerprint_hash, fingerprint_b64,
    duration_seconds, confidence, algorithm,
    fingerprint_status, fingerprint_error, fingerprint_attempted_at, retry_count,
    download_size_bytes, download_content_type, used_fallback
  ) values (
    p_track_id, null, null, null,
    null, null, 'chromaprint-v1',
    'failed', p_error, now(), 1,
    p_download_size_bytes, p_download_content_type, false
  )
  on conflict (track_id) do update set
    fingerprint_status = 'failed',
    fingerprint_error = excluded.fingerprint_error,
    fingerprint_attempted_at = now(),
    retry_count = public.audio_fingerprints.retry_count + 1,
    download_size_bytes = coalesce(excluded.download_size_bytes, public.audio_fingerprints.download_size_bytes),
    download_content_type = coalesce(excluded.download_content_type, public.audio_fingerprints.download_content_type);
$$;

-- ===== D. list_tracks_needing_fingerprint — retry 제한 적용 =====
drop function if exists public.list_tracks_needing_fingerprint(int);

create or replace function public.list_tracks_needing_fingerprint(
  p_limit int default 50,
  p_max_retries int default 3
)
returns table (track_id uuid, audio_url text, title text, artist text, prior_attempts int)
language sql
security definer
set search_path = public
as $$
  select t.id, t.audio_url, t.title, t.artist,
         coalesce((select retry_count from public.audio_fingerprints f where f.track_id = t.id), 0)::int
           as prior_attempts
  from public.tracks t
  where t.audio_url is not null
    and t.removed_at is null
    and not exists (
      select 1 from public.audio_fingerprints f
      where f.track_id = t.id
        and (f.fingerprint_status = 'success' or f.retry_count >= p_max_retries)
    )
  -- 신규 트랙 우선, 이후 재시도 가능 후보
  order by
    (exists (select 1 from public.audio_fingerprints f where f.track_id = t.id))::int,
    t.created_at desc nulls last, t.id
  limit greatest(p_limit, 1);
$$;

-- ===== E. 관리자 큐 RPC =====
create or replace function public.admin_fingerprint_failure_summary()
returns table (
  total_success int,
  total_failed int,
  total_retryable int,
  total_exhausted int,
  pending_never_attempted int,
  failure_breakdown jsonb
)
language sql
security definer
set search_path = public
as $$
  with stats as (
    select
      count(*) filter (where fingerprint_status='success') as s_succ,
      count(*) filter (where fingerprint_status='failed') as s_fail,
      count(*) filter (where fingerprint_status='failed' and retry_count < 3) as s_retry,
      count(*) filter (where fingerprint_status='failed' and retry_count >= 3) as s_exhaust
    from public.audio_fingerprints
  ),
  pending as (
    select count(*)::int as never_attempted
    from public.tracks t
    where t.audio_url is not null and t.removed_at is null
      and not exists (select 1 from public.audio_fingerprints f where f.track_id = t.id)
  ),
  err as (
    select coalesce(jsonb_object_agg(error_signature, cnt), '{}'::jsonb) as breakdown
    from (
      select substring(coalesce(fingerprint_error, '(no_error)') from 1 for 100) as error_signature,
             count(*) as cnt
      from public.audio_fingerprints
      where fingerprint_status='failed'
      group by substring(coalesce(fingerprint_error, '(no_error)') from 1 for 100)
      order by count(*) desc
      limit 50
    ) g
  )
  select s.s_succ::int, s.s_fail::int, s.s_retry::int, s.s_exhaust::int,
         p.never_attempted, err.breakdown
  from stats s, pending p, err;
$$;

create or replace function public.admin_list_fingerprint_failures(
  p_limit int default 100,
  p_only_exhausted boolean default false
) returns table (
  track_id uuid,
  title text,
  artist text,
  audio_url text,
  error text,
  retry_count int,
  attempted_at timestamptz,
  download_size_bytes bigint,
  download_content_type text
)
language sql
security definer
set search_path = public
as $$
  select t.id, t.title, t.artist, t.audio_url,
         f.fingerprint_error, f.retry_count, f.fingerprint_attempted_at,
         f.download_size_bytes, f.download_content_type
  from public.audio_fingerprints f
  join public.tracks t on t.id = f.track_id and t.removed_at is null
  where f.fingerprint_status = 'failed'
    and (not p_only_exhausted or f.retry_count >= 3)
  order by f.fingerprint_attempted_at desc nulls last
  limit greatest(p_limit, 1);
$$;

-- 관리자 수동 reset (운영자가 다시 시도 허용)
create or replace function public.admin_reset_fingerprint_failure(p_track_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.audio_fingerprints
  where track_id = p_track_id and fingerprint_status = 'failed';
$$;

-- ===== F. 권한 =====
revoke all on function public.store_track_fingerprint(uuid, bigint[], text, text, numeric, numeric, text, bigint, text, boolean) from public;
revoke all on function public.store_track_fingerprint_failure(uuid, text, bigint, text) from public;
revoke all on function public.list_tracks_needing_fingerprint(int, int) from public;
revoke all on function public.admin_fingerprint_failure_summary() from public;
revoke all on function public.admin_list_fingerprint_failures(int, boolean) from public;
revoke all on function public.admin_reset_fingerprint_failure(uuid) from public;

grant execute on function public.store_track_fingerprint(uuid, bigint[], text, text, numeric, numeric, text, bigint, text, boolean) to service_role;
grant execute on function public.store_track_fingerprint_failure(uuid, text, bigint, text) to service_role;
grant execute on function public.list_tracks_needing_fingerprint(int, int) to service_role;
grant execute on function public.admin_fingerprint_failure_summary() to authenticated, service_role;
grant execute on function public.admin_list_fingerprint_failures(int, boolean) to authenticated, service_role;
grant execute on function public.admin_reset_fingerprint_failure(uuid) to authenticated, service_role;
