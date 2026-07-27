-- =============================================================================
-- 0467_fix_recompute_centroid_cast.sql — forward-only minimal blocker fix
--
-- WHY: migration 0219 defined public.recompute_playlist_centroid() using the
--   cast `te.embedding::float8[]`. This pgvector build has NO vector→float8[]
--   (double precision[]) cast, so the expression fails at PLAN time — even for
--   zero rows. Because tg_playlist_tracks_centroid runs recompute on EVERY
--   INSERT/DELETE/UPDATE of playlist_tracks (FOR EACH ROW), *all* writes to
--   playlist_tracks fail ("cannot cast type vector to double precision[]").
--   This blocks both the existing PlaylistEditor per-row writes and the new
--   admin playlist Save/Clone RPCs (0466).
--
-- FIX (minimal, behavior-preserving): replace ONLY the cast with the supported
--   `::real[]::float8[]` form. pgvector supports vector→real[]; real[]→float8[]
--   is the standard element-wise widening cast. The stored embedding is float4
--   internally, so vector→real[] is exact and real[]→float8[] widens without
--   loss — the resulting float8[] values, the averaging math, and the written
--   centroid are identical to what 0219 intended. Nothing else changes.
--
-- SCOPE GUARANTEES (per request):
--   * 0219 file is NOT edited; this is a separate forward-only migration.
--   * Only the cast expression changes; centroid computation semantics kept.
--   * No other trigger/function/schema is touched. _tg_recompute_centroid,
--     tg_playlist_tracks_centroid, grants, and all tables remain as-is
--     (CREATE OR REPLACE preserves existing ACLs).
--   * Rollback: see 0467_fix_recompute_centroid_cast.rollback.sql.
-- =============================================================================

create or replace function public.recompute_playlist_centroid(p_playlist_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count int := 0;
  v_dims constant int := 512;
  v_sum float8[];
  v_emb_arr float8[];
  v_avg vector;
  r record;
begin
  v_sum := array_fill(0::float8, ARRAY[v_dims]);
  for r in
    select te.embedding::real[]::float8[] as emb   -- 0467: was ::float8[] (unsupported cast)
    from public.playlist_tracks pt
    join public.track_embeddings te on te.track_id = pt.track_id
    where pt.playlist_id = p_playlist_id and te.model_version = 'laion-clap-music-v1'
  loop
    v_emb_arr := r.emb;
    for i in 1..v_dims loop v_sum[i] := v_sum[i] + v_emb_arr[i]; end loop;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    delete from public.playlist_centroids where playlist_id = p_playlist_id;
    return;
  end if;

  for i in 1..v_dims loop v_sum[i] := v_sum[i] / v_count; end loop;
  v_avg := v_sum::vector;

  insert into public.playlist_centroids(playlist_id, embedding, track_count, updated_at)
  values (p_playlist_id, v_avg, v_count, now())
  on conflict (playlist_id) do update
    set embedding = excluded.embedding,
        track_count = excluded.track_count,
        updated_at = now();
end;
$function$;
