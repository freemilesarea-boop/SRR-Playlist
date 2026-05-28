-- 0177b/0190/0178/0176 재검수·고위험 함수들의 하드코딩된 LUFS -14..-10 범위를
-- 0210 에서 도입한 compute_quality_grade(lufs, tp, clip) 정책으로 교체.
-- 정책: PASS(녹)/WARNING(황, 업로드 허용)/REJECT(적). 본 PR 의 4개 함수에서:
--   - quality_review_required / needs_re_review 플래그: 측정된 reject 만 발동
--   - high-risk lufs_boundary: 측정된 reject 만 (warning/pass는 노이즈 제거)
--   - admin_rereview_queue problem_summary: 동일 reject 기준
-- 측정 없는(lufs null) 트랙은 어떤 플래그도 새로 만들지 않음(분석 누락은 별도 이슈).
-- additive: CREATE OR REPLACE 만. 데이터 UPDATE 없음. release_status/stream_events/정산 무접근.

-- 1) _rereview_reflag_track : 단일 트랙 재플래그
create or replace function public._rereview_reflag_track(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_decl text[]; v_blocked boolean; v_ms numeric;
        v_lufs numeric; v_tp numeric; v_clip boolean; v_qpass boolean;
        v_status text; v_btags text[]; v_quality_reject boolean;
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

-- 2) admin_finalize_rereview : 전체 재플래그
create or replace function public.admin_finalize_rereview()
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_g jsonb; v_t jsonb; r record; v_flags int := 0; v_decl text[]; v_blocked_declared boolean; v_quality_reject boolean;
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

-- 3) admin_list_high_risk_tracks : lufs_boundary 의미를 "측정된 reject 등급" 으로 재정의 (warning/pass 노이즈 제거).
create or replace function public.admin_list_high_risk_tracks(p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.risk_score desc, x.created_at desc),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, t.release_status, t.created_at,
      coalesce(ap.metadata_trust_score,100) as trust_score, public._metadata_trust_tier(ap.metadata_trust_score) as trust_tier,
      (coalesce(ap.metadata_trust_score,100) < 50) as low_trust,
      exists(select 1 from public.track_guardrail_flags f where f.track_id=t.id and f.severity='hard_block') as guardrail_hard,
      coalesce(m.mismatch_score,0) >= 0.5 as ai_mismatch_high,
      coalesce(r.disagreement_score,0) >= 50 as embedding_disagree_high,
      -- 0211: lufs_boundary 재정의 = 측정된 grade='reject' 만 (warning/pass 노이즈 제거)
      (q.integrated_lufs is not null
        and public.compute_quality_grade(q.integrated_lufs, q.true_peak, q.clipping_detected) = 'reject') as lufs_boundary,
      (select count(distinct f.store_key) from public.track_guardrail_flags f where f.track_id=t.id and f.severity='hard_block') as hard_stores,
      m.mismatch_score, ap.artist_name as owner_name, t.owner_user_id,
      ( (case when coalesce(ap.metadata_trust_score,100) < 50 then 40 else 0 end)
      + (case when exists(select 1 from public.track_guardrail_flags f where f.track_id=t.id and f.severity='hard_block') then 30 else 0 end)
      + (case when coalesce(m.mismatch_score,0) >= 0.5 then 20 else 0 end)
      + (case when coalesce(r.disagreement_score,0) >= 50 then 15 else 0 end)
      + (case when (q.integrated_lufs is not null
                    and public.compute_quality_grade(q.integrated_lufs, q.true_peak, q.clipping_detected) = 'reject') then 10 else 0 end)
      ) as risk_score
    from public.tracks t
    left join public.artist_profiles ap on ap.user_id=t.owner_user_id
    left join public.track_ai_metadata m on m.track_id=t.id
    left join public.track_embedding_reviews r on r.track_id=t.id
    left join lateral (
      select integrated_lufs, true_peak, clipping_detected
      from public.track_audio_quality qq where qq.track_id=t.id order by analyzed_at desc limit 1
    ) q on true
    where t.source_type='artist_upload' and t.removed_at is null
      and t.release_status in ('submitted','review_pending','changes_requested','released','approved','scheduled')
  ) x
  where x.low_trust or x.guardrail_hard or x.ai_mismatch_high or x.embedding_disagree_high or x.lufs_boundary
  limit greatest(1, p_limit);
  return v;
end; $function$;

-- 4) admin_rereview_queue : problem_summary 의 LUFS 분기를 신규 grade='reject' 기준으로.
create or replace function public.admin_rereview_queue(p_filter text default 'needs_re_review'::text, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then raise exception 'admin only'; end if;
  with tgt as (
    select t.id as track_id, t.title, t.artist, t.release_status, t.audio_url, t.duration,
      t.genre_tags, t.mood_tags, t.situation_tags, t.business_type_tags, t.main_genre, t.owner_user_id,
      m.ai_genres, m.ai_moods, m.ai_situations, m.ai_energy_level, m.mismatch_score, m.mismatch_reasons,
      m.explanation as ai_explanation,
      q.integrated_lufs as lufs, q.true_peak as tp, q.clipping_detected as clip, q.passed_quality_check as qpass,
      coalesce(ap.metadata_trust_score, 100)::numeric as trust_score, ap.artist_name as owner_name,
      ds.declared_stores, bs.blocked_stores, fl.open_flags, fl.disposition, fl.needs_fix
    from public.tracks t
    left join public.track_ai_metadata m on m.track_id = t.id
    left join lateral (
      select integrated_lufs, true_peak, clipping_detected, passed_quality_check
      from public.track_audio_quality q2
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
       where s = any(coalesce(tgt.declared_stores, '{}'))) as blocked_declared_stores,
      (tgt.lufs is not null and public.compute_quality_grade(tgt.lufs, tgt.tp, tgt.clip) = 'reject') as quality_reject
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
        when e.quality_reject then
          format('품질 REJECT (LUFS %s / TP %s)', coalesce(round(e.lufs, 1)::text, '?'), coalesce(e.tp::text, '?'))
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
end; $function$;
