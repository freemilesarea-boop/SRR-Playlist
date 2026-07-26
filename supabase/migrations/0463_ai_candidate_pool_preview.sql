-- 0463_ai_candidate_pool_preview.sql
-- Phase AI-PIPELINE-CONNECTION-1 — AI Runtime Integration & Candidate Pipeline (PREVIEW ONLY)
--
-- DRAFT — Test DB (haojpuhztegecbrwqorr) only. NOT applied to Production (nsoesrvwkxqifjcxzvol).
--
-- Goal: connect the currently-dead-ended pipeline
--   Store Fit → (DB save) → END
-- one step further, as an ADMIN-ONLY, READ-ONLY PREVIEW:
--   Store Fit → Candidate Pool → AI Candidate Queue
-- WITHOUT touching live playback. This migration only ADDS read-only RPCs. It does NOT modify
-- resolve_store_playback_policy, get_store_playlist_rotation_pool, get_playlist_tracks, the player,
-- the scheduler, rotation, crossfade, break/closed, or any queue the store player actually uses.
--
-- Reuses P0 (0462): the canonical, contract-correct _ai_check_store_guardrails (blocked / penalty_score)
-- and playlist_track_fit_scores. No new AI provider, no scoring-formula change, no auto playlist
-- generation, no test pool / pilot / rollout / reputation / experiment / auto-promotion.
--
-- Feature-flag posture: these RPCs are admin-gated and are surfaced ONLY behind an OFF-by-default
-- "AI Runtime Preview" admin toggle in the client. Nothing here is wired into the live queue.

-- ============================================================================
-- 1. Candidate-pool CORE (no auth gate; SECURITY DEFINER). Classifies each track in a playlist
--    for a given store into eligible / penalized / blocked, using existing fit scores + P0 guardrails.
--    Kept gate-free so it is unit-testable with synthetic data; the PUBLIC wrapper (below) gates admin.
-- ============================================================================
create or replace function public._ai_store_candidate_pool_core(p_store_id uuid, p_playlist_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_biz text;
  v_canon text;
  v_rows jsonb := '[]'::jsonb;
  r record;
  v_gr jsonb;
  v_blocked boolean;
  v_penalty numeric;
  v_status text;
  v_class text;
  v_eligible int := 0;
  v_penalized int := 0;
  v_blocked_n int := 0;
begin
  select business_category into v_biz from public.users where id = p_store_id;
  v_canon := public._ai_canonical_store_type(v_biz);

  for r in
    select pt.track_id, pt.order_index, t.title, t.artist,
           fs.fit_score, fs.status as fit_status, fs.penalty_score as fit_penalty
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
      left join public.playlist_track_fit_scores fs
        on fs.playlist_id = p_playlist_id and fs.track_id = pt.track_id
     where pt.playlist_id = p_playlist_id
     order by pt.order_index asc
  loop
    v_gr := public._ai_check_store_guardrails(r.track_id, coalesce(v_biz, ''));
    v_blocked := coalesce((v_gr->>'blocked')::boolean, false);
    v_penalty := coalesce((v_gr->>'penalty_score')::numeric, 0);
    v_status := coalesce(r.fit_status, 'unscored');

    if v_blocked or v_status = 'excluded' then
      v_class := 'blocked'; v_blocked_n := v_blocked_n + 1;
    elsif v_penalty > 0 or v_status = 'review_needed' then
      v_class := 'penalized'; v_penalized := v_penalized + 1;
    else
      v_class := 'eligible'; v_eligible := v_eligible + 1;
    end if;

    v_rows := v_rows || jsonb_build_object(
      'track_id', r.track_id,
      'title', r.title,
      'artist', r.artist,
      'order_index', r.order_index,
      'fit_score', r.fit_score,
      'fit_status', v_status,
      'guardrail_blocked', v_blocked,
      'guardrail_penalty', v_penalty,
      'guardrail_severity', v_gr->>'severity',
      'classification', v_class
    );
  end loop;

  return jsonb_build_object(
    'store_id', p_store_id,
    'playlist_id', p_playlist_id,
    'store_business_category', v_biz,
    'store_type_canonical', v_canon,
    'counts', jsonb_build_object('eligible', v_eligible, 'penalized', v_penalized, 'blocked', v_blocked_n,
                                 'total', v_eligible + v_penalized + v_blocked_n),
    'tracks', v_rows,
    'computed_at', now()
  );
end $$;
revoke all on function public._ai_store_candidate_pool_core(uuid, uuid) from public, anon;
grant execute on function public._ai_store_candidate_pool_core(uuid, uuid) to service_role;

-- ============================================================================
-- 2. AI queue-builder CORE — the "Fit → Queue" connection (preview). Non-blocked tracks ranked by
--    fit_score desc (eligible before penalized on equal score), capped at p_limit. Read-only; returns
--    an ORDERED candidate list. It does NOT write any queue and does NOT touch the live player.
-- ============================================================================
create or replace function public._ai_build_store_queue_core(p_store_id uuid, p_playlist_id uuid, p_limit int default 50)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_biz text;
  v_queue jsonb := '[]'::jsonb;
  r record;
  v_gr jsonb;
  v_pos int := 0;
begin
  select business_category into v_biz from public.users where id = p_store_id;

  for r in
    select pt.track_id, t.title, t.artist,
           coalesce(fs.fit_score, 0) as fit_score,
           coalesce(fs.penalty_score, 0) as fit_penalty,
           coalesce(fs.status, 'unscored') as fit_status
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
      left join public.playlist_track_fit_scores fs
        on fs.playlist_id = p_playlist_id and fs.track_id = pt.track_id
     where pt.playlist_id = p_playlist_id
       and coalesce(fs.status,'unscored') <> 'excluded'
       and coalesce((public._ai_check_store_guardrails(pt.track_id, coalesce(v_biz,''))->>'blocked')::boolean, false) = false
     order by coalesce(fs.fit_score, 0) desc,
              (case coalesce(fs.status,'unscored') when 'review_needed' then 1 else 0 end) asc,
              pt.order_index asc
     limit greatest(1, least(coalesce(p_limit, 50), 500))
  loop
    v_pos := v_pos + 1;
    v_queue := v_queue || jsonb_build_object(
      'position', v_pos, 'track_id', r.track_id, 'title', r.title, 'artist', r.artist,
      'fit_score', r.fit_score, 'fit_status', r.fit_status, 'guardrail_penalty', r.fit_penalty
    );
  end loop;

  return jsonb_build_object(
    'store_id', p_store_id, 'playlist_id', p_playlist_id,
    'store_type_canonical', public._ai_canonical_store_type(v_biz),
    'queue_length', v_pos, 'queue', v_queue, 'computed_at', now()
  );
end $$;
revoke all on function public._ai_build_store_queue_core(uuid, uuid, int) from public, anon;
grant execute on function public._ai_build_store_queue_core(uuid, uuid, int) to service_role;

-- ============================================================================
-- 3. Admin-gated PUBLIC preview wrappers. These are the only client-callable entry points, and they
--    are surfaced only behind the OFF-by-default "AI Runtime Preview" admin toggle. Admin only.
-- ============================================================================
create or replace function public.admin_ai_store_candidate_pool(p_store_id uuid, p_playlist_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return public._ai_store_candidate_pool_core(p_store_id, p_playlist_id);
end $$;
revoke all on function public.admin_ai_store_candidate_pool(uuid, uuid) from public, anon;
grant execute on function public.admin_ai_store_candidate_pool(uuid, uuid) to authenticated;

create or replace function public.admin_ai_build_store_queue(p_store_id uuid, p_playlist_id uuid, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return public._ai_build_store_queue_core(p_store_id, p_playlist_id, p_limit);
end $$;
revoke all on function public.admin_ai_build_store_queue(uuid, uuid, int) from public, anon;
grant execute on function public.admin_ai_build_store_queue(uuid, uuid, int) to authenticated;
