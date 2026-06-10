-- 0334 — '마스터링 필요(음압 부적격)' 재검수 플래그 분리 (Option B).
--
-- 배경: 0210 에서 품질 게이트를 2단계(pass/reject) → 3단계(pass/warning/reject)로 완화하면서,
--       음압 미달(LUFS 범위 밖)이 reject → warning 으로 바뀌어 "마스터링 안 된 음원"이 업로드/유통됨.
-- 정책(Option B): 업로드는 그대로 허용(차단 안 함)하되, 음압이 PASS 밴드를 벗어난 warning 곡을
--       'mastering_required' 재검수 플래그로 분리해 관리자 검수 큐에서 잡는다. (자동 비공개·삭제 없음)
--
-- 판정: latest track_audio_quality 가 grade='warning' 이고 LUFS 가 PASS 밴드(-14..-9) 밖.
--       (reject 는 기존 quality_review_required 가 담당. 순수 true_peak warning 은 제외 — 음압 기준이므로.)
-- additive: 컬럼/제약/함수만. release_status·stream_events·정산 무접근. 트랙 데이터 UPDATE 없음.

-- 1) flag_type CHECK 확장 — 'mastering_required' 추가.
alter table public.track_rereview_flags drop constraint if exists track_rereview_flags_flag_type_check;
alter table public.track_rereview_flags add constraint track_rereview_flags_flag_type_check
  check (flag_type in ('needs_re_review','high_risk','quality_review_required','guardrail_hard',
                       'metadata_cleanup_required','mastering_required'));

-- 2) 판정 헬퍼 — warning 등급 & LUFS 밴드 밖(음압 부적격) 이면 true.
create or replace function public.compute_mastering_required(
  p_lufs numeric, p_tp numeric, p_clip boolean
) returns boolean language sql immutable
set search_path to 'public' as $$
  select p_lufs is not null
     and public.compute_quality_grade(p_lufs, p_tp, coalesce(p_clip, false)) = 'warning'
     and (p_lufs < -14 or p_lufs > -9);
$$;
grant execute on function public.compute_mastering_required(numeric, numeric, boolean) to anon, authenticated;

-- 3) 단일 트랙 mastering_required 플래그 동기화 (upsert / 해소).
create or replace function public._sync_mastering_flag(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_lufs numeric; v_tp numeric; v_clip boolean; v_need boolean;
begin
  if p_track_id is null then return; end if;
  select integrated_lufs, true_peak, clipping_detected
    into v_lufs, v_tp, v_clip
    from public.track_audio_quality where track_id = p_track_id order by analyzed_at desc limit 1;
  v_need := public.compute_mastering_required(v_lufs, v_tp, v_clip);
  if v_need then
    insert into public.track_rereview_flags(track_id, flag_type, reason, status)
    values (p_track_id, 'mastering_required',
            format('음압 부적격 — 마스터링 권장 (LUFS %s, 권장 -14..-9)', coalesce(v_lufs::text, '?')), 'open')
    on conflict (track_id, flag_type)
      do update set reason = excluded.reason,
                    status = case when public.track_rereview_flags.status in ('resolved','dismissed')
                                  then 'open' else public.track_rereview_flags.status end,
                    resolved_by = null, resolved_at = null;
  else
    -- 더 이상 음압 부적격 아님(재업로드로 통과 등) → 열린 플래그 자동 해소.
    update public.track_rereview_flags
      set status = 'resolved', resolved_at = now()
      where track_id = p_track_id and flag_type = 'mastering_required' and status in ('open','needs_fix');
  end if;
end; $$;
grant execute on function public._sync_mastering_flag(uuid) to authenticated;

-- 4) record_audio_quality — 0210 본문 유지 + 측정 직후 mastering_required 동기화.
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
  -- 0334: 음압 부적격(warning, LUFS 밴드 밖) 곡을 마스터링 필요 검수 큐로 분리.
  if p_track_id is not null then
    perform public._sync_mastering_flag(p_track_id);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'quality_grade', v_grade);
end; $$;
grant execute on function public.record_audio_quality(uuid, text, text, numeric, numeric, numeric, boolean, int, int, int, boolean, text, text) to authenticated;

-- 5) _rereview_reflag_track (0211) — mastering_required 브랜치 추가.
--    (이 함수는 open 플래그를 전부 지우고 재삽입하므로, mastering 도 여기서 함께 재계산해야 유실 안 됨.)
create or replace function public._rereview_reflag_track(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_decl text[]; v_blocked boolean; v_ms numeric;
        v_lufs numeric; v_tp numeric; v_clip boolean; v_qpass boolean;
        v_status text; v_btags text[]; v_quality_reject boolean; v_mastering boolean;
begin
  select release_status, business_type_tags into v_status, v_btags from public.tracks where id = p_track_id;
  select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl
    from unnest(coalesce(v_btags, '{}')) tag;
  v_blocked := exists (
    select 1 from public.track_guardrail_flags f
    where f.track_id = p_track_id and f.severity = 'hard_block' and f.store_key = any(coalesce(v_decl, '{}')));
  select coalesce(mismatch_score, 0) into v_ms from public.track_ai_metadata where track_id = p_track_id;
  v_ms := coalesce(v_ms, 0);
  select integrated_lufs, true_peak, clipping_detected, passed_quality_check
    into v_lufs, v_tp, v_clip, v_qpass
    from public.track_audio_quality where track_id = p_track_id order by analyzed_at desc limit 1;
  v_quality_reject := (v_lufs is not null and public.compute_quality_grade(v_lufs, v_tp, v_clip) = 'reject');
  v_mastering := public.compute_mastering_required(v_lufs, v_tp, v_clip);

  delete from public.track_rereview_flags where track_id = p_track_id and status = 'open';
  if v_blocked then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'guardrail_hard', '등록한 매장에서 금지규칙 hard_block')
    on conflict (track_id, flag_type) do nothing;
  end if;
  if v_quality_reject then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'quality_review_required',
            format('품질 REJECT (LUFS %s / TP %s)', coalesce(v_lufs::text,'?'), coalesce(v_tp::text,'?')))
    on conflict (track_id, flag_type) do nothing;
  end if;
  if v_mastering then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'mastering_required',
            format('음압 부적격 — 마스터링 권장 (LUFS %s, 권장 -14..-9)', coalesce(v_lufs::text,'?')))
    on conflict (track_id, flag_type) do nothing;
  end if;
  if v_blocked or v_ms >= 0.5 then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'high_risk', format('mismatch %s / 등록매장차단 %s', round(v_ms, 2), v_blocked))
    on conflict (track_id, flag_type) do nothing;
  end if;
  if v_status = 'released' and (v_blocked or v_quality_reject) then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'needs_re_review', '공개곡 — 등록매장 충돌/품질 재검수 필요(자동 비공개 안 함)')
    on conflict (track_id, flag_type) do nothing;
  end if;
end; $function$;

-- 6) admin_finalize_rereview (0211) — 루프에 mastering_required 재삽입 추가.
create or replace function public.admin_finalize_rereview()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_g jsonb; v_t jsonb; r record; v_flags int := 0; v_decl text[];
        v_blocked_declared boolean; v_quality_reject boolean; v_mastering boolean;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  v_g := public.admin_recompute_guardrail_flags();
  v_t := public.admin_recompute_metadata_trust();
  delete from public.track_rereview_flags where status='open' and flag_type <> 'metadata_cleanup_required';
  for r in
    select t.id, t.release_status, t.business_type_tags,
      coalesce((select mismatch_score from public.track_ai_metadata m where m.track_id=t.id),0) as ms,
      q.integrated_lufs as lufs, q.true_peak as tp, q.clipping_detected as clip, q.passed_quality_check as qpass
    from public.tracks t
    left join lateral (
      select integrated_lufs, true_peak, clipping_detected, passed_quality_check
      from public.track_audio_quality q where q.track_id=t.id order by analyzed_at desc limit 1
    ) q on true
    where t.source_type='artist_upload' and t.removed_at is null
      and t.release_status in ('released','approved','submitted','review_pending','scheduled')
  loop
    select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl from unnest(coalesce(r.business_type_tags,'{}')) tag;
    v_blocked_declared := exists (select 1 from public.track_guardrail_flags f
      where f.track_id=r.id and f.severity='hard_block' and f.store_key = any(coalesce(v_decl,'{}')));
    v_quality_reject := (r.lufs is not null and public.compute_quality_grade(r.lufs, r.tp, r.clip) = 'reject');
    v_mastering := public.compute_mastering_required(r.lufs, r.tp, r.clip);
    if v_blocked_declared then
      insert into public.track_rereview_flags(track_id, flag_type, reason)
      values (r.id,'guardrail_hard','등록한 매장에서 금지규칙 hard_block')
      on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
    if v_quality_reject then
      insert into public.track_rereview_flags(track_id, flag_type, reason)
      values (r.id,'quality_review_required',
              format('품질 REJECT (LUFS %s / TP %s)', coalesce(r.lufs::text,'?'), coalesce(r.tp::text,'?')))
      on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
    if v_mastering then
      insert into public.track_rereview_flags(track_id, flag_type, reason)
      values (r.id,'mastering_required',
              format('음압 부적격 — 마스터링 권장 (LUFS %s, 권장 -14..-9)', coalesce(r.lufs::text,'?')))
      on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
    if v_blocked_declared or r.ms >= 0.5 then
      insert into public.track_rereview_flags(track_id, flag_type, reason)
      values (r.id,'high_risk', format('mismatch %s / 등록매장차단 %s', round(r.ms,2), v_blocked_declared))
      on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
    if r.release_status='released' and (v_blocked_declared or v_quality_reject) then
      insert into public.track_rereview_flags(track_id, flag_type, reason)
      values (r.id,'needs_re_review','공개곡 — 등록매장 충돌/품질 재검수 필요(자동 비공개 안 함)')
      on conflict (track_id, flag_type) do nothing; v_flags := v_flags + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'guardrail', v_g, 'trust', v_t, 'flags_upserted', v_flags);
end; $function$;

-- 7) admin_rereview_summary (0178) — mastering_required 카운트 추가.
create or replace function public.admin_rereview_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'total_target', (select count(*) from public.tracks t where t.source_type='artist_upload' and t.removed_at is null and t.release_status in ('released','approved','submitted','review_pending','scheduled')),
    'features_done', (select count(*) from public.track_audio_features f join public.tracks t on t.id=f.track_id where f.status='done' and t.removed_at is null),
    'features_missing', (select count(*) from public.tracks t where t.source_type='artist_upload' and t.removed_at is null and t.release_status in ('released','approved','submitted','review_pending','scheduled') and not exists (select 1 from public.track_audio_features f where f.track_id=t.id and f.status='done')),
    'features_failed', (select count(*) from public.track_audio_features where status='failed'),
    'quality_review_required', (select count(*) from public.track_rereview_flags where flag_type='quality_review_required' and status='open'),
    'mastering_required', (select count(*) from public.track_rereview_flags where flag_type='mastering_required' and status='open'),
    'guardrail_hard_tracks', (select count(distinct track_id) from public.track_guardrail_flags where severity='hard_block'),
    'mismatch_high', (select count(*) from public.track_ai_metadata where coalesce(mismatch_score,0) >= 0.5),
    'high_risk_flags', (select count(*) from public.track_rereview_flags where flag_type='high_risk' and status='open'),
    'needs_re_review', (select count(*) from public.track_rereview_flags where flag_type='needs_re_review' and status='open'),
    'low_trust_uploaders', (select count(*) from public.artist_profiles where coalesce(metadata_trust_score,100) < 50),
    'fix_requested', (select count(distinct track_id) from public.track_rereview_flags where status='needs_fix'),
    'resolved_total', (select count(distinct track_id) from public.track_rereview_flags where status in ('resolved','dismissed')));
end; $$;
grant execute on function public.admin_rereview_summary() to authenticated;

-- 8) 기존 곡 백필 — 현재 음압 부적격(warning, LUFS 밴드 밖) 활성 곡에 플래그 생성.
insert into public.track_rereview_flags(track_id, flag_type, reason, status)
select t.id, 'mastering_required',
       format('음압 부적격 — 마스터링 권장 (LUFS %s, 권장 -14..-9)', coalesce(q.integrated_lufs::text, '?')), 'open'
from public.tracks t
join lateral (
  select integrated_lufs, true_peak, clipping_detected
  from public.track_audio_quality q2 where q2.track_id = t.id order by analyzed_at desc limit 1
) q on true
where t.source_type = 'artist_upload' and t.removed_at is null
  and t.release_status in ('released','approved','submitted','review_pending','scheduled')
  and public.compute_mastering_required(q.integrated_lufs, q.true_peak, q.clipping_detected)
on conflict (track_id, flag_type) do nothing;
