-- 0175 — metadata_trust_score 를 검수/배치 정책에 연결. additive. 정산/stream_events 미변경.
create or replace function public._metadata_trust_tier(p_score numeric)
returns text language sql immutable as $$
  select case when coalesce(p_score,100) >= 80 then 'high' when coalesce(p_score,100) >= 50 then 'medium' else 'low' end; $$;

create or replace function public.admin_track_review_policy(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_owner uuid; v_name text; v_score numeric; v_tier text; v_mismatch numeric; v_guard_hard boolean;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select t.owner_user_id into v_owner from public.tracks t where t.id=p_track_id;
  select ap.artist_name, ap.metadata_trust_score into v_name, v_score from public.artist_profiles ap where ap.user_id=v_owner;
  v_tier := public._metadata_trust_tier(v_score);
  select coalesce(mismatch_score,0) into v_mismatch from public.track_ai_metadata where track_id=p_track_id;
  select exists (select 1 from public.track_guardrail_flags f where f.track_id=p_track_id and f.severity='hard_block') into v_guard_hard;
  return jsonb_build_object('owner_user_id', v_owner, 'owner_name', v_name, 'trust_score', coalesce(v_score,100), 'tier', v_tier,
    'ai_mismatch', coalesce(v_mismatch,0), 'guardrail_hard_block', v_guard_hard,
    'fast_approve_eligible', (v_tier='high' and coalesce(v_mismatch,0) < 0.3 and not v_guard_hard),
    'enhanced_warning', (v_tier='medium' and (coalesce(v_mismatch,0) >= 0.4 or v_guard_hard)),
    'auto_placement_blocked', (v_tier='low'), 'direct_metadata_blocked', (v_tier='low'),
    'ai_metadata_preferred', (v_tier='low'), 'review_priority_boost', (v_tier='low'),
    'policy_label', case v_tier when 'high' then 'AI 메타 일치 시 빠른 승인 가능'
      when 'medium' then '일반 검수 (불일치/guardrail 시 경고 강화)'
      else '주의 업로더 — 자동배치 제외 · AI 추천 메타 우선 · 직접 메타 반영 금지 권장' end);
end; $$;
grant execute on function public.admin_track_review_policy(uuid) to authenticated;

create or replace function public.admin_list_watch_uploaders()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.metadata_trust_score asc),'[]'::jsonb) into v from (
    select ap.user_id, ap.artist_name, ap.metadata_trust_score, public._metadata_trust_tier(ap.metadata_trust_score) as tier,
      (select count(*) from public.tracks t where t.owner_user_id=ap.user_id and t.removed_at is null and t.release_status in ('released','approved','scheduled')) as total_tracks,
      (select count(distinct f.track_id) from public.track_guardrail_flags f where f.owner_user_id=ap.user_id and f.severity='hard_block') as hard_tracks
    from public.artist_profiles ap where coalesce(ap.metadata_trust_score,100) < 50) x;
  return v;
end; $$;
grant execute on function public.admin_list_watch_uploaders() to authenticated;

create or replace function public.get_my_metadata_trust()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_score numeric; v_tier text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select metadata_trust_score into v_score from public.artist_profiles where user_id=v_uid;
  v_tier := public._metadata_trust_tier(v_score);
  return jsonb_build_object('trust_score', coalesce(v_score,100), 'tier', v_tier,
    'guidance', case v_tier
      when 'low' then '최근 업로드 메타데이터가 매장 분위기와 자주 어긋났습니다. 장르·무드·BPM·에너지를 음원 실제 특성에 맞게 정확히 입력해 주세요. 부정확하면 자동 배치에서 제외될 수 있습니다.'
      when 'medium' then '메타데이터를 음원 특성에 맞게 정확히 입력할수록 노출/배치 정확도가 올라갑니다.'
      else '메타데이터 신뢰도가 양호합니다. 감사합니다!' end);
end; $$;
grant execute on function public.get_my_metadata_trust() to authenticated;

-- 자동배치 제안: trust < 50 업로더 곡 제외
create or replace function public.admin_generate_ai_suggestions(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; v_cut numeric;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select fit_recommend_cutoff into v_cut from public.ai_scoring_config where id=1;
  insert into public.ai_playlist_suggestions(playlist_id, track_id, fit_score, reason, status)
  select s.playlist_id, s.track_id, s.fit_score, s.reason, 'pending'
  from public.playlist_track_fit_scores s join public.tracks t on t.id=s.track_id
  where s.playlist_id=p_playlist_id and s.status='active' and s.fit_score >= v_cut
    and t.release_status in ('released','approved') and t.removed_at is null
    and not exists (select 1 from public.playlist_tracks pt where pt.playlist_id=s.playlist_id and pt.track_id=s.track_id)
    and coalesce((select ap.metadata_trust_score from public.artist_profiles ap where ap.user_id=t.owner_user_id), 100) >= 50
  on conflict (playlist_id, track_id) do update set fit_score=excluded.fit_score, reason=excluded.reason,
    status=case when public.ai_playlist_suggestions.status='rejected' then 'rejected' else 'pending' end;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'suggestions', v_n);
end; $$;
grant execute on function public.admin_generate_ai_suggestions(uuid) to authenticated;
