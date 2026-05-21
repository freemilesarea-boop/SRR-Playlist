-- 0108 — 스마트(자동) 플레이리스트 자동 노출 수정
--   원인1: is_auto=true 플레이리스트가 0개 → 기본 auto playlist seed
--   원인2: 매칭 RPC가 array 태그(business_tags/mood_tags 등)만 보는데, 업로드는
--          scalar(suitable_store/mood)만 채움 → 모든 곡 score 0 → tag rule 에서 제외.
--          → RPC가 scalar suitable_store/mood 도 매칭하도록 보강 (백필/업로드 RPC 변경 없이 호환).
--   추가: auto_playlist_counts() — 자동 플리는 playlist_tracks 가 없어 "0곡" 으로 보이므로
--         동적 매칭 수를 한 번에 반환해 UI 카운트/정렬 보정.
-- 정산/스트리밍/검수/결제 로직 변경 없음. playlist_tracks 저장 없음(동적 매칭 유지).

create or replace function public.get_auto_playlist_tracks(p_playlist_id uuid, p_limit integer default 100)
returns table(id uuid, title text, artist text, genre text, mood text, audio_url text, cover_url text, duration integer, created_at timestamp with time zone, score numeric)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  r jsonb;
  v_business text; v_time_slot text;
  v_moods text[]; v_situations text[];
  v_bpm_min int; v_bpm_max int; v_energy_min int; v_energy_max int;
  v_vocal text; v_fresh_days int; v_max_per_artist int; v_seed text;
  v_has_tag_rule boolean;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 200));
begin
  select p.auto_rule into r from public.playlists p where p.id = p_playlist_id and p.is_auto = true;
  if r is null then return; end if;

  v_business     := nullif(r->>'business_category', '');
  v_time_slot    := nullif(r->>'time_slot', '');
  v_moods        := case when r ? 'mood_tags' then array(select jsonb_array_elements_text(r->'mood_tags')) else '{}' end;
  v_situations   := case when r ? 'situation_tags' then array(select jsonb_array_elements_text(r->'situation_tags')) else '{}' end;
  v_bpm_min      := nullif(r->>'bpm_min','')::int;
  v_bpm_max      := nullif(r->>'bpm_max','')::int;
  v_energy_min   := nullif(r->>'energy_min','')::int;
  v_energy_max   := nullif(r->>'energy_max','')::int;
  v_vocal        := nullif(r->>'vocal_type','');
  v_fresh_days   := coalesce(nullif(r->>'freshness_boost_days','')::int, 0);
  v_max_per_artist := nullif(r->>'max_tracks_per_artist','')::int;
  v_seed         := coalesce(r->>'shuffle_seed', p_playlist_id::text);
  v_has_tag_rule := v_business is not null or v_time_slot is not null
                    or array_length(v_moods,1) is not null or array_length(v_situations,1) is not null;

  return query
  with scored as (
    select
      t.id as tid, t.title as ttitle, t.artist as tartist, t.genre as tgenre, t.mood as tmood,
      t.audio_url as taudio, t.cover_url as tcover, t.duration as tduration, t.created_at as tcreated,
      (
        coalesce(case when v_time_slot  is not null and v_time_slot = any(coalesce(t.time_slots,'{}')) then 15 else 0 end,0)
      -- business: array business_tags 또는 scalar suitable_store 매칭 (업로드는 scalar 만 채움)
      + coalesce(case when v_business is not null
                      and (v_business = any(coalesce(t.business_tags,'{}')) or t.suitable_store = v_business)
                      then 25 else 0 end,0)
      -- mood: array mood_tags overlap 또는 scalar mood 텍스트 부분일치
      + coalesce((select count(*) from unnest(v_moods) m
                  where m = any(coalesce(t.mood_tags,'{}')) or coalesce(t.mood,'') ilike '%'||m||'%'),0) * 20
      + coalesce((select count(*) from unnest(v_situations) s where s = any(coalesce(t.situation_tags,'{}'))),0) * 25
      + coalesce(case when v_business is not null and coalesce(t.lyric_type,'') in ('instrumental','soft_vocal') then 10 else 0 end,0)
      + coalesce(case when v_fresh_days > 0 and coalesce(t.released_at, t.created_at) >= now() - make_interval(days => v_fresh_days) then 20 else 0 end,0)
      )::numeric as tscore,
      ('x' || substr(md5(t.id::text || v_seed), 1, 8))::bit(32)::bigint as trot
    from public.tracks t
    where t.audio_url is not null and t.audio_url <> ''
      and (t.release_status = 'released' or t.release_status is null)
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
      and (v_bpm_min is null or coalesce(t.bpm, 0) >= v_bpm_min)
      and (v_bpm_max is null or coalesce(t.bpm, 9999) <= v_bpm_max)
      and (v_energy_min is null or coalesce(t.energy_level, 0) >= v_energy_min)
      and (v_energy_max is null or coalesce(t.energy_level, 9999) <= v_energy_max)
      and (v_vocal is null or coalesce(t.lyric_type,'') = v_vocal)
  ),
  filtered as (
    select * from scored s where (not v_has_tag_rule) or s.tscore > 0
  ),
  diversified as (
    select f.*,
      row_number() over (
        partition by coalesce(lower(btrim(f.tartist)), f.tid::text)
        order by f.tscore desc, f.trot
      ) as artist_rank
    from filtered f
  )
  select d.tid, d.ttitle, d.tartist, d.tgenre, d.tmood, d.taudio, d.tcover,
         d.tduration, d.tcreated, d.tscore
  from diversified d
  where v_max_per_artist is null or d.artist_rank <= v_max_per_artist
  order by d.tscore desc, d.trot
  limit v_limit;
end;
$function$;

-- 기본 auto playlist seed (status='released' 라야 RLS playlists_read_all 통과)
insert into public.playlists (title, category, business_category, time_slot, is_business_only, mood_tags, status, released_at, is_auto, auto_rule, sort_order)
select v.title, v.category, v.business_category, v.time_slot, v.is_business_only, v.mood_tags, 'released', now(), true, v.auto_rule::jsonb, v.sort_order
from (values
  ('와인바 · 저녁 무드', '와인바', '와인바', 'evening', true, array['잔잔한','감성적']::text[],
   '{"business_category":"와인바","time_slot":"evening","max_tracks_per_artist":3,"shuffle_seed":"wine-eve"}', 1),
  ('카페 · 오전 산뜻한 음악', '카페', '카페', 'morning', true, array['산뜻한','경쾌한']::text[],
   '{"business_category":"카페","time_slot":"morning","mood_tags":["산뜻한","경쾌한","잔잔한"],"max_tracks_per_artist":3,"shuffle_seed":"cafe-morn"}', 2),
  ('헬스장 · 에너지 음악', '헬스장', '헬스장', null, true, array['신나는','에너지']::text[],
   '{"business_category":"헬스장","mood_tags":["신나는","에너지","파워풀"],"max_tracks_per_artist":3,"shuffle_seed":"gym"}', 3),
  ('식당 · 낮 · 잔잔한 음악', '식당', '식당', 'afternoon', true, array['잔잔한','편안한']::text[],
   '{"business_category":"식당","time_slot":"afternoon","mood_tags":["잔잔한","편안한"],"max_tracks_per_artist":3,"shuffle_seed":"diner"}', 4),
  ('방금 올라온 신곡', '신곡', null, null, false, array[]::text[],
   '{"freshness_boost_days":60,"max_tracks_per_artist":10,"shuffle_seed":"fresh"}', 5)
) as v(title, category, business_category, time_slot, is_business_only, mood_tags, auto_rule, sort_order)
where not exists (
  select 1 from public.playlists p where p.is_auto = true and p.title = v.title
);

-- 자동 플리 동적 매칭 수 (UI 카운트/정렬 보정용)
create or replace function public.auto_playlist_counts()
returns table(playlist_id uuid, n integer)
language sql
stable security definer
set search_path to 'public'
as $function$
  select p.id, (select count(*)::int from public.get_auto_playlist_tracks(p.id, 200))
  from public.playlists p
  where p.is_auto = true and p.status = 'released';
$function$;

grant execute on function public.auto_playlist_counts() to anon, authenticated;
