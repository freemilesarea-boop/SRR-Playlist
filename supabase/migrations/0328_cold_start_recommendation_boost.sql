-- 0328 — 추천 콜드 스타트 boost (X6.46, Tier 3.2)
--
-- 분석 보고서 Tier 3.2:
--   현재 get_personalized_recommendations 콜드스타트 (v_total < 5) 경로:
--     score = 0.5*recency(21d=1, else 0.3) + 0.5*all_time_pop/20 + 0.05*priority
--     diversity = max 2 per artist
--
--   문제점:
--     1) 카탈로그가 신생이라 모든 트랙이 21d 이내 → recency 가 모두 1 → ordering 의미 상실
--     2) all_time popularity 만 사용 → 7일 trending track 이 묻힘
--     3) 장르 다양성 제약 없음 → 한 장르가 결과를 지배 가능
--     4) 완주율 (quality) 신호 무시
--     5) 최근 좋아요 수 신호 무시 (가입 1일된 사용자에게도 활용 가능)
--
-- 변경 (cold-start 만, personalized path 는 그대로):
--   1) trending_7d (last 7d milestone_30s count) 추가, all_time_pop 와 분리
--   2) completion_ratio (last 30d complete / (milestone_30s+1)) — quality 신호
--   3) recent_likes (last 7d 좋아요 count) — soft trending
--   4) 장르 다양성: row_number partition by genre (max 3) 추가
--   5) scoring 가중치 재배분:
--      0.30 * trending_7d (count/10 cap)
--      0.25 * all_time_pop (count/30 cap)
--      0.20 * completion_ratio
--      0.10 * recent_likes (count/3 cap)
--      0.10 * recency (21d=1, 60d=0.5, else 0.1) — 신생 카탈로그 후에도 의미 보존
--      0.05 * recommendation_priority/10
--
-- 정책 보존:
--   - personalized path (v_total >= 5) 그대로
--   - cold-start threshold (v_total < 5) 동일 — 좋아요 1건 = 5점 → 즉시 personalized 전환
--   - 다양성 우선 (장르 max 3 + 아티스트 max 2)
--   - return signature 동일 (track_id, title, artist, genre, mood, cover_url, audio_url, duration, score, reason)

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
    -- X6.46 콜드스타트 boost: trending(7d) + completion_ratio + recent_likes + 장르 다양성
    return query
    with cand as (
      select t.*,
        -- 7d trending milestone_30s
        coalesce((
          select count(*) from public.stream_events se
          where se.track_id = t.id and se.event_type = 'milestone_30s'
            and se.created_at > now() - interval '7 days'
        ), 0)::int as trending_7d,
        -- all-time milestone_30s (popularity proxy)
        coalesce((
          select count(*) from public.stream_events se
          where se.track_id = t.id and se.event_type = 'milestone_30s'
        ), 0)::int as all_time_pop,
        -- 30d completion ratio (complete / (milestone_30s + 1) to avoid /0)
        coalesce((
          select count(*) filter (where se.event_type = 'complete')::numeric
               / nullif(count(*) filter (where se.event_type = 'milestone_30s') + 1, 0)
          from public.stream_events se
          where se.track_id = t.id and se.created_at > now() - interval '30 days'
        ), 0)::numeric as completion_ratio,
        -- 7d recent likes (soft trending)
        coalesce((
          select count(*) from public.liked_tracks lt
          where lt.track_id = t.id and lt.created_at > now() - interval '7 days'
        ), 0)::int as recent_likes
      from public.tracks t
      where t.release_status = 'released'
        and coalesce(t.is_recommendable, true) = true
        and t.audio_url is not null
        and length(btrim(t.audio_url)) > 0
        -- 0324 audio_health 가 'failed' 인 트랙 제외 (NULL/passed/unknown 은 통과)
        and coalesce(t.audio_health_status, 'unknown') <> 'failed'
    ),
    scored as (
      select c.*,
        ( 0.30 * least(c.trending_7d::numeric / 10, 1)
        + 0.25 * least(c.all_time_pop::numeric / 30, 1)
        + 0.20 * least(c.completion_ratio, 1)
        + 0.10 * least(c.recent_likes::numeric / 3, 1)
        + 0.10 * (case when c.created_at > now() - interval '21 days' then 1.0
                       when c.created_at > now() - interval '60 days' then 0.5
                       else 0.1 end)
        + 0.05 * (c.recommendation_priority::numeric / 10)
        ) as rec_score
      from cand c
    ),
    ranked as (
      select s.*,
        row_number() over (
          partition by s.owner_user_id order by rec_score desc, s.created_at desc
        ) as artist_rn,
        row_number() over (
          partition by coalesce(nullif(trim(s.genre), ''), s.main_genre)
          order by rec_score desc, s.created_at desc
        ) as genre_rn
      from scored s
    )
    select r.id, r.title, r.artist,
           coalesce(nullif(trim(r.genre), ''), r.main_genre),
           r.mood, r.cover_url, r.audio_url, r.duration,
           round(r.rec_score, 4),
           (case
              when r.trending_7d > 0 and r.trending_7d >= 5 then '지금 뜨는 곡'
              when r.recent_likes > 0 then '최근 인기'
              when r.completion_ratio > 0.7 then '끝까지 들은 곡'
              when r.created_at > now() - interval '21 days' then '신곡'
              else '인기·신곡 추천'
            end)::text as reason
    from ranked r
    where r.artist_rn <= 2 and r.genre_rn <= 3
    order by r.rec_score desc, r.created_at desc
    limit p_limit;
    return;
  end if;

  -- personalized path — 변경 없음 (X6.46 은 cold-start 만 boost)
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
  select r.id, r.title, r.artist, coalesce(nullif(trim(r.genre), ''), r.main_genre), r.mood, r.cover_url, r.audio_url, r.duration,
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
