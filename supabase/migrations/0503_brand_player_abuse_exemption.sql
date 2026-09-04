-- ============================================================================
-- 0503_brand_player_abuse_exemption.sql
-- Phase BRAND-PLAYER-ABUSE-EXEMPTION-1
--
-- 배경: 어뷰징 정책(0275/0086)은 "같은 계정이 같은 곡을 하루 3회 넘게 재생하면
--   어뷰징" 이라는 개인 청취 기준이다. 24시간 무인 매장은 같은 곡을 하루 9~10회
--   돌리는 게 정상 운영이라, 지금 구조에서는 재생의 70%가 daily_user_track_cap 으로
--   제외되고 매장이 admin_list_abuse_candidates 에 어뷰저로 뜬다.
--   (실측: 최근 7일 milestone_30s 5,077건 중 3,768건(74%)이 캡에 걸림)
--
-- 결정: 브랜드 플레이어 재생은 어뷰징 정책에서 면제하고, 재생 수를 그대로
--   차트·정산에 반영한다. 매장에 특화된 음악을 만드는 아티스트가 차트에 오르는
--   구조를 의도한 것.
--
-- ⚠ 영향 (의도된 것): 24시간 매장 1곳이 하루 약 550 유효 스트림을 만든다.
--   현재 서비스 전체 유효 스트림이 주당 1,309건이므로, 매장이 늘어날수록
--   차트·정산 분배가 매장 재생 중심으로 재편된다.
--
-- ── 면제 판정은 서버가 검증한다 ────────────────────────────────────────────
--   source_page 는 클라이언트가 보내는 값이라 그것만으로 면제하면 누구나
--   '/brand/player/x' 를 위조해 무제한 적립할 수 있다. 그래서
--   _is_brand_player_stream() 이 **살아 있는 brand_player_sessions 행**까지 확인한다.
--
-- ── 면제하지 않는 가드 (그대로 유지) ───────────────────────────────────────
--   • bot UA / too_short / unreleased / admin_preview / artist_preview
--   • self_play   — 아티스트가 자기 곡을 매장에서 돌려 정산을 받는 건 여전히 차단
--   • muted_play  — 볼륨 0(무음)은 어떤 기준으로도 청취가 아니다
--   • dedup_30s_window — 30초 내 같은 곡 중복 적립 방지 (매장 운영과 무관)
--   면제 대상은 딱 두 개: daily_user_track_cap, low_player_volume(<0.1).
--   매장 배경음악은 낮은 볼륨이 정상이라 low_player_volume 은 오탐이다.
--
-- ── 함께 적용: 브랜드 플레이리스트 아티스트당 곡수 상한 4 → 12 ─────────────
--   스터디카페 하드필터(0463)를 통과하는 곡이 170곡/26팀인데 아티스트당 4곡
--   상한 때문에 74곡(약 3시간 20분)만 나온다. 12곡으로 완화하면 약 140곡
--   (약 6시간) 이 되어 24시간 매장의 반복감이 줄어든다.
--
-- 불변식: stream_events 기존 행 무변경(백필 없음). 차트/정산 RPC 본문 무변경
--   (전부 is_effective=true 를 보므로 트리거만 바꾸면 자동 반영된다).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 브랜드 플레이어 재생 판정 — 서버 검증
--    source_page 형식 + 그 사용자의 살아 있는 브랜드 플레이어 세션 존재를 함께 본다.
--    heartbeat 는 60초 주기지만 백그라운드 탭에서 5분 이상 지연되는 것이 관측돼
--    여유를 두고 15분 window 를 쓴다.
-- ----------------------------------------------------------------------------
create or replace function public._is_brand_player_stream(p_source_page text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(p_source_page, '') like '/brand/player%'
     and p_user_id is not null
     and exists (
       select 1
         from public.brand_player_sessions s
        where s.user_id = p_user_id
          and s.revoked_at is null
          and (s.expires_at is null or s.expires_at > now())
          and s.last_seen_at > now() - interval '15 minutes'
     );
$$;
comment on function public._is_brand_player_stream(text, uuid) is
  '0503 — 브랜드 플레이어 재생 여부(서버 검증). source_page 위조만으로는 통과하지 못한다.';

-- ----------------------------------------------------------------------------
-- 2) stream_events 트리거 — 브랜드 플레이어는 daily_user_track_cap 미적용
--    rank 는 그대로 계산해 기록한다(관측용). is_effective 만 강제 true.
-- ----------------------------------------------------------------------------
create or replace function public._stream_events_set_effective()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rank int;
  v_kst_date date;
  v_brand boolean;
begin
  v_kst_date := (coalesce(new.created_at, now()) at time zone 'Asia/Seoul')::date;
  new.effective_play_date_kst := v_kst_date;

  if new.event_type = 'milestone_30s' and new.user_id is not null then
    select count(*) + 1 into v_rank
    from public.stream_events
    where user_id = new.user_id
      and track_id = new.track_id
      and event_type = 'milestone_30s'
      and effective_play_date_kst = v_kst_date;

    new.daily_user_track_rank := v_rank;

    -- 🆕 0503: 브랜드 플레이어(무인 24시간 매장)는 반복 재생이 정상 운영이다.
    v_brand := public._is_brand_player_stream(new.source_page, new.user_id);

    if v_brand then
      new.is_effective := true;
      new.excluded_reason := null;
    elsif v_rank > 3 then
      new.is_effective := false;
      new.excluded_reason := 'daily_user_track_cap';
    else
      new.is_effective := true;
      new.excluded_reason := null;
    end if;
  end if;

  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) record_stream_event_safe — 브랜드 플레이어는 24h cap / low_player_volume 면제
--    prod 정의를 그대로 옮기고 두 분기에만 v_brand 조건을 추가한다.
-- ----------------------------------------------------------------------------
create or replace function public.record_stream_event_safe(
  p_track_id uuid, p_session_id text, p_event_type text,
  p_listened_seconds integer default 0, p_completed boolean default false,
  p_playlist_id uuid default null, p_anonymous_id text default null,
  p_source_page text default null, p_user_agent text default null,
  p_player_volume numeric default null, p_player_muted boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_track record;
  v_eligible boolean := true;
  v_reason text := null;
  v_identity_match boolean;
  v_event_id bigint;
  v_daily_count int := 0;
  v_daily_limit int := 3;
  v_cap_setting jsonb;
  v_cap_parsed int;
  v_vol numeric;
  v_muted boolean;
  v_brand boolean := false;   -- 🆕 0503
begin
  if p_event_type not in ('start','milestone_30s','complete') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_event_type');
  end if;
  select id, owner_user_id, source_type, release_status, visibility_status, audio_url
    into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then
    return jsonb_build_object('ok', false, 'reason', 'track_not_found');
  end if;
  if p_user_agent is not null and (
       p_user_agent ilike '%bot%' or p_user_agent ilike '%crawler%'
    or p_user_agent ilike '%spider%' or p_user_agent ilike '%curl%'
    or p_user_agent ilike '%wget%' or p_user_agent ilike '%headlesschrome%'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'bot_filtered');
  end if;
  if p_event_type = 'milestone_30s' and p_listened_seconds < 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_short');
  end if;

  -- 🆕 0503: 브랜드 플레이어 판정 (서버 검증 — 세션 존재까지 확인)
  v_brand := public._is_brand_player_stream(p_source_page, v_uid);

  select value into v_cap_setting from public.admin_settings
  where key='stream_daily_user_track_cap';
  if v_cap_setting is not null then
    begin
      v_cap_parsed := (v_cap_setting)::text::int;
      if v_cap_parsed is not null and v_cap_parsed > 0 then
        v_daily_limit := v_cap_parsed;
      end if;
    exception when others then null;
    end;
  end if;

  v_vol := p_player_volume;
  if v_vol is not null and (v_vol < 0 or v_vol > 1) then v_vol := null; end if;
  v_muted := coalesce(p_player_muted, false);

  if v_track.source_type <> 'artist_upload' or v_track.release_status <> 'released' then
    v_eligible := false; v_reason := 'unreleased';
  end if;
  if v_eligible then
    if p_source_page is not null and p_source_page like '/admin%' then
      v_eligible := false; v_reason := 'admin_preview';
    elsif p_source_page is not null and p_source_page like '/artist%' then
      v_eligible := false; v_reason := 'artist_preview';
    elsif v_uid is not null and v_track.owner_user_id = v_uid then
      -- 브랜드 플레이어라도 자기 곡 재생은 계속 차단 (자가 정산 방지)
      v_eligible := false; v_reason := 'self_play';
    end if;
  end if;

  if v_eligible then
    if v_muted or (v_vol is not null and v_vol = 0) then
      -- 무음은 어떤 기준으로도 청취가 아니다 — 브랜드 플레이어도 동일 적용
      v_eligible := false; v_reason := 'muted_play';
    elsif v_vol is not null and v_vol < 0.1 and not v_brand then
      -- 🆕 0503: 매장 배경음악은 낮은 볼륨이 정상 운영 → 브랜드 플레이어 면제
      v_eligible := false; v_reason := 'low_player_volume';
    end if;
  end if;

  -- X6.47 30s dedup — flag-based + smart (eligible prior play 만 검사)
  if v_eligible and p_event_type = 'milestone_30s' then
    if v_uid is not null then
      select exists (
        select 1 from public.stream_events
        where track_id = p_track_id and user_id = v_uid
          and event_type = 'milestone_30s'
          and eligible_for_payout = true
          and created_at > now() - interval '30 seconds'
      ) into v_identity_match;
    elsif p_anonymous_id is not null and length(btrim(p_anonymous_id)) > 0 then
      select exists (
        select 1 from public.stream_events
        where track_id = p_track_id and anonymous_id = p_anonymous_id
          and event_type = 'milestone_30s'
          and eligible_for_payout = true
          and created_at > now() - interval '30 seconds'
      ) into v_identity_match;
    else v_identity_match := false; end if;
    if v_identity_match then
      v_eligible := false; v_reason := 'dedup_30s_window';
    end if;
  end if;

  -- 🆕 0503: 24h user×track cap — 브랜드 플레이어는 미적용
  if v_eligible and p_event_type = 'milestone_30s' and not v_brand then
    if v_uid is not null then
      select count(*) into v_daily_count
      from public.stream_events
      where track_id = p_track_id and user_id = v_uid
        and event_type = 'milestone_30s' and eligible_for_payout = true
        and created_at > now() - interval '24 hours';
    elsif p_anonymous_id is not null and length(btrim(p_anonymous_id)) > 0 then
      select count(*) into v_daily_count
      from public.stream_events
      where track_id = p_track_id and anonymous_id = p_anonymous_id and user_id is null
        and event_type = 'milestone_30s' and eligible_for_payout = true
        and created_at > now() - interval '24 hours';
    else v_daily_count := 0; end if;
    if v_daily_count >= v_daily_limit then
      v_eligible := false; v_reason := 'daily_user_track_cap';
    end if;
  end if;

  insert into public.stream_events (
    user_id, anonymous_id, track_id, artist_user_id, playlist_id,
    session_id, listened_seconds, completed, event_type,
    source_page, user_agent, eligible_for_payout, exclusion_reason,
    player_volume, player_muted
  ) values (
    v_uid, nullif(btrim(p_anonymous_id),''), p_track_id, v_track.owner_user_id, p_playlist_id,
    p_session_id, coalesce(p_listened_seconds, 0), coalesce(p_completed, false), p_event_type,
    p_source_page, p_user_agent, v_eligible, v_reason,
    v_vol, v_muted
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true, 'event_id', v_event_id,
    'eligible_for_payout', v_eligible,
    'exclusion_reason', v_reason,
    'daily_user_track_count', v_daily_count,
    'daily_user_track_limit', v_daily_limit,
    'brand_player_exempt', v_brand,
    'player_volume', v_vol,
    'player_muted', v_muted,
    'event_type', p_event_type
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) admin_list_abuse_candidates — 브랜드 플레이어 재생은 후보에서 제외
--    (정상 운영 중인 24시간 매장이 어뷰저 목록을 가득 채우는 것을 막는다)
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_abuse_candidates(
  p_days integer default 7, p_min_raw integer default 10,
  p_min_excluded integer default 7, p_limit integer default 200
)
returns table(
  user_id uuid, user_email text, track_id uuid, track_title text, artist text,
  date_kst date, raw_plays bigint, effective_plays bigint, excluded_plays bigint,
  excluded_reason text, last_played_at timestamp with time zone
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  with agg as (
    select se.user_id, se.track_id, se.effective_play_date_kst as date_kst,
           count(*) as raw_plays,
           count(*) filter (where se.is_effective=true) as effective_plays,
           count(*) filter (where se.is_effective=false) as excluded_plays,
           max(se.created_at) as last_played_at
    from public.stream_events se
    where se.event_type = 'milestone_30s'
      and se.user_id is not null
      -- 🆕 0503: 브랜드 플레이어 재생은 어뷰징 후보가 아니다
      and coalesce(se.source_page,'') not like '/brand/player%'
      and se.effective_play_date_kst >= (current_date at time zone 'Asia/Seoul')::date - (p_days - 1)
    group by se.user_id, se.track_id, se.effective_play_date_kst
    having count(*) >= p_min_raw
        or count(*) filter (where se.is_effective=false) >= p_min_excluded
  )
  select a.user_id,
         au.email::text,
         a.track_id, t.title, t.artist,
         a.date_kst,
         a.raw_plays, a.effective_plays, a.excluded_plays,
         'daily_user_track_cap'::text,
         a.last_played_at
  from agg a
  left join public.tracks t on t.id = a.track_id
  left join auth.users au on au.id = a.user_id
  order by a.excluded_plays desc, a.raw_plays desc
  limit greatest(1, p_limit);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) 브랜드 플레이리스트 다양성 상한 4 → 12
--    prod 정의(0464 기반)를 그대로 옮기고 artist_rank 상한만 바꾼다.
-- ----------------------------------------------------------------------------
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
  v_allowed_g text[]; -- 0464: 허용 장르 whitelist (비었으면 미적용)
  v_limit int := greatest(1, least(coalesce(p_limit,200), 500));
  v_seed text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD') || ':' || p_brand_id::text;
  -- 0463: study_cafe 하드필터 graft
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
      (select count(*) from unnest(v_pref_m) pm where b.mood_blob like '%'||pm||'%') as pref_m_hits
    from base b
  ),
  eligible as (
    select f.*,
      (f.pref_g_hits*25 + f.pref_m_hits*15 + case when f.energy_ok then 5 else 0 end
        + case when pol.vocal_policy='prefer_instrumental' and (f.instrumental is true or f.lyric_type='instrumental') then 10 else 0 end)::numeric as score,
      ('x' || substr(md5(f.id::text || v_seed),1,8))::bit(32)::bigint as rot
    from filtered f
    where not f.blocked_g_hit and not f.blocked_m_hit and f.vocal_ok
      and f.allowed_ok and f.bpm_ok
  ),
  diversified as (
    select e.*, row_number() over (partition by coalesce(lower(btrim(e.artist)), e.id::text) order by (case when e.energy_ok then 1 else 0 end) desc, e.score desc, e.rot) as artist_rank
    from eligible e
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'artist', d.artist, 'genre', d.genre, 'mood', d.mood, 'audio_url', d.audio_url, 'cover_url', d.cover_url, 'duration', d.duration, 'created_at', d.created_at)
           order by (case when d.energy_ok then 1 else 0 end) desc, d.score desc, d.rot), '[]'::jsonb) into v
  -- 🆕 0503: 아티스트당 4곡 → 12곡. 24시간 매장의 반복 주기를 늘린다.
  from diversified d where d.artist_rank <= 12 limit v_limit;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) 권한
-- ----------------------------------------------------------------------------
revoke execute on function public._is_brand_player_stream(text, uuid) from public, anon;
grant  execute on function public._is_brand_player_stream(text, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7) 진단 (무해)
-- ----------------------------------------------------------------------------
do $$
declare v_n int;
begin
  select jsonb_array_length(public._brand_generate_playlist(ba.id, 300)) into v_n
    from public.brand_accounts ba where ba.name = '카공시대' limit 1;
  raise notice '[0503] 카공시대 재생목록 곡수 = %', v_n;
end $$;
