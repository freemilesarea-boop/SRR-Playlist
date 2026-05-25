-- 0173b — Hard Guardrails 판정 엔진 + _ai_compute_fit 연동 + override/UI RPC.
create or replace function public._ai_check_store_guardrails(p_track_id uuid, p_store_key text)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  f record; t record; m record; g record;
  v_tgen text[]; v_mood text; fv numeric; viol boolean; hit boolean;
  v_violations jsonb := '[]'::jsonb; v_pen numeric := 0; v_max_sev text := null; v_blocked boolean := false;
begin
  if exists (select 1 from public.store_guardrail_overrides o where o.track_id=p_track_id and o.store_key=p_store_key) then
    return jsonb_build_object('passed', true, 'blocked', false, 'severity', null, 'violations', '[]'::jsonb, 'penalty_score', 0, 'overridden', true);
  end if;
  select * into f from public.track_audio_features where track_id=p_track_id;
  select tr.main_genre, tr.genre, tr.genre_tags, tr.mood, coalesce(tr.explicit_content,false) as explicit into t from public.tracks tr where tr.id=p_track_id;
  select ai_moods into m from public.track_ai_metadata where track_id=p_track_id;
  select array_agg(distinct x) into v_tgen from (
    select public._ai_norm_genre(z) x from unnest(array_remove(array[t.main_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) z
    where public._ai_norm_genre(z) <> '') s;
  v_tgen := coalesce(v_tgen,'{}');
  v_mood := lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(m.ai_moods,'{}'), ' '));
  for g in select * from public.store_guardrails where store_key=p_store_key and enabled loop
    viol := false; hit := false;
    if g.rule_type = 'numeric' then
      fv := case
        when g.rule_key in ('max_energy','min_energy') then f.energy
        when g.rule_key in ('max_bpm','min_bpm') then f.bpm
        when g.rule_key = 'max_acousticness' then f.acousticness
        when g.rule_key = 'max_brightness' then f.brightness
        when g.rule_key = 'max_vocal_presence' then f.vocal_presence
        when g.rule_key = 'max_loudness' then f.loudness
        when g.rule_key in ('max_instrumentalness','min_instrumentalness') then f.instrumentalness
        when g.rule_key = 'max_danceability' then f.danceability else null end;
      if fv is not null then
        viol := case g.operator when '>' then fv > g.value::numeric when '<' then fv < g.value::numeric
          when '>=' then fv >= g.value::numeric when '<=' then fv <= g.value::numeric else false end;
        hit := true;
      end if;
    elsif g.rule_type = 'genre' and g.operator='contains' then viol := public._ai_norm_genre(g.value) = any(v_tgen); hit := true;
    elsif g.rule_type = 'mood' and g.operator='contains' then viol := v_mood like '%'||lower(g.value)||'%'; hit := true;
    elsif g.rule_type = 'flag' and g.operator='is_true' then viol := t.explicit; hit := true;
    end if;
    if hit and viol then
      v_violations := v_violations || jsonb_build_object('rule_key', g.rule_key, 'severity', g.severity, 'reason', g.reason);
      if g.severity='hard_block' then v_blocked := true; v_pen := 100; v_max_sev := 'hard_block';
      elsif g.severity='soft_block' then v_pen := greatest(v_pen, 50); if v_max_sev is null or v_max_sev='warning' then v_max_sev := 'soft_block'; end if;
      else v_pen := greatest(v_pen, 15); if v_max_sev is null then v_max_sev := 'warning'; end if; end if;
    end if;
  end loop;
  return jsonb_build_object('passed', not v_blocked, 'blocked', v_blocked, 'severity', v_max_sev,
    'violations', v_violations, 'penalty_score', v_pen, 'overridden', false);
end; $$;
grant execute on function public._ai_check_store_guardrails(uuid, text) to authenticated;

-- _ai_compute_fit: guardrail 우선(hard→fit0/excluded, soft/warning→감점). (0173b 적용본)
create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  pl record; ai record; t record; cfg record; gr jsonb;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric; v_fit numeric;
  v_status text; v_reason text; v_excluded boolean := false; v_gpen numeric := 0;
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags, ai_store_key
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;
  v_key := coalesce(nullif(btrim(pl.ai_store_key),''), public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart));
  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then v_audio := (ai.ai_store_fit->>v_key)::numeric; else v_audio := 50; end if;
  v_meta := 50 + public._ai_overlap(pl.genre_tags, t.genre_tags)*8 + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));
  v_behav := public._ai_behavior_score(p_playlist_id, p_track_id);
  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));
  v_fit := least(100, greatest(0, v_audio*cfg.fit_audio_w + v_meta*cfg.fit_meta_w + v_behav*cfg.fit_behavior_w - v_pen*cfg.fit_penalty_w));
  if v_key is not null then
    gr := public._ai_check_store_guardrails(p_track_id, v_key);
    if (gr->>'blocked')::boolean then
      v_fit := 0; v_excluded := true;
      v_reason := '[guardrail hard_block] ' || coalesce((select string_agg(e->>'reason',', ') from jsonb_array_elements(gr->'violations') e), '');
    else
      v_gpen := coalesce((gr->>'penalty_score')::numeric, 0);
      if v_gpen > 0 then v_fit := greatest(0, v_fit - v_gpen); end if;
    end if;
  end if;
  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then v_excluded := true; end if;
  if v_status is null then v_status := case when v_excluded then 'excluded' when v_fit < cfg.fit_exclude_cutoff then 'review_needed' else 'active' end; end if;
  if v_reason is null then
    v_reason := format('audio %s · meta %s · behavior %s · penalty %s%s%s', round(v_audio), round(v_meta), round(v_behav), round(v_pen),
      case when v_key is not null then ' · store='||v_key else '' end, case when v_gpen>0 then ' · guardrail -'||round(v_gpen) else '' end);
  end if;
  insert into public.playlist_track_fit_scores(playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score, reason, source, status, updated_at)
  values (p_playlist_id, p_track_id, round(v_fit), round(v_audio), round(v_meta), round(v_behav), round(v_pen), v_reason, 'algorithm', v_status, now())
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin' then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now();
end; $$;

create or replace function public.admin_get_track_guardrails(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by (x.gr->>'blocked')::boolean desc), '[]'::jsonb) into v from (
    select sk.store_key, public._ai_check_store_guardrails(p_track_id, sk.store_key) as gr
    from (select distinct store_key from public.store_guardrails where enabled) sk
  ) x where (x.gr->>'violations') <> '[]';
  return v;
end; $$;
grant execute on function public.admin_get_track_guardrails(uuid) to authenticated;

create or replace function public.admin_set_guardrail_override(p_track_id uuid, p_store_key text, p_enable boolean, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  if p_enable then
    insert into public.store_guardrail_overrides(track_id, store_key, reason, created_by)
    values (p_track_id, p_store_key, nullif(btrim(p_reason),''), v_uid)
    on conflict (track_id, store_key) do update set reason=coalesce(excluded.reason, public.store_guardrail_overrides.reason), created_by=v_uid, created_at=now();
  else delete from public.store_guardrail_overrides where track_id=p_track_id and store_key=p_store_key; end if;
  return jsonb_build_object('ok', true, 'override', p_enable);
end; $$;
grant execute on function public.admin_set_guardrail_override(uuid, text, boolean, text) to authenticated;
