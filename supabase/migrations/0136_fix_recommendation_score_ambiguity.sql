-- 0136 — get_personalized_* 의 RETURNS TABLE score 컬럼이 user_music_preferences.score 를 가려
--   "column reference score is ambiguous" 발생 → 모든 score 참조를 테이블 별칭으로 한정.
create or replace function public.get_personalized_recommendations(p_limit int default 12)
returns table(track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration int, score numeric, reason text)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_total numeric := 0; v_mg numeric; v_mm numeric; v_ma numeric;
begin
  if v_uid is not null then
    perform public.refresh_user_music_preferences(v_uid);
    select coalesce(sum(p.score),0) into v_total from public.user_music_preferences p where p.user_id=v_uid;
  end if;

  if v_uid is null or v_total < 5 then
    return query
    with cand as (
      select t.*, coalesce((select count(*) from public.stream_events se where se.track_id=t.id and se.event_type='milestone_30s'),0) pop
      from public.tracks t
      where t.release_status='released' and coalesce(t.is_recommendable,true)=true
        and t.audio_url is not null and length(btrim(t.audio_url))>0
    ), ranked as (
      select c.*, row_number() over (partition by c.owner_user_id order by c.created_at desc) rn from cand c
    )
    select r.id, r.title, r.artist, coalesce(nullif(trim(r.genre),''), r.main_genre), r.mood, r.cover_url, r.audio_url, r.duration,
           round((0.5*(case when r.created_at>now()-interval '21 days' then 1 else 0.3 end) + 0.5*least(r.pop::numeric/20,1) + 0.05*r.recommendation_priority),4),
           '인기·신곡 추천'::text
    from ranked r where rn <= 2
    order by 9 desc, r.created_at desc limit p_limit;
    return;
  end if;

  select max(p.score) into v_mg from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='genre';
  select max(p.score) into v_mm from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='mood';
  select max(p.score) into v_ma from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='artist';

  return query
  with cand as (
    select t.*,
      coalesce((select g.score from public.user_music_preferences g where g.user_id=v_uid and g.preference_type='genre' and g.preference_key=coalesce(nullif(trim(t.genre),''),t.main_genre)),0) gsc,
      coalesce((select m.score from public.user_music_preferences m where m.user_id=v_uid and m.preference_type='mood' and m.preference_key=t.mood),0) msc,
      coalesce((select a.score from public.user_music_preferences a where a.user_id=v_uid and a.preference_type='artist' and a.preference_key=t.owner_user_id::text),0) asc_,
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

create or replace function public.get_personalized_playlists(p_limit int default 8)
returns table(id uuid, title text, description text, category text, cover_url text, track_count bigint, score numeric)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_total numeric := 0;
begin
  if v_uid is not null then
    perform public.refresh_user_music_preferences(v_uid);
    select coalesce(sum(p.score),0) into v_total from public.user_music_preferences p where p.user_id=v_uid;
  end if;

  return query
  with topg as (select lower(ump.preference_key) k from public.user_music_preferences ump where ump.user_id=v_uid and ump.preference_type='genre' order by ump.score desc limit 5),
       topm as (select ump.preference_key k from public.user_music_preferences ump where ump.user_id=v_uid and ump.preference_type='mood' order by ump.score desc limit 5),
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
