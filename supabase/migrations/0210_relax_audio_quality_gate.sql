-- 오디오 품질 게이트 완화: 2단계(pass/reject) → 3단계(pass/warning/reject).
-- 신규 정책:
--   PASS:    LUFS -14..-9   AND  TP <= 0.0 dBTP
--   WARNING: LUFS -9..-7    OR   TP 0.0..+0.3 dBTP   (또는 PASS 밴드 외 일반 — 업로드 허용)
--   REJECT:  TP > +0.3 dBTP  OR  clipping(설정시) OR analysis_failed
-- additive: 컬럼 추가 + 함수 CREATE OR REPLACE. config 정책값만 UPDATE (트랙 데이터 UPDATE 없음).
-- release_status/stream_events/정산 무접근.

-- 1) config 컬럼 추가 + 정책 기본값 갱신.
alter table public.audio_quality_config
  add column if not exists true_peak_reject_max numeric not null default 0.3;
alter table public.audio_quality_config
  alter column lufs_max set default -9,
  alter column true_peak_max set default 0.0;

-- 운영 정책 적용 (config 행만 갱신 — 트랙 데이터 무변경).
update public.audio_quality_config
  set lufs_max = -9, true_peak_max = 0.0, true_peak_reject_max = 0.3, updated_at = now()
  where id = 1;

-- 2) track_audio_quality 에 3단계 등급 컬럼.
alter table public.track_audio_quality
  add column if not exists quality_grade text check (quality_grade in ('pass','warning','reject'));
create index if not exists idx_taq_grade on public.track_audio_quality(quality_grade, analyzed_at desc);

-- 3) 동적 grade 계산 헬퍼 (구 데이터 + 신규 모두 동일 정책 평가).
create or replace function public.compute_quality_grade(
  p_lufs numeric, p_tp numeric, p_clipping boolean, p_block_on_clipping boolean default null
) returns text language sql immutable
set search_path to 'public' as $$
  select case
    when p_lufs is null then 'reject'
    when coalesce(p_block_on_clipping, true) and coalesce(p_clipping, false) then 'reject'
    when p_tp is not null and p_tp > 0.3 then 'reject'
    when p_lufs between -14 and -9 and (p_tp is null or p_tp <= 0.0) then 'pass'
    else 'warning'
  end;
$$;
grant execute on function public.compute_quality_grade(numeric, numeric, boolean, boolean) to anon, authenticated;

-- 4) config 관리자 패치 — true_peak_reject_max 지원.
create or replace function public.admin_update_audio_quality_config(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.audio_quality_config set
    enabled = coalesce((p_patch->>'enabled')::boolean, enabled),
    lufs_min = coalesce((p_patch->>'lufs_min')::numeric, lufs_min),
    lufs_max = coalesce((p_patch->>'lufs_max')::numeric, lufs_max),
    true_peak_max = coalesce((p_patch->>'true_peak_max')::numeric, true_peak_max),
    true_peak_reject_max = coalesce((p_patch->>'true_peak_reject_max')::numeric, true_peak_reject_max),
    block_on_clipping = coalesce((p_patch->>'block_on_clipping')::boolean, block_on_clipping),
    updated_at=now(), updated_by=v_uid where id=1;
  return public.get_audio_quality_config();
end; $$;
grant execute on function public.admin_update_audio_quality_config(jsonb) to authenticated;

-- 5) record_audio_quality — quality_grade 저장 + p_passed 계산 보정. 시그니처 기존 13파라미터 유지.
-- p_passed 가 null/false 인 경우라도 grade 가 'pass'/'warning' 이면 passed=true (warning 통과 허용).
create or replace function public.record_audio_quality(
  p_track_id uuid, p_upload_session_id text, p_original_filename text,
  p_integrated_lufs numeric, p_true_peak numeric, p_loudness_range numeric, p_clipping boolean,
  p_sample_rate int, p_channels int, p_bitrate_kbps int,
  p_passed boolean, p_failure_reason text, p_analyzer_version text default 'ebur128-js-v1'
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_grade text; v_block boolean;
begin
  select block_on_clipping into v_block from public.audio_quality_config where id=1;
  v_grade := public.compute_quality_grade(p_integrated_lufs, p_true_peak, coalesce(p_clipping,false), coalesce(v_block,true));
  insert into public.track_audio_quality(track_id, upload_session_id, user_id, original_filename,
    integrated_lufs, true_peak, loudness_range, clipping_detected, sample_rate, channels, bitrate_kbps,
    passed_quality_check, failure_reason, analyzer_version, quality_grade)
  values (p_track_id, nullif(btrim(coalesce(p_upload_session_id,'')),''), v_uid, p_original_filename,
    p_integrated_lufs, p_true_peak, p_loudness_range, coalesce(p_clipping,false), p_sample_rate, p_channels, p_bitrate_kbps,
    -- pass/warning 은 통과(true), reject 만 차단(false). 클라이언트가 보낸 p_passed 보다 서버 판정 우선.
    (v_grade in ('pass','warning')), p_failure_reason, coalesce(p_analyzer_version,'ebur128-js-v1'), v_grade)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'quality_grade', v_grade);
end; $$;
grant execute on function public.record_audio_quality(uuid, text, text, numeric, numeric, numeric, boolean, int, int, int, boolean, text, text) to authenticated;

-- 6) admin_list_audio_quality — quality_grade 노출 + filter 확장 (pass/warning/reject).
create or replace function public.admin_list_audio_quality(p_filter text default 'all', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_block boolean;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select block_on_clipping into v_block from public.audio_quality_config where id=1;
  select coalesce(jsonb_agg(row_to_json(x) order by x.analyzed_at desc),'[]'::jsonb) into v from (
    select q.id, q.track_id, q.original_filename, q.integrated_lufs, q.true_peak, q.loudness_range,
           q.clipping_detected, q.sample_rate, q.channels, q.bitrate_kbps, q.passed_quality_check,
           q.failure_reason, q.analyzed_at, t.title, t.artist,
           coalesce(q.quality_grade, public.compute_quality_grade(q.integrated_lufs, q.true_peak, q.clipping_detected, v_block)) as quality_grade
    from public.track_audio_quality q left join public.tracks t on t.id=q.track_id
    where case p_filter
      when 'failed'   then q.passed_quality_check=false
      when 'reject'   then coalesce(q.quality_grade, public.compute_quality_grade(q.integrated_lufs, q.true_peak, q.clipping_detected, v_block)) = 'reject'
      when 'warning'  then coalesce(q.quality_grade, public.compute_quality_grade(q.integrated_lufs, q.true_peak, q.clipping_detected, v_block)) = 'warning'
      when 'pass'     then coalesce(q.quality_grade, public.compute_quality_grade(q.integrated_lufs, q.true_peak, q.clipping_detected, v_block)) = 'pass'
      when 'clipping' then q.clipping_detected=true
      when 'low_loudness' then q.failure_reason like '%low_loudness%'
      when 'over_compressed' then q.loudness_range is not null and q.loudness_range < 3
      else true end
    limit greatest(1,p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_audio_quality(text, int) to authenticated;
