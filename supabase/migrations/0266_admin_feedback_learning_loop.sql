-- 0266 — Admin 조치 학습 피드백 + auto_place_track 반영
--
-- 목표:
--   1. track_store_feedback 테이블 — 관리자 조치 정규화 저장
--   2. _check_admin_feedback(track_id, store_slug) — auto_place_track 통합용
--   3. auto_place_track — admin_removed/excluded skip + approved bonus + review penalty
--   4. admin_qc_act_and_resolve — 액션 완료 시 feedback 자동 upsert
--   5. admin_feedback_summary RPC

-- ===== A. track_store_feedback =====
create table if not exists public.track_store_feedback (
  id                  uuid primary key default gen_random_uuid(),
  track_id            uuid not null references public.tracks(id) on delete cascade,
  playlist_id         uuid references public.playlists(id) on delete set null,
  store_type          text,  -- normalize_store_label() 결과, metadata_corrected 는 NULL
  action              text not null check (action in (
                        'admin_removed','admin_excluded','admin_review_needed',
                        'admin_approved','metadata_corrected')),
  before_fit_score    numeric,
  after_fit_score     numeric,
  before_metadata     jsonb,
  after_metadata      jsonb,
  admin_note          text,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- 같은 (track, store_type, action) 페어는 최신값으로 유지
create unique index if not exists uq_tsf_track_store_action
  on public.track_store_feedback(track_id, coalesce(store_type, ''), action);

create index if not exists ix_tsf_track on public.track_store_feedback(track_id, created_at desc);
create index if not exists ix_tsf_store_action on public.track_store_feedback(store_type, action, created_at desc);

alter table public.track_store_feedback enable row level security;
drop policy if exists "tsf admin read" on public.track_store_feedback;
create policy "tsf admin read" on public.track_store_feedback for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. _check_admin_feedback =====
-- 반환: { hard_skip, score_delta, matched_actions[] }
create or replace function public._check_admin_feedback(p_track_id uuid, p_store_slug text)
returns jsonb
language sql stable parallel safe
as $$
  with f as (
    select action, after_fit_score from public.track_store_feedback
    where track_id = p_track_id and store_type = p_store_slug
  )
  select jsonb_build_object(
    'hard_skip', exists (select 1 from f where action in ('admin_removed','admin_excluded')),
    'score_delta',
      coalesce((select sum(
        case action
          when 'admin_approved' then 15
          when 'admin_review_needed' then -10
          else 0  -- removed/excluded 는 hard_skip 으로 처리
        end) from f), 0),
    'matched_actions',
      coalesce((select array_agg(action) from f), '{}'::text[])
  );
$$;

-- ===== C. auto_place_track — admin feedback 통합 =====
create or replace function public.auto_place_track(p_track_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t record; a record; r record; pred record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
  v_skip_block int := 0; v_skip_gate int := 0; v_skip_excl int := 0;
  v_skip_genre_hard int := 0; v_skip_admin_feedback int := 0;
  v_pl_slug text;
  v_gr jsonb;
  v_gr_soft numeric;
  v_gr_bonus numeric;
  v_fb jsonb;
  v_fb_delta numeric;
  v_score_adj numeric;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'track_not_found'); end if;
  if coalesce(t.audio_url,'') = '' or not (t.release_status = 'released' or t.release_status is null) then
    insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
      values (p_track_id,'skipped',0,0, jsonb_build_object('reason','not_released_or_no_audio'));
    return jsonb_build_object('ok', true, 'status', 'skipped');
  end if;

  perform public.derive_track_analysis(p_track_id);
  select * into a from public.track_analysis where track_id = p_track_id;
  select * into pred from public.track_ai_predictions
    where track_id = p_track_id and model_version = 'taxonomy-v1';
  v_artist_key := lower(btrim(coalesce(t.artist,'')));
  select count(*) into v_cand from public.playlists where is_auto_generated = true and status = 'released';

  select count(*) into v_skip_excl
  from public.playlists p
  where p.is_auto_generated = true and p.status = 'released'
    and public._track_is_excluded_from_playlist(p_track_id, p.id);

  for r in
    select p.id, p.title, p.business_category, p.ai_store_key,
      (
        coalesce(case when (a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(t.time_slots,'{}')) or 'all' = any(coalesce(t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end
      + coalesce(case when pred.predicted_main_genre is not null
                       and exists(select 1 from unnest(p.genre_tags) g
                                  where lower(g) = lower(pred.predicted_main_genre))
                  then 5 else 0 end, 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_moods,'{}'::text[])) pm
           join public.taxonomy_moods tm on tm.slug = pm
           where tm.name_ko = any(coalesce(p.mood_tags,'{}'::text[]))) * 3,
          9), 0)
      + coalesce(least(
          (select count(*) from unnest(coalesce(pred.predicted_store_types,'{}'::text[])) ps
           join public.taxonomy_store_types ts on ts.slug = ps
           where ts.name_ko = p.business_category) * 10,
          20), 0)
      )::numeric as score,
      ((a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
        or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))) as genre_match,
      exists(select 1 from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) as mood_match,
      (p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}')))) as business_match,
      exists(
        select 1 from public.track_ai_predictions ap
        where ap.track_id = p_track_id and ap.model_version = 'taxonomy-v1' and ap.predicted_store_types is not null
          and ((p.ai_store_key is not null and p.ai_store_key = any(ap.predicted_store_types))
            or exists(select 1 from public.taxonomy_store_types ts where ts.name_ko = p.business_category and ts.slug = any(ap.predicted_store_types)))
      ) as ai_store_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'allow'
          and (position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where position(lower(gbr.genre_pattern) in lower(gt)) > 0))
      )) as allow_match,
      (p.business_category is not null and exists(
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category and gbr.block_kind = 'block'
          and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
            or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or exists(select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt where lower(gt) like '%' || lower(gbr.genre_pattern) || '%'))
      )) as block_match,
      (select string_agg(distinct gbr.genre_pattern, ',') from public.genre_block_rules gbr
       where gbr.business_category = p.business_category and gbr.block_kind = 'block'
         and ((a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
           or lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
           or lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')) as matched_block_pattern
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
      and not public._track_is_excluded_from_playlist(p_track_id, p.id)
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;

    if r.block_match and not r.allow_match then
      begin
        insert into public.placement_risk_flags (playlist_id, track_id, risk_type, risk_reason,
          business_category, main_genre, matched_pattern, match_score)
        values (r.id, p_track_id, 'genre_block_suspected',
          format('block rule matched: main_genre=%s × business=%s pattern=%s (score %s)',
                 t.main_genre, r.business_category, coalesce(r.matched_block_pattern,'?'), round(r.score,1)),
          r.business_category, t.main_genre, coalesce(r.matched_block_pattern,''), round(r.score,1))
        on conflict (playlist_id, track_id, risk_type) do nothing;
      exception when others then null;
      end;
      v_skip_block := v_skip_block + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_blocked');
      continue;
    end if;

    v_pl_slug := public.normalize_store_label(r.business_category);
    v_score_adj := r.score;
    if v_pl_slug is not null then
      -- 🆕 0266: admin feedback hard skip
      v_fb := public._check_admin_feedback(p_track_id, v_pl_slug);
      if (v_fb->>'hard_skip')::boolean then
        v_skip_admin_feedback := v_skip_admin_feedback + 1;
        v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
          'decision', 'skip_admin_feedback', 'actions', v_fb->'matched_actions');
        continue;
      end if;
      v_fb_delta := coalesce((v_fb->>'score_delta')::numeric, 0);

      -- X5.0 genre guardrail
      v_gr := public._check_genre_guardrail(p_track_id, v_pl_slug);
      if (v_gr->>'hard_block')::boolean then
        begin
          insert into public.placement_risk_flags (playlist_id, track_id, risk_type, risk_reason,
            business_category, main_genre, matched_pattern, match_score)
          values (r.id, p_track_id, 'genre_hard_block',
            format('X5 genre_hard_block: %s x %s (patterns: %s)',
                   t.main_genre, v_pl_slug,
                   coalesce((select string_agg(p, ',') from jsonb_array_elements_text(v_gr->'hard_block_patterns') p), '?')),
            r.business_category, t.main_genre,
            coalesce((select string_agg(p, ',') from jsonb_array_elements_text(v_gr->'hard_block_patterns') p), ''),
            round(r.score,1))
          on conflict (playlist_id, track_id, risk_type) do nothing;
        exception when others then null;
        end;
        v_skip_genre_hard := v_skip_genre_hard + 1;
        v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1),
          'decision', 'skip_genre_hard_block');
        continue;
      end if;
      v_gr_soft := coalesce((v_gr->>'soft_penalty_delta')::numeric, 0);
      v_gr_bonus := coalesce((v_gr->>'bonus_delta')::numeric, 0);
      v_score_adj := r.score + v_gr_soft + v_gr_bonus + v_fb_delta;
      if v_score_adj < v_threshold then
        v_log := v_log || jsonb_build_object('playlist', r.title, 'orig_score', round(r.score,1),
          'adj_score', round(v_score_adj,1),
          'decision', 'skip_below_threshold_after_guardrail',
          'soft', v_gr_soft, 'bonus', v_gr_bonus, 'fb_delta', v_fb_delta);
        continue;
      end if;
    end if;

    if not (r.genre_match or r.mood_match or r.business_match or r.ai_store_match or r.allow_match) then
      v_skip_gate := v_skip_gate + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'decision', 'skip_gate_failed');
      continue;
    end if;
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key
    ) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'artist_cap');
      continue;
    end if;
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id,
        coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        round(v_score_adj,1),
        format('자동 배치 X5.1 (score %s%s · gate: %s)',
          round(v_score_adj,1),
          case when v_score_adj <> r.score
               then format(' [orig %s · gr_soft %s · gr_bonus %s · fb %s]',
                           round(r.score,1), v_gr_soft, v_gr_bonus, coalesce(v_fb_delta,0))
               else '' end,
          array_to_string(array_remove(array[
            case when r.genre_match then 'genre' end,
            case when r.mood_match then 'mood' end,
            case when r.business_match then 'business' end,
            case when r.ai_store_match then 'ai_store' end,
            case when r.allow_match then 'allow' end
          ], null), '+')),
        'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(v_score_adj,1), 'decision', 'auto_place');
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed,
          v_log || jsonb_build_object(
            'skip_blocked', v_skip_block,
            'skip_gate_failed', v_skip_gate,
            'skip_admin_exclusion', v_skip_excl,
            'skip_genre_hard_block', v_skip_genre_hard,
            'skip_admin_feedback', v_skip_admin_feedback));
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'skip_blocked', v_skip_block, 'skip_gate_failed', v_skip_gate,
    'skip_admin_exclusion', v_skip_excl, 'skip_genre_hard_block', v_skip_genre_hard,
    'skip_admin_feedback', v_skip_admin_feedback,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $function$;

-- ===== D. admin_qc_act_and_resolve — feedback upsert 추가 =====
create or replace function public.admin_qc_act_and_resolve(
  p_queue_id uuid,
  p_action text,
  p_playlist_id uuid default null,
  p_payload jsonb default null,
  p_status text default null,
  p_reason text default null,
  p_admin_note text default null,
  p_resolve_after boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_queue record;
  v_action_result jsonb;
  v_resolved boolean := false;
  v_pl record;
  v_slug text;
  v_fb_action text;
  v_before_fit numeric;
  v_after_fit numeric;
  v_before_meta jsonb;
  v_after_meta jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_queue from public.admin_qc_queue where id = p_queue_id;
  if v_queue.id is null then raise exception 'queue_not_found'; end if;

  -- before snapshot (fit_score / metadata)
  if p_playlist_id is not null then
    select fit_score into v_before_fit
      from public.playlist_track_fit_scores
      where playlist_id = p_playlist_id and track_id = v_queue.track_id;
  end if;
  if p_action = 'update_metadata' then
    select jsonb_build_object('main_genre', main_genre, 'sub_genre', sub_genre,
      'mood', mood, 'mood_tags', mood_tags, 'genre_tags', genre_tags,
      'suitable_store', suitable_store, 'energy_level', energy_level,
      'instrumental', instrumental, 'vocal_type', vocal_type,
      'explicit_content', explicit_content, 'language', language, 'admin_note', admin_note
    ) into v_before_meta from public.tracks where id = v_queue.track_id;
  end if;

  -- action 분기
  if p_action = 'remove' then
    if p_playlist_id is null then raise exception 'playlist_id required for remove'; end if;
    v_action_result := public.admin_remove_track_from_playlist(p_playlist_id, v_queue.track_id, p_reason);
    v_fb_action := 'admin_removed';
  elsif p_action = 'change_status' then
    if p_playlist_id is null or p_status is null then
      raise exception 'playlist_id and status required for change_status';
    end if;
    v_action_result := public.admin_change_track_fit_status(
      p_playlist_id, v_queue.track_id, p_status, p_reason, p_admin_note);
    v_fb_action := case p_status
      when 'excluded' then 'admin_excluded'
      when 'review_needed' then 'admin_review_needed'
      when 'active' then 'admin_approved'
      else null end;
  elsif p_action = 'update_metadata' then
    if p_payload is null then raise exception 'payload required for update_metadata'; end if;
    v_action_result := public.admin_update_track_metadata(v_queue.track_id, p_payload, p_reason);
    v_fb_action := 'metadata_corrected';
  elsif p_action = 'recompute' then
    if p_playlist_id is null then raise exception 'playlist_id required for recompute'; end if;
    v_action_result := public.admin_recompute_track_fit(p_playlist_id, v_queue.track_id, false);
    -- recompute 는 feedback 안 함
  else
    raise exception 'invalid_action: %', p_action;
  end if;

  -- track_audit_logs 의 queue_id 연결
  update public.admin_track_audit_logs
    set queue_id = p_queue_id
    where id = (
      select id from public.admin_track_audit_logs
      where track_id = v_queue.track_id and queue_id is null
      order by created_at desc limit 1
    );

  -- after snapshot
  if p_playlist_id is not null then
    select fit_score into v_after_fit
      from public.playlist_track_fit_scores
      where playlist_id = p_playlist_id and track_id = v_queue.track_id;
  end if;
  if p_action = 'update_metadata' then
    select jsonb_build_object('main_genre', main_genre, 'sub_genre', sub_genre,
      'mood', mood, 'mood_tags', mood_tags, 'genre_tags', genre_tags,
      'suitable_store', suitable_store, 'energy_level', energy_level,
      'instrumental', instrumental, 'vocal_type', vocal_type,
      'explicit_content', explicit_content, 'language', language, 'admin_note', admin_note
    ) into v_after_meta from public.tracks where id = v_queue.track_id;
  end if;

  -- 🆕 track_store_feedback upsert
  if v_fb_action is not null then
    if p_playlist_id is not null then
      select normalize_store_label(business_category) into v_slug
        from public.playlists where id = p_playlist_id;
    else
      v_slug := null;  -- update_metadata 는 store_type 무관 (global)
    end if;
    insert into public.track_store_feedback
      (track_id, playlist_id, store_type, action,
       before_fit_score, after_fit_score, before_metadata, after_metadata,
       admin_note, created_by)
    values (v_queue.track_id, p_playlist_id, v_slug, v_fb_action,
            v_before_fit, v_after_fit, v_before_meta, v_after_meta,
            coalesce(p_admin_note, p_reason), v_admin)
    on conflict (track_id, coalesce(store_type, ''), action) do update set
      playlist_id = excluded.playlist_id,
      before_fit_score = coalesce(excluded.before_fit_score, public.track_store_feedback.before_fit_score),
      after_fit_score = excluded.after_fit_score,
      before_metadata = coalesce(excluded.before_metadata, public.track_store_feedback.before_metadata),
      after_metadata = excluded.after_metadata,
      admin_note = excluded.admin_note,
      created_by = excluded.created_by,
      updated_at = now();
  end if;

  if p_resolve_after and v_queue.status in ('open','reviewing') then
    update public.admin_qc_queue
      set status='resolved', resolved_at=now(), updated_at=now()
      where id = p_queue_id;
    v_resolved := true;
    insert into public.admin_qc_queue_audit_logs
      (queue_id, track_id, admin_user_id, action, note)
    values (p_queue_id, v_queue.track_id, v_admin,
            'qc_inline_action',
            format('action=%s · playlist=%s · feedback=%s',
                   p_action, coalesce(p_playlist_id::text,'—'), coalesce(v_fb_action,'—')));
  end if;

  return jsonb_build_object(
    'ok', true, 'action', p_action, 'queue_id', p_queue_id,
    'action_result', v_action_result, 'resolved', v_resolved,
    'feedback_action', v_fb_action, 'feedback_store', v_slug);
end; $$;

-- ===== E. admin_feedback_summary =====
create or replace function public.admin_feedback_summary()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.track_store_feedback),
    'by_action', (
      select jsonb_object_agg(action, n) from (
        select action, count(*) as n from public.track_store_feedback group by action
      ) s),
    'by_store', (
      select jsonb_object_agg(coalesce(store_type, 'GLOBAL'), n) from (
        select store_type, count(*) as n from public.track_store_feedback group by store_type
      ) s),
    'recent', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'track_id', track_id, 'store_type', store_type, 'action', action,
        'created_at', created_at)
      order by created_at desc), '[]'::jsonb)
      from (select * from public.track_store_feedback order by created_at desc limit 20) r
    )
  );
$$;

-- ===== F. 권한 =====
revoke all on function public._check_admin_feedback(uuid, text) from public, anon;
revoke all on function public.admin_feedback_summary() from public, anon;
grant execute on function public._check_admin_feedback(uuid, text) to authenticated, service_role;
grant execute on function public.admin_feedback_summary() to authenticated, service_role;
