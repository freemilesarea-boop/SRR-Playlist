-- 0178 — 전체 재검수 대상 빠른 처리 UX (검수 보조 전용). additive·idempotent.
-- 절대 자동 비공개/삭제 없음. release_status / playlist_tracks / stream_events / 정산 / 차트 미접근.
-- 본 마이그레이션은 (1) 재검수 큐 enriched 조회, (2) 곡 상세 비교, (3) 개별/일괄 빠른 액션 RPC 만 추가.

-- 플래그 처리 상태 확장: needs_fix(수정요청 대기) 추가 + disposition/admin_note 기록
alter table public.track_rereview_flags drop constraint if exists track_rereview_flags_status_check;
alter table public.track_rereview_flags add constraint track_rereview_flags_status_check
  check (status in ('open','resolved','dismissed','needs_fix'));
alter table public.track_rereview_flags add column if not exists disposition text;
alter table public.track_rereview_flags add column if not exists admin_note text;

create or replace function public._store_label(p_key text)
returns text language sql stable set search_path to 'public' as $$
  select coalesce((select store_label from public.ai_store_profiles where store_key = p_key), p_key);
$$;

-- 단일 곡 자동 플래그 재계산(등록매장 충돌 기준) — finalize 로직의 1곡 버전. open 자동플래그만 rebuild.
create or replace function public._rereview_reflag_track(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_decl text[]; v_blocked boolean; v_ms numeric; v_lufs numeric; v_qpass boolean; v_status text; v_btags text[];
begin
  select release_status, business_type_tags into v_status, v_btags from public.tracks where id = p_track_id;
  select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl
    from unnest(coalesce(v_btags, '{}')) tag;
  v_blocked := exists (
    select 1 from public.track_guardrail_flags f
    where f.track_id = p_track_id and f.severity = 'hard_block' and f.store_key = any(coalesce(v_decl, '{}')));
  select coalesce(mismatch_score, 0) into v_ms from public.track_ai_metadata where track_id = p_track_id;
  v_ms := coalesce(v_ms, 0);
  select integrated_lufs, passed_quality_check into v_lufs, v_qpass
    from public.track_audio_quality where track_id = p_track_id order by analyzed_at desc limit 1;

  delete from public.track_rereview_flags where track_id = p_track_id and status = 'open';
  if v_blocked then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'guardrail_hard', '등록한 매장에서 금지규칙 hard_block')
    on conflict (track_id, flag_type) do nothing;
  end if;
  if (v_qpass is false) or (v_lufs is not null and (v_lufs < -14 or v_lufs > -10)) then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'quality_review_required', format('LUFS %s / 품질검사', v_lufs))
    on conflict (track_id, flag_type) do nothing;
  end if;
  if v_blocked or v_ms >= 0.5 then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'high_risk', format('mismatch %s / 등록매장차단 %s', round(v_ms, 2), v_blocked))
    on conflict (track_id, flag_type) do nothing;
  end if;
  if v_status = 'released' and (v_blocked or v_qpass is false) then
    insert into public.track_rereview_flags(track_id, flag_type, reason)
    values (p_track_id, 'needs_re_review', '공개곡 — 등록매장 충돌/품질 재검수 필요(자동 비공개 안 함)')
    on conflict (track_id, flag_type) do nothing;
  end if;
end; $$;

-- enriched 재검수 큐: 등록 메타 vs AI 메타, 선언/차단 매장, 한줄 요약, 처리상태
create or replace function public.admin_rereview_queue(p_filter text default 'needs_re_review', p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then raise exception 'admin only'; end if;
  with tgt as (
    select t.id as track_id, t.title, t.artist, t.release_status, t.audio_url, t.duration,
      t.genre_tags, t.mood_tags, t.situation_tags, t.business_type_tags, t.main_genre, t.owner_user_id,
      m.ai_genres, m.ai_moods, m.ai_situations, m.ai_energy_level, m.mismatch_score, m.mismatch_reasons,
      m.explanation as ai_explanation,
      q.integrated_lufs as lufs, q.passed_quality_check as qpass,
      coalesce(ap.metadata_trust_score, 100)::numeric as trust_score, ap.artist_name as owner_name,
      ds.declared_stores, bs.blocked_stores, fl.open_flags, fl.disposition, fl.needs_fix
    from public.tracks t
    left join public.track_ai_metadata m on m.track_id = t.id
    left join lateral (
      select integrated_lufs, passed_quality_check from public.track_audio_quality q2
      where q2.track_id = t.id order by analyzed_at desc limit 1) q on true
    left join public.artist_profiles ap on ap.user_id = t.owner_user_id
    left join lateral (
      select array_remove(array_agg(distinct public._ai_tag_to_store_key(tag)), null) as declared_stores
      from unnest(coalesce(t.business_type_tags, '{}')) tag) ds on true
    left join lateral (
      select array_agg(distinct f.store_key) as blocked_stores
      from public.track_guardrail_flags f where f.track_id = t.id and f.severity = 'hard_block') bs on true
    left join lateral (
      select array_agg(distinct rf.flag_type) filter (where rf.status = 'open') as open_flags,
        (array_agg(rf.disposition order by rf.resolved_at desc nulls last)
          filter (where rf.disposition is not null))[1] as disposition,
        bool_or(rf.status = 'needs_fix') as needs_fix
      from public.track_rereview_flags rf where rf.track_id = t.id) fl on true
    where t.source_type = 'artist_upload' and t.removed_at is null
      and t.release_status in ('released','approved','submitted','review_pending','scheduled')
  ), enriched as (
    select tgt.*,
      (select array_agg(distinct s) from unnest(coalesce(tgt.blocked_stores, '{}')) s
       where s = any(coalesce(tgt.declared_stores, '{}'))) as blocked_declared_stores
    from tgt
  )
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v from (
    select e.track_id, e.title, e.artist, e.release_status, e.audio_url, e.duration,
      e.genre_tags as declared_genres, e.mood_tags as declared_moods, e.situation_tags as declared_situations,
      e.business_type_tags as declared_store_tags, e.declared_stores,
      e.ai_genres, e.ai_moods, e.ai_situations, e.ai_energy_level,
      e.mismatch_score, e.mismatch_reasons, e.ai_explanation,
      e.blocked_stores, e.blocked_declared_stores, e.lufs, e.qpass,
      e.trust_score, e.owner_name, e.owner_user_id, e.open_flags, e.disposition, e.needs_fix,
      case
        when e.blocked_declared_stores is not null and array_length(e.blocked_declared_stores, 1) > 0 then
          format('등록 장르 %s · AI 분석 %s → %s 부적합 (%s)',
            coalesce((e.genre_tags)[1], e.main_genre, '미상'),
            coalesce((e.ai_genres)[1], '?'),
            (select string_agg(public._store_label(s), ', ') from unnest(e.blocked_declared_stores) s),
            coalesce((select (f.violated_rules)[1] from public.track_guardrail_flags f
                      where f.track_id = e.track_id and f.severity = 'hard_block'
                        and f.store_key = any(e.blocked_declared_stores) limit 1), 'hard_block'))
        when coalesce(e.mismatch_score, 0) >= 0.5 then
          format('등록 메타와 AI 분석 불일치 (mismatch %s)%s', round(e.mismatch_score, 2),
            case when e.mismatch_reasons is not null and array_length(e.mismatch_reasons, 1) > 0
                 then ' — ' || (e.mismatch_reasons)[1] else '' end)
        when e.qpass is false or (e.lufs is not null and (e.lufs < -14 or e.lufs > -10)) then
          format('음량/품질 기준 벗어남 (LUFS %s)', coalesce(round(e.lufs, 1)::text, '?'))
        when e.trust_score < 50 then format('저신뢰 업로더 (trust %s)', e.trust_score)
        else '재검수 확인 필요'
      end as problem_summary
    from enriched e
    where case
      when p_filter = 'all' then (e.open_flags is not null and array_length(e.open_flags, 1) > 0)
      when p_filter = 'mismatch_high' then coalesce(e.mismatch_score, 0) >= 0.5
      when p_filter = 'low_trust' then e.trust_score < 50
      when p_filter like 'store:%' then substring(p_filter from 7) = any(coalesce(e.blocked_declared_stores, '{}'))
      else p_filter = any(coalesce(e.open_flags, '{}'))
    end
    order by coalesce(e.mismatch_score, 0) desc, e.trust_score asc, e.track_id
    limit greatest(1, p_limit)) x;
  return v;
end; $$;
grant execute on function public.admin_rereview_queue(text, int) to authenticated;

-- 곡 상세: 매장별 guardrail breakdown 포함(선언 여부 표시)
create or replace function public.admin_rereview_track_detail(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_decl text[];
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then raise exception 'admin only'; end if;
  select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl
    from unnest(coalesce((select business_type_tags from public.tracks where id = p_track_id), '{}')) tag;
  select jsonb_build_object(
    'track_id', t.id, 'title', t.title, 'artist', t.artist, 'release_status', t.release_status,
    'audio_url', t.audio_url, 'duration', t.duration,
    'declared_genres', t.genre_tags, 'declared_moods', t.mood_tags, 'declared_situations', t.situation_tags,
    'declared_store_tags', t.business_type_tags, 'declared_stores', v_decl,
    'ai_genres', m.ai_genres, 'ai_moods', m.ai_moods, 'ai_situations', m.ai_situations,
    'ai_energy_level', m.ai_energy_level, 'ai_vocal_type', m.ai_vocal_type,
    'mismatch_score', m.mismatch_score, 'mismatch_reasons', m.mismatch_reasons, 'ai_explanation', m.explanation,
    'ai_exclusions', m.ai_exclusions,
    'lufs', (select integrated_lufs from public.track_audio_quality q where q.track_id = t.id order by analyzed_at desc limit 1),
    'qpass', (select passed_quality_check from public.track_audio_quality q where q.track_id = t.id order by analyzed_at desc limit 1),
    'guardrails', (select coalesce(jsonb_agg(jsonb_build_object(
        'store_key', f.store_key, 'store_label', public._store_label(f.store_key),
        'severity', f.severity, 'rules', f.violated_rules,
        'is_declared', f.store_key = any(coalesce(v_decl, '{}')))
        order by (f.store_key = any(coalesce(v_decl, '{}'))) desc, f.severity), '[]'::jsonb)
      from public.track_guardrail_flags f where f.track_id = t.id),
    'open_flags', (select array_agg(distinct flag_type) filter (where status = 'open') from public.track_rereview_flags where track_id = t.id)
  ) into v
  from public.tracks t left join public.track_ai_metadata m on m.track_id = t.id
  where t.id = p_track_id;
  return v;
end; $$;
grant execute on function public.admin_rereview_track_detail(uuid) to authenticated;

-- 개별/일괄 빠른 액션. 자동 비공개/삭제 없음 — 메타/태그/플래그 처리만.
create or replace function public.admin_rereview_action(
  p_track_ids uuid[], p_action text, p_store_key text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_n int := 0; v_aig text[]; v_aim text[];
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then raise exception 'admin only'; end if;
  if p_track_ids is null or array_length(p_track_ids, 1) is null then
    return jsonb_build_object('ok', true, 'affected', 0, 'action', p_action);
  end if;
  foreach v_id in array p_track_ids loop
    if p_action = 'apply_ai_meta' then
      select ai_genres, ai_moods into v_aig, v_aim from public.track_ai_metadata where track_id = v_id;
      update public.tracks set
        genre_tags = coalesce(v_aig, genre_tags), mood_tags = coalesce(v_aim, mood_tags),
        main_genre = coalesce((v_aig)[1], main_genre), mood = coalesce((v_aim)[1], mood)
      where id = v_id;
      perform public.recompute_track_ai_metadata(v_id);
      update public.track_ai_metadata set status = 'reviewed', reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
      where track_id = v_id;
      perform public._rereview_reflag_track(v_id);
      update public.track_rereview_flags set disposition = 'meta_applied' where track_id = v_id and status = 'open';
      v_n := v_n + 1;
    elsif p_action = 'remove_declared_store' then
      if p_store_key is null then continue; end if;
      update public.tracks set business_type_tags = (
        select array_remove(array_agg(tag), null) from unnest(coalesce(business_type_tags, '{}')) tag
        where public._ai_tag_to_store_key(tag) is distinct from p_store_key)
      where id = v_id;
      perform public._rereview_reflag_track(v_id);
      v_n := v_n + 1;
    elsif p_action = 'exclude_store' then
      if p_store_key is null then continue; end if;
      update public.track_ai_metadata set
        ai_exclusions = (select array_agg(distinct x) from unnest(coalesce(ai_exclusions, '{}') || array[p_store_key]) x),
        updated_at = now()
      where track_id = v_id;
      update public.tracks set business_type_tags = (
        select array_remove(array_agg(tag), null) from unnest(coalesce(business_type_tags, '{}')) tag
        where public._ai_tag_to_store_key(tag) is distinct from p_store_key)
      where id = v_id;
      perform public._rereview_reflag_track(v_id);
      v_n := v_n + 1;
    elsif p_action = 'no_problem' then
      update public.track_rereview_flags set status = 'resolved', disposition = 'no_problem',
        resolved_by = v_uid, resolved_at = now(), admin_note = coalesce(nullif(btrim(p_note), ''), admin_note)
      where track_id = v_id and status in ('open', 'needs_fix');
      v_n := v_n + 1;
    elsif p_action = 'request_fix' then
      update public.track_rereview_flags set status = 'needs_fix', disposition = 'fix_requested',
        resolved_by = v_uid, resolved_at = now(), admin_note = coalesce(nullif(btrim(p_note), ''), admin_note)
      where track_id = v_id and status = 'open';
      v_n := v_n + 1;
    else
      raise exception 'unknown action %', p_action;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'affected', v_n, 'action', p_action);
end; $$;
grant execute on function public.admin_rereview_action(uuid[], text, text, text) to authenticated;

-- summary 확장: 수정요청 대기 / 처리완료 카운트
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
    'guardrail_hard_tracks', (select count(distinct track_id) from public.track_guardrail_flags where severity='hard_block'),
    'mismatch_high', (select count(*) from public.track_ai_metadata where coalesce(mismatch_score,0) >= 0.5),
    'high_risk_flags', (select count(*) from public.track_rereview_flags where flag_type='high_risk' and status='open'),
    'needs_re_review', (select count(*) from public.track_rereview_flags where flag_type='needs_re_review' and status='open'),
    'low_trust_uploaders', (select count(*) from public.artist_profiles where coalesce(metadata_trust_score,100) < 50),
    'fix_requested', (select count(distinct track_id) from public.track_rereview_flags where status='needs_fix'),
    'resolved_total', (select count(distinct track_id) from public.track_rereview_flags where status in ('resolved','dismissed')));
end; $$;
grant execute on function public.admin_rereview_summary() to authenticated;
