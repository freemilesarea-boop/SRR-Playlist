-- 0250 — Phase X4.0 Listening Behavior Learning Foundation
--
-- 목표: stream_events / track_play_events / liked_tracks / playlist_track_skip_events
--       기반으로 트랙별 실제 반응 점수 (behavior_score) 를 계산하여 검수/추천 참고용으로 노출.
--
-- 정책 (사용자 spec):
--   - 자동 삭제/차단/반려 금지. 큐 생성과 점수 표시만.
--   - 이번 phase 는 foundation — fit_score 에 직접 반영 안 함.
--   - play_count 낮으면 confidence 낮게 처리.

-- ===== A. track_behavior_scores =====
create table if not exists public.track_behavior_scores (
  track_id                 uuid not null references public.tracks(id) on delete cascade,
  window_days              int not null,
  play_count               int not null default 0,
  unique_listener_count    int not null default 0,
  completion_rate          numeric default 0,
  skip_rate                numeric default 0,
  replay_rate              numeric default 0,
  like_rate                numeric default 0,
  save_rate                numeric default 0,
  avg_listen_seconds       numeric default 0,
  avg_completion_percent   numeric default 0,
  behavior_score           numeric default 0,
  confidence               numeric default 0,
  store_breakdown_json     jsonb,
  playlist_breakdown_json  jsonb,
  daypart_breakdown_json   jsonb,
  calculated_at            timestamptz not null default now(),
  primary key (track_id, window_days)
);

create index if not exists ix_tbs_window on public.track_behavior_scores(window_days, behavior_score desc);
create index if not exists ix_tbs_skip on public.track_behavior_scores(window_days, skip_rate desc) where play_count >= 20;

alter table public.track_behavior_scores enable row level security;
drop policy if exists "tbs admin read" on public.track_behavior_scores;
create policy "tbs admin read" on public.track_behavior_scores for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. _compute_track_behavior_score (내부 helper) =====
-- 입력: track_id, window_days
-- 출력: void (upsert track_behavior_scores)
-- 사용 이벤트:
--   stream_events: event_type='start' = play, completed=true 비율, listened_seconds
--   track_play_events: completion_ratio, event_type='skip' (보조 신호)
--   playlist_track_skip_events: 실제 skip 행위
--   liked_tracks: like (= save proxy)
create or replace function public._compute_track_behavior_score(p_track_id uuid, p_window_days int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz := now() - (p_window_days || ' days')::interval;
  v_play_count int := 0;
  v_unique_listeners int := 0;
  v_total_plays_for_replay int := 0;
  v_completed int := 0;
  v_skip_count int := 0;
  v_like_count int := 0;
  v_avg_listen numeric := 0;
  v_avg_completion numeric := 0;
  v_completion_rate numeric := 0;
  v_skip_rate numeric := 0;
  v_replay_rate numeric := 0;
  v_like_rate numeric := 0;
  v_save_rate numeric := 0;
  v_behavior numeric := 0;
  v_confidence numeric := 0;
  v_store_b jsonb := '{}'::jsonb;
  v_playlist_b jsonb := '{}'::jsonb;
  v_daypart_b jsonb := '{}'::jsonb;
begin
  -- 1) Stream plays
  select count(*) filter (where event_type='start'),
         count(distinct coalesce(user_id::text, anonymous_id, session_id)),
         count(*) filter (where completed=true),
         coalesce(avg(listened_seconds), 0)
    into v_play_count, v_unique_listeners, v_completed, v_avg_listen
    from public.stream_events
    where track_id = p_track_id and created_at > v_cutoff;

  -- replay_rate proxy: (total_plays - unique_listeners) / total_plays
  if v_play_count > 0 then
    v_completion_rate := v_completed::numeric / v_play_count;
    if v_unique_listeners > 0 and v_play_count > v_unique_listeners then
      v_replay_rate := (v_play_count - v_unique_listeners)::numeric / v_play_count;
    end if;
  end if;

  -- 2) Skip rate (playlist_track_skip_events: played_seconds < 30% of track_duration → early skip)
  select count(*) into v_skip_count
    from public.playlist_track_skip_events
    where track_id = p_track_id and created_at > v_cutoff
      and (track_duration is null or played_seconds < coalesce(track_duration, 999) * 0.3);

  -- skip_rate = skip / max(play_count, skip+complete)
  if v_play_count > 0 then
    v_skip_rate := least(1.0, v_skip_count::numeric / v_play_count);
  end if;

  -- 3) Average completion% from track_play_events (richer signal)
  select coalesce(avg(completion_ratio), 0) into v_avg_completion
    from public.track_play_events
    where track_id = p_track_id and created_at > v_cutoff
      and event_type in ('play','complete');

  -- 4) Like rate (distinct likers / unique listeners)
  select count(distinct user_id) into v_like_count
    from public.liked_tracks
    where track_id = p_track_id and created_at > v_cutoff;
  if v_unique_listeners > 0 then
    v_like_rate := least(1.0, v_like_count::numeric / v_unique_listeners);
    v_save_rate := v_like_rate; -- save event 미존재 → like 를 save proxy 로 사용
  end if;

  -- 5) Store breakdown (business_category 별)
  select coalesce(jsonb_object_agg(business_category, breakdown), '{}'::jsonb) into v_store_b
  from (
    select pl.business_category,
           jsonb_build_object(
             'play_count', count(*),
             'completion_rate', round((count(*) filter (where se.completed=true))::numeric / nullif(count(*),0), 4),
             'avg_listen_seconds', round(avg(se.listened_seconds)::numeric, 2)
           ) as breakdown
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.track_id = p_track_id and se.created_at > v_cutoff
      and pl.business_category is not null
    group by pl.business_category
  ) s;

  -- 6) Playlist breakdown (per playlist_id)
  select coalesce(jsonb_object_agg(playlist_id::text, breakdown), '{}'::jsonb) into v_playlist_b
  from (
    select se.playlist_id,
           jsonb_build_object(
             'title', max(pl.title), 'play_count', count(*),
             'completion_rate', round((count(*) filter (where se.completed=true))::numeric / nullif(count(*),0), 4),
             'business_category', max(pl.business_category)
           ) as breakdown
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.track_id = p_track_id and se.created_at > v_cutoff
      and se.playlist_id is not null
    group by se.playlist_id
  ) s;

  -- 7) Daypart breakdown (heuristic: 시간대 분류 from created_at hour)
  select coalesce(jsonb_object_agg(daypart, breakdown), '{}'::jsonb) into v_daypart_b
  from (
    select
      case
        when extract(hour from created_at) between 6 and 11 then 'morning'
        when extract(hour from created_at) between 12 and 17 then 'afternoon'
        when extract(hour from created_at) between 18 and 22 then 'evening'
        else 'night'
      end as daypart,
      jsonb_build_object(
        'play_count', count(*),
        'completion_rate', round((count(*) filter (where completed=true))::numeric / nullif(count(*),0), 4)
      ) as breakdown
    from public.stream_events
    where track_id = p_track_id and created_at > v_cutoff
    group by daypart
  ) s;

  -- 8) behavior_score formula:
  -- + completion_rate × 35 + replay_rate × 20 + like_rate × 20 + save_rate × 15 - skip_rate × 25
  -- + play_count confidence boost up to +10
  v_behavior := v_completion_rate * 35
              + v_replay_rate * 20
              + v_like_rate * 20
              + v_save_rate * 15
              - v_skip_rate * 25
              + least(10, v_play_count::numeric / 10);

  -- confidence: 0 ~ 1, linear ramp 0→100 plays
  v_confidence := least(1.0, v_play_count::numeric / 100);

  insert into public.track_behavior_scores(
    track_id, window_days, play_count, unique_listener_count,
    completion_rate, skip_rate, replay_rate, like_rate, save_rate,
    avg_listen_seconds, avg_completion_percent,
    behavior_score, confidence,
    store_breakdown_json, playlist_breakdown_json, daypart_breakdown_json,
    calculated_at
  ) values (
    p_track_id, p_window_days, v_play_count, v_unique_listeners,
    round(v_completion_rate, 4), round(v_skip_rate, 4), round(v_replay_rate, 4),
    round(v_like_rate, 4), round(v_save_rate, 4),
    round(v_avg_listen, 2), round(v_avg_completion, 4),
    round(v_behavior, 2), round(v_confidence, 4),
    v_store_b, v_playlist_b, v_daypart_b, now()
  )
  on conflict (track_id, window_days) do update set
    play_count = excluded.play_count,
    unique_listener_count = excluded.unique_listener_count,
    completion_rate = excluded.completion_rate,
    skip_rate = excluded.skip_rate,
    replay_rate = excluded.replay_rate,
    like_rate = excluded.like_rate,
    save_rate = excluded.save_rate,
    avg_listen_seconds = excluded.avg_listen_seconds,
    avg_completion_percent = excluded.avg_completion_percent,
    behavior_score = excluded.behavior_score,
    confidence = excluded.confidence,
    store_breakdown_json = excluded.store_breakdown_json,
    playlist_breakdown_json = excluded.playlist_breakdown_json,
    daypart_breakdown_json = excluded.daypart_breakdown_json,
    calculated_at = now();
end; $$;

-- ===== C. recompute_track_behavior_scores (bulk) =====
create or replace function public.recompute_track_behavior_scores(p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_count int := 0;
  v_start timestamptz := clock_timestamp();
  tid uuid;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  -- 윈도우 내 이벤트가 있는 모든 트랙 + 기존 score 행이 있는 트랙
  for tid in
    select distinct track_id from (
      select track_id from public.stream_events
        where created_at > now() - (p_window_days || ' days')::interval
        and track_id is not null
      union
      select track_id from public.track_play_events
        where created_at > now() - (p_window_days || ' days')::interval
        and track_id is not null
      union
      select track_id from public.playlist_track_skip_events
        where created_at > now() - (p_window_days || ' days')::interval
        and track_id is not null
      union
      select track_id from public.liked_tracks
        where created_at > now() - (p_window_days || ' days')::interval
        and track_id is not null
      union
      select track_id from public.track_behavior_scores where window_days = p_window_days
    ) all_tids
  loop
    perform public._compute_track_behavior_score(tid, p_window_days);
    v_count := v_count + 1;
  end loop;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'recompute_behavior_scores', v_count,
    jsonb_build_object('window_days', p_window_days),
    jsonb_build_object('tracks_computed', v_count,
      'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int),
    'completed', now()
  );

  return jsonb_build_object('ok', true, 'tracks_computed', v_count,
    'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int);
end; $$;

create or replace function public.recompute_single_track_behavior_score(
  p_track_id uuid, p_window_days int default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_row record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  perform public._compute_track_behavior_score(p_track_id, p_window_days);
  select * into v_row from public.track_behavior_scores
    where track_id = p_track_id and window_days = p_window_days;
  return to_jsonb(v_row);
end; $$;

-- ===== D. admin_get_track_behavior_detail =====
create or replace function public.admin_get_track_behavior_detail(
  p_track_id uuid, p_window_days int default 30
) returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_admin uuid := auth.uid();
  v_score record;
  v_track record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select id, title, artist, main_genre, suitable_store
    into v_track from public.tracks where id = p_track_id;
  select * into v_score from public.track_behavior_scores
    where track_id = p_track_id and window_days = p_window_days;
  return jsonb_build_object(
    'track', to_jsonb(v_track),
    'score', case when v_score.track_id is null then null else to_jsonb(v_score) end,
    'window_days', p_window_days,
    'has_data', v_score.track_id is not null
  );
end; $$;

-- ===== E. admin_list_behavior_outliers =====
-- play_count 충분한데 skip 높거나 completion 낮은 트랙
create or replace function public.admin_list_behavior_outliers(
  p_window_days int default 30,
  p_min_play_count int default 20,
  p_limit int default 200
) returns table (
  track_id uuid, title text, artist text, main_genre text,
  play_count int, unique_listener_count int,
  completion_rate numeric, skip_rate numeric, replay_rate numeric, like_rate numeric,
  behavior_score numeric, confidence numeric,
  risk_signals text[]
)
language sql security definer set search_path = public stable as $$
  select b.track_id, t.title, t.artist, t.main_genre,
    b.play_count, b.unique_listener_count,
    b.completion_rate, b.skip_rate, b.replay_rate, b.like_rate,
    b.behavior_score, b.confidence,
    array_remove(array[
      case when b.skip_rate > 0.6 then 'high_skip' end,
      case when b.completion_rate < 0.3 then 'low_completion' end,
      case when b.play_count >= 50 and b.behavior_score < 30 then 'low_score_high_volume' end,
      case when b.like_rate = 0 and b.play_count >= 30 then 'no_likes_despite_plays' end,
      case when b.replay_rate < 0.05 and b.play_count >= 30 then 'no_replays' end
    ], null) as risk_signals
  from public.track_behavior_scores b
  join public.tracks t on t.id = b.track_id
  where b.window_days = p_window_days
    and b.play_count >= p_min_play_count
    and (b.skip_rate > 0.6 or b.completion_rate < 0.3
         or (b.play_count >= 50 and b.behavior_score < 30))
  order by b.skip_rate desc, b.behavior_score asc
  limit greatest(p_limit, 1);
$$;

-- ===== F. QC Rule 통합 =====
-- admin_qc_rules / admin_qc_queue 의 source check 에 'behavior' 추가
alter table public.admin_qc_rules drop constraint if exists admin_qc_rules_source_check;
alter table public.admin_qc_rules add constraint admin_qc_rules_source_check
  check (source in ('rule','ai','chromaprint','fingerprint','placement','manual','behavior'));

alter table public.admin_qc_queue drop constraint if exists admin_qc_queue_source_check;
alter table public.admin_qc_queue add constraint admin_qc_queue_source_check
  check (source in ('rule','ai','chromaprint','fingerprint','placement','manual','behavior'));

-- 3 신규 룰 seed
insert into public.admin_qc_rules (rule_key, name, description, issue_type, severity, source, condition_json, is_active)
values
  ('behavior_high_skip', '높은 skip rate (≥70%)',
   'play_count ≥ 30 + skip_rate > 70% — 부적합 배치/메타 가능성',
   'behavior_high_skip', 'HIGH', 'behavior',
   jsonb_build_object('condition', 'play_count >= 30 AND skip_rate > 0.7', 'window_days', 30),
   true),
  ('behavior_low_completion', '낮은 completion rate (<25%)',
   'play_count ≥ 30 + completion_rate < 25%',
   'behavior_low_completion', 'HIGH', 'behavior',
   jsonb_build_object('condition', 'play_count >= 30 AND completion_rate < 0.25', 'window_days', 30),
   true),
  ('store_mismatch_behavior', '특정 매장에서 반복 스킵',
   'store_breakdown_json 의 매장 중 play_count ≥ 10 + completion_rate < 30%',
   'store_mismatch_behavior', 'MEDIUM', 'behavior',
   jsonb_build_object('condition', 'store_breakdown play_count >= 10 AND completion_rate < 0.3', 'window_days', 30),
   true)
on conflict (rule_key) do nothing;

-- admin_generate_qc_queue_candidates v4: 3 behavior 룰 추가
create or replace function public.admin_generate_qc_queue_candidates()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_counts jsonb := '{}'::jsonb; v_n int; r record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  -- (기존 11 룰 — v3 동일 — 동작 보존)
  select * into r from public.admin_qc_rules where rule_key='placement_rock_in_lounge';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('Rock 트랙이 %s 플레이리스트에 배치됨', pl.business_category),
      jsonb_build_object('main_genre', t.main_genre, 'playlist_id', pl.id,
                         'playlist_title', pl.title, 'business_category', pl.business_category)
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where (lower(coalesce(t.main_genre,'')) like '%rock%' or lower(coalesce(t.sub_genre,'')) like '%rock%')
      and pl.business_category in ('호텔','와인바','병원') and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='placement_energetic_in_hospital';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      'Electronic/energetic 트랙이 병원 플레이리스트에 배치됨',
      jsonb_build_object('main_genre', t.main_genre, 'mood', t.mood,
        'playlist_id', pl.id, 'playlist_title', pl.title)
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where (lower(coalesce(t.main_genre,'')) like '%electronic%'
           or lower(coalesce(t.mood,'')) in ('energetic','exciting')
           or 'energetic' = any(coalesce(t.mood_tags,'{}'::text[]))
           or 'exciting' = any(coalesce(t.mood_tags,'{}'::text[])))
      and pl.business_category = '병원' and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='placement_fitness_in_relaxed';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('헬스장/피트니스 트랙이 %s 등 부적합 장소에 배치됨', pl.business_category),
      jsonb_build_object('suitable_store', t.suitable_store,
        'playlist_id', pl.id, 'business_category', pl.business_category)
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    where t.suitable_store in ('헬스장','피트니스','fitness')
      and pl.business_category in ('병원','호텔','와인바','카페','라운지') and t.removed_at is null
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='placement_predicted_mismatch';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (t.id) t.id, r.rule_key, r.severity, r.source,
      format('AI 예측 매장 (%s) 과 배치된 %s 가 모두 불일치',
        array_to_string(p.predicted_store_types,','), pl.business_category),
      jsonb_build_object('predicted_store_types', p.predicted_store_types,
        'business_category', pl.business_category,
        'normalized_slug', public.normalize_store_label(pl.business_category))
    from public.tracks t join public.playlist_tracks pt on pt.track_id = t.id
    join public.playlists pl on pl.id = pt.playlist_id
    join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
    where p.predicted_store_types is not null and array_length(p.predicted_store_types,1) > 0
      and t.removed_at is null
      and public.normalize_store_label(pl.business_category) is not null
      and not (public.normalize_store_label(pl.business_category) = any(p.predicted_store_types))
      and p.store_type_confidence >= 0.7
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='fingerprint_failed';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select f.track_id, r.rule_key, r.severity, r.source,
      format('Chromaprint 디코딩 실패 (retry %s회)', f.retry_count),
      jsonb_build_object('retry_count', f.retry_count, 'content_type', f.download_content_type,
                         'download_size_bytes', f.download_size_bytes,
                         'fingerprint_error', left(coalesce(f.fingerprint_error,''), 300))
    from public.audio_fingerprints f
    join public.tracks t on t.id = f.track_id and t.removed_at is null
    where f.fingerprint_status = 'failed' and f.retry_count >= 2
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='fingerprint_duplicate';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (a.track_id) a.track_id, r.rule_key,
      case when a.fingerprint_hash = b.fingerprint_hash
           or public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) >= 0.95
           then 'CRITICAL' else r.severity end,
      r.source,
      format('동일/유사 음원 후보 발견 (sim=%s)',
             case when a.fingerprint_hash = b.fingerprint_hash then '1.0000'
                  else round(public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint), 4)::text end),
      jsonb_build_object('candidate_track_id', b.track_id,
        'similarity', case when a.fingerprint_hash = b.fingerprint_hash then 1.0
                           else public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) end,
        'hash_exact', a.fingerprint_hash = b.fingerprint_hash,
        'duration_a', a.duration_seconds, 'duration_b', b.duration_seconds)
    from public.audio_fingerprints a
    join public.audio_fingerprints b on b.track_id > a.track_id
      and abs(coalesce(a.duration_seconds,0) - coalesce(b.duration_seconds,0)) < 3.0
    join public.tracks ta on ta.id = a.track_id and ta.removed_at is null
    join public.tracks tb on tb.id = b.track_id and tb.removed_at is null
    where a.fingerprint_status='success' and b.fingerprint_status='success'
      and (a.fingerprint_hash = b.fingerprint_hash
           or public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) >= 0.90)
    order by a.track_id, public._audio_fingerprint_similarity(a.fingerprint, b.fingerprint) desc
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='confidence_low_genre';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select p.track_id, r.rule_key, r.severity, r.source,
      format('genre_confidence %s 미만', round(p.genre_confidence,2)),
      jsonb_build_object('genre_confidence', p.genre_confidence, 'predicted_main_genre', p.predicted_main_genre)
    from public.track_ai_predictions p
    join public.tracks t on t.id = p.track_id and t.removed_at is null
    where p.model_version='taxonomy-v1' and p.genre_confidence < 0.5
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='confidence_low_mood';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select p.track_id, r.rule_key, r.severity, r.source,
      format('mood_confidence %s 미만', round(p.mood_confidence,2)),
      jsonb_build_object('mood_confidence', p.mood_confidence, 'predicted_moods', p.predicted_moods)
    from public.track_ai_predictions p
    join public.tracks t on t.id = p.track_id and t.removed_at is null
    where p.model_version='taxonomy-v1' and p.mood_confidence < 0.5
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='confidence_low_store';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select p.track_id, r.rule_key, r.severity, r.source,
      format('store_type_confidence %s 미만', round(p.store_type_confidence,2)),
      jsonb_build_object('store_type_confidence', p.store_type_confidence,
                         'predicted_store_types', p.predicted_store_types)
    from public.track_ai_predictions p
    join public.tracks t on t.id = p.track_id and t.removed_at is null
    where p.model_version='taxonomy-v1' and p.store_type_confidence < 0.5
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='meta_conflict_genre';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select t.id, r.rule_key, r.severity, r.source,
      format('Manual genre "%s" vs AI predicted "%s" 불일치',
             t.main_genre, coalesce(tg.name_ko, p.predicted_main_genre)),
      jsonb_build_object('manual_genre', t.main_genre, 'predicted_slug', p.predicted_main_genre,
                         'predicted_name_ko', tg.name_ko, 'genre_confidence', p.genre_confidence)
    from public.tracks t
    join public.track_ai_predictions p on p.track_id = t.id and p.model_version='taxonomy-v1'
    left join public.taxonomy_genres tg on tg.slug = p.predicted_main_genre
    where t.removed_at is null and t.main_genre is not null and p.predicted_main_genre is not null
      and p.genre_confidence >= 0.7
      and lower(btrim(t.main_genre)) <> lower(btrim(coalesce(tg.name_ko, p.predicted_main_genre)))
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='exclusion_conflict';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select pt.track_id, r.rule_key, r.severity, r.source,
      format('금지 장소 (%s) 에 아직 playlist_tracks 남아있음',
             array_to_string(array_agg(distinct e.store_type_slug), ',')),
      jsonb_build_object('active_exclusions', array_agg(distinct e.store_type_slug),
        'misplaced_playlist_ids', array_agg(distinct pl.id::text),
        'misplaced_playlist_titles', array_agg(distinct pl.title))
    from public.playlist_tracks pt
    join public.playlists pl on pl.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id and t.removed_at is null
    join public.track_store_exclusions e on e.track_id = pt.track_id and e.is_active
    where public._track_is_excluded_from_playlist(pt.track_id, pl.id)
    group by pt.track_id
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  -- 🆕 X4.0 behavior 3 룰
  select * into r from public.admin_qc_rules where rule_key='behavior_high_skip';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('skip_rate %s%% (play_count %s)', round(b.skip_rate*100,1), b.play_count),
      jsonb_build_object('skip_rate', b.skip_rate, 'play_count', b.play_count,
                         'completion_rate', b.completion_rate, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.play_count >= 30 and b.skip_rate > 0.7
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='behavior_low_completion';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('completion_rate %s%% (play_count %s)', round(b.completion_rate*100,1), b.play_count),
      jsonb_build_object('completion_rate', b.completion_rate, 'play_count', b.play_count,
                         'skip_rate', b.skip_rate, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.play_count >= 30 and b.completion_rate < 0.25
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  -- store_mismatch_behavior: store_breakdown_json 내부에서 특정 매장의 play_count>=10 + completion<0.3
  select * into r from public.admin_qc_rules where rule_key='store_mismatch_behavior';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct b.track_id, r.rule_key, r.severity, r.source,
      format('매장 "%s" 에서 completion_rate 낮음 (%s)', sb.key, sb.value->>'completion_rate'),
      jsonb_build_object('matched_store', sb.key,
                         'breakdown', sb.value, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    cross join lateral jsonb_each(coalesce(b.store_breakdown_json,'{}'::jsonb)) sb
    where b.window_days = 30
      and (sb.value->>'play_count')::int >= 10
      and (sb.value->>'completion_rate')::numeric < 0.3
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'qc_queue_generate', 0, null,
    jsonb_build_object('by_rule', v_counts), 'completed', now()
  );

  return jsonb_build_object('ok', true, 'by_rule', v_counts,
    'generated_total', (
      select coalesce(sum(case when value::text ~ '^[0-9]+$' then (value::text)::int else 0 end), 0)
      from jsonb_each(v_counts)
    ));
end; $$;

-- ===== G. 권한 =====
revoke all on function public._compute_track_behavior_score(uuid, int) from public, anon;
revoke all on function public.recompute_track_behavior_scores(int) from public, anon;
revoke all on function public.recompute_single_track_behavior_score(uuid, int) from public, anon;
revoke all on function public.admin_get_track_behavior_detail(uuid, int) from public, anon;
revoke all on function public.admin_list_behavior_outliers(int, int, int) from public, anon;

grant execute on function public._compute_track_behavior_score(uuid, int) to service_role;
grant execute on function public.recompute_track_behavior_scores(int) to authenticated, service_role;
grant execute on function public.recompute_single_track_behavior_score(uuid, int) to authenticated, service_role;
grant execute on function public.admin_get_track_behavior_detail(uuid, int) to authenticated, service_role;
grant execute on function public.admin_list_behavior_outliers(int, int, int) to authenticated, service_role;
