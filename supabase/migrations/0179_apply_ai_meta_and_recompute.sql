-- 0179 — AI 메타 적용 후 자동 재배치/재평가(self-healing) 파이프라인. additive·idempotent.
-- 절대 자동 비공개/삭제 없음. release_status / playlist_tracks / stream_events / 정산 / 차트 미접근.
-- 메타 적용 → ai_metadata 재계산 → fit_score 재계산 → guardrail 재검사 → reflag → 추천후보 갱신 → before/after diff 반환.

-- 단일 곡 guardrail 재계산(전역 admin_recompute_guardrail_flags 의 1곡 버전). idempotent upsert.
create or replace function public._rereview_recompute_track_guardrails(p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare sk record; gr jsonb; v_owner uuid;
begin
  select owner_user_id into v_owner from public.tracks where id = p_track_id;
  delete from public.track_guardrail_flags where track_id = p_track_id;
  for sk in select distinct store_key from public.store_guardrails where enabled loop
    gr := public._ai_check_store_guardrails(p_track_id, sk.store_key);
    if (gr->'violations') <> '[]'::jsonb then
      insert into public.track_guardrail_flags(track_id, owner_user_id, store_key, severity, violated_rules)
      values (p_track_id, v_owner, sk.store_key, gr->>'severity',
        (select array_agg(e->>'rule_key') from jsonb_array_elements(gr->'violations') e))
      on conflict (track_id, store_key) do update set severity = excluded.severity, violated_rules = excluded.violated_rules, created_at = now();
    end if;
  end loop;
end; $$;

-- 곡의 매장별 fit 스냅샷 {store_key: avg_fit} — recommendable 플레이리스트를 store_key 로 집계
create or replace function public._rereview_store_fit_snapshot(p_track_id uuid)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select coalesce(jsonb_object_agg(sk, fit), '{}'::jsonb) from (
    select coalesce(nullif(btrim(p.ai_store_key), ''), public._ai_playlist_store_key(p.business_category, p.category, p.daypart)) as sk,
           round(avg(f.fit_score)) as fit
    from public.playlist_track_fit_scores f
    join public.playlists p on p.id = f.playlist_id
    where f.track_id = p_track_id and coalesce(p.is_recommendable, true)
    group by 1
  ) q where sk is not null;
$$;

-- 메인: AI 메타 적용 + 전체 재계산 파이프라인. before/after diff 반환.
-- options: { auto_resolve: bool=false }
create or replace function public.admin_apply_ai_metadata_and_recompute(p_track_id uuid, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_uid uuid := auth.uid();
  v_auto_resolve boolean := coalesce((p_options->>'auto_resolve')::boolean, false);
  v_aig text[]; v_aim text[]; v_decl text[];
  v_fit_before jsonb; v_fit_after jsonb;
  v_blocked_before text[]; v_blocked_after text[];
  v_conflict_before text[]; v_conflict_after text[];
  v_flags_before text[]; v_flags_after text[]; v_removed text[];
  v_mismatch_before numeric; v_mismatch_after numeric;
  v_risk_before text; v_risk_after text;
  v_unblocked text[]; v_newblocked text[]; v_removed_conflicts text[]; v_remaining_conflicts text[];
  v_fit_diff jsonb; v_top_gains jsonb; v_keys text[];
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then raise exception 'admin only'; end if;

  -- 선언 매장
  select array_remove(array_agg(public._ai_tag_to_store_key(tag)), null) into v_decl
    from unnest(coalesce((select business_type_tags from public.tracks where id = p_track_id), '{}')) tag;

  -- ===== BEFORE 스냅샷 =====
  v_fit_before := public._rereview_store_fit_snapshot(p_track_id);
  select array_agg(distinct store_key) into v_blocked_before from public.track_guardrail_flags where track_id = p_track_id and severity = 'hard_block';
  v_conflict_before := array(select unnest(coalesce(v_blocked_before, '{}')) intersect select unnest(coalesce(v_decl, '{}')));
  select coalesce(mismatch_score, 0) into v_mismatch_before from public.track_ai_metadata where track_id = p_track_id;
  v_mismatch_before := coalesce(v_mismatch_before, 0);
  select array_agg(distinct flag_type) into v_flags_before from public.track_rereview_flags where track_id = p_track_id and status = 'open';
  v_risk_before := case when 'high_risk' = any(coalesce(v_flags_before, '{}')) then 'high'
                        when 'needs_re_review' = any(coalesce(v_flags_before, '{}')) or 'guardrail_hard' = any(coalesce(v_flags_before, '{}')) then 'medium'
                        else 'low' end;

  -- ===== 1) AI 메타 적용 =====
  select ai_genres, ai_moods into v_aig, v_aim from public.track_ai_metadata where track_id = p_track_id;
  update public.tracks set
    genre_tags = coalesce(v_aig, genre_tags), mood_tags = coalesce(v_aim, mood_tags),
    main_genre = coalesce((v_aig)[1], main_genre), mood = coalesce((v_aim)[1], mood)
  where id = p_track_id;

  -- ===== 2) ai_metadata 재계산 (mismatch / ai_store_fit) =====
  perform public.recompute_track_ai_metadata(p_track_id);
  update public.track_ai_metadata set status = 'reviewed', reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where track_id = p_track_id;

  -- ===== 3) guardrail 재검사 (genre/mood 변경 반영) =====
  perform public._rereview_recompute_track_guardrails(p_track_id);

  -- ===== 4) fit_score 재계산 (추천 후보 캐시 갱신; playlist_tracks 미수정) =====
  perform public.recompute_track_fit_scores(p_track_id);

  -- ===== 5) rereview reflag (high-risk / needs_re_review / quality 재평가) =====
  perform public._rereview_reflag_track(p_track_id);
  update public.track_rereview_flags set disposition = 'meta_applied' where track_id = p_track_id and status = 'open';

  -- ===== AFTER 스냅샷 =====
  v_fit_after := public._rereview_store_fit_snapshot(p_track_id);
  select array_agg(distinct store_key) into v_blocked_after from public.track_guardrail_flags where track_id = p_track_id and severity = 'hard_block';
  v_conflict_after := array(select unnest(coalesce(v_blocked_after, '{}')) intersect select unnest(coalesce(v_decl, '{}')));
  select coalesce(mismatch_score, 0) into v_mismatch_after from public.track_ai_metadata where track_id = p_track_id;
  v_mismatch_after := coalesce(v_mismatch_after, 0);
  select array_agg(distinct flag_type) into v_flags_after from public.track_rereview_flags where track_id = p_track_id and status = 'open';
  v_risk_after := case when 'high_risk' = any(coalesce(v_flags_after, '{}')) then 'high'
                       when 'needs_re_review' = any(coalesce(v_flags_after, '{}')) or 'guardrail_hard' = any(coalesce(v_flags_after, '{}')) then 'medium'
                       else 'low' end;

  -- ===== 변화 계산 =====
  v_unblocked := array(select unnest(coalesce(v_blocked_before, '{}')) except select unnest(coalesce(v_blocked_after, '{}')));
  v_newblocked := array(select unnest(coalesce(v_blocked_after, '{}')) except select unnest(coalesce(v_blocked_before, '{}')));
  v_removed_conflicts := array(select unnest(coalesce(v_conflict_before, '{}')) except select unnest(coalesce(v_conflict_after, '{}')));
  v_remaining_conflicts := v_conflict_after;
  v_removed := array(select unnest(coalesce(v_flags_before, '{}')) except select unnest(coalesce(v_flags_after, '{}')));

  -- ===== 6) PHASE 4 옵션: 충돌/불일치 해소 플래그 자동 resolved 기록(감사용) =====
  if v_auto_resolve and array_length(v_removed, 1) is not null then
    insert into public.track_rereview_flags(track_id, flag_type, status, disposition, reason, resolved_by, resolved_at)
    select p_track_id, ft, 'resolved', 'auto_resolved', 'AI 메타 적용으로 충돌/불일치 해소', v_uid, now()
    from unnest(v_removed) ft
    on conflict (track_id, flag_type) do update set status = 'resolved', disposition = 'auto_resolved', resolved_by = excluded.resolved_by, resolved_at = now();
  end if;

  -- ===== fit diff (store 별 before/after/delta) + top gains =====
  v_keys := array(select jsonb_object_keys(v_fit_before || v_fit_after));
  select coalesce(jsonb_agg(d order by (d->>'delta')::numeric desc), '[]'::jsonb) into v_fit_diff from (
    select jsonb_build_object(
      'store_key', k, 'store_label', public._store_label(k),
      'before', (v_fit_before->>k)::numeric, 'after', (v_fit_after->>k)::numeric,
      'delta', coalesce((v_fit_after->>k)::numeric, 0) - coalesce((v_fit_before->>k)::numeric, 0)) as d
    from unnest(v_keys) k) q;
  select coalesce(jsonb_agg(d order by (d->>'delta')::numeric desc), '[]'::jsonb) into v_top_gains from (
    select jsonb_build_object(
      'store_key', k, 'store_label', public._store_label(k),
      'before', (v_fit_before->>k)::numeric, 'after', (v_fit_after->>k)::numeric,
      'delta', coalesce((v_fit_after->>k)::numeric, 0) - coalesce((v_fit_before->>k)::numeric, 0)) as d
    from unnest(v_keys) k
    where coalesce((v_fit_after->>k)::numeric, 0) - coalesce((v_fit_before->>k)::numeric, 0) > 0
    limit 5) q;

  return jsonb_build_object(
    'ok', true, 'track_id', p_track_id,
    'declared_stores', v_decl,
    'fit_before', v_fit_before, 'fit_after', v_fit_after, 'fit_diff', v_fit_diff, 'top_gains', v_top_gains,
    'blocked_before', coalesce(v_blocked_before, '{}'), 'blocked_after', coalesce(v_blocked_after, '{}'),
    'unblocked_stores', v_unblocked, 'newly_blocked_stores', v_newblocked,
    'removed_conflicts', v_removed_conflicts, 'remaining_conflicts', coalesce(v_remaining_conflicts, '{}'),
    'mismatch_before', round(v_mismatch_before, 2), 'mismatch_after', round(v_mismatch_after, 2),
    'mismatch_reduced', v_mismatch_after < v_mismatch_before,
    'risk_before', v_risk_before, 'risk_after', v_risk_after,
    'risk_reduced', (v_risk_before = 'high' and v_risk_after <> 'high') or (v_risk_before = 'medium' and v_risk_after = 'low'),
    'open_flags_after', coalesce(v_flags_after, '{}'),
    'warning', case when array_length(v_remaining_conflicts, 1) is not null
      then format('등록 매장 %s 에서 여전히 hard_block — 자동 해소 불가, 관리자 검수 필요',
        (select string_agg(public._store_label(s), ', ') from unnest(v_remaining_conflicts) s))
      else null end);
end; $$;
grant execute on function public.admin_apply_ai_metadata_and_recompute(uuid, jsonb) to authenticated;
