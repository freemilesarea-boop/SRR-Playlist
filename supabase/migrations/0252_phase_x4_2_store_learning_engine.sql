-- 0252 — Phase X4.2 Store Learning Engine
--
-- 목표: 트랙 × 매장(taxonomy slug) 단위 실제 행동 점수 계산.
--       playlists.business_category → normalize_store_label() → store_type_slug 변환.
--
-- 정책 (사용자 spec):
--   - 자동 삭제/차단/반려/승격/강등 금지
--   - 인사이트/검수 큐 생성만
--   - fit_score / final_fit_score 절대 변경 금지

-- ===== A. track_store_behavior_scores =====
create table if not exists public.track_store_behavior_scores (
  track_id                uuid not null references public.tracks(id) on delete cascade,
  store_type_slug         text not null,
  window_days             int not null,
  play_count              int not null default 0,
  unique_listener_count   int not null default 0,
  completion_rate         numeric default 0,
  skip_rate               numeric default 0,
  replay_rate             numeric default 0,
  like_rate               numeric default 0,
  avg_listen_seconds      numeric default 0,
  avg_completion_percent  numeric default 0,
  store_behavior_score    numeric default 0,
  confidence              numeric default 0,
  calculated_at           timestamptz not null default now(),
  primary key (track_id, store_type_slug, window_days)
);

create index if not exists ix_tsbs_slug on public.track_store_behavior_scores(store_type_slug, window_days, store_behavior_score desc);
create index if not exists ix_tsbs_score on public.track_store_behavior_scores(window_days, store_behavior_score desc) where play_count >= 10;

alter table public.track_store_behavior_scores enable row level security;
drop policy if exists "tsbs admin read" on public.track_store_behavior_scores;
create policy "tsbs admin read" on public.track_store_behavior_scores for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. recompute_track_store_behavior_scores (전체) =====
-- 단일 거대 쿼리로 모든 (track × store_slug) 조합 한 번에 계산.
-- 이벤트 소스:
--   stream_events: play_count / unique_listeners / completed / avg_listen
--   playlist_track_skip_events: skip_count (early skip = played < 30% duration)
--   track_play_events: avg_completion_percent
--   liked_tracks: like_count (track-level, 매장 무관)
create or replace function public.recompute_track_store_behavior_scores(p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_count int;
  v_start timestamptz := clock_timestamp();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  with play_agg as (
    select
      se.track_id,
      public.normalize_store_label(pl.business_category) as store_slug,
      count(*) filter (where se.event_type='start')::int as play_count,
      count(distinct coalesce(se.user_id::text, se.anonymous_id, se.session_id))::int as unique_listeners,
      count(*) filter (where se.completed=true)::int as completed_count,
      coalesce(avg(se.listened_seconds), 0)::numeric as avg_listen
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.created_at > now() - (p_window_days || ' days')::interval
      and se.track_id is not null
      and pl.business_category is not null
      and public.normalize_store_label(pl.business_category) is not null
    group by se.track_id, public.normalize_store_label(pl.business_category)
  ),
  skip_agg as (
    select pts.track_id,
      public.normalize_store_label(pl.business_category) as store_slug,
      count(*)::int as skip_count
    from public.playlist_track_skip_events pts
    join public.playlists pl on pl.id = pts.playlist_id
    where pts.created_at > now() - (p_window_days || ' days')::interval
      and pts.track_id is not null
      and (pts.track_duration is null or pts.played_seconds < coalesce(pts.track_duration, 999) * 0.3)
      and pl.business_category is not null
      and public.normalize_store_label(pl.business_category) is not null
    group by pts.track_id, public.normalize_store_label(pl.business_category)
  ),
  like_agg as (
    select track_id, count(distinct user_id)::int as like_count
    from public.liked_tracks
    where created_at > now() - (p_window_days || ' days')::interval
      and track_id is not null
    group by track_id
  ),
  completion_agg as (
    select tpe.track_id,
      public.normalize_store_label(pl.business_category) as store_slug,
      coalesce(avg(tpe.completion_ratio), 0)::numeric as avg_completion
    from public.track_play_events tpe
    join public.playlists pl on pl.id = tpe.playlist_id
    where tpe.created_at > now() - (p_window_days || ' days')::interval
      and tpe.track_id is not null
      and tpe.event_type in ('play','complete')
      and public.normalize_store_label(pl.business_category) is not null
    group by tpe.track_id, public.normalize_store_label(pl.business_category)
  ),
  scored as (
    select pa.track_id, pa.store_slug,
      pa.play_count, pa.unique_listeners,
      (pa.completed_count::numeric / nullif(pa.play_count, 0)) as completion_rate,
      least(1.0, coalesce(sa.skip_count, 0)::numeric / nullif(pa.play_count, 0)) as skip_rate,
      case when pa.unique_listeners > 0 and pa.play_count > pa.unique_listeners
           then (pa.play_count - pa.unique_listeners)::numeric / pa.play_count
           else 0 end as replay_rate,
      least(1.0, coalesce(la.like_count, 0)::numeric / nullif(pa.unique_listeners, 0)) as like_rate,
      pa.avg_listen,
      coalesce(ca.avg_completion, 0) as avg_completion_percent,
      coalesce(sa.skip_count, 0) as skip_count,
      coalesce(la.like_count, 0) as like_count
    from play_agg pa
    left join skip_agg sa on sa.track_id = pa.track_id and sa.store_slug = pa.store_slug
    left join like_agg la on la.track_id = pa.track_id
    left join completion_agg ca on ca.track_id = pa.track_id and ca.store_slug = pa.store_slug
  )
  insert into public.track_store_behavior_scores (
    track_id, store_type_slug, window_days,
    play_count, unique_listener_count, completion_rate, skip_rate, replay_rate, like_rate,
    avg_listen_seconds, avg_completion_percent,
    store_behavior_score, confidence, calculated_at
  )
  select
    s.track_id, s.store_slug, p_window_days,
    s.play_count, s.unique_listeners,
    round(coalesce(s.completion_rate, 0), 4),
    round(coalesce(s.skip_rate, 0), 4),
    round(s.replay_rate, 4),
    round(coalesce(s.like_rate, 0), 4),
    round(s.avg_listen, 2),
    round(s.avg_completion_percent, 4),
    -- store_behavior_score = completion×40 + replay×20 + like×20 - skip×30 + min(plays/10, 10)
    round(
      coalesce(s.completion_rate, 0) * 40
      + s.replay_rate * 20
      + coalesce(s.like_rate, 0) * 20
      - coalesce(s.skip_rate, 0) * 30
      + least(10, s.play_count::numeric / 10), 2),
    -- confidence = min(plays / 50, 1.0)
    round(least(1.0, s.play_count::numeric / 50), 4),
    now()
  from scored s
  on conflict (track_id, store_type_slug, window_days) do update set
    play_count = excluded.play_count,
    unique_listener_count = excluded.unique_listener_count,
    completion_rate = excluded.completion_rate,
    skip_rate = excluded.skip_rate,
    replay_rate = excluded.replay_rate,
    like_rate = excluded.like_rate,
    avg_listen_seconds = excluded.avg_listen_seconds,
    avg_completion_percent = excluded.avg_completion_percent,
    store_behavior_score = excluded.store_behavior_score,
    confidence = excluded.confidence,
    calculated_at = now();
  get diagnostics v_count = row_count;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'recompute_track_store_behavior_scores', v_count,
    jsonb_build_object('window_days', p_window_days),
    jsonb_build_object('rows_upserted', v_count,
      'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int),
    'completed', now()
  );

  return jsonb_build_object('ok', true, 'rows_upserted', v_count,
    'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int);
end; $$;

-- ===== C. recompute_single_track_store_behavior_score =====
-- 단일 track 의 모든 (store_slug) 행 재계산 (전체 쿼리에 track filter 추가)
create or replace function public.recompute_single_track_store_behavior_score(
  p_track_id uuid, p_window_days int default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_count int := 0;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  -- 단순화: 해당 track 의 기존 행 모두 삭제 후 전체 recompute 의 결과 중 이 track 만 다시 insert.
  -- 트래픽 적으면 더 효율적인 분리 SQL 작성 가능하지만 여기선 정확성 우선.
  delete from public.track_store_behavior_scores
    where track_id = p_track_id and window_days = p_window_days;

  with play_agg as (
    select se.track_id, public.normalize_store_label(pl.business_category) as store_slug,
      count(*) filter (where se.event_type='start')::int as play_count,
      count(distinct coalesce(se.user_id::text, se.anonymous_id, se.session_id))::int as unique_listeners,
      count(*) filter (where se.completed=true)::int as completed_count,
      coalesce(avg(se.listened_seconds), 0)::numeric as avg_listen
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.track_id = p_track_id
      and se.created_at > now() - (p_window_days || ' days')::interval
      and pl.business_category is not null
      and public.normalize_store_label(pl.business_category) is not null
    group by se.track_id, public.normalize_store_label(pl.business_category)
  ),
  skip_agg as (
    select pts.track_id, public.normalize_store_label(pl.business_category) as store_slug,
      count(*)::int as skip_count
    from public.playlist_track_skip_events pts
    join public.playlists pl on pl.id = pts.playlist_id
    where pts.track_id = p_track_id
      and pts.created_at > now() - (p_window_days || ' days')::interval
      and (pts.track_duration is null or pts.played_seconds < coalesce(pts.track_duration, 999) * 0.3)
      and public.normalize_store_label(pl.business_category) is not null
    group by pts.track_id, public.normalize_store_label(pl.business_category)
  ),
  like_agg as (
    select count(distinct user_id)::int as like_count
    from public.liked_tracks
    where track_id = p_track_id and created_at > now() - (p_window_days || ' days')::interval
  ),
  completion_agg as (
    select tpe.track_id, public.normalize_store_label(pl.business_category) as store_slug,
      coalesce(avg(tpe.completion_ratio), 0)::numeric as avg_completion
    from public.track_play_events tpe
    join public.playlists pl on pl.id = tpe.playlist_id
    where tpe.track_id = p_track_id
      and tpe.created_at > now() - (p_window_days || ' days')::interval
      and tpe.event_type in ('play','complete')
      and public.normalize_store_label(pl.business_category) is not null
    group by tpe.track_id, public.normalize_store_label(pl.business_category)
  )
  insert into public.track_store_behavior_scores (
    track_id, store_type_slug, window_days,
    play_count, unique_listener_count, completion_rate, skip_rate, replay_rate, like_rate,
    avg_listen_seconds, avg_completion_percent,
    store_behavior_score, confidence, calculated_at
  )
  select pa.track_id, pa.store_slug, p_window_days,
    pa.play_count, pa.unique_listeners,
    round(coalesce((pa.completed_count::numeric / nullif(pa.play_count, 0)), 0), 4) as cr,
    round(least(1.0, coalesce(sa.skip_count, 0)::numeric / nullif(pa.play_count, 0)), 4) as sr,
    round(case when pa.unique_listeners > 0 and pa.play_count > pa.unique_listeners
               then (pa.play_count - pa.unique_listeners)::numeric / pa.play_count
               else 0 end, 4) as rr,
    round(least(1.0, coalesce(la.like_count, 0)::numeric / nullif(pa.unique_listeners, 0)), 4) as lr,
    round(pa.avg_listen, 2),
    round(coalesce(ca.avg_completion, 0), 4),
    round(
      coalesce(pa.completed_count::numeric / nullif(pa.play_count, 0), 0) * 40
      + (case when pa.unique_listeners > 0 and pa.play_count > pa.unique_listeners
              then (pa.play_count - pa.unique_listeners)::numeric / pa.play_count
              else 0 end) * 20
      + coalesce(least(1.0, la.like_count::numeric / nullif(pa.unique_listeners, 0)), 0) * 20
      - coalesce(least(1.0, sa.skip_count::numeric / nullif(pa.play_count, 0)), 0) * 30
      + least(10, pa.play_count::numeric / 10), 2),
    round(least(1.0, pa.play_count::numeric / 50), 4),
    now()
  from play_agg pa
  left join skip_agg sa on sa.track_id = pa.track_id and sa.store_slug = pa.store_slug
  left join like_agg la on true
  left join completion_agg ca on ca.track_id = pa.track_id and ca.store_slug = pa.store_slug;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'rows_upserted', v_count, 'track_id', p_track_id);
end; $$;

-- ===== D. admin_get_track_store_behavior_detail =====
create or replace function public.admin_get_track_store_behavior_detail(
  p_track_id uuid, p_window_days int default 30
) returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return jsonb_build_object(
    'track_id', p_track_id, 'window_days', p_window_days,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'store_type_slug', s.store_type_slug,
        'store_name_ko', (select name_ko from public.taxonomy_store_types where slug = s.store_type_slug),
        'play_count', s.play_count,
        'unique_listener_count', s.unique_listener_count,
        'completion_rate', s.completion_rate,
        'skip_rate', s.skip_rate,
        'replay_rate', s.replay_rate,
        'like_rate', s.like_rate,
        'avg_listen_seconds', s.avg_listen_seconds,
        'avg_completion_percent', s.avg_completion_percent,
        'store_behavior_score', s.store_behavior_score,
        'confidence', s.confidence
      ) order by s.store_behavior_score desc)
      from public.track_store_behavior_scores s
      where s.track_id = p_track_id and s.window_days = p_window_days
    ), '[]'::jsonb)
  );
end; $$;

-- ===== E. admin_list_store_learning_candidates =====
-- 단일 store_slug 의 promotion/demotion 후보 (해당 매장 한정).
create or replace function public.admin_list_store_learning_candidates(
  p_store_slug text, p_window_days int default 30
) returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  v_admin uuid := auth.uid();
  v_promotion jsonb;
  v_demotion jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id', s.track_id, 'title', t.title, 'artist', t.artist, 'main_genre', t.main_genre,
    'store_behavior_score', s.store_behavior_score, 'confidence', s.confidence,
    'play_count', s.play_count, 'completion_rate', s.completion_rate,
    'skip_rate', s.skip_rate, 'like_rate', s.like_rate
  ) order by s.store_behavior_score desc), '[]'::jsonb) into v_promotion
  from public.track_store_behavior_scores s
  join public.tracks t on t.id = s.track_id and t.removed_at is null
  where s.store_type_slug = p_store_slug and s.window_days = p_window_days
    and s.store_behavior_score >= 70 and s.confidence >= 0.3;

  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id', s.track_id, 'title', t.title, 'artist', t.artist, 'main_genre', t.main_genre,
    'store_behavior_score', s.store_behavior_score, 'confidence', s.confidence,
    'play_count', s.play_count, 'completion_rate', s.completion_rate,
    'skip_rate', s.skip_rate, 'like_rate', s.like_rate
  ) order by s.store_behavior_score asc), '[]'::jsonb) into v_demotion
  from public.track_store_behavior_scores s
  join public.tracks t on t.id = s.track_id and t.removed_at is null
  where s.store_type_slug = p_store_slug and s.window_days = p_window_days
    and s.store_behavior_score <= 30 and s.confidence >= 0.3;

  return jsonb_build_object(
    'store_type_slug', p_store_slug, 'window_days', p_window_days,
    'promotion', v_promotion, 'demotion', v_demotion,
    'promotion_count', jsonb_array_length(v_promotion),
    'demotion_count', jsonb_array_length(v_demotion)
  );
end; $$;

-- ===== F. admin_list_store_mismatch_candidates =====
-- 매장 단위로 skip 높거나 completion 낮은 트랙 (전 매장).
create or replace function public.admin_list_store_mismatch_candidates(
  p_window_days int default 30, p_min_play_count int default 10, p_limit int default 200
) returns table (
  track_id uuid, title text, artist text, main_genre text,
  store_type_slug text, store_name_ko text,
  play_count int, completion_rate numeric, skip_rate numeric,
  store_behavior_score numeric, confidence numeric,
  risk_signals text[]
)
language sql security definer set search_path = public stable as $$
  select s.track_id, t.title, t.artist, t.main_genre,
    s.store_type_slug,
    (select ts.name_ko from public.taxonomy_store_types ts where ts.slug = s.store_type_slug) as store_name_ko,
    s.play_count, s.completion_rate, s.skip_rate,
    s.store_behavior_score, s.confidence,
    array_remove(array[
      case when s.skip_rate >= 0.6 then 'high_skip' end,
      case when s.completion_rate <= 0.25 then 'low_completion' end,
      case when s.store_behavior_score <= 30 and s.confidence >= 0.3 then 'low_score' end
    ], null) as risk_signals
  from public.track_store_behavior_scores s
  join public.tracks t on t.id = s.track_id and t.removed_at is null
  where s.window_days = p_window_days
    and s.play_count >= p_min_play_count
    and (s.skip_rate >= 0.6 or s.completion_rate <= 0.25
         or (s.store_behavior_score <= 30 and s.confidence >= 0.3))
  order by s.skip_rate desc, s.store_behavior_score asc
  limit greatest(p_limit, 1);
$$;

-- ===== G. admin_list_track_store_scores (UI 메인 테이블) =====
create or replace function public.admin_list_track_store_scores(
  p_store_slug text default null, p_window_days int default 30, p_limit int default 200
) returns table (
  track_id uuid, title text, artist text, main_genre text,
  store_type_slug text, store_name_ko text,
  play_count int, unique_listener_count int,
  completion_rate numeric, skip_rate numeric, replay_rate numeric, like_rate numeric,
  store_behavior_score numeric, confidence numeric,
  is_promotion_candidate boolean, is_demotion_candidate boolean
)
language sql security definer set search_path = public stable as $$
  select s.track_id, t.title, t.artist, t.main_genre,
    s.store_type_slug,
    (select ts.name_ko from public.taxonomy_store_types ts where ts.slug = s.store_type_slug),
    s.play_count, s.unique_listener_count,
    s.completion_rate, s.skip_rate, s.replay_rate, s.like_rate,
    s.store_behavior_score, s.confidence,
    (s.store_behavior_score >= 70 and s.confidence >= 0.3) as is_promotion_candidate,
    (s.store_behavior_score <= 30 and s.confidence >= 0.3) as is_demotion_candidate
  from public.track_store_behavior_scores s
  join public.tracks t on t.id = s.track_id and t.removed_at is null
  where s.window_days = p_window_days
    and (p_store_slug is null or s.store_type_slug = p_store_slug)
  order by s.play_count desc, s.store_behavior_score desc
  limit greatest(p_limit, 1);
$$;

-- ===== H. admin_store_learning_summary =====
create or replace function public.admin_store_learning_summary(p_window_days int default 30)
returns jsonb language sql security definer set search_path = public stable as $$
  select jsonb_build_object(
    'total_rows', (select count(*) from public.track_store_behavior_scores where window_days = p_window_days),
    'distinct_tracks', (select count(distinct track_id) from public.track_store_behavior_scores where window_days = p_window_days),
    'by_store', (
      select jsonb_object_agg(store_type_slug, info) from (
        select s.store_type_slug,
          jsonb_build_object(
            'rows', count(*),
            'distinct_tracks', count(distinct s.track_id),
            'avg_score', round(avg(s.store_behavior_score), 2),
            'avg_confidence', round(avg(s.confidence), 4),
            'high_confidence_rows', count(*) filter (where s.confidence >= 0.3),
            'promotion_candidates', count(*) filter (where s.store_behavior_score >= 70 and s.confidence >= 0.3),
            'demotion_candidates', count(*) filter (where s.store_behavior_score <= 30 and s.confidence >= 0.3)
          ) as info
        from public.track_store_behavior_scores s
        where s.window_days = p_window_days
        group by s.store_type_slug
      ) g
    )
  );
$$;

-- ===== I. QC Rules — 3 신규 룰 =====
insert into public.admin_qc_rules (rule_key, name, description, issue_type, severity, source, condition_json, is_active)
values
  ('store_behavior_high_skip', '매장별 높은 skip rate',
   '특정 매장에서 play_count >= 30 AND skip_rate >= 0.6 AND confidence >= 0.3',
   'store_behavior_high_skip', 'HIGH', 'behavior',
   jsonb_build_object('condition', 'play_count >= 30 AND skip_rate >= 0.6 AND confidence >= 0.3', 'window_days', 30),
   true),
  ('store_behavior_low_completion', '매장별 낮은 completion rate',
   '특정 매장에서 play_count >= 30 AND completion_rate <= 0.25 AND confidence >= 0.3',
   'store_behavior_low_completion', 'HIGH', 'behavior',
   jsonb_build_object('condition', 'play_count >= 30 AND completion_rate <= 0.25 AND confidence >= 0.3', 'window_days', 30),
   true),
  ('store_behavior_mismatch', '매장별 부정 outlier (강등 후보)',
   '특정 매장에서 store_behavior_score <= 30 AND confidence >= 0.3',
   'store_behavior_mismatch', 'MEDIUM', 'behavior',
   jsonb_build_object('condition', 'store_behavior_score <= 30 AND confidence >= 0.3', 'window_days', 30),
   true)
on conflict (rule_key) do nothing;

-- ===== J. admin_generate_qc_queue_candidates v6: 3 store_behavior 룰 추가 =====
-- 기존 v5 본문 보존 + 끝에 3 룰 추가
create or replace function public.admin_generate_qc_queue_candidates()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_counts jsonb := '{}'::jsonb; v_n int; r record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

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

  select * into r from public.admin_qc_rules where rule_key='store_mismatch_behavior';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct b.track_id, r.rule_key, r.severity, r.source,
      format('매장 "%s" 에서 completion_rate 낮음 (%s)', sb.key, sb.value->>'completion_rate'),
      jsonb_build_object('matched_store', sb.key, 'breakdown', sb.value, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    cross join lateral jsonb_each(coalesce(b.store_breakdown_json,'{}'::jsonb)) sb
    where b.window_days = 30
      and (sb.value->>'play_count')::int >= 10
      and (sb.value->>'completion_rate')::numeric < 0.3
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='behavior_positive_outlier';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('승격 후보: behavior_score %s, confidence %s', round(b.behavior_score,1), round(b.confidence,2)),
      jsonb_build_object('behavior_score', b.behavior_score, 'confidence', b.confidence,
                         'completion_rate', b.completion_rate, 'like_rate', b.like_rate,
                         'play_count', b.play_count, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.behavior_score >= 70 and b.confidence >= 0.30
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='behavior_negative_outlier';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select b.track_id, r.rule_key, r.severity, r.source,
      format('강등 후보: behavior_score %s, confidence %s', round(b.behavior_score,1), round(b.confidence,2)),
      jsonb_build_object('behavior_score', b.behavior_score, 'confidence', b.confidence,
                         'skip_rate', b.skip_rate, 'completion_rate', b.completion_rate,
                         'play_count', b.play_count, 'window_days', b.window_days)
    from public.track_behavior_scores b
    join public.tracks t on t.id = b.track_id and t.removed_at is null
    where b.window_days = 30 and b.behavior_score <= 30 and b.confidence >= 0.30
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  -- 🆕 X4.2 store_behavior 3 룰
  select * into r from public.admin_qc_rules where rule_key='store_behavior_high_skip';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (s.track_id, s.store_type_slug) s.track_id, r.rule_key, r.severity, r.source,
      format('%s 매장에서 skip_rate %s%% (play %s, conf %s)',
             s.store_type_slug, round(s.skip_rate*100,1), s.play_count, round(s.confidence,2)),
      jsonb_build_object('store_type_slug', s.store_type_slug,
                         'skip_rate', s.skip_rate, 'play_count', s.play_count,
                         'completion_rate', s.completion_rate, 'confidence', s.confidence,
                         'window_days', s.window_days)
    from public.track_store_behavior_scores s
    join public.tracks t on t.id = s.track_id and t.removed_at is null
    where s.window_days = 30 and s.play_count >= 30 and s.skip_rate >= 0.6 and s.confidence >= 0.3
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='store_behavior_low_completion';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (s.track_id, s.store_type_slug) s.track_id, r.rule_key, r.severity, r.source,
      format('%s 매장에서 completion %s%% (play %s, conf %s)',
             s.store_type_slug, round(s.completion_rate*100,1), s.play_count, round(s.confidence,2)),
      jsonb_build_object('store_type_slug', s.store_type_slug,
                         'completion_rate', s.completion_rate, 'play_count', s.play_count,
                         'skip_rate', s.skip_rate, 'confidence', s.confidence,
                         'window_days', s.window_days)
    from public.track_store_behavior_scores s
    join public.tracks t on t.id = s.track_id and t.removed_at is null
    where s.window_days = 30 and s.play_count >= 30 and s.completion_rate <= 0.25 and s.confidence >= 0.3
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  select * into r from public.admin_qc_rules where rule_key='store_behavior_mismatch';
  if r.is_active then
    insert into public.admin_qc_queue(track_id, issue_type, severity, source, reason, evidence_json)
    select distinct on (s.track_id, s.store_type_slug) s.track_id, r.rule_key, r.severity, r.source,
      format('%s 매장에서 강등 후보 (score %s, conf %s)',
             s.store_type_slug, round(s.store_behavior_score,1), round(s.confidence,2)),
      jsonb_build_object('store_type_slug', s.store_type_slug,
                         'store_behavior_score', s.store_behavior_score, 'confidence', s.confidence,
                         'skip_rate', s.skip_rate, 'completion_rate', s.completion_rate,
                         'play_count', s.play_count, 'window_days', s.window_days)
    from public.track_store_behavior_scores s
    join public.tracks t on t.id = s.track_id and t.removed_at is null
    where s.window_days = 30 and s.store_behavior_score <= 30 and s.confidence >= 0.3
    on conflict (track_id, issue_type) where status='open' do nothing;
    get diagnostics v_n = row_count; v_counts := v_counts || jsonb_build_object(r.rule_key, v_n);
  else v_counts := v_counts || jsonb_build_object(r.rule_key, 'skipped_inactive'); end if;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (v_admin, 'qc_queue_generate', 0, null,
    jsonb_build_object('by_rule', v_counts), 'completed', now());

  return jsonb_build_object('ok', true, 'by_rule', v_counts,
    'generated_total', (
      select coalesce(sum(case when value::text ~ '^[0-9]+$' then (value::text)::int else 0 end), 0)
      from jsonb_each(v_counts)
    ));
end; $$;

-- ===== K. 권한 =====
revoke all on function public.recompute_track_store_behavior_scores(int) from public, anon;
revoke all on function public.recompute_single_track_store_behavior_score(uuid, int) from public, anon;
revoke all on function public.admin_get_track_store_behavior_detail(uuid, int) from public, anon;
revoke all on function public.admin_list_store_learning_candidates(text, int) from public, anon;
revoke all on function public.admin_list_store_mismatch_candidates(int, int, int) from public, anon;
revoke all on function public.admin_list_track_store_scores(text, int, int) from public, anon;
revoke all on function public.admin_store_learning_summary(int) from public, anon;

grant execute on function public.recompute_track_store_behavior_scores(int) to authenticated, service_role;
grant execute on function public.recompute_single_track_store_behavior_score(uuid, int) to authenticated, service_role;
grant execute on function public.admin_get_track_store_behavior_detail(uuid, int) to authenticated, service_role;
grant execute on function public.admin_list_store_learning_candidates(text, int) to authenticated, service_role;
grant execute on function public.admin_list_store_mismatch_candidates(int, int, int) to authenticated, service_role;
grant execute on function public.admin_list_track_store_scores(text, int, int) to authenticated, service_role;
grant execute on function public.admin_store_learning_summary(int) to authenticated, service_role;
