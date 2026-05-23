-- 0135 — 개인화 추천 RPC (룰/가중치). 트랙/플레이리스트 + 콜드스타트 + removed 제외 + 다양성.
alter table public.playlists
  add column if not exists is_recommendable boolean not null default true,
  add column if not exists recommendation_priority int not null default 0;

-- refresh: genre 키를 coalesce(genre, main_genre) 로 (artist_upload 은 genre null, main_genre 사용)
create or replace function public.refresh_user_music_preferences(p_user_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_user_id is null then return; end if;
  with per_track as (
    select se.track_id, coalesce(nullif(trim(t.genre),''), t.main_genre) as genre, t.mood, se.artist_user_id,
           least(sum(
             (case se.event_type when 'complete' then 4 when 'milestone_30s' then 2 else 1 end)
             * (case when se.created_at > now()-interval '30 days' then 1.5
                     when se.created_at > now()-interval '90 days' then 1.0 else 0.4 end)), 14) as track_score,
           count(*) filter (where se.event_type in ('milestone_30s','complete')) as plays,
           count(*) filter (where se.completed) as completes,
           max(se.created_at) as last_at
    from public.stream_events se join public.tracks t on t.id = se.track_id
    where se.user_id = p_user_id and se.created_at > now()-interval '180 days'
      and se.event_type in ('start','milestone_30s','complete') and t.release_status='released'
    group by se.track_id, coalesce(nullif(trim(t.genre),''), t.main_genre), t.mood, se.artist_user_id
  ),
  liked as (
    select coalesce(nullif(trim(t.genre),''), t.main_genre) as genre, t.mood, t.owner_user_id as artist_user_id, 5::numeric bonus
    from public.liked_tracks lt join public.tracks t on t.id = lt.track_id
    where lt.user_id = p_user_id and t.release_status='released'
  ),
  combined as (
    select ptype, pkey, sum(sc) sc, sum(pc) pc, sum(cc) cc, max(la) la from (
      select 'genre'::text ptype, genre pkey, sum(track_score) sc, sum(plays) pc, sum(completes) cc, max(last_at) la from per_track where nullif(trim(coalesce(genre,'')),'') is not null group by genre
      union all select 'genre', genre, sum(bonus), 0,0,null from liked where nullif(trim(coalesce(genre,'')),'') is not null group by genre
      union all select 'mood', mood, sum(track_score), sum(plays), sum(completes), max(last_at) from per_track where nullif(trim(coalesce(mood,'')),'') is not null group by mood
      union all select 'mood', mood, sum(bonus), 0,0,null from liked where nullif(trim(coalesce(mood,'')),'') is not null group by mood
      union all select 'artist', artist_user_id::text, sum(track_score), sum(plays), sum(completes), max(last_at) from per_track where artist_user_id is not null group by artist_user_id
    ) x group by ptype, pkey
  )
  insert into public.user_music_preferences(user_id, preference_type, preference_key, score, play_count, completed_count, last_played_at, updated_at)
  select p_user_id, ptype, pkey, round(sc,2), pc, cc, la, now() from combined
  on conflict (user_id, preference_type, preference_key) do update set
    score=excluded.score, play_count=excluded.play_count, completed_count=excluded.completed_count,
    last_played_at=excluded.last_played_at, updated_at=now();
  delete from public.user_music_preferences ump
  where ump.user_id = p_user_id and ump.updated_at < now() - interval '1 second';
end; $function$;

-- 개인화 트랙 추천
create or replace function public.get_personalized_recommendations(p_limit int default 12)
returns table(track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration int, score numeric, reason text)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_total numeric := 0; v_mg numeric; v_mm numeric; v_ma numeric;
begin
  if v_uid is not null then
    perform public.refresh_user_music_preferences(v_uid);
    select coalesce(sum(score),0) into v_total from public.user_music_preferences where user_id=v_uid;
  end if;

  if v_uid is null or v_total < 5 then
    -- 콜드스타트: 최신 released + 인기 (recommendable), 아티스트 다양성
    return query
    with cand as (
      select t.*, coalesce((select count(*) from public.stream_events se where se.track_id=t.id and se.event_type='milestone_30s'),0) pop
      from public.tracks t
      where t.release_status='released' and coalesce(t.is_recommendable,true)=true
        and t.audio_url is not null and length(btrim(t.audio_url))>0
    ), ranked as (
      select c.*, row_number() over (partition by c.owner_user_id order by c.created_at desc) rn
      from cand c
    )
    select r.id, r.title, r.artist, coalesce(nullif(trim(r.genre),''), r.main_genre), r.mood, r.cover_url, r.audio_url, r.duration,
           round((0.5*(case when r.created_at>now()-interval '21 days' then 1 else 0.3 end) + 0.5*least(r.pop::numeric/20,1) + 0.05*r.recommendation_priority),4),
           '인기·신곡 추천'::text
    from ranked r where rn <= 2
    order by 9 desc, r.created_at desc limit p_limit;
    return;
  end if;

  select max(score) into v_mg from public.user_music_preferences where user_id=v_uid and preference_type='genre';
  select max(score) into v_mm from public.user_music_preferences where user_id=v_uid and preference_type='mood';
  select max(score) into v_ma from public.user_music_preferences where user_id=v_uid and preference_type='artist';

  return query
  with cand as (
    select t.*,
      coalesce((select score from public.user_music_preferences g where g.user_id=v_uid and g.preference_type='genre' and g.preference_key=coalesce(nullif(trim(t.genre),''),t.main_genre)),0) gsc,
      coalesce((select score from public.user_music_preferences m where m.user_id=v_uid and m.preference_type='mood' and m.preference_key=t.mood),0) msc,
      coalesce((select score from public.user_music_preferences a where a.user_id=v_uid and a.preference_type='artist' and a.preference_key=t.owner_user_id::text),0) asc_,
      coalesce((select count(*) from public.stream_events se where se.track_id=t.id and se.event_type='milestone_30s'),0) pop,
      coalesce((select count(*) from public.stream_events se where se.user_id=v_uid and se.track_id=t.id and se.event_type='milestone_30s'),0) myplays
    from public.tracks t
    where t.release_status='released' and coalesce(t.is_recommendable,true)=true
      and t.audio_url is not null and length(btrim(t.audio_url))>0
  ),
  scored as (
    select c.*,
      ( 0.35*(case when coalesce(v_mg,0)>0 then c.gsc/v_mg else 0 end)
      + 0.25*(case when coalesce(v_mm,0)>0 then c.msc/v_mm else 0 end)
      + 0.15*(case when coalesce(v_ma,0)>0 then c.asc_/v_ma else 0 end)
      + 0.15*(case when c.created_at>now()-interval '21 days' then 1 when c.created_at>now()-interval '60 days' then 0.5 else 0.1 end)
      + 0.10*least(c.pop::numeric/20,1)
      + 0.02*c.recommendation_priority
      - (case when c.myplays>=5 then 0.4 when c.myplays>=2 then 0.2 else 0 end) ) as rec_score
    from cand c
  ),
  ranked as (
    select s.*, row_number() over (partition by s.owner_user_id order by rec_score desc) artist_rn from scored s where rec_score > 0
  )
  select r.id, r.title, r.artist, coalesce(nullif(trim(r.genre),''), r.main_genre), r.mood, r.cover_url, r.audio_url, r.duration,
         round(r.rec_score,4),
         (case when r.gsc>0 and r.gsc=greatest(r.gsc,r.msc,r.asc_) then '자주 듣는 장르'
               when r.msc>0 and r.msc>=r.gsc then '자주 듣는 분위기'
               when r.asc_>0 then '관심 아티스트'
               when r.created_at>now()-interval '21 days' then '신곡'
               else '추천' end)::text
  from ranked r where artist_rn <= 2
  order by rec_score desc limit p_limit;
end; $function$;
grant execute on function public.get_personalized_recommendations(int) to anon, authenticated;

-- 개인화 플레이리스트 추천 (태그 overlap + 공개곡 수 + boost)
create or replace function public.get_personalized_playlists(p_limit int default 8)
returns table(id uuid, title text, description text, category text, cover_url text, track_count bigint, score numeric)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_total numeric := 0;
begin
  if v_uid is not null then
    perform public.refresh_user_music_preferences(v_uid);
    select coalesce(sum(score),0) into v_total from public.user_music_preferences where user_id=v_uid;
  end if;

  return query
  with topg as (select lower(preference_key) k from public.user_music_preferences where user_id=v_uid and preference_type='genre' order by score desc limit 5),
       topm as (select preference_key k from public.user_music_preferences where user_id=v_uid and preference_type='mood' order by score desc limit 5),
  cand as (
    select p.id, p.title, p.description, p.category, p.genre_tags, p.mood_tags, p.recommendation_priority, p.created_at, p.is_auto_generated,
      (select count(*) from public.playlist_tracks pt join public.tracks t on t.id=pt.track_id where pt.playlist_id=p.id and t.release_status='released') pub_tracks,
      (select count(*) from unnest(coalesce(p.genre_tags,'{}')) g where lower(g) in (select k from topg)) g_ov,
      (select count(*) from unnest(coalesce(p.mood_tags,'{}')) m where m in (select k from topm)) m_ov
    from public.playlists p
    where p.status='released' and coalesce(p.is_recommendable,true)=true
  )
  select c.id, c.title, c.description, c.category,
    case when c.is_auto_generated then public.auto_playlist_cover_url(c.id) else public.playlist_cover_url(c.id) end,
    c.pub_tracks,
    round( (c.g_ov*1.0 + c.m_ov*0.8 + c.recommendation_priority*0.5
            + (case when v_total < 5 then least(c.pub_tracks::numeric/10,1) else 0 end)
            + (case when c.created_at>now()-interval '30 days' then 0.3 else 0 end)), 3)
  from cand c
  where c.pub_tracks >= 3 and (v_total < 5 or (c.g_ov + c.m_ov) > 0)
  order by 7 desc, c.pub_tracks desc limit p_limit;
end; $function$;
grant execute on function public.get_personalized_playlists(int) to anon, authenticated;
