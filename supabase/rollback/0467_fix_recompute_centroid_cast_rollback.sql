-- =============================================================================
-- ROLLBACK for 0467_fix_recompute_centroid_cast.sql
--
-- Restores public.recompute_playlist_centroid() to the exact 0219 definition
-- (with the original `te.embedding::float8[]` cast). NOTE: reverting reinstates
-- the pre-existing blocker — all playlist_tracks writes will fail again on any
-- build lacking a vector→float8[] cast. Provided only for completeness.
--
-- Not a migration to run in sequence; execute manually if you must revert 0467.
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
    select te.embedding::float8[] as emb
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
