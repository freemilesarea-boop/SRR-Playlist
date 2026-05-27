-- 0203 — 음원 품질 게이트 경고 티어 + 관리자 override (additive). 검수 기준 일관화/false-reject 감소.
--   hard reject: TP>0(실측 클리핑) / severe clipping / 극단 LUFS / 분석불가 만.
--   warning(통과+플래그): TP −1~0(코덱 오버슈트) / 경미 LUFS / 경미 clipping → 관리자 override 가능.
--   ⚠ 자동 normalization 없음. stream_events/정산/release_status 무관. 신규 게이트 동작은 프론트(PR) 배포 후 적용.

-- 1) config 확장: hard 한계 + clipping 샘플 임계 (기존 lufs_min/max/true_peak_max 는 "권장/경고 밴드"로 재해석)
alter table public.audio_quality_config
  add column if not exists lufs_hard_min numeric default -16,
  add column if not exists lufs_hard_max numeric default -8,
  add column if not exists true_peak_hard_max numeric default 0.0,
  add column if not exists clip_warn_samples int default 8,
  add column if not exists clip_hard_samples int default 50;

-- 2) track_audio_quality: 경고 상태/사유 보관
alter table public.track_audio_quality
  add column if not exists quality_status text,           -- pass | warning | fail | override_approved
  add column if not exists warnings text[],
  add column if not exists overridden_by uuid,
  add column if not exists overridden_at timestamptz;

-- 3) config 패치 RPC 확장(신규 필드 포함)
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
    block_on_clipping = coalesce((p_patch->>'block_on_clipping')::boolean, block_on_clipping),
    lufs_hard_min = coalesce((p_patch->>'lufs_hard_min')::numeric, lufs_hard_min),
    lufs_hard_max = coalesce((p_patch->>'lufs_hard_max')::numeric, lufs_hard_max),
    true_peak_hard_max = coalesce((p_patch->>'true_peak_hard_max')::numeric, true_peak_hard_max),
    clip_warn_samples = coalesce((p_patch->>'clip_warn_samples')::int, clip_warn_samples),
    clip_hard_samples = coalesce((p_patch->>'clip_hard_samples')::int, clip_hard_samples),
    updated_at=now(), updated_by=v_uid where id=1;
  return public.get_audio_quality_config();
end; $$;
grant execute on function public.admin_update_audio_quality_config(jsonb) to authenticated;

-- 4) record v2: 경고 상태/사유 포함 (기존 record_audio_quality 유지)
create or replace function public.record_audio_quality_v2(
  p_track_id uuid, p_upload_session_id text, p_original_filename text,
  p_integrated_lufs numeric, p_true_peak numeric, p_loudness_range numeric, p_clipping boolean,
  p_sample_rate int, p_channels int, p_bitrate_kbps int,
  p_passed boolean, p_failure_reason text, p_analyzer_version text default 'ebur128-js-v1',
  p_quality_status text default null, p_warnings text[] default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  insert into public.track_audio_quality(track_id, upload_session_id, user_id, original_filename,
    integrated_lufs, true_peak, loudness_range, clipping_detected, sample_rate, channels, bitrate_kbps,
    passed_quality_check, failure_reason, analyzer_version, quality_status, warnings)
  values (p_track_id, nullif(btrim(coalesce(p_upload_session_id,'')),''), v_uid, p_original_filename,
    p_integrated_lufs, p_true_peak, p_loudness_range, coalesce(p_clipping,false), p_sample_rate, p_channels, p_bitrate_kbps,
    coalesce(p_passed,false), p_failure_reason, coalesce(p_analyzer_version,'ebur128-js-v1'),
    coalesce(p_quality_status, case when coalesce(p_passed,false) then 'pass' else 'fail' end), p_warnings)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.record_audio_quality_v2(uuid, text, text, numeric, numeric, numeric, boolean, int, int, int, boolean, text, text, text, text[]) to authenticated;

-- 5) 관리자 경고 override (warning 등록곡의 품질 경고 승인). hard reject 곡은 애초에 생성 안 되므로 대상 아님.
create or replace function public.admin_override_quality_warning(p_track_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not public.can_review_tracks() then raise exception 'review admin only'; end if;
  update public.track_audio_quality
    set quality_status='override_approved', overridden_by=v_uid, overridden_at=now()
    where id = (select id from public.track_audio_quality where track_id=p_track_id order by analyzed_at desc limit 1);
  if not found then raise exception 'quality record not found'; end if;
  return jsonb_build_object('ok', true, 'track_id', p_track_id);
end; $$;
grant execute on function public.admin_override_quality_warning(uuid, text) to authenticated;

-- 6) 목록 RPC 확장: quality_status/warnings 반환 + 'warning' 필터
create or replace function public.admin_list_audio_quality(p_filter text default 'all', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.analyzed_at desc),'[]'::jsonb) into v from (
    select q.id, q.track_id, q.original_filename, q.integrated_lufs, q.true_peak, q.loudness_range,
           q.clipping_detected, q.sample_rate, q.channels, q.bitrate_kbps, q.passed_quality_check,
           q.failure_reason, q.analyzed_at, q.quality_status, q.warnings, t.title, t.artist
    from public.track_audio_quality q left join public.tracks t on t.id=q.track_id
    where case p_filter
      when 'failed' then q.passed_quality_check=false
      when 'warning' then q.quality_status='warning'
      when 'clipping' then q.clipping_detected=true
      when 'low_loudness' then q.failure_reason like '%low_loudness%'
      when 'over_compressed' then q.loudness_range is not null and q.loudness_range < 3
      else true end
    limit greatest(1,p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_audio_quality(text, int) to authenticated;
