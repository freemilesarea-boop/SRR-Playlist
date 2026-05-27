-- 0202 — AI 가중치 제안 Shadow Apply / 실제 재계산 시뮬레이션 (read-only).
--   실제 ai_scoring_config / ai_store_profiles / playlist_track_fit_scores 절대 수정 금지.
--   shadow config(가상)에서 _ai_compute_fit 와 "동일한 공식"(동일 helper 호출)으로 재계산해 diff 만 산출.
--   모델: 제안을 store-fit delta(±) / trust penalty 로 환산 → 실제 fit 공식(audio·Wa+meta·Wm+behav·Wb−pen·Wp+guardrail)에 통과.
--   (주의) store profile 규칙 자체 변경/ai_store_fit 재산출은 모델하지 않음 — 문서화. Phase3 근사보다 충실(실제 가중치/guardrail/behavior/penalty/cutoff 사용).

create table if not exists public.ai_scoring_shadow_configs (
  id uuid primary key default gen_random_uuid(),
  suggestion_id uuid,
  created_by uuid,
  status text not null default 'draft',         -- draft | simulated | approved_for_apply | rejected
  base_config_snapshot jsonb,
  proposed_config_snapshot jsonb,
  proposed_changes jsonb,
  simulation_result jsonb,
  created_at timestamptz not null default now(),
  simulated_at timestamptz,
  decided_at timestamptz
);
create index if not exists idx_shadow_status on public.ai_scoring_shadow_configs(status, created_at desc);
alter table public.ai_scoring_shadow_configs enable row level security;
drop policy if exists shadow_admin_read on public.ai_scoring_shadow_configs;
create policy shadow_admin_read on public.ai_scoring_shadow_configs for select
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 1) 제안 → shadow config 생성 (실제 config 무변경)
create or replace function public.admin_create_shadow_config_from_suggestion(p_suggestion_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare s public.ai_weight_suggestions%rowtype; v_base jsonb; v_delta numeric; v_changes jsonb; v_id uuid;
begin
  if not public.can_manage_curation() then raise exception 'curation admin only'; end if;
  select * into s from public.ai_weight_suggestions where id=p_suggestion_id;
  if not found then raise exception 'suggestion not found'; end if;
  select to_jsonb(c) into v_base from public.ai_scoring_config c where id=1;
  v_delta := round(5 + 10*coalesce(s.confidence,0.5));
  v_changes := case s.suggestion_type
    when 'store_overpredict'  then jsonb_build_object('kind','store_fit_delta','store',s.target_key,'delta',-v_delta)
    when 'store_underpredict' then jsonb_build_object('kind','store_fit_delta','store',s.target_key,'delta', v_delta)
    when 'uploader_trust_down' then jsonb_build_object('kind','trust_penalty','owner',s.target_key,'penalty',v_delta)
    else jsonb_build_object('kind','noop') end;
  insert into public.ai_scoring_shadow_configs(suggestion_id, created_by, status, base_config_snapshot, proposed_config_snapshot, proposed_changes)
  values (p_suggestion_id, auth.uid(), 'draft', v_base, v_base || jsonb_build_object('shadow_change', v_changes), v_changes)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'shadow_config_id', v_id, 'proposed_changes', v_changes);
end; $$;
grant execute on function public.admin_create_shadow_config_from_suggestion(uuid) to authenticated;

-- 2) shadow simulation — 실제 _ai_compute_fit 공식 재현(저장 안 함)
create or replace function public.admin_simulate_shadow_config(p_shadow_config_id uuid, p_sample_limit int default 500)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  sh public.ai_scoring_shadow_configs%rowtype; ch jsonb; v_kind text; v_store text; v_owner text;
  v_store_delta numeric := 0; v_trust_pen numeric := 0;
  wa numeric; wm numeric; wb numeric; wp numeric; xcut numeric; v_lim int;
  sensitive text[] := array['hospital','kids_cafe','yoga','pilates','fine_dining','hotel_lobby','nail_shop'];
  r record; gr jsonb;
  v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric; v_fit numeric; v_excl boolean; v_status text; v_skip int;
  c_aff int:=0; c_chg int:=0; c_drop int:=0; c_new int:=0; c_excl int:=0; c_pl int:=0; c_guard int:=0;
  v_risky jsonb:='[]'::jsonb; v_safe jsonb:='[]'::jsonb; v_top jsonb:='[]'::jsonb; v_obj jsonb; v_reason text;
  v_is_store boolean; res jsonb;
begin
  if not public.can_manage_curation() then raise exception 'curation admin only'; end if;
  select * into sh from public.ai_scoring_shadow_configs where id=p_shadow_config_id;
  if not found then raise exception 'shadow config not found'; end if;
  ch := sh.proposed_changes; v_kind := ch->>'kind';
  v_store := ch->>'store'; v_owner := ch->>'owner';
  v_is_store := (v_kind='store_fit_delta');
  v_store_delta := coalesce((ch->>'delta')::numeric,0);
  v_trust_pen := coalesce((ch->>'penalty')::numeric,0);
  v_lim := least(greatest(coalesce(p_sample_limit,500),1),2000);
  select fit_audio_w, fit_meta_w, fit_behavior_w, fit_penalty_w, fit_exclude_cutoff
    into wa, wm, wb, wp, xcut from public.ai_scoring_config where id=1;

  for r in
    with pairs as (
      select fs.playlist_id, fs.track_id, fs.fit_score cur_fit, fs.status cur_status,
             t.owner_user_id, t.genre_tags t_genre, t.mood_tags t_mood, t.audio_health_status ah,
             pl.genre_tags pl_genre, pl.mood_tags pl_mood, pl.situation_tags pl_sit,
             coalesce(nullif(pl.ai_store_key,''), public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart)) v_key,
             am.track_id ai_present, am.ai_store_fit, am.ai_situations, am.mismatch_score, am.ai_exclusions
      from public.playlist_track_fit_scores fs
      join public.playlists pl on pl.id=fs.playlist_id and coalesce(pl.is_recommendable,true)
      join public.tracks t on t.id=fs.track_id
      left join public.track_ai_metadata am on am.track_id=fs.track_id
    )
    select * from pairs
    where (v_is_store and v_key = v_store) or (not v_is_store and owner_user_id::text = v_owner)
    limit v_lim
  loop
    c_aff := c_aff + 1;
    -- audio (+ shadow store delta)
    v_audio := case when r.ai_present is not null and r.v_key is not null and (r.ai_store_fit ? r.v_key)
                    then (r.ai_store_fit->>r.v_key)::numeric else 50 end;
    if v_is_store and r.v_key = v_store then v_audio := greatest(0, least(100, v_audio + v_store_delta)); end if;
    -- meta
    v_meta := 50 + public._ai_overlap(r.pl_genre, r.t_genre)*8 + public._ai_overlap(r.pl_mood, r.t_mood)*8
      + (case when r.ai_present is not null then public._ai_overlap(r.pl_sit, r.ai_situations)*6 else 0 end)
      - (case when r.ai_present is not null then coalesce(r.mismatch_score,0)*30 else 0 end);
    v_meta := greatest(0, least(100, v_meta));
    v_behav := public._ai_behavior_score(r.playlist_id, r.track_id);
    select count(*) into v_skip from public.playlist_track_skip_events e
      where e.playlist_id=r.playlist_id and e.track_id=r.track_id and e.created_at>now()-interval '30 days' and e.played_seconds>=5;
    v_pen := (case when r.ai_present is not null then coalesce(r.mismatch_score,0)*40 else 0 end)
      + (case when r.ah='conversion_failed' then 50 else 0 end) + least(30, v_skip*5);
    -- shadow trust penalty (해당 업로더)
    if (not v_is_store) and r.owner_user_id::text = v_owner then v_pen := v_pen + v_trust_pen; end if;
    v_pen := greatest(0, least(100, v_pen));

    v_excl := false;
    gr := public._ai_check_store_guardrails(r.track_id, r.v_key);
    if coalesce((gr->>'blocked')::boolean,false) then
      v_fit := 0; v_excl := true;
    else
      v_fit := greatest(0, least(100, v_audio*wa + v_meta*wm + v_behav*wb - v_pen*wp));
      v_fit := greatest(0, v_fit - coalesce((gr->>'penalty_score')::numeric,0));
    end if;
    if r.ai_present is not null and r.v_key is not null and r.ai_exclusions @> array[r.v_key] then v_excl := true; end if;
    v_status := case when v_excl then 'excluded' when v_fit < xcut then 'review_needed' else 'active' end;

    -- diff 집계 (현재=저장된 status, shadow=재계산)
    if r.cur_status is distinct from v_status then
      c_chg := c_chg + 1;
      if exists (select 1 from public.playlist_tracks pt where pt.playlist_id=r.playlist_id and pt.track_id=r.track_id) then c_pl := c_pl + 1; end if;
      if r.cur_status='active' and v_status<>'active' then c_drop := c_drop + 1; end if;
      if r.cur_status<>'active' and v_status='active' then c_new := c_new + 1; end if;
      if v_status='excluded' and r.cur_status<>'excluded' then c_excl := c_excl + 1; end if;
      if r.v_key = any(sensitive) then c_guard := c_guard + (case when v_status<>'active' and r.cur_status='active' then 1 when v_status='active' and r.cur_status<>'active' then -1 else 0 end); end if;

      -- 위험/안전 분류
      v_reason := null;
      if r.v_key = any(sensitive) and v_status='active' and r.cur_status<>'active' then v_reason := '민감매장 신규 추천(위험)';
      elsif r.v_key <> all(sensitive) and v_status<>'active' and r.cur_status='active' then v_reason := '정상 추천 탈락 가능';
      elsif r.v_key = any(sensitive) and v_status<>'active' and r.cur_status='active' then v_reason := '민감매장 부적합 제거(안전)';
      end if;

      if jsonb_array_length(v_top) < 60 then
        v_obj := jsonb_build_object('track_id',r.track_id,'playlist_id',r.playlist_id,'store',r.v_key,
          'current_score',r.cur_fit,'shadow_score',round(v_fit),'delta',round(v_fit)-coalesce(r.cur_fit,0),
          'current_status',r.cur_status,'shadow_status',v_status,
          'in_playlist',(exists (select 1 from public.playlist_tracks pt where pt.playlist_id=r.playlist_id and pt.track_id=r.track_id)),
          'risk_reason',v_reason);
        v_top := v_top || v_obj;
        if v_reason in ('민감매장 신규 추천(위험)','정상 추천 탈락 가능') and jsonb_array_length(v_risky)<40 then v_risky := v_risky || v_obj;
        elsif v_reason = '민감매장 부적합 제거(안전)' and jsonb_array_length(v_safe)<40 then v_safe := v_safe || v_obj; end if;
      end if;
    end if;
  end loop;

  res := jsonb_build_object(
    'affected_tracks_count', c_aff,
    'changed_recommendations_count', c_chg,
    'dropped_from_recommendation_count', c_drop,
    'newly_recommended_count', c_new,
    'excluded_count', c_excl,
    'playlist_impact_count', c_pl,
    'guardrail_conflict_change', c_guard,
    'proposed_changes', ch,
    'config_weights', jsonb_build_object('audio',wa,'meta',wm,'behavior',wb,'penalty',wp,'exclude_cutoff',xcut),
    'top_changed_tracks', v_top, 'risky_changes', v_risky, 'safe_changes', v_safe,
    'note', '실제 반영 아님(shadow). store profile 규칙/ai_store_fit 재산출은 미모델, store-fit delta·trust penalty 로 근사.');

  update public.ai_scoring_shadow_configs set status='simulated', simulation_result=res, simulated_at=now() where id=p_shadow_config_id;
  return res;
end; $$;
grant execute on function public.admin_simulate_shadow_config(uuid, int) to authenticated;

create or replace function public.admin_list_shadow_configs(p_status text default null)
returns setof public.ai_scoring_shadow_configs language sql stable security definer set search_path to 'public' as $$
  select * from public.ai_scoring_shadow_configs
  where exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
    and (p_status is null or status=p_status)
  order by created_at desc;
$$;
grant execute on function public.admin_list_shadow_configs(text) to authenticated;

-- 승인/반려 (상태만. approved_for_apply = 반영 준비 완료일 뿐, 실제 config 반영은 Phase 4 별도)
create or replace function public.admin_decide_shadow_config(p_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not public.can_manage_curation() then raise exception 'curation admin only'; end if;
  if p_decision not in ('approved_for_apply','rejected','draft','simulated') then raise exception 'invalid decision'; end if;
  update public.ai_scoring_shadow_configs set status=p_decision, decided_at=now() where id=p_id;
  if not found then raise exception 'shadow config not found'; end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_decision);
end; $$;
grant execute on function public.admin_decide_shadow_config(uuid, text) to authenticated;