-- 0324 — 음원 업로드 가이드 + 본인 QC 리포트 공개 + 자동 사전 검증 (X6.35)
--
-- 목적 (B Tier 1.5 + 3.1):
--   현재 반려율 43.6% (618/1419) — 가장 큰 단일 사유 "음질 부적격" 492건.
--   운영 데이터 분석 결과 released vs removed 의 DSP 지표 거의 동일
--   (avg qc_score 93.8 vs 93.9, clipping 둘 다 0). 자동 차단 어려움.
--
-- 접근법:
--   1) "권장 기준" 공개 — 운영 데이터 분포 기반 + 업계 표준
--      (LUFS Integrated, True Peak, Clipping, QC Score 등)
--   2) 아티스트가 본인 트랙의 QC 결과 직접 확인 가능 (현재 admin only)
--   3) 업로드 전 가이드 카드 + 업로드 후 본인 트랙 QC 뱃지 노출
--   → 운영자 청취 판단 전에 본인이 재마스터링 결정 → 반려율 사전 감소
--
-- RPC 3종 신규:
--   - get_audio_upload_guidelines() 공개 (아티스트 가입 안내용)
--   - validate_track_audio_qc(p_track_id) — 분석 결과 verdict 산출
--   - get_my_track_qc_report(p_track_id) — 본인 트랙만 (RLS)

-- ===== 1) get_audio_upload_guidelines — 운영자가 보여주는 권장 기준 =====
create or replace function public.get_audio_upload_guidelines()
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'integrated_lufs', jsonb_build_object(
      'recommended_min', -20,
      'recommended_max', -10,
      'ideal_target', -14,
      'note', '스트리밍 라우드네스 정규화 기준. 너무 작으면 음량 부족, 너무 크면 클리핑/왜곡 위험.'
    ),
    'true_peak_db', jsonb_build_object(
      'recommended_max', -1.0,
      'ideal_max', -2.0,
      'note', 'True Peak 가 0 dBTP 에 가까울수록 디지털 왜곡 위험. -1 dBTP 이하 권장.'
    ),
    'clipping_count', jsonb_build_object(
      'recommended_max', 0,
      'fail_threshold', 5,
      'note', '0회 권장. 5회 이상이면 마스터링 재작업 필요.'
    ),
    'qc_score', jsonb_build_object(
      'recommended_min', 80,
      'excellent', 90,
      'note', '종합 음질 점수 (DSP 분석 결과). 80 점 이상 권장.'
    ),
    'file_format', jsonb_build_object(
      'accepted', jsonb_build_array('mp3','wav','m4a','flac'),
      'max_size_mb', 100,
      'preferred', 'wav 또는 flac (무손실)'
    ),
    'duration', jsonb_build_object(
      'recommended_min_seconds', 60,
      'recommended_max_seconds', 600,
      'note', '1분 미만 / 10분 초과 시 운영자 추가 검토 가능성 높음.'
    ),
    'common_rejection_reasons', jsonb_build_array(
      jsonb_build_object('reason', '음질 부적격',
        'tips', '마스터링 단계에서 LUFS/True Peak 점검 + 후반부 음질 저하 여부 확인'),
      jsonb_build_object('reason', '메타데이터 부적합',
        'tips', '곡 제목에 [메타데이터] 같은 표기 제거, 정확한 곡명만 사용'),
      jsonb_build_object('reason', '곡 길이 부적격',
        'tips', '너무 짧거나 길면 매장 BGM 용도에 부적합 — 60초~10분 권장')
    ),
    'general_tips', jsonb_build_array(
      '발매일은 업로드일 + 3일 이상 미래로 설정',
      '커버 이미지는 정사각형 1000x1000 이상 권장',
      '여러 곡 동시 업로드 시 동일 앨범으로 묶어 일괄 검수 진행'
    )
  );
$$;

grant execute on function public.get_audio_upload_guidelines() to anon, authenticated;

-- ===== 2) validate_track_audio_qc — 업로드된 트랙의 QC 결과 verdict =====
create or replace function public.validate_track_audio_qc(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_track record;
  v_qc record;
  v_lufs_verdict text; v_tp_verdict text;
  v_clip_verdict text; v_score_verdict text;
  v_overall text;
  v_messages text[] := '{}';
begin
  -- 소유자 확인: 본인 트랙 또는 admin
  select t.id, t.owner_user_id, t.title, t.release_status, t.created_at
    into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.owner_user_id <> v_uid
     and not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select q.* into v_qc from public.audio_qc_reports q
  where q.track_id = p_track_id
  order by q.created_at desc limit 1;

  if v_qc.id is null then
    return jsonb_build_object(
      'track_id', p_track_id,
      'status', 'analyzing',
      'message', 'QC 분석이 아직 완료되지 않았습니다. 보통 업로드 후 5분 이내 완료됩니다.',
      'analyzed', false
    );
  end if;

  -- LUFS 검증
  if v_qc.integrated_lufs is null then v_lufs_verdict := 'unknown';
  elsif v_qc.integrated_lufs < -20 then
    v_lufs_verdict := 'warning';
    v_messages := array_append(v_messages,
      format('LUFS %s — 음량이 권장 범위(-20 ~ -10)보다 작습니다. 마스터링에서 노멀라이즈 권장.',
             round(v_qc.integrated_lufs, 1)));
  elsif v_qc.integrated_lufs > -10 then
    v_lufs_verdict := 'warning';
    v_messages := array_append(v_messages,
      format('LUFS %s — 음량이 권장 범위(-20 ~ -10)보다 큽니다. 클리핑/왜곡 위험.',
             round(v_qc.integrated_lufs, 1)));
  else v_lufs_verdict := 'ok'; end if;

  -- True Peak 검증
  if v_qc.true_peak_db is null then v_tp_verdict := 'unknown';
  elsif v_qc.true_peak_db > -1.0 then
    v_tp_verdict := 'warning';
    v_messages := array_append(v_messages,
      format('True Peak %s dBTP — 권장 -1 dBTP 초과. 리미터 강화 권장.',
             round(v_qc.true_peak_db, 2)));
  else v_tp_verdict := 'ok'; end if;

  -- Clipping
  if v_qc.clipping_count is null then v_clip_verdict := 'unknown';
  elsif v_qc.clipping_count >= 5 then
    v_clip_verdict := 'fail';
    v_messages := array_append(v_messages,
      format('클리핑 %s회 감지 — 마스터링 재작업 권장.', v_qc.clipping_count));
  elsif v_qc.clipping_count > 0 then
    v_clip_verdict := 'warning';
    v_messages := array_append(v_messages,
      format('클리핑 %s회 감지 — 0회 권장.', v_qc.clipping_count));
  else v_clip_verdict := 'ok'; end if;

  -- QC Score
  if v_qc.qc_score is null then v_score_verdict := 'unknown';
  elsif v_qc.qc_score < 70 then
    v_score_verdict := 'fail';
    v_messages := array_append(v_messages,
      format('종합 점수 %s/100 — 70 점 미만 (낮음).', round(v_qc.qc_score, 0)));
  elsif v_qc.qc_score < 80 then
    v_score_verdict := 'warning';
    v_messages := array_append(v_messages,
      format('종합 점수 %s/100 — 80 점 미만 권장.', round(v_qc.qc_score, 0)));
  else v_score_verdict := 'ok'; end if;

  -- overall
  if 'fail' = any(array[v_lufs_verdict, v_tp_verdict, v_clip_verdict, v_score_verdict]) then
    v_overall := 'fail';
  elsif 'warning' = any(array[v_lufs_verdict, v_tp_verdict, v_clip_verdict, v_score_verdict]) then
    v_overall := 'warning';
  else v_overall := 'ok'; end if;

  return jsonb_build_object(
    'track_id', p_track_id,
    'status', 'analyzed',
    'analyzed', true,
    'overall_verdict', v_overall,
    'qc_score', v_qc.qc_score,
    'qc_grade', v_qc.qc_grade,
    'risk_level', v_qc.risk_level,
    'metrics', jsonb_build_object(
      'integrated_lufs', v_qc.integrated_lufs,
      'true_peak_db', v_qc.true_peak_db,
      'clipping_count', v_qc.clipping_count,
      'noise_floor_db', v_qc.noise_floor_db,
      'dynamic_range', v_qc.dynamic_range,
      'duration', v_qc.duration
    ),
    'verdicts', jsonb_build_object(
      'lufs', v_lufs_verdict,
      'true_peak', v_tp_verdict,
      'clipping', v_clip_verdict,
      'qc_score', v_score_verdict
    ),
    'messages', array_to_json(v_messages),
    'measured_at', v_qc.created_at
  );
end; $$;

grant execute on function public.validate_track_audio_qc(uuid) to authenticated;

-- ===== 3) get_my_track_qc_report — 본인 트랙들의 QC 요약 일괄 =====
create or replace function public.get_my_track_qc_report(p_limit int default 50)
returns table(
  track_id uuid, title text, release_status text, created_at timestamptz,
  qc_score numeric, qc_grade text, risk_level text,
  integrated_lufs numeric, true_peak_db numeric, clipping_count int,
  has_report boolean
)
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'login required'; end if;
  return query
  select t.id, t.title, t.release_status, t.created_at,
         q.qc_score, q.qc_grade, q.risk_level,
         q.integrated_lufs, q.true_peak_db, q.clipping_count,
         (q.id is not null) as has_report
  from public.tracks t
  left join lateral (
    select * from public.audio_qc_reports r
    where r.track_id = t.id order by r.created_at desc limit 1
  ) q on true
  where t.owner_user_id = v_uid
  order by t.created_at desc
  limit greatest(1, p_limit);
end; $$;

grant execute on function public.get_my_track_qc_report(int) to authenticated;
