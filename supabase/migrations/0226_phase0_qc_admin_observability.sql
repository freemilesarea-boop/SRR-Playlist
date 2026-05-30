-- 0226 — Phase 0 AI QC: admin observability (재시도 + 파이프라인 통계)
--
-- 클라이언트 호출:
--   qcApi.ts adminRetryPendingQc()    → admin_retry_pending_qc(limit)
--   qcApi.ts getQcPipelineStatus()    → admin_qc_pipeline_status()

-- QC 미분석 트랙 일괄 재시도 (트리거가 실패했거나 백필 누락 케이스)
create or replace function public.admin_retry_pending_qc(p_limit int default 50)
returns table (track_id uuid, request_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_req bigint;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;

  for r in
    select t.id from public.tracks t
    left join public.audio_qc_reports rep on rep.track_id = t.id and rep.model_version = 'qc-v1'
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.removed_at is null
      and rep.id is null
    order by t.created_at desc
    limit p_limit
  loop
    begin
      v_req := public.enqueue_track_qc(r.id);
      track_id := r.id;
      request_id := v_req;
      return next;
    exception when others then
      insert into public.qc_enqueue_log(track_id, status, reason)
        values (r.id, 'failed', 'admin_retry: ' || SQLERRM);
    end;
  end loop;
end;
$$;
revoke all on function public.admin_retry_pending_qc(int) from public, anon;
grant execute on function public.admin_retry_pending_qc(int) to authenticated, service_role;

-- 파이프라인 상태 통계 (admin UI 상단 6칸)
create or replace function public.admin_qc_pipeline_status()
returns table (
  tracks_total bigint,
  tracks_with_qc bigint,
  tracks_pending_qc bigint,
  enqueue_total_24h bigint,
  enqueue_failed_24h bigint,
  enqueue_skipped_24h bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with t as (
    select count(*) as tracks_total from public.tracks
    where audio_url is not null and removed_at is null
  ),
  q as (
    select count(*) as tracks_with_qc from public.audio_qc_reports
    where model_version = 'qc-v1'
  ),
  p as (
    select count(*) as tracks_pending_qc
    from public.tracks tr
    left join public.audio_qc_reports r on r.track_id = tr.id and r.model_version = 'qc-v1'
    where tr.audio_url is not null and tr.removed_at is null and r.id is null
  ),
  l as (
    select
      count(*) as enqueue_total_24h,
      count(*) filter (where status = 'failed') as enqueue_failed_24h,
      count(*) filter (where status = 'skipped') as enqueue_skipped_24h
    from public.qc_enqueue_log
    where created_at > now() - interval '24 hours'
  )
  select t.tracks_total, q.tracks_with_qc, p.tracks_pending_qc,
         l.enqueue_total_24h, l.enqueue_failed_24h, l.enqueue_skipped_24h
  from t, q, p, l;
$$;
revoke all on function public.admin_qc_pipeline_status() from public, anon;
grant execute on function public.admin_qc_pipeline_status() to authenticated, service_role;
