-- 0224 — Phase 0 AI QC: 음원 검수 점수/등급/위험도 저장 + 조회 RPC
--
-- 흐름:
--   Modal qc-single → store_track_qc_report (service_role)
--   admin UI       → get_track_qc_report / list_admin_qc_review_queue
--   백필           → list_tracks_needing_qc (service_role)
--
-- 모델 버전 분리 보관 → 추후 모델 교체 (qc-v1 → qc-v2) 시 이력 유지.

create table if not exists public.audio_qc_reports (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  -- 라우드니스
  integrated_lufs numeric(6,2),
  true_peak_db numeric(6,2),
  -- 다이내믹/스테레오
  dynamic_range numeric(5,2),
  stereo_width numeric(4,3),
  -- 노이즈/무음
  noise_floor_db numeric(6,2),
  silence_ratio numeric(4,3),
  -- 클리핑/왜곡
  clipping_count int,
  distortion_score numeric(4,3),
  -- 기술 메타
  sample_rate int,
  bit_depth int,
  duration numeric(7,2),
  -- 점수/등급
  qc_score numeric(5,2),
  qc_grade text check (qc_grade in ('A','B','C','D')),
  risk_level text check (risk_level in ('LOW','MEDIUM','HIGH','CRITICAL')),
  issues_json jsonb default '[]'::jsonb,
  -- 메타
  model_version text not null default 'qc-v1',
  created_at timestamptz not null default now(),
  unique (track_id, model_version)
);

create index if not exists audio_qc_track_idx on public.audio_qc_reports(track_id);
create index if not exists audio_qc_priority_idx
  on public.audio_qc_reports(risk_level, qc_score asc, created_at desc);

alter table public.audio_qc_reports enable row level security;
drop policy if exists audio_qc_admin_read on public.audio_qc_reports;
create policy audio_qc_admin_read on public.audio_qc_reports for select
  using (exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- Modal 워커 → 저장
create or replace function public.store_track_qc_report(
  p_track_id uuid,
  p_integrated_lufs numeric,
  p_true_peak_db numeric,
  p_dynamic_range numeric,
  p_stereo_width numeric,
  p_noise_floor_db numeric,
  p_silence_ratio numeric,
  p_clipping_count int,
  p_distortion_score numeric,
  p_sample_rate int,
  p_bit_depth int,
  p_duration numeric,
  p_qc_score numeric,
  p_qc_grade text,
  p_risk_level text,
  p_issues_json jsonb,
  p_model_version text default 'qc-v1'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audio_qc_reports(
    track_id, integrated_lufs, true_peak_db, dynamic_range, stereo_width,
    noise_floor_db, silence_ratio, clipping_count, distortion_score,
    sample_rate, bit_depth, duration,
    qc_score, qc_grade, risk_level, issues_json, model_version
  ) values (
    p_track_id, p_integrated_lufs, p_true_peak_db, p_dynamic_range, p_stereo_width,
    p_noise_floor_db, p_silence_ratio, p_clipping_count, p_distortion_score,
    p_sample_rate, p_bit_depth, p_duration,
    p_qc_score, p_qc_grade, p_risk_level, coalesce(p_issues_json, '[]'::jsonb), p_model_version
  )
  on conflict (track_id, model_version) do update set
    integrated_lufs  = excluded.integrated_lufs,
    true_peak_db     = excluded.true_peak_db,
    dynamic_range    = excluded.dynamic_range,
    stereo_width     = excluded.stereo_width,
    noise_floor_db   = excluded.noise_floor_db,
    silence_ratio    = excluded.silence_ratio,
    clipping_count   = excluded.clipping_count,
    distortion_score = excluded.distortion_score,
    sample_rate      = excluded.sample_rate,
    bit_depth        = excluded.bit_depth,
    duration         = excluded.duration,
    qc_score         = excluded.qc_score,
    qc_grade         = excluded.qc_grade,
    risk_level       = excluded.risk_level,
    issues_json      = excluded.issues_json,
    created_at       = now();
end;
$$;
revoke all on function public.store_track_qc_report(uuid,numeric,numeric,numeric,numeric,numeric,numeric,int,numeric,int,int,numeric,numeric,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.store_track_qc_report(uuid,numeric,numeric,numeric,numeric,numeric,numeric,int,numeric,int,int,numeric,numeric,text,text,jsonb,text) to service_role;

-- 단일 트랙 리포트
create or replace function public.get_track_qc_report(p_track_id uuid)
returns public.audio_qc_reports
language sql
security definer
set search_path = public
stable
as $$
  select * from public.audio_qc_reports
  where track_id = p_track_id
  order by created_at desc
  limit 1;
$$;
revoke all on function public.get_track_qc_report(uuid) from public, anon;
grant execute on function public.get_track_qc_report(uuid) to authenticated, service_role;

-- 검수 우선순위 큐 — CRITICAL > HIGH > MEDIUM > LOW > 미분석, 점수 낮은 순
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
  select
    t.id, t.title, t.artist, t.cover_url, t.release_status, t.submitted_at,
    r.qc_score, r.qc_grade, r.risk_level,
    r.integrated_lufs, r.true_peak_db, r.clipping_count,
    jsonb_array_length(coalesce(r.issues_json, '[]'::jsonb)) as issues_count,
    r.created_at
  from public.tracks t
  left join public.audio_qc_reports r on r.track_id = t.id
  where t.release_status in ('submitted','review_pending','changes_requested')
    and t.removed_at is null
  order by
    case r.risk_level
      when 'CRITICAL' then 0
      when 'HIGH' then 1
      when 'MEDIUM' then 2
      when 'LOW' then 3
      else 4 end,
    r.qc_score asc nulls last,
    t.submitted_at desc nulls last
  limit p_limit;
$$;
revoke all on function public.list_admin_qc_review_queue(int) from public, anon;
grant execute on function public.list_admin_qc_review_queue(int) to authenticated, service_role;

-- 백필 후보 — QC 없는 트랙
create or replace function public.list_tracks_needing_qc(p_limit int default 50)
returns table (track_id uuid, title text, audio_url text, duration numeric)
language sql
security definer
set search_path = public
stable
as $$
  select t.id, t.title, t.audio_url, t.duration
  from public.tracks t
  left join public.audio_qc_reports r on r.track_id = t.id and r.model_version = 'qc-v1'
  where t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.removed_at is null
    and r.id is null
  order by t.created_at desc
  limit p_limit;
$$;
revoke all on function public.list_tracks_needing_qc(int) from public, anon, authenticated;
grant execute on function public.list_tracks_needing_qc(int) to service_role;
