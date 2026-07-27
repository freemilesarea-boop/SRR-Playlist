-- ============================================================================
-- 0465_ai_learning_engine.sql — Phase AI-LEARNING-ENGINE-1
--
-- Runtime feedback learning + adaptive score. Connects:
--   Store Player → Playback Result → Reaction Collection → Learning Engine
--   → Adaptive Score → Candidate Pool Update
--
-- 설계 원칙 (safety / isolation):
--   • ISOLATED signal store: 새 테이블 store_playback_feedback. 기존 track_play_events /
--     _ai_behavior_score / _ai_compute_fit / global fit 파이프라인은 건드리지 않는다
--     (global scoring 오염 방지 — "AI Scoring Formula 재설계 금지").
--   • Adaptive 는 STORE-scoped(매장별). fit_score 는 그대로 두고, 매장 반응으로
--     adaptive_score 를 별도 산출.
--   • Learning Delay: 반응 → 즉시 Queue 반영 금지. Batch(admin recompute)로
--     track_adaptive_scores 를 materialize → 다음 Rotation 에 반영. (cron/worker 없음)
--   • Minimum sample gate: 재생 20회 미만이면 adaptive = fit (학습 미적용).
--   • Queue core 는 coalesce(adaptive_score, fit_score) 로 정렬 → adaptive row 없으면
--     기존 0463 동작과 완전 동일(backward compatible). Production 기본 runtime 불변.
--   • Additive only, idempotent, explicit search_path, SECURITY DEFINER + 내부 auth.
--     Test DB 전용. Production 미적용.
--
-- 재사용: _ai_runtime_can_read_store / _ai_runtime_touch_updated_at (0464),
--         playlist_track_fit_scores.fit_score (0156), store_track_reactions(선택, Prod).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Isolated store playback feedback (Learning Event store)
--    §1 Collector: play / complete / skip / next / previous / pause / resume
-- ----------------------------------------------------------------------------
create table if not exists public.store_playback_feedback (
  id                uuid primary key default gen_random_uuid(),
  store_id          uuid not null references public.users(id) on delete cascade,
  track_id          uuid not null references public.tracks(id) on delete cascade,
  playlist_id       uuid,
  event_type        text not null check (event_type in
                      ('play','complete','skip','next','previous','pause','resume')),
  completion_ratio  numeric check (completion_ratio is null or (completion_ratio >= 0 and completion_ratio <= 1)),
  played_seconds    numeric,
  duration_seconds  numeric,
  session_id        text,
  created_at        timestamptz not null default now()
);

comment on table public.store_playback_feedback is
  'AI-LEARNING-ENGINE-1: isolated per-store playback feedback. Feeds adaptive score ONLY; never the global fit/behavior pipeline.';

create index if not exists idx_spf_store_track_time
  on public.store_playback_feedback (store_id, track_id, created_at desc);
create index if not exists idx_spf_store_playlist
  on public.store_playback_feedback (store_id, playlist_id);

alter table public.store_playback_feedback enable row level security;

drop policy if exists spf_read on public.store_playback_feedback;
create policy spf_read on public.store_playback_feedback
  for select using (public._ai_runtime_can_read_store(store_id, auth.uid()));
-- writes only via record_store_playback_feedback (definer); no direct write policy.

-- ----------------------------------------------------------------------------
-- 2. Feedback ingest RPC — store-self / HQ / admin. Fire-and-forget.
--    Production stores also collect (learning-only); nothing about the queue changes here.
-- ----------------------------------------------------------------------------
create or replace function public.record_store_playback_feedback(
  p_store_id         uuid,
  p_track_id         uuid,
  p_event_type       text,
  p_playlist_id      uuid default null,
  p_completion_ratio numeric default null,
  p_played_seconds   numeric default null,
  p_duration_seconds numeric default null,
  p_session_id       text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_ratio numeric;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if not public._ai_runtime_can_read_store(p_store_id, v_uid) then
    raise exception 'store_access_denied';
  end if;
  if p_event_type not in ('play','complete','skip','next','previous','pause','resume') then
    raise exception 'invalid_event_type';
  end if;
  if not exists (select 1 from public.tracks where id = p_track_id) then
    raise exception 'invalid_track';
  end if;

  -- derive completion_ratio defensively (reject impossible values)
  v_ratio := p_completion_ratio;
  if v_ratio is null and p_played_seconds is not null and p_duration_seconds is not null
     and p_duration_seconds > 0 then
    v_ratio := least(1, greatest(0, p_played_seconds / p_duration_seconds));
  end if;
  if v_ratio is not null then v_ratio := least(1, greatest(0, v_ratio)); end if;

  insert into public.store_playback_feedback
    (store_id, track_id, playlist_id, event_type, completion_ratio,
     played_seconds, duration_seconds, session_id)
  values
    (p_store_id, p_track_id, p_playlist_id, p_event_type, v_ratio,
     greatest(0, coalesce(p_played_seconds, 0)), p_duration_seconds, p_session_id);

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.record_store_playback_feedback(uuid, uuid, text, uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.record_store_playback_feedback(uuid, uuid, text, uuid, numeric, numeric, numeric, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Store-scoped reaction score (0..100) + rates + sample. Pure aggregation.
--    Reads ONLY store_playback_feedback (+ optional store_track_reactions on Prod).
-- ----------------------------------------------------------------------------
create or replace function public._ai_store_reaction_score(
  p_store_id uuid, p_playlist_id uuid, p_track_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_plays int; v_comps int; v_skips int; v_nexts int; v_depth numeric;
  v_like int := 0; v_dislike int := 0;
  comp_r numeric; skip_r numeric; next_r numeric; react_bonus numeric := 0;
  raw numeric;
begin
  select count(*) filter (where event_type = 'play'),
         count(*) filter (where event_type = 'complete'),
         count(*) filter (where event_type = 'skip'),
         count(*) filter (where event_type = 'next'),
         coalesce(avg(completion_ratio) filter (where completion_ratio is not null), 0)
    into v_plays, v_comps, v_skips, v_nexts, v_depth
  from public.store_playback_feedback
  where store_id = p_store_id and track_id = p_track_id
    and (p_playlist_id is null or playlist_id = p_playlist_id)
    and created_at > now() - interval '90 days';

  -- optional explicit reactions (Prod: store_track_reactions; Test fixture may lack it)
  if to_regclass('public.store_track_reactions') is not null then
    execute 'select count(*) filter (where reaction_type=''like''), '
         || 'count(*) filter (where reaction_type=''dislike'') '
         || 'from public.store_track_reactions where store_id=$1 and track_id=$2'
      into v_like, v_dislike using p_store_id, p_track_id;
  end if;

  if coalesce(v_plays, 0) = 0 then
    return jsonb_build_object('reaction_score', 50, 'sample_count', 0,
      'skip_rate', 0, 'completion_rate', 0);
  end if;

  comp_r := least(1, v_comps::numeric / v_plays);
  skip_r := least(1, v_skips::numeric / v_plays);
  next_r := least(1, v_nexts::numeric / v_plays);
  if (v_like + v_dislike) > 0 then
    react_bonus := (v_like - v_dislike)::numeric / (v_like + v_dislike) * 10;  -- ±10
  end if;

  raw := 50 + comp_r * 40 + v_depth * 10 - skip_r * 50 - next_r * 15 + react_bonus;
  raw := least(100, greatest(0, raw));

  return jsonb_build_object(
    'reaction_score', round(raw),
    'sample_count', v_plays,
    'skip_rate', round(skip_r, 4),
    'completion_rate', round(comp_r, 4)
  );
end;
$$;

-- Internal helper — callers are the admin-gated wrappers (definer). Lock out anon/authenticated.
revoke execute on function public._ai_store_reaction_score(uuid, uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 4. Adaptive score = fit + weighted reaction delta, min-sample gated. Immutable.
--    MIN_SAMPLE=20, WEIGHT=0.4, adjustment clamped ±20, adaptive clamped 0..100.
-- ----------------------------------------------------------------------------
create or replace function public._ai_adaptive_score(
  p_fit numeric, p_reaction_score numeric, p_sample_count integer
)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  select case
    when coalesce(p_sample_count, 0) < 20 then round(coalesce(p_fit, 0))  -- learning not applied
    else round(
      least(100, greatest(0,
        coalesce(p_fit, 0) +
        least(20, greatest(-20, (coalesce(p_reaction_score, 50) - 50) * 0.4))
      ))
    )
  end;
$$;

-- Internal helper (pure scalar math). Keep the surface consistent with other _ai_ cores.
revoke execute on function public._ai_adaptive_score(numeric, numeric, integer) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Materialized adaptive scores (Batch Update target). Runtime reads this.
-- ----------------------------------------------------------------------------
create table if not exists public.track_adaptive_scores (
  store_id         uuid not null references public.users(id) on delete cascade,
  playlist_id      uuid not null,
  track_id         uuid not null references public.tracks(id) on delete cascade,
  fit_score        numeric not null default 0,
  reaction_score   numeric not null default 50,
  adaptive_score   numeric not null default 0,
  sample_count     integer not null default 0,
  skip_rate        numeric not null default 0,
  completion_rate  numeric not null default 0,
  learning_status  text not null default 'collecting' check (learning_status in ('collecting','active')),
  updated_at       timestamptz not null default now(),
  primary key (store_id, playlist_id, track_id)
);

comment on table public.track_adaptive_scores is
  'AI-LEARNING-ENGINE-1: materialized per-store adaptive scores (batch-updated). Runtime queue orders by coalesce(adaptive_score, fit_score).';

create index if not exists idx_tas_store_playlist
  on public.track_adaptive_scores (store_id, playlist_id);

alter table public.track_adaptive_scores enable row level security;

drop policy if exists tas_read on public.track_adaptive_scores;
create policy tas_read on public.track_adaptive_scores
  for select using (public._ai_runtime_can_read_store(store_id, auth.uid()));

drop trigger if exists trg_tas_touch on public.track_adaptive_scores;
create trigger trg_tas_touch
  before update on public.track_adaptive_scores
  for each row execute function public._ai_runtime_touch_updated_at();

-- ----------------------------------------------------------------------------
-- 6. Batch recompute (the "Batch Update" — admin action, no cron). Platform admin only.
--    Materializes adaptive scores for one store×playlist from collected feedback.
-- ----------------------------------------------------------------------------
create or replace function public.admin_ai_recompute_adaptive_scores(
  p_store_id uuid, p_playlist_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  r record; v_stats jsonb; v_fit numeric; v_adaptive numeric;
  v_sample int; v_updated int := 0; v_active int := 0; v_status text;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin_only';
  end if;
  if p_store_id is null or p_playlist_id is null then raise exception 'invalid_args'; end if;

  for r in
    select pt.track_id, coalesce(fs.fit_score, 0) as fit_score
      from public.playlist_tracks pt
      left join public.playlist_track_fit_scores fs
        on fs.playlist_id = p_playlist_id and fs.track_id = pt.track_id
     where pt.playlist_id = p_playlist_id
  loop
    v_fit := r.fit_score;
    v_stats := public._ai_store_reaction_score(p_store_id, p_playlist_id, r.track_id);
    v_sample := (v_stats->>'sample_count')::int;
    v_adaptive := public._ai_adaptive_score(v_fit, (v_stats->>'reaction_score')::numeric, v_sample);
    v_status := case when v_sample >= 20 then 'active' else 'collecting' end;

    insert into public.track_adaptive_scores
      (store_id, playlist_id, track_id, fit_score, reaction_score, adaptive_score,
       sample_count, skip_rate, completion_rate, learning_status)
    values
      (p_store_id, p_playlist_id, r.track_id, v_fit, (v_stats->>'reaction_score')::numeric,
       v_adaptive, v_sample, (v_stats->>'skip_rate')::numeric, (v_stats->>'completion_rate')::numeric, v_status)
    on conflict (store_id, playlist_id, track_id) do update set
      fit_score = excluded.fit_score,
      reaction_score = excluded.reaction_score,
      adaptive_score = excluded.adaptive_score,
      sample_count = excluded.sample_count,
      skip_rate = excluded.skip_rate,
      completion_rate = excluded.completion_rate,
      learning_status = excluded.learning_status;

    v_updated := v_updated + 1;
    if v_status = 'active' then v_active := v_active + 1; end if;
  end loop;

  return jsonb_build_object('store_id', p_store_id, 'playlist_id', p_playlist_id,
    'updated', v_updated, 'active', v_active, 'computed_at', now());
end;
$$;

revoke execute on function public.admin_ai_recompute_adaptive_scores(uuid, uuid) from public, anon;
grant execute on function public.admin_ai_recompute_adaptive_scores(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Learning dashboard (admin/HQ) — live fit/adaptive/diff/rates/status/sample.
-- ----------------------------------------------------------------------------
create or replace function public.admin_ai_learning_dashboard(
  p_store_id uuid, p_playlist_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  r record; v_rows jsonb := '[]'::jsonb; v_stats jsonb;
  v_fit numeric; v_live_adaptive numeric; v_sample int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if not public._ai_runtime_can_read_store(p_store_id, v_uid) then
    raise exception 'store_access_denied';
  end if;

  for r in
    select pt.track_id, pt.order_index, t.title, t.artist,
           coalesce(fs.fit_score, 0) as fit_score,
           ads.adaptive_score as applied_adaptive, ads.learning_status as applied_status,
           ads.updated_at as applied_at
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
      left join public.playlist_track_fit_scores fs
        on fs.playlist_id = p_playlist_id and fs.track_id = pt.track_id
      left join public.track_adaptive_scores ads
        on ads.store_id = p_store_id and ads.playlist_id = p_playlist_id and ads.track_id = pt.track_id
     where pt.playlist_id = p_playlist_id
     order by pt.order_index asc
  loop
    v_fit := r.fit_score;
    v_stats := public._ai_store_reaction_score(p_store_id, p_playlist_id, r.track_id);
    v_sample := (v_stats->>'sample_count')::int;
    v_live_adaptive := public._ai_adaptive_score(v_fit, (v_stats->>'reaction_score')::numeric, v_sample);

    v_rows := v_rows || jsonb_build_object(
      'track_id', r.track_id, 'title', r.title, 'artist', r.artist, 'order_index', r.order_index,
      'fit_score', v_fit,
      'reaction_score', (v_stats->>'reaction_score')::numeric,
      'adaptive_score_live', v_live_adaptive,
      'adaptive_score_applied', r.applied_adaptive,
      'difference', v_live_adaptive - v_fit,
      'skip_rate', (v_stats->>'skip_rate')::numeric,
      'completion_rate', (v_stats->>'completion_rate')::numeric,
      'sample_count', v_sample,
      'learning_status', case when v_sample >= 20 then 'active' else 'collecting' end,
      'applied_status', coalesce(r.applied_status, 'none'),
      'applied_at', r.applied_at
    );
  end loop;

  return jsonb_build_object('store_id', p_store_id, 'playlist_id', p_playlist_id,
    'tracks', v_rows, 'computed_at', now());
end;
$$;

revoke execute on function public.admin_ai_learning_dashboard(uuid, uuid) from public, anon;
grant execute on function public.admin_ai_learning_dashboard(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. Inject adaptive_score into the runtime queue core (0463).
--    coalesce(adaptive_score, fit_score): no adaptive row → identical to 0463.
-- ----------------------------------------------------------------------------
create or replace function public._ai_build_store_queue_core(
  p_store_id uuid, p_playlist_id uuid, p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_biz text; v_queue jsonb := '[]'::jsonb; r record; v_pos int := 0;
begin
  select business_category into v_biz from public.users where id = p_store_id;
  for r in
    select pt.track_id, t.title, t.artist, coalesce(fs.fit_score, 0) as fit_score,
           coalesce(ads.adaptive_score, fs.fit_score, 0) as adaptive_score,
           coalesce(fs.penalty_score, 0) as fit_penalty, coalesce(fs.status, 'unscored') as fit_status
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
      left join public.playlist_track_fit_scores fs on fs.playlist_id = p_playlist_id and fs.track_id = pt.track_id
      left join public.track_adaptive_scores ads
        on ads.store_id = p_store_id and ads.playlist_id = p_playlist_id and ads.track_id = pt.track_id
     where pt.playlist_id = p_playlist_id and coalesce(fs.status,'unscored') <> 'excluded'
       and coalesce((public._ai_check_store_guardrails(pt.track_id, coalesce(v_biz,''))->>'blocked')::boolean, false) = false
     order by coalesce(ads.adaptive_score, fs.fit_score, 0) desc,
              (case coalesce(fs.status,'unscored') when 'review_needed' then 1 else 0 end) asc, pt.order_index asc
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  loop
    v_pos := v_pos + 1;
    v_queue := v_queue || jsonb_build_object('position', v_pos, 'track_id', r.track_id, 'title', r.title,
      'artist', r.artist, 'fit_score', r.fit_score, 'adaptive_score', r.adaptive_score,
      'fit_status', r.fit_status, 'guardrail_penalty', r.fit_penalty);
  end loop;
  return jsonb_build_object('store_id', p_store_id, 'playlist_id', p_playlist_id,
    'store_type_canonical', public._ai_canonical_store_type(v_biz), 'queue_length', v_pos, 'queue', v_queue, 'computed_at', now());
end $$;

-- ----------------------------------------------------------------------------
-- 9. Surface adaptive_score in the candidate pool core (admin diagnostics).
-- ----------------------------------------------------------------------------
create or replace function public._ai_store_candidate_pool_core(
  p_store_id uuid, p_playlist_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_biz text; v_canon text; v_rows jsonb := '[]'::jsonb; r record; v_gr jsonb;
  v_blocked boolean; v_penalty numeric; v_status text; v_class text;
  v_eligible int := 0; v_penalized int := 0; v_blocked_n int := 0;
begin
  select business_category into v_biz from public.users where id = p_store_id;
  v_canon := public._ai_canonical_store_type(v_biz);
  for r in
    select pt.track_id, pt.order_index, t.title, t.artist,
           fs.fit_score, fs.status as fit_status, fs.penalty_score as fit_penalty,
           ads.adaptive_score
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
      left join public.playlist_track_fit_scores fs
        on fs.playlist_id = p_playlist_id and fs.track_id = pt.track_id
      left join public.track_adaptive_scores ads
        on ads.store_id = p_store_id and ads.playlist_id = p_playlist_id and ads.track_id = pt.track_id
     where pt.playlist_id = p_playlist_id order by pt.order_index asc
  loop
    v_gr := public._ai_check_store_guardrails(r.track_id, coalesce(v_biz, ''));
    v_blocked := coalesce((v_gr->>'blocked')::boolean, false);
    v_penalty := coalesce((v_gr->>'penalty_score')::numeric, 0);
    v_status := coalesce(r.fit_status, 'unscored');
    if v_blocked or v_status = 'excluded' then v_class := 'blocked'; v_blocked_n := v_blocked_n + 1;
    elsif v_penalty > 0 or v_status = 'review_needed' then v_class := 'penalized'; v_penalized := v_penalized + 1;
    else v_class := 'eligible'; v_eligible := v_eligible + 1; end if;
    v_rows := v_rows || jsonb_build_object('track_id', r.track_id, 'title', r.title, 'artist', r.artist,
      'order_index', r.order_index, 'fit_score', r.fit_score,
      'adaptive_score', coalesce(r.adaptive_score, r.fit_score), 'fit_status', v_status,
      'guardrail_blocked', v_blocked, 'guardrail_penalty', v_penalty, 'guardrail_severity', v_gr->>'severity',
      'classification', v_class);
  end loop;
  return jsonb_build_object('store_id', p_store_id, 'playlist_id', p_playlist_id,
    'store_business_category', v_biz, 'store_type_canonical', v_canon,
    'counts', jsonb_build_object('eligible', v_eligible, 'penalized', v_penalized, 'blocked', v_blocked_n,
      'total', v_eligible + v_penalized + v_blocked_n),
    'tracks', v_rows, 'computed_at', now());
end $$;
