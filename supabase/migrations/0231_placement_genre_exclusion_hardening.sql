-- 0231 — Placement genre exclusion hardening
--
-- 버그: main_genre='Rock' 이면서 mood='신나는', suitable_store='헬스장' 인 DMON 트랙들이
-- "호텔 라운지 · 고급스러운 재즈" / "와인바 · 저녁 무드" 플레이리스트에 자동 배치됨.
--
-- 원인 (35점 분해):
--   - daypart='evening' match → +10
--   - BPM in range → +10
--   - quality_score - 70 (≈85-70) → +15
--   - 합산 35 > threshold 30 → 배치
--   - genre/mood/business 모두 0 점인데 다른 요소만으로 통과됨
--   - auto_place_track() 가 genre_block_rules 를 읽지 않아 rock-in-hotel 차단 안 됨
--
-- 수정:
--   A. genre_block_rules 보강 (호텔/와인바/카페 라운지 × rock/metal/punk/hard rock 등)
--   B. ai_store_profiles 의 hotel_lobby/winebar/cocktail_bar blocked_genres/blocked_moods 보강
--   C. auto_place_track() 패치 — genre_block_rules 'block' 매치 시 -1000 페널티 (실질 차단)
--      예외: 같은 business 에 'allow' 패턴 (soft rock / acoustic 등) 이 매치되면 페널티 면제
--   D. admin_explain_placement — 단일 트랙 × 플레이리스트 점수 분해 (디버그용)
--   E. admin_find_mismatched_placements — 잘못 배치된 placement 검색
--   F. admin_cleanup_mismatched_placements (dryRun) — 자동 정리

-- ===== A. genre_block_rules 보강 =====
-- (genre_block_rules 는 UNIQUE 제약이 없는 듯하므로 NOT EXISTS 가드)

insert into public.genre_block_rules(business_category, block_kind, genre_pattern, reason)
select v.b, v.k, v.p, v.r
from (values
  -- 호텔 (라운지 포함) block
  ('호텔', 'block', 'rock', '호텔 라운지 부적합'),
  ('호텔', 'block', 'metal', '호텔 라운지 부적합'),
  ('호텔', 'block', 'punk', '호텔 라운지 부적합'),
  ('호텔', 'block', 'hard rock', '호텔 라운지 부적합'),
  ('호텔', 'block', 'hardstyle', '호텔 라운지 부적합'),
  ('호텔', 'block', 'hardcore', '호텔 라운지 부적합'),
  ('호텔', 'block', 'trap', '호텔 라운지 부적합'),
  ('호텔', 'block', 'drill', '호텔 라운지 부적합'),
  -- 호텔 allow (예외 — soft 계열은 허용)
  ('호텔', 'allow', 'jazz', '호텔 라운지 최적'),
  ('호텔', 'allow', 'classical', '호텔 라운지 최적'),
  ('호텔', 'allow', 'lounge', '호텔 라운지 최적'),
  ('호텔', 'allow', 'acoustic', '호텔 라운지 가능'),
  ('호텔', 'allow', 'soft rock', '호텔 라운지 예외 허용 (soft)'),
  ('호텔', 'allow', 'indie acoustic', '호텔 라운지 예외 허용'),
  -- 와인바 block
  ('와인바', 'block', 'rock', '와인바 부적합'),
  ('와인바', 'block', 'metal', '와인바 부적합'),
  ('와인바', 'block', 'punk', '와인바 부적합'),
  ('와인바', 'block', 'hard rock', '와인바 부적합'),
  ('와인바', 'block', 'hardstyle', '와인바 부적합'),
  ('와인바', 'block', 'hardcore', '와인바 부적합'),
  ('와인바', 'block', 'trap', '와인바 부적합'),
  ('와인바', 'block', 'drill', '와인바 부적합'),
  -- 와인바 allow
  ('와인바', 'allow', 'jazz', '와인바 최적'),
  ('와인바', 'allow', 'soul', '와인바 분위기'),
  ('와인바', 'allow', 'lounge', '와인바 분위기'),
  ('와인바', 'allow', 'soft rock', '와인바 예외 허용 (soft)'),
  ('와인바', 'allow', 'indie acoustic', '와인바 예외 허용'),
  -- 카페 라운지 block
  ('카페 라운지', 'block', 'rock', '카페 라운지 부적합'),
  ('카페 라운지', 'block', 'metal', '카페 라운지 부적합'),
  ('카페 라운지', 'block', 'punk', '카페 라운지 부적합'),
  ('카페 라운지', 'block', 'hard rock', '카페 라운지 부적합'),
  ('카페 라운지', 'block', 'trap', '카페 라운지 부적합'),
  -- 카페 라운지 allow
  ('카페 라운지', 'allow', 'jazz', '카페 라운지 최적'),
  ('카페 라운지', 'allow', 'lounge', '카페 라운지 최적'),
  ('카페 라운지', 'allow', 'acoustic', '카페 라운지 가능')
) as v(b,k,p,r)
where not exists (
  select 1 from public.genre_block_rules ex
  where ex.business_category = v.b and ex.block_kind = v.k and ex.genre_pattern = v.p
);

-- ===== B. ai_store_profiles 보강 =====
update public.ai_store_profiles
set blocked_genres = (
  select array_agg(distinct g order by g)
  from unnest(coalesce(blocked_genres, '{}'::text[]) || array['rock','metal','punk','hard rock','hardstyle']) as g
)
where store_key in ('hotel_lobby','winebar','cocktail_bar');

update public.ai_store_profiles
set blocked_moods = (
  select array_agg(distinct m order by m)
  from unnest(coalesce(blocked_moods, '{}'::text[]) || array['aggressive','intense','heavy','noisy']) as m
)
where store_key in ('hotel_lobby','winebar','cocktail_bar');

-- ===== C. auto_place_track() 패치 — block 룰 적용 =====
create or replace function public.auto_place_track(p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t record; a record; r record;
  v_artist_key text;
  v_threshold numeric := 30; v_max int := 5; v_artist_cap int := 3;
  v_placed int := 0; v_cand int := 0; v_log jsonb := '[]'::jsonb;
begin
  select * into t from public.tracks where id = p_track_id;
  if t.id is null then return jsonb_build_object('ok', false, 'reason', 'track_not_found'); end if;
  if coalesce(t.audio_url,'') = '' or not (t.release_status = 'released' or t.release_status is null) then
    insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
      values (p_track_id,'skipped',0,0, jsonb_build_object('reason','not_released_or_no_audio'));
    return jsonb_build_object('ok', true, 'status', 'skipped');
  end if;

  perform public.derive_track_analysis(p_track_id);
  select * into a from public.track_analysis where track_id = p_track_id;
  v_artist_key := lower(btrim(coalesce(t.artist,'')));
  select count(*) into v_cand from public.playlists where is_auto_generated = true and status = 'released';

  for r in
    select p.id, p.title,
      (
        coalesce(case when (a.genre is not null and exists(select 1 from unnest(p.genre_tags) g where lower(g)=lower(a.genre)))
                       or exists(select 1 from unnest(p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(t.genre_tags,'{}')) x))
                  then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(p.mood_tags) m where m = any(a.mood_tags) or lower(coalesce(t.mood,'')) = lower(m)) * 15, 0)
      + coalesce(case when p.business_category is not null and (t.suitable_store = p.business_category or p.business_category = any(coalesce(t.business_tags,'{}'))) then 20 else 0 end,0)
      + coalesce(case when p.daypart is not null and (p.daypart = any(coalesce(t.time_slots,'{}')) or 'all' = any(coalesce(t.time_slots,'{}'))) then 10 else 0 end,0)
      + coalesce(case when p.bpm_min is not null and a.bpm is not null then (case when a.bpm between p.bpm_min and coalesce(p.bpm_max,9999) then 10 else -10 end) else 0 end,0)
      + coalesce(case when p.energy_min is not null and a.energy is not null then (case when a.energy between p.energy_min and coalesce(p.energy_max,100) then 10 else -5 end) else 0 end,0)
      + coalesce(case when p.vocal_preference='vocal' then (case when coalesce(t.instrumental,false) then -10 else 10 end)
                      when p.vocal_preference='instrumental' then (case when coalesce(t.instrumental,false) then 10 else -10 end)
                      else 0 end,0)
      + coalesce(a.quality_score - 70, 0)
      + case when t.created_at >= now() - interval '30 days' then 5 else 0 end
      -- 🆕 genre_block_rules block 매치 시 -1000 (단, allow 패턴 매치 시 면제)
      + coalesce(case when p.business_category is not null and exists(
          select 1 from public.genre_block_rules gbr
          where gbr.business_category = p.business_category
            and gbr.block_kind = 'block'
            and (
              (a.genre is not null and position(lower(gbr.genre_pattern) in lower(a.genre)) > 0)
              or (lower(coalesce(t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')
              or (lower(coalesce(t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%')
              or exists(
                select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt
                where lower(gt) like '%' || lower(gbr.genre_pattern) || '%'
              )
            )
        )
        and not exists(
          select 1 from public.genre_block_rules gbr2
          where gbr2.business_category = p.business_category
            and gbr2.block_kind = 'allow'
            and (
              position(lower(gbr2.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
              or position(lower(gbr2.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
              or exists(
                select 1 from unnest(coalesce(t.genre_tags, '{}'::text[])) gt
                where position(lower(gbr2.genre_pattern) in lower(gt)) > 0
              )
            )
        )
        then -1000 else 0 end, 0)
      )::numeric as score
    from public.playlists p
    where p.is_auto_generated = true and p.status = 'released'
    order by score desc
  loop
    exit when v_placed >= v_max or r.score < v_threshold;
    if v_artist_key <> '' and (
      select count(*) from public.playlist_tracks pt join public.tracks tt on tt.id = pt.track_id
      where pt.playlist_id = r.id and lower(btrim(coalesce(tt.artist,''))) = v_artist_key
    ) >= v_artist_cap then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'artist_cap');
      continue;
    end if;
    begin
      insert into public.playlist_tracks(playlist_id, track_id, order_index, match_score, placement_reason, placed_by)
      values (r.id, p_track_id,
        coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id = r.id), 0),
        round(r.score,1),
        format('자동 배치 (genre/mood/업종/시간 적합 · score %s)', round(r.score,1)), 'auto');
      v_placed := v_placed + 1;
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'placed', true);
    exception when unique_violation then
      v_log := v_log || jsonb_build_object('playlist', r.title, 'score', round(r.score,1), 'skip', 'already_placed');
    end;
  end loop;

  insert into public.auto_placement_runs(track_id,status,candidate_count,placed_count,log_json)
  values (p_track_id, case when v_placed > 0 then 'placed' else 'review' end, v_cand, v_placed, v_log);
  return jsonb_build_object('ok', true, 'placed', v_placed, 'candidates', v_cand,
    'status', case when v_placed > 0 then 'placed' else 'review' end);
end; $$;

-- ===== D. admin_explain_placement — 단일 트랙 × 플레이리스트 점수 분해 =====
create or replace function public.admin_explain_placement(p_track_id uuid, p_playlist_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_t record; v_a record; v_p record;
  v_genre numeric := 0; v_mood numeric := 0; v_business numeric := 0;
  v_daypart numeric := 0; v_bpm numeric := 0; v_energy numeric := 0;
  v_vocal numeric := 0; v_quality numeric := 0; v_freshness numeric := 0;
  v_excl numeric := 0;
  v_block_reasons text[]; v_allow_exc text[];
  v_total numeric;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select * into v_t from public.tracks where id = p_track_id;
  if not found then raise exception 'track not found: %', p_track_id; end if;
  select * into v_p from public.playlists where id = p_playlist_id;
  if not found then raise exception 'playlist not found: %', p_playlist_id; end if;
  select * into v_a from public.track_analysis where track_id = p_track_id;

  v_genre := coalesce(case when (v_a.genre is not null and exists(select 1 from unnest(v_p.genre_tags) g where lower(g)=lower(v_a.genre)))
                            or exists(select 1 from unnest(v_p.genre_tags) g where lower(g) = any(select lower(x) from unnest(coalesce(v_t.genre_tags,'{}'::text[])) x))
                        then 25 else 0 end, 0);
  v_mood := coalesce((select count(*) from unnest(v_p.mood_tags) m where m = any(v_a.mood_tags) or lower(coalesce(v_t.mood,'')) = lower(m)) * 15, 0);
  v_business := coalesce(case when v_p.business_category is not null and (v_t.suitable_store = v_p.business_category or v_p.business_category = any(coalesce(v_t.business_tags,'{}'::text[]))) then 20 else 0 end, 0);
  v_daypart := coalesce(case when v_p.daypart is not null and (v_p.daypart = any(coalesce(v_t.time_slots,'{}'::text[])) or 'all' = any(coalesce(v_t.time_slots,'{}'::text[]))) then 10 else 0 end, 0);
  v_bpm := coalesce(case when v_p.bpm_min is not null and v_a.bpm is not null then (case when v_a.bpm between v_p.bpm_min and coalesce(v_p.bpm_max,9999) then 10 else -10 end) else 0 end, 0);
  v_energy := coalesce(case when v_p.energy_min is not null and v_a.energy is not null then (case when v_a.energy between v_p.energy_min and coalesce(v_p.energy_max,100) then 10 else -5 end) else 0 end, 0);
  v_vocal := coalesce(case when v_p.vocal_preference='vocal' then (case when coalesce(v_t.instrumental,false) then -10 else 10 end)
                            when v_p.vocal_preference='instrumental' then (case when coalesce(v_t.instrumental,false) then 10 else -10 end)
                            else 0 end, 0);
  v_quality := coalesce(v_a.quality_score - 70, 0);
  v_freshness := case when v_t.created_at >= now() - interval '30 days' then 5 else 0 end;

  if v_p.business_category is not null then
    select array_agg(gbr.genre_pattern || ' → ' || gbr.reason)
      into v_block_reasons
    from public.genre_block_rules gbr
    where gbr.business_category = v_p.business_category
      and gbr.block_kind = 'block'
      and (
        (v_a.genre is not null and position(lower(gbr.genre_pattern) in lower(v_a.genre)) > 0)
        or lower(coalesce(v_t.main_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
        or lower(coalesce(v_t.sub_genre,'')) like '%' || lower(gbr.genre_pattern) || '%'
        or exists(select 1 from unnest(coalesce(v_t.genre_tags,'{}'::text[])) gt where lower(gt) like '%' || lower(gbr.genre_pattern) || '%')
      );
    select array_agg(gbr.genre_pattern || ' → ' || gbr.reason)
      into v_allow_exc
    from public.genre_block_rules gbr
    where gbr.business_category = v_p.business_category
      and gbr.block_kind = 'allow'
      and (
        position(lower(gbr.genre_pattern) in lower(coalesce(v_t.main_genre,''))) > 0
        or position(lower(gbr.genre_pattern) in lower(coalesce(v_t.sub_genre,''))) > 0
        or exists(select 1 from unnest(coalesce(v_t.genre_tags,'{}'::text[])) gt where position(lower(gbr.genre_pattern) in lower(gt)) > 0)
      );
    if v_block_reasons is not null and array_length(v_block_reasons,1) > 0
       and (v_allow_exc is null or array_length(v_allow_exc,1) = 0) then
      v_excl := -1000;
    end if;
  end if;

  v_total := v_genre + v_mood + v_business + v_daypart + v_bpm + v_energy + v_vocal + v_quality + v_freshness + v_excl;

  return jsonb_build_object(
    'track', jsonb_build_object('id', v_t.id, 'title', v_t.title, 'artist', v_t.artist,
      'manual_main_genre', v_t.main_genre, 'manual_sub_genre', v_t.sub_genre,
      'manual_mood', v_t.mood, 'manual_mood_tags', v_t.mood_tags,
      'suitable_store', v_t.suitable_store, 'time_slots', v_t.time_slots,
      'genre_tags', v_t.genre_tags),
    'analysis', case when v_a is null then null else jsonb_build_object(
      'genre', v_a.genre, 'mood_tags', v_a.mood_tags, 'energy', v_a.energy,
      'bpm', v_a.bpm, 'quality_score', v_a.quality_score) end,
    'playlist', jsonb_build_object('id', v_p.id, 'title', v_p.title,
      'business_category', v_p.business_category, 'daypart', v_p.daypart,
      'genre_tags', v_p.genre_tags, 'mood_tags', v_p.mood_tags,
      'bpm_min', v_p.bpm_min, 'bpm_max', v_p.bpm_max,
      'energy_min', v_p.energy_min, 'energy_max', v_p.energy_max),
    'scores', jsonb_build_object(
      'genre', v_genre, 'mood', v_mood, 'business', v_business, 'daypart', v_daypart,
      'bpm', v_bpm, 'energy', v_energy, 'vocal', v_vocal,
      'quality', v_quality, 'freshness', v_freshness, 'exclude_penalty', v_excl),
    'block_reasons', v_block_reasons,
    'allow_exceptions', v_allow_exc,
    'final_score', v_total,
    'threshold', 30,
    'would_place', v_total >= 30,
    'metadata_source', 'manual_main_genre',
    'ai_prediction_taxonomy_v1', (
      select jsonb_build_object('main', predicted_main_genre, 'subs', predicted_sub_genres,
                                'confidence', genre_confidence, 'applied_at', applied_at)
      from public.track_ai_predictions where track_id = p_track_id and model_version = 'taxonomy-v1'
    )
  );
end; $$;
revoke all on function public.admin_explain_placement(uuid, uuid) from public, anon;
grant execute on function public.admin_explain_placement(uuid, uuid) to authenticated, service_role;

-- ===== E. 잘못 배치된 placement 검색 =====
create or replace function public.admin_find_mismatched_placements(
  p_business_pattern text default '%',
  p_genre_patterns text[] default array['rock','metal','punk','hard rock','hardstyle','hardcore','trap','drill']
)
returns table (
  playlist_id uuid, playlist_title text, business_category text,
  track_id uuid, title text, artist text,
  main_genre text, sub_genre text, mood text, suitable_store text,
  match_score numeric, placed_by text, placement_reason text, placed_at timestamptz,
  has_allow_exception boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  return query
  select
    p.id, p.title, p.business_category,
    t.id, t.title, t.artist,
    t.main_genre, t.sub_genre, t.mood, t.suitable_store,
    pt.match_score, pt.placed_by, pt.placement_reason, pt.created_at,
    exists (
      select 1 from public.genre_block_rules gbr
      where gbr.business_category = p.business_category
        and gbr.block_kind = 'allow'
        and (
          position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
          or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
        )
    )
  from public.playlist_tracks pt
  join public.playlists p on p.id = pt.playlist_id
  join public.tracks t on t.id = pt.track_id
  where t.removed_at is null
    and p.business_category is not null
    and p.business_category ilike p_business_pattern
    and exists(
      select 1 from unnest(p_genre_patterns) pat
      where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
         or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%'
    )
  order by p.title, pt.match_score desc nulls last;
end; $$;
revoke all on function public.admin_find_mismatched_placements(text, text[]) from public, anon;
grant execute on function public.admin_find_mismatched_placements(text, text[]) to authenticated, service_role;

-- ===== F. 자동 정리 (dryRun / 실행) =====
create or replace function public.admin_cleanup_mismatched_placements(
  p_dry_run boolean default true,
  p_business_pattern text default '%',
  p_genre_patterns text[] default array['rock','metal','punk','hard rock','hardstyle','hardcore','trap','drill'],
  p_reason text default 'genre-business mismatch cleanup (0231)'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_samples jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  with targets as (
    select pt.playlist_id, pt.track_id, p.title as playlist_title, t.title as track_title,
           t.main_genre, p.business_category, pt.match_score
    from public.playlist_tracks pt
    join public.playlists p on p.id = pt.playlist_id
    join public.tracks t on t.id = pt.track_id
    where t.removed_at is null
      and p.business_category is not null
      and p.business_category ilike p_business_pattern
      and exists(
        select 1 from unnest(p_genre_patterns) pat
        where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
           or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%'
      )
      and not exists (
        select 1 from public.genre_block_rules gbr
        where gbr.business_category = p.business_category
          and gbr.block_kind = 'allow'
          and (
            position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
            or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
          )
      )
  )
  select count(*), coalesce(jsonb_agg(to_jsonb(t) order by t.playlist_title, t.match_score desc nulls last), '[]'::jsonb)
    into v_count, v_samples
  from targets t;

  if p_dry_run then
    return jsonb_build_object(
      'ok', true, 'dryRun', true,
      'target_count', coalesce(v_count, 0),
      'samples', v_samples
    );
  end if;

  delete from public.playlist_tracks pt
  using public.playlists p, public.tracks t
  where pt.playlist_id = p.id and pt.track_id = t.id
    and t.removed_at is null
    and p.business_category is not null
    and p.business_category ilike p_business_pattern
    and exists(
      select 1 from unnest(p_genre_patterns) pat
      where lower(coalesce(t.main_genre,'')) like '%' || lower(pat) || '%'
         or lower(coalesce(t.sub_genre,'')) like '%' || lower(pat) || '%'
    )
    and not exists (
      select 1 from public.genre_block_rules gbr
      where gbr.business_category = p.business_category
        and gbr.block_kind = 'allow'
        and (
          position(lower(gbr.genre_pattern) in lower(coalesce(t.main_genre,''))) > 0
          or position(lower(gbr.genre_pattern) in lower(coalesce(t.sub_genre,''))) > 0
        )
    );
  get diagnostics v_count = row_count;

  return jsonb_build_object(
    'ok', true, 'dryRun', false,
    'removed_count', coalesce(v_count, 0),
    'reason', p_reason,
    'admin_id', auth.uid()
  );
end; $$;
revoke all on function public.admin_cleanup_mismatched_placements(boolean, text, text[], text) from public, anon;
grant execute on function public.admin_cleanup_mismatched_placements(boolean, text, text[], text) to authenticated, service_role;
