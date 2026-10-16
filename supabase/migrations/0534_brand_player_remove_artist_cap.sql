-- 0534_brand_player_remove_artist_cap.sql
--
-- 브랜드 플레이어의 아티스트당 곡수 상한(0503 에서 4 → 12)을 없앤다.
--
-- 왜
--   24시간 매장은 하루치 플레이리스트가 짧을수록 같은 곡을 자주 반복한다.
--   데모 본사(EROOMING)를 재즈(보컬/연주)·로파이로 좁히자 정책을 통과하는 곡은
--   298곡/13.8시간인데, 아티스트당 12곡 상한 때문에 238곡/11.2시간만 편성됐다.
--   장르·보컬·무드·BPM 정책이 이미 편성 범위를 정하므로, 아티스트 상한은 곡만
--   덜어낼 뿐 얻는 것이 없다.
--
-- 바뀌는 것
--   · diversified CTE(artist_rank) 와 `artist_rank <= 12` 필터를 지운다.
--   · 나머지(필터·점수·정렬·시드 회전)는 0508 정의 그대로다.
--   · `limit v_limit` 도 함께 지운다. 집계(jsonb_agg) 한 줄에 걸린 limit 이라 원래부터
--     아무것도 자르지 않았다 — 동작은 그대로이고 오해만 없앤다.
--
-- 영향 (2026-10-16 prod 재생성 결과)
--   데모 238 → 298곡, 루베르 190 → 244곡, 카공시대 190 → 244곡,
--   ming(장르 정책 없음) 1,116 → 2,042곡.
--
-- prod 에는 동일 정의가 `brand_player_remove_artist_cap` 으로 이미 적용돼 있다.

create or replace function public._brand_generate_playlist(p_brand_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v jsonb; pol public.brand_music_policies%rowtype;
  v_blocked_g text[]; v_pref_g text[]; v_blocked_m text[]; v_pref_m text[];
  v_allowed_g text[];
  v_limit int := greatest(1, least(coalesce(p_limit,200), 500));
  v_seed text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD') || ':' || p_brand_id::text;
  v_industry text; v_is_study boolean;
begin
  select * into pol from public.brand_music_policies where brand_id = p_brand_id;
  select industry_type into v_industry from public.brand_accounts where id = p_brand_id;
  v_is_study := coalesce(public.normalize_store_label(v_industry),'') = 'study_cafe'
    or lower(btrim(coalesce(v_industry,''))) in ('study_cafe','스터디카페','스터디 카페','독서실','study cafe','studycafe');

  v_blocked_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.blocked_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_pref_g    := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.preferred_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_blocked_m := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.blocked_moods,'{}')) m where btrim(m) <> ''), '{}');
  v_pref_m    := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.preferred_moods,'{}')) m where btrim(m) <> ''), '{}');
  v_allowed_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.allowed_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');

  with base as (
    select t.id, t.title, t.artist, t.genre, t.mood, t.audio_url, t.cover_url, t.duration, t.created_at,
           t.owner_user_id, t.instrumental, t.lyric_type, t.vocal_type, f.energy as feat_energy,
           coalesce(t.bpm, f.bpm) as feat_bpm,
           coalesce((select array_agg(distinct public._ai_norm_genre(z)) from unnest(array_remove(array[t.main_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) z where public._ai_norm_genre(z) <> ''), '{}') as norm_genres,
           lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(t.mood_tags,'{}'),' ') || ' ' || array_to_string(coalesce(m.ai_moods,'{}'),' ')) as mood_blob
    from public.tracks t
    left join public.track_audio_features f on f.track_id = t.id
    left join public.track_ai_metadata m on m.track_id = t.id
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.release_status = 'released' or t.release_status is null)
      and t.removed_at is null
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
      and (not v_is_study or coalesce((public._study_cafe_track_eligible(t.id)->>'eligible')::boolean, false))
  ),
  filtered as (
    select b.*,
      (case when pol.vocal_policy = 'instrumental_only' then (b.instrumental is true or b.lyric_type = 'instrumental' or b.vocal_type = 'instrumental') else true end) as vocal_ok,
      (case when b.feat_energy is null then true else (pol.energy_min is null or b.feat_energy >= pol.energy_min) and (pol.energy_max is null or b.feat_energy <= pol.energy_max) end) as energy_ok,
      (array_length(v_allowed_g,1) is null or exists (select 1 from unnest(v_allowed_g) ag where ag = any(b.norm_genres))) as allowed_ok,
      (case when b.feat_bpm is null then true else (pol.bpm_min is null or b.feat_bpm >= pol.bpm_min) and (pol.bpm_max is null or b.feat_bpm <= pol.bpm_max) end) as bpm_ok,
      (exists (select 1 from unnest(v_blocked_g) bg where bg = any(b.norm_genres))) as blocked_g_hit,
      (exists (select 1 from unnest(v_blocked_m) bm where b.mood_blob like '%'||bm||'%')) as blocked_m_hit,
      (select count(*) from unnest(v_pref_g) pg where pg = any(b.norm_genres)) as pref_g_hits,
      (select count(*) from unnest(v_pref_m) pm where b.mood_blob like '%'||pm||'%') as pref_m_hits,
      -- 🆕 0508: 최근 14일 신규 발매곡
      (b.created_at > now() - interval '14 days') as is_new_release
    from base b
  ),
  eligible as (
    select f.*,
      (f.pref_g_hits*25 + f.pref_m_hits*15 + case when f.energy_ok then 5 else 0 end
        + case when pol.vocal_policy='prefer_instrumental' and (f.instrumental is true or f.lyric_type='instrumental') then 10 else 0 end
        -- 🆕 0508: 신곡 가산점. preferred_genre 1개(25)보다 작게 두어 정책을 뒤집지 않는다.
        + case when f.is_new_release then 18 else 0 end)::numeric as score,
      ('x' || substr(md5(f.id::text || v_seed),1,8))::bit(32)::bigint as rot
    from filtered f
    where not f.blocked_g_hit and not f.blocked_m_hit and f.vocal_ok
      and f.allowed_ok and f.bpm_ok
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'artist', d.artist, 'genre', d.genre, 'mood', d.mood, 'audio_url', d.audio_url, 'cover_url', d.cover_url, 'duration', d.duration, 'created_at', d.created_at, 'is_new_release', d.is_new_release)
           order by (case when d.energy_ok then 1 else 0 end) desc, d.score desc, d.rot), '[]'::jsonb) into v
  -- 🆕 0534: 아티스트당 곡수 상한(12) 제거. 정책을 통과한 곡은 모두 편성한다.
  from eligible d;
  return v;
end;
$$;
