-- 0227 — Phase 0 QC v2 캘리브레이션
--
-- qc-v1 50곡 실음원 검증 결과 NOISE_HIGH=50/50 (100% false positive).
-- 원인: 10th percentile RMS 가 진짜 noise floor 가 아닌 '조용한 음악' 측정.
-- 50곡 분포: avg=-23.30 dB / min=-32.65 / p95=-16.06 → 어떤 임계든 false flag.
--
-- 변경:
--   1. Modal worker _analyze_qc: silence 기반 측정 + 1st percentile fallback (modal_app.py)
--   2. NOISE_HIGH > -40, NOISE_ELEVATED > -50 (산업 표준)
--   3. model_version='qc-v2' — qc-v1 데이터 보존 (UNIQUE (track_id, model_version))
--   4. 본 마이그레이션: 4개 RPC 를 qc-v2 기준으로 갱신
--      - list_tracks_needing_qc (qc-v2 없는 트랙 = qc-v1 만 있는 트랙도 다시 후보)
--      - list_admin_qc_review_queue (v2 우선, v1 fallback)
--      - get_track_qc_report (v2 우선, v1 fallback)
--      - admin_qc_pipeline_status (v2 카운트 기준)
--      - admin_retry_pending_qc (v2 기준)

create or replace function public.list_tracks_needing_qc(p_limit int default 50)
returns table (track_id uuid, title text, audio_url text, duration numeric)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, t.title, t.audio_url, t.duration
  from public.tracks t
  left join public.audio_qc_reports r on r.track_id = t.id and r.model_version = 'qc-v2'
  where t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.removed_at is null
    and r.id is null
  order by t.created_at desc
  limit p_limit;
$$;

create or replace function public.list_admin_qc_review_queue(p_limit int default 50)
returns table (
  track_id uuid, title text, artist text, cover_url text,
  release_status text, submitted_at timestamptz,
  qc_score numeric, qc_grade text, risk_level text,
  integrated_lufs numeric, true_peak_db numeric,
  clipping_count int, issues_count int, qc_created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  -- 같은 track 의 v2 우선, 없으면 v1 fallback
  with latest_qc as (
    select distinct on (r.track_id)
      r.track_id, r.qc_score, r.qc_grade, r.risk_level,
      r.integrated_lufs, r.true_peak_db, r.clipping_count, r.issues_json, r.created_at
    from public.audio_qc_reports r
    order by r.track_id, case r.model_version when 'qc-v2' then 0 else 1 end, r.created_at desc
  )
  select
    t.id, t.title, t.artist, t.cover_url, t.release_status, t.submitted_at,
    r.qc_score, r.qc_grade, r.risk_level,
    r.integrated_lufs, r.true_peak_db, r.clipping_count,
    jsonb_array_length(coalesce(r.issues_json, '[]'::jsonb)) as issues_count,
    r.created_at
  from public.tracks t
  left join latest_qc r on r.track_id = t.id
  where t.release_status in ('submitted','review_pending','changes_requested')
    and t.removed_at is null
  order by
    case r.risk_level when 'CRITICAL' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 when 'LOW' then 3 else 4 end,
    r.qc_score asc nulls last,
    t.submitted_at desc nulls last
  limit p_limit;
$$;

create or replace function public.get_track_qc_report(p_track_id uuid)
returns public.audio_qc_reports
language sql
security definer
set search_path = public
stable
as $$
  select * from public.audio_qc_reports
  where track_id = p_track_id
  order by case model_version when 'qc-v2' then 0 else 1 end, created_at desc
  limit 1;
$$;

create or replace function public.admin_qc_pipeline_status()
returns table (
  tracks_total bigint, tracks_with_qc bigint, tracks_pending_qc bigint,
  enqueue_total_24h bigint, enqueue_failed_24h bigint, enqueue_skipped_24h bigint
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
    where model_version = 'qc-v2'
  ),
  p as (
    select count(*) as tracks_pending_qc
    from public.tracks tr
    left join public.audio_qc_reports r on r.track_id = tr.id and r.model_version = 'qc-v2'
    where tr.audio_url is not null and tr.removed_at is null and r.id is null
  ),
  l as (
    select count(*) as enqueue_total_24h,
      count(*) filter (where status = 'failed') as enqueue_failed_24h,
      count(*) filter (where status = 'skipped') as enqueue_skipped_24h
    from public.qc_enqueue_log
    where created_at > now() - interval '24 hours'
  )
  select t.tracks_total, q.tracks_with_qc, p.tracks_pending_qc,
         l.enqueue_total_24h, l.enqueue_failed_24h, l.enqueue_skipped_24h
  from t, q, p, l;
$$;

create or replace function public.admin_retry_pending_qc(p_limit int default 50)
returns table (track_id uuid, request_id bigint)
language plpgsql
security definer
set search_path = public
as $$
declare r record; v_req bigint;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  for r in
    select t.id from public.tracks t
    left join public.audio_qc_reports rep on rep.track_id = t.id and rep.model_version = 'qc-v2'
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
