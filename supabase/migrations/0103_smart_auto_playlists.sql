-- 0103 — 동적 스마트 플레이리스트 (옵션 A)
-- playlists.is_auto + auto_rule jsonb. 트랙은 저장 없이 조회 시점 실시간 매칭.
-- playlist_tracks 자동 insert 없음. 정산/스트리밍 무관.

alter table public.playlists
  add column if not exists is_auto boolean not null default false,
  add column if not exists auto_rule jsonb;

create index if not exists tracks_released_audio_idx
  on public.tracks (release_status)
  where audio_url is not null and audio_url <> '';

-- 실시간 자동 플리 트랙 RPC
-- auto_rule: {business_category, time_slot, mood_tags[], situation_tags[],
--   bpm_min, bpm_max, energy_min, energy_max, vocal_type, freshness_boost_days,
--   max_tracks_per_artist, shuffle_seed}
-- ⚠ RETURNS TABLE OUT 파라미터(id/artist/score 등)와의 ambiguity 회피 위해
--   본문 전 컬럼을 t./CTE alias 로 qualify (lazy-bind 42702 방지).
create or replace function public.get_auto_playlist_tracks(p_playlist_id uuid, p_limit int default 100)
returns table(
  id uuid, title text, artist text, genre text, mood text,
  audio_url text, cover_url text, duration int, created_at timestamptz,
  score numeric
)
language plpgsql stable security definer set search_path = public as $$
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
      + coalesce(case when v_business   is not null and v_business  = any(coalesce(t.business_tags,'{}')) then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(v_moods) m where m = any(coalesce(t.mood_tags,'{}'))),0) * 20
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
$$;
grant execute on function public.get_auto_playlist_tracks(uuid, int) to anon, authenticated;
