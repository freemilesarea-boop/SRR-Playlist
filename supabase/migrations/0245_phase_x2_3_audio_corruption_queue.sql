-- 0245 — Phase X2.3 손상 음원 후보 큐 (Audio corruption candidates)
--
-- 배경: fingerprint_status='failed' = fpcalc + ffmpeg 양쪽 디코딩 실패.
--       오디오 파일 손상 / partial upload / 깨진 codec 가능성 큼.
-- 정책 (사용자 spec):
--   - 자동 삭제/차단 금지. 관리자 검수 큐로만 표시.
--   - 업로드 QC 자동 반려 후보로 "연결" — 자동 반려 자체는 금지, 후보 목록만 노출.
--
-- 구성:
--   A. admin_list_corruption_candidates — 실패 fingerprint + tracks 메타 + 기존 QC report 조인
--   B. admin_mark_fingerprint_qc_risk — 운영자가 명시적으로 audio_qc_reports 에 high-risk 표시
--      (자동 아님, UI 버튼 클릭 시 호출)

-- ===== A. corruption candidates =====
-- 메타데이터 비교에 필요한 모든 신호를 한 쿼리로 노출:
--   · tracks.duration  (사용자 claim)
--   · download_size_bytes / content_type (실제 HTTP 응답)
--   · qc-v2 의 risk_level / qc_score (DSP 분석이 있다면)
--   · fingerprint_error (디코딩 실패 stderr 일부)
create or replace function public.admin_list_corruption_candidates(
  p_limit int default 100,
  p_only_exhausted boolean default false
) returns table (
  track_id              uuid,
  title                 text,
  artist                text,
  audio_url             text,
  fingerprint_error     text,
  retry_count           int,
  attempted_at          timestamptz,
  download_size_bytes   bigint,
  download_content_type text,
  track_duration        numeric,
  qc_risk_level         text,
  qc_score              numeric,
  qc_issues_count       int,
  has_qc_report         boolean
)
language sql
security definer
set search_path = public
as $$
  select t.id, t.title, t.artist, t.audio_url,
         f.fingerprint_error, f.retry_count, f.fingerprint_attempted_at,
         f.download_size_bytes, f.download_content_type,
         t.duration,
         q.risk_level, q.qc_score,
         coalesce(jsonb_array_length(q.issues_json), 0),
         q.id is not null
  from public.audio_fingerprints f
  join public.tracks t on t.id = f.track_id and t.removed_at is null
  left join lateral (
    select id, risk_level, qc_score, issues_json
    from public.audio_qc_reports
    where track_id = f.track_id
    order by created_at desc
    limit 1
  ) q on true
  where f.fingerprint_status = 'failed'
    and (not p_only_exhausted or f.retry_count >= 3)
  order by f.retry_count desc, f.fingerprint_attempted_at desc nulls last
  limit greatest(p_limit, 1);
$$;

-- ===== B. fingerprint 실패 → QC 위험 마크 (수동 호출) =====
-- 자동이 아니라 관리자가 UI 에서 버튼 누를 때만 audio_qc_reports 에 한 행 만든다.
-- 기존 qc-v2 행이 있어도 별도 model_version='fingerprint-failed' 행으로 분리 보관.
create or replace function public.admin_mark_fingerprint_qc_risk(p_track_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_error text;
  v_size bigint;
  v_ctype text;
begin
  select fingerprint_error, download_size_bytes, download_content_type
    into v_error, v_size, v_ctype
  from public.audio_fingerprints
  where track_id = p_track_id and fingerprint_status = 'failed';

  if not found then
    raise exception 'no failed fingerprint row for track_id %', p_track_id;
  end if;

  insert into public.audio_qc_reports(
    track_id, risk_level, qc_score, qc_grade,
    issues_json, model_version, created_at
  ) values (
    p_track_id, 'HIGH', 0, 'D',
    jsonb_build_array(jsonb_build_object(
      'code', 'FINGERPRINT_DECODE_FAILED',
      'message', '오디오 디코딩 실패 — 손상/부분 업로드/코덱 mismatch 가능',
      'fingerprint_error', left(coalesce(v_error,''), 500),
      'download_size_bytes', v_size,
      'content_type', v_ctype
    )),
    'fingerprint-failed', now()
  )
  returning id into v_id;

  return v_id;
end; $$;

-- ===== C. 권한 =====
revoke all on function public.admin_list_corruption_candidates(int, boolean) from public;
revoke all on function public.admin_mark_fingerprint_qc_risk(uuid) from public;

grant execute on function public.admin_list_corruption_candidates(int, boolean) to authenticated, service_role;
grant execute on function public.admin_mark_fingerprint_qc_risk(uuid) to authenticated, service_role;
