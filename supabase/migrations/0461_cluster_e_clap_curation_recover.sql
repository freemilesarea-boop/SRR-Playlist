-- 0461 — RPC-MIGRATION-RECOVERY-1DE · Cluster E: CLAP curation / playlist ops (Production-only drift recovery)
-- Test Supabase only. Production unchanged.
--
-- 배경: 5개 Cluster E RPC 가 Production 에만 존재. 종속 Table(clap_recommendations, playlists,
--   playlist_tracks, playlist_centroids)은 Test/repo 에 이미 존재 → 함수만 복구.
--
-- 보안:
--   · Reader 3개(list_clap_curation_playlists, list_clap_recommendations, list_clap_auto_approved)는
--     Production 에서 language sql + admin 검사 없음 → 시그니처/반환형 유지한 채 plpgsql + admin guard.
--   · Write 2개(rollback_clap_auto_attach, set_playlist_auto_attach)는 이미 admin guard + actor=auth.uid
--     → verbatim. Curation/Playlist 로직 변경 없음.
--   · playlists.auto_attach_enabled / auto_attach_threshold 는 Production 에만 존재(Test 컬럼 drift).
--     set_playlist_auto_attach 가 기록하고 list_clap_curation_playlists 가 읽으므로 Production 정의
--     (boolean not null default true / numeric not null default 65.00)로 복구한다.
--   · list_clap_recommendations 의 duration/energy_level 는 tracks 에서 integer 이나 반환 계약은
--     numeric/text → 선언 반환형 유지를 위해 명시적 cast(::numeric, ::text) 추가(계약 불변).

-- ══ 종속 Column 복구 (playlists Production-only drift) ═══════════════════════════
alter table public.playlists add column if not exists auto_attach_enabled boolean not null default true;
alter table public.playlists add column if not exists auto_attach_threshold numeric not null default 65.00;

-- ══ Admin Reader (SECURITY FIX: language sql + no guard → plpgsql + admin guard) ══
create or replace function public.list_clap_curation_playlists()
 returns table(playlist_id uuid, title text, business_category text, track_count integer, centroid_track_count integer, centroid_updated_at timestamp with time zone, pending_count integer, auto_approved_count integer, auto_attach_enabled boolean, auto_attach_threshold numeric)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    p.id as playlist_id,
    p.title,
    p.business_category,
    (select count(*)::int from public.playlist_tracks pt where pt.playlist_id = p.id) as track_count,
    pc.track_count as centroid_track_count,
    pc.updated_at as centroid_updated_at,
    (select count(*)::int from public.clap_recommendations cr where cr.playlist_id = p.id and cr.status='pending') as pending_count,
    (select count(*)::int from public.clap_recommendations cr where cr.playlist_id = p.id and cr.status='auto_approved') as auto_approved_count,
    p.auto_attach_enabled,
    p.auto_attach_threshold
  from public.playlists p
  left join public.playlist_centroids pc on pc.playlist_id = p.id
  where coalesce(p.status,'released') = 'released'
  order by pc.updated_at desc nulls last, p.sort_order;
end;
$function$;

create or replace function public.list_clap_recommendations(p_playlist_id uuid, p_limit integer default 20)
 returns table(id uuid, track_id uuid, title text, artist text, main_genre text, sub_genre text, cover_url text, audio_url text, duration numeric, energy_level text, audio_health_status text, clap_similarity numeric, genre_score numeric, mood_score numeric, energy_score numeric, quality_score numeric, total_score numeric, hard_block_reason text, status text, created_at timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    cr.id, cr.track_id,
    t.title, t.artist, t.main_genre, t.sub_genre, t.cover_url, t.audio_url, t.duration::numeric, t.energy_level::text, t.audio_health_status,
    cr.clap_similarity, cr.genre_score, cr.mood_score, cr.energy_score, cr.quality_score, cr.total_score,
    cr.hard_block_reason, cr.status, cr.created_at
  from public.clap_recommendations cr
  join public.tracks t on t.id = cr.track_id
  where cr.playlist_id = p_playlist_id and cr.status = 'pending'
  order by cr.total_score desc
  limit p_limit;
end;
$function$;

create or replace function public.list_clap_auto_approved(p_limit integer default 50)
 returns table(recommendation_id uuid, playlist_id uuid, playlist_title text, business_category text, track_id uuid, track_title text, track_artist text, cover_url text, audio_url text, main_genre text, sub_genre text, clap_similarity numeric, total_score numeric, attached_at timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    cr.id, cr.playlist_id, p.title, p.business_category,
    cr.track_id, t.title, t.artist, t.cover_url, t.audio_url, t.main_genre, t.sub_genre,
    cr.clap_similarity, cr.total_score, cr.reviewed_at
  from public.clap_recommendations cr
  join public.playlists p on p.id = cr.playlist_id
  join public.tracks t on t.id = cr.track_id
  where cr.status = 'auto_approved'
  order by cr.reviewed_at desc nulls last
  limit p_limit;
end;
$function$;

-- ══ Admin Write (verbatim — 이미 admin guard + actor=auth.uid) ══════════════════
create or replace function public.rollback_clap_auto_attach(p_recommendation_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_rec record;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_rec from public.clap_recommendations where id = p_recommendation_id;
  if v_rec is null then raise exception 'not_found'; end if;
  if v_rec.status <> 'auto_approved' then raise exception 'not_auto_approved'; end if;
  delete from public.playlist_tracks
  where playlist_id = v_rec.playlist_id and track_id = v_rec.track_id;
  update public.clap_recommendations
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_recommendation_id;
end;
$function$;

create or replace function public.set_playlist_auto_attach(p_playlist_id uuid, p_enabled boolean, p_threshold numeric)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_threshold < 0 or p_threshold > 100 then
    raise exception 'threshold must be 0-100';
  end if;
  update public.playlists
  set auto_attach_enabled = p_enabled,
      auto_attach_threshold = p_threshold
  where id = p_playlist_id;
end;
$function$;

-- ══ Grants (fail-closed: revoke PUBLIC, anon 없음, authenticated + 내부 admin guard) ══
revoke all on function public.list_clap_curation_playlists() from public;
revoke all on function public.list_clap_recommendations(uuid,integer) from public;
revoke all on function public.list_clap_auto_approved(integer) from public;
revoke all on function public.rollback_clap_auto_attach(uuid) from public;
revoke all on function public.set_playlist_auto_attach(uuid,boolean,numeric) from public;

grant execute on function public.list_clap_curation_playlists() to authenticated;
grant execute on function public.list_clap_recommendations(uuid,integer) to authenticated;
grant execute on function public.list_clap_auto_approved(integer) to authenticated;
grant execute on function public.rollback_clap_auto_attach(uuid) to authenticated;
grant execute on function public.set_playlist_auto_attach(uuid,boolean,numeric) to authenticated;

comment on function public.list_clap_curation_playlists() is 'RPC-MIGRATION-RECOVERY-1DE: admin-guarded (was over-exposed to authenticated in Production).';
comment on function public.list_clap_recommendations(uuid,integer) is 'RPC-MIGRATION-RECOVERY-1DE: admin-guarded (was over-exposed to authenticated in Production).';
comment on function public.list_clap_auto_approved(integer) is 'RPC-MIGRATION-RECOVERY-1DE: admin-guarded (was over-exposed to authenticated in Production).';
