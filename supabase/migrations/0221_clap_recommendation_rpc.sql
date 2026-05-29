-- 0221 — CLAP 추천 RPC (이미 prod 적용)
--
-- generate_clap_recommendations(playlist_id, limit) — top-N 추천 생성
-- decide_clap_recommendation(recommendation_id, approve) — 운영자 결정

create or replace function public.generate_clap_recommendations(
  p_playlist_id uuid,
  p_limit int default 10
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_centroid vector(512);
  v_business_cat text;
  v_inserted int := 0;
begin
  select pc.embedding into v_centroid from public.playlist_centroids pc where pc.playlist_id = p_playlist_id;
  if v_centroid is null then return 0; end if;
  select p.business_category into v_business_cat from public.playlists p where p.id = p_playlist_id;

  delete from public.clap_recommendations where playlist_id = p_playlist_id and status = 'pending';

  with candidates as (
    select t.id as track_id, t.main_genre, t.sub_genre, t.energy_level, t.audio_health_status,
           (1 - (te.embedding <=> v_centroid)) as clap_sim
    from public.tracks t
    join public.track_embeddings te on te.track_id = t.id and te.model_version = 'laion-clap-music-v1'
    where t.visibility_status = 'approved' and t.removed_at is null
      and t.id not in (select track_id from public.playlist_tracks where playlist_id = p_playlist_id)
  ),
  scored as (
    select c.*,
      (
        select string_agg(gbr.genre_pattern, ', ') from public.genre_block_rules gbr
        where gbr.business_category = v_business_cat and gbr.block_kind = 'block'
          and (lower(coalesce(c.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
            or lower(coalesce(c.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')
      ) as block_reason,
      case when v_business_cat is null then 10
        when exists (select 1 from public.genre_block_rules gbr
          where gbr.business_category = v_business_cat and gbr.block_kind = 'allow'
            and (lower(coalesce(c.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
              or lower(coalesce(c.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')
        ) then 20 else 5 end::numeric(5,2) as genre_score,
      0::numeric(5,2) as mood_score,
      case when c.energy_level is null then 5 else 10 end::numeric(5,2) as energy_score,
      case when c.audio_health_status = 'ok' or c.audio_health_status is null then 5
        when c.audio_health_status in ('conversion_failed','unreachable') then 0 else 2 end::numeric(5,2) as quality_score
    from candidates c
  )
  insert into public.clap_recommendations(
    playlist_id, track_id, clap_similarity, genre_score, mood_score, energy_score, quality_score,
    total_score, hard_block_reason, status
  )
  select p_playlist_id, s.track_id, s.clap_sim::numeric(6,4),
    s.genre_score, s.mood_score, s.energy_score, s.quality_score,
    (greatest(0, s.clap_sim) * 50 + s.genre_score + s.mood_score + s.energy_score + s.quality_score)::numeric(5,2),
    s.block_reason, 'pending'
  from scored s
  where s.block_reason is null
  order by (greatest(0, s.clap_sim) * 50 + s.genre_score + s.mood_score + s.energy_score + s.quality_score) desc
  limit p_limit;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function public.generate_clap_recommendations(uuid, int) from public, anon;
grant execute on function public.generate_clap_recommendations(uuid, int) to authenticated, service_role;

create or replace function public.decide_clap_recommendation(p_recommendation_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_rec record; v_max_order int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_rec from public.clap_recommendations where id = p_recommendation_id;
  if v_rec is null then raise exception 'recommendation_not_found'; end if;

  if p_approve then
    select coalesce(max(order_index), -1) into v_max_order
    from public.playlist_tracks where playlist_id = v_rec.playlist_id;
    insert into public.playlist_tracks(playlist_id, track_id, order_index)
    values (v_rec.playlist_id, v_rec.track_id, v_max_order + 1)
    on conflict do nothing;
    update public.clap_recommendations
      set status='approved', reviewed_by=auth.uid(), reviewed_at=now() where id = p_recommendation_id;
  else
    update public.clap_recommendations
      set status='rejected', reviewed_by=auth.uid(), reviewed_at=now() where id = p_recommendation_id;
  end if;
end;
$$;

revoke all on function public.decide_clap_recommendation(uuid, boolean) from public, anon;
grant execute on function public.decide_clap_recommendation(uuid, boolean) to authenticated, service_role;
