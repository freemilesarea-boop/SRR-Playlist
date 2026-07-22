-- 0460 — RPC-MIGRATION-RECOVERY-1DE · Cluster D: admin track detail / QC / moderation (Production-only drift recovery)
-- Test Supabase only. Production unchanged.
--
-- 배경: 8개 Cluster D RPC + 2개 종속 Table(ai_metadata_corrections, artist_lifetime_streams) +
--   2개 내부 helper(_log_ai_correction, snapshot_artist_lifetime_streams)가 Production 에만 존재.
--   helper/table 은 client .rpc() 로 호출되지 않아 Undefined RPC 목록에 없었으나, 8개 RPC 의
--   실행 종속성이므로 Test 재현을 위해 함께 복구한다.
--
-- 보안:
--   · Reader 4개(get_admin_track_detail, list_admin_tracks_with_ai, ai_correction_stats,
--     list_severe_metadata_mismatches)는 Production 에서 language sql + admin 검사 없음(authenticated
--     과도 노출) → 시그니처/반환형 유지한 채 plpgsql + admin guard 로 교정.
--   · Write 4개(admin_hard_delete_track, admin_purge_all_tracks, admin_update_track_metadata_full,
--     bulk_delete_severe_mismatches)는 이미 admin guard + actor=auth.uid() → verbatim 복구.
--   · 정산/스트림 계산 로직 변경 없음 · AI 알고리즘 변경 없음.

-- ══ 종속 Table ══════════════════════════════════════════════════════════════
create table if not exists public.ai_metadata_corrections (
  id               uuid primary key default gen_random_uuid(),
  track_id         uuid not null references public.tracks(id) on delete cascade,
  field_name       text not null,
  ai_value         text,
  artist_value     text,
  admin_value      text not null,
  ai_confidence    numeric(4,3),
  prediction_model text,
  corrected_by     uuid references public.users(id),
  corrected_at     timestamptz not null default now()
);
create index if not exists ai_corrections_field_idx on public.ai_metadata_corrections using btree (field_name, corrected_at desc);
create index if not exists ai_corrections_track_idx on public.ai_metadata_corrections using btree (track_id);

alter table public.ai_metadata_corrections enable row level security;
drop policy if exists ai_corrections_admin_read on public.ai_metadata_corrections;
create policy ai_corrections_admin_read on public.ai_metadata_corrections for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

create table if not exists public.artist_lifetime_streams (
  artist_user_id          uuid primary key references public.users(id) on delete cascade,
  total_streams           bigint not null default 0,
  completed_streams       bigint not null default 0,
  eligible_payout_streams bigint not null default 0,
  total_listened_seconds  bigint not null default 0,
  first_streamed_at       timestamptz,
  last_streamed_at        timestamptz,
  last_snapshotted_at     timestamptz not null default now(),
  notes                   text
);

alter table public.artist_lifetime_streams enable row level security;
drop policy if exists alstreams_admin_read on public.artist_lifetime_streams;
create policy alstreams_admin_read on public.artist_lifetime_streams for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
drop policy if exists alstreams_self_read on public.artist_lifetime_streams;
create policy alstreams_self_read on public.artist_lifetime_streams for select
  using (artist_user_id = auth.uid());

-- ══ 내부 helper 함수 (client 노출 금지 — definer context 내부 호출 전용) ═══════════
-- _log_ai_correction: admin guard 없음(내부 전용). authenticated/anon 에 grant 금지.
create or replace function public._log_ai_correction(p_track_id uuid, p_field text, p_ai_value text, p_artist_value text, p_admin_value text, p_ai_confidence numeric default null::numeric, p_prediction_model text default 'laion-clap+librosa'::text)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_admin_value is null or btrim(p_admin_value) = '' then return; end if;
  if p_ai_value is null and p_artist_value is null then return; end if;
  insert into public.ai_metadata_corrections(
    track_id, field_name, ai_value, artist_value, admin_value,
    ai_confidence, prediction_model, corrected_by
  ) values (
    p_track_id, p_field, p_ai_value, p_artist_value, p_admin_value,
    p_ai_confidence, p_prediction_model, auth.uid()
  );
end;
$function$;

-- snapshot_artist_lifetime_streams: admin guard 있음. 내부 전용(admin_purge_all_tracks 에서 호출).
create or replace function public.snapshot_artist_lifetime_streams()
 returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_count int;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  insert into public.artist_lifetime_streams as a
    (artist_user_id, total_streams, completed_streams, eligible_payout_streams,
     total_listened_seconds, first_streamed_at, last_streamed_at, last_snapshotted_at)
  select
    se.artist_user_id, count(*),
    count(*) filter (where se.completed),
    count(*) filter (where se.eligible_for_payout),
    coalesce(sum(se.listened_seconds), 0),
    min(se.created_at), max(se.created_at), now()
  from public.stream_events se
  where se.artist_user_id is not null
  group by se.artist_user_id
  on conflict (artist_user_id) do update set
    total_streams           = excluded.total_streams,
    completed_streams       = excluded.completed_streams,
    eligible_payout_streams = excluded.eligible_payout_streams,
    total_listened_seconds  = excluded.total_listened_seconds,
    first_streamed_at       = least(a.first_streamed_at, excluded.first_streamed_at),
    last_streamed_at        = greatest(a.last_streamed_at, excluded.last_streamed_at),
    last_snapshotted_at     = now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

-- ══ Admin Reader (SECURITY FIX: language sql + no guard → plpgsql + admin guard) ══
create or replace function public.get_admin_track_detail(p_track_id uuid)
 returns table(id uuid, title text, artist text, album_name text, release_title text, release_type text, release_date date, release_status text, visibility_status text, removed_at timestamp with time zone, removed_reason text, source_type text, source_label text, main_genre text, sub_genre text, mood text, suitable_store text, lyrics text, lyric_type text, isrc text, rights_holder_name text, language text, explicit_content boolean, instrumental boolean, genre_tags text[], mood_tags text[], business_tags text[], business_type_tags text[], recommended_dayparts text[], time_slots text[], situation_tags text[], season_tags text[], vocal_type text, vocal_presence integer, emotional_intensity integer, brightness_level integer, energy_level integer, bpm integer, tempo_feel text, ai_predicted_energy_level integer, ai_energy_confidence numeric, ai_predicted_bpm integer, ai_predicted_tempo_feel text, ai_predicted_at timestamp with time zone, ai_applied_at timestamp with time zone, audio_url text, cover_url text, duration integer, audio_health_status text, audio_review_status text, cover_review_status text, metadata_review_status text, metadata_source text, created_at timestamp with time zone, submitted_at timestamp with time zone, approved_at timestamp with time zone, released_at timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    t.id, t.title, t.artist, t.album_name, t.release_title,
    t.release_type, t.release_date, t.release_status,
    t.visibility_status, t.removed_at, t.removed_reason,
    t.source_type,
    case t.source_type
      when 'artist_upload' then '아티스트 직접 업로드'
      when 'admin_upload' then '관리자 업로드'
      when 'seed' then '시드 데이터'
      else coalesce(t.source_type, '—') end as source_label,
    t.main_genre, t.sub_genre, t.mood, t.suitable_store,
    t.lyrics, t.lyric_type, t.isrc, t.rights_holder_name,
    t.language, t.explicit_content, t.instrumental,
    t.genre_tags, t.mood_tags, t.business_tags, t.business_type_tags,
    t.recommended_dayparts, t.time_slots, t.situation_tags, t.season_tags,
    t.vocal_type, t.vocal_presence, t.emotional_intensity, t.brightness_level,
    t.energy_level, t.bpm, t.tempo_feel,
    p.predicted_energy_level, p.energy_confidence,
    p.predicted_bpm, p.predicted_tempo_feel, p.created_at, p.applied_at,
    t.audio_url, t.cover_url, t.duration, t.audio_health_status,
    t.audio_review_status, t.cover_review_status, t.metadata_review_status,
    t.metadata_source,
    t.created_at, t.submitted_at, t.approved_at, t.released_at
  from public.tracks t
  left join public.track_ai_predictions p on p.track_id = t.id
  where t.id = p_track_id;
end;
$function$;

create or replace function public.list_admin_tracks_with_ai(p_limit integer default 1000)
 returns table(id uuid, title text, artist text, audio_url text, cover_url text, duration integer, created_at timestamp with time zone, main_genre text, sub_genre text, mood text, energy_level integer, bpm integer, tempo_feel text, ai_predicted_energy_level integer, ai_energy_confidence numeric, ai_predicted_bpm integer, ai_predicted_tempo_feel text, ai_applied_at timestamp with time zone)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    t.id, t.title, t.artist, t.audio_url, t.cover_url, t.duration, t.created_at,
    t.main_genre, t.sub_genre, t.mood, t.energy_level, t.bpm, t.tempo_feel,
    p.predicted_energy_level, p.energy_confidence,
    p.predicted_bpm, p.predicted_tempo_feel, p.applied_at
  from public.tracks t
  left join public.track_ai_predictions p on p.track_id = t.id
  where t.visibility_status is distinct from 'hidden' and t.removed_at is null
  order by t.created_at desc
  limit p_limit;
end;
$function$;

create or replace function public.ai_correction_stats()
 returns table(field_name text, total_corrections integer, exact_matches integer, changed integer, accuracy_pct numeric, avg_numeric_delta numeric, recent_corrections integer)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    c.field_name,
    count(*)::int as total_corrections,
    count(*) filter (where c.ai_value = c.admin_value)::int as exact_matches,
    count(*) filter (where c.ai_value is distinct from c.admin_value)::int as changed,
    round(100.0 * count(*) filter (where c.ai_value = c.admin_value) / nullif(count(*), 0), 1) as accuracy_pct,
    avg(case
      when c.ai_value ~ '^[0-9]+$' and c.admin_value ~ '^[0-9]+$'
      then abs(c.admin_value::numeric - c.ai_value::numeric)
      else null end)::numeric(8,2) as avg_numeric_delta,
    count(*) filter (where c.corrected_at > now() - interval '30 days')::int as recent_corrections
  from public.ai_metadata_corrections c
  group by c.field_name
  order by total_corrections desc;
end;
$function$;

create or replace function public.list_severe_metadata_mismatches(p_limit integer default 100)
 returns table(track_id uuid, title text, artist text, declared_mood text, declared_genre text, ai_energy integer, ai_bpm integer, ai_tempo text, ai_confidence numeric, reasons text)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    t.id, t.title, t.artist, t.mood, t.main_genre,
    p.predicted_energy_level, p.predicted_bpm, p.predicted_tempo_feel, p.energy_confidence,
    array_to_string(array_remove(array[
      case when t.mood in ('차분한','편안한','몽환적인','따뜻한') and p.predicted_energy_level >= 4
        then '잔잔무드+AI고에너지(' || p.predicted_energy_level || ')' end,
      case when t.mood in ('신나는','활기찬','트렌디한') and p.predicted_energy_level <= 2
        then '활기무드+AI저에너지(' || p.predicted_energy_level || ')' end,
      case when t.main_genre in ('Lo-fi','Jazz','Ambient','Classical','Lounge','Chillhop','Jazzhop') and p.predicted_bpm > 140
        then '잔잔장르+AI고BPM(' || p.predicted_bpm || ')' end,
      case when t.main_genre in ('House','EDM','Phonk','Hip-Hop','K-HipHop','Trap','Drill') and p.predicted_bpm is not null and p.predicted_bpm < 70
        then '빠른장르+AI저BPM(' || p.predicted_bpm || ')' end
    ], null), ', ') as reasons
  from public.tracks t
  join public.track_ai_predictions p on p.track_id = t.id
  where t.visibility_status = 'approved' and t.removed_at is null
    and (
      (t.mood in ('차분한','편안한','몽환적인','따뜻한') and p.predicted_energy_level >= 4)
      or (t.mood in ('신나는','활기찬','트렌디한') and p.predicted_energy_level <= 2)
      or (t.main_genre in ('Lo-fi','Jazz','Ambient','Classical','Lounge','Chillhop','Jazzhop') and p.predicted_bpm > 140)
      or (t.main_genre in ('House','EDM','Phonk','Hip-Hop','K-HipHop','Trap','Drill') and p.predicted_bpm is not null and p.predicted_bpm < 70)
    )
  order by p.energy_confidence desc nulls last
  limit p_limit;
end;
$function$;

-- ══ Admin Write (verbatim — 이미 admin guard + actor=auth.uid) ══════════════════
create or replace function public.admin_hard_delete_track(p_track_id uuid)
 returns table(track_id uuid, audio_bucket text, audio_path text, cover_bucket text, cover_path text, mode text)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_track record;
  v_has_revenue boolean;
  v_mode text;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  perform set_config('app.allow_audio_reencode', 'on', true);
  select t.id, t.storage_path, t.cover_storage_path
    into v_track from public.tracks t where t.id = p_track_id;
  if v_track is null then raise exception 'track_not_found'; end if;
  v_has_revenue :=
    exists (select 1 from public.settlement_items si where si.track_id = p_track_id)
    or exists (select 1 from public.streaming_revenues sr where sr.track_id = p_track_id);
  if v_has_revenue then
    update public.tracks set
      visibility_status = 'hidden',
      removed_at = coalesce(removed_at, now()),
      removed_by = coalesce(removed_by, auth.uid()),
      removed_reason = coalesce(removed_reason, 'admin_hard_delete:revenue_protected'),
      release_status = case when release_status = 'released' then 'removed' else release_status end,
      audio_url = null,
      cover_url = null,
      storage_path = null,
      cover_storage_path = null
    where id = p_track_id;
    v_mode := 'soft_due_to_revenue';
  else
    delete from public.tracks where id = p_track_id;
    v_mode := 'hard';
  end if;
  return query
    select v_track.id,
           'audio'::text,
           nullif(btrim(v_track.storage_path), ''),
           'covers'::text,
           nullif(btrim(v_track.cover_storage_path), ''),
           v_mode;
end;
$function$;

create or replace function public.admin_purge_all_tracks(p_confirm text)
 returns table(snapshot_artists integer, total_tracks integer, hard_deleted integer, soft_deleted integer, failed integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_snapshot int;
  v_total int;
  v_hard int := 0;
  v_soft int := 0;
  v_fail int := 0;
  r record;
  res record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_confirm is distinct from 'DELETE_ALL_TRACKS' then
    raise exception 'confirmation_required'
      using hint = 'p_confirm 파라미터에 정확히 DELETE_ALL_TRACKS 문자열이 필요합니다';
  end if;
  v_snapshot := public.snapshot_artist_lifetime_streams();
  select count(*) into v_total from public.tracks;
  for r in select id from public.tracks loop
    begin
      for res in select * from public.admin_hard_delete_track(r.id) loop
        if res.mode = 'hard' then v_hard := v_hard + 1;
        else v_soft := v_soft + 1; end if;
      end loop;
    exception when others then
      v_fail := v_fail + 1;
    end;
  end loop;
  return query select v_snapshot, v_total, v_hard, v_soft, v_fail;
end;
$function$;

create or replace function public.admin_update_track_metadata_full(p_track_id uuid, p_title text default null::text, p_artist text default null::text, p_album_name text default null::text, p_main_genre text default null::text, p_sub_genre text default null::text, p_mood text default null::text, p_suitable_store text default null::text, p_lyrics text default null::text, p_language text default null::text, p_explicit_content boolean default null::boolean, p_instrumental boolean default null::boolean, p_energy_level integer default null::integer, p_bpm integer default null::integer, p_tempo_feel text default null::text, p_vocal_type text default null::text, p_vocal_presence integer default null::integer, p_emotional_intensity integer default null::integer, p_brightness_level integer default null::integer, p_genre_tags text[] default null::text[], p_mood_tags text[] default null::text[], p_business_tags text[] default null::text[], p_recommended_dayparts text[] default null::text[], p_time_slots text[] default null::text[], p_situation_tags text[] default null::text[], p_season_tags text[] default null::text[])
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_ai_energy int; v_ai_bpm int; v_ai_tempo text; v_ai_conf numeric;
  v_old_energy int; v_old_bpm int; v_old_tempo text;
  v_old_genre text; v_old_mood text;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_energy_level is not null and (p_energy_level < 1 or p_energy_level > 5) then
    raise exception 'energy_level must be 1-5';
  end if;
  if p_bpm is not null and (p_bpm < 0 or p_bpm > 400) then
    raise exception 'bpm must be 0-400';
  end if;
  select p.predicted_energy_level, p.predicted_bpm, p.predicted_tempo_feel, p.energy_confidence
    into v_ai_energy, v_ai_bpm, v_ai_tempo, v_ai_conf
  from public.track_ai_predictions p
  where p.track_id = p_track_id;
  select t.energy_level, t.bpm, t.tempo_feel, t.main_genre, t.mood
    into v_old_energy, v_old_bpm, v_old_tempo, v_old_genre, v_old_mood
  from public.tracks t where t.id = p_track_id;
  perform set_config('app.allow_audio_reencode', 'off', true);
  update public.tracks set
    title = coalesce(nullif(btrim(p_title), ''), title),
    artist = coalesce(nullif(btrim(p_artist), ''), artist),
    album_name = coalesce(nullif(btrim(p_album_name), ''), album_name),
    main_genre = coalesce(nullif(btrim(p_main_genre), ''), main_genre),
    sub_genre = case when p_sub_genre is null then sub_genre
                     when length(btrim(p_sub_genre)) = 0 then null
                     else btrim(p_sub_genre) end,
    mood = case when p_mood is null then mood
                when length(btrim(p_mood)) = 0 then null
                else btrim(p_mood) end,
    suitable_store = coalesce(nullif(btrim(p_suitable_store), ''), suitable_store),
    lyrics = case when p_lyrics is null then lyrics
                  when length(btrim(p_lyrics)) = 0 then null
                  else p_lyrics end,
    language = coalesce(nullif(btrim(p_language), ''), language),
    explicit_content = coalesce(p_explicit_content, explicit_content),
    instrumental = coalesce(p_instrumental, instrumental),
    energy_level = coalesce(p_energy_level, energy_level),
    bpm = coalesce(p_bpm, bpm),
    tempo_feel = case when p_tempo_feel is null then tempo_feel
                      when length(btrim(p_tempo_feel)) = 0 then null
                      else btrim(p_tempo_feel) end,
    vocal_type = coalesce(nullif(btrim(p_vocal_type), ''), vocal_type),
    vocal_presence = coalesce(p_vocal_presence, vocal_presence),
    emotional_intensity = coalesce(p_emotional_intensity, emotional_intensity),
    brightness_level = coalesce(p_brightness_level, brightness_level),
    genre_tags = coalesce(p_genre_tags, genre_tags),
    mood_tags = coalesce(p_mood_tags, mood_tags),
    business_tags = coalesce(p_business_tags, business_tags),
    recommended_dayparts = coalesce(p_recommended_dayparts, recommended_dayparts),
    time_slots = coalesce(p_time_slots, time_slots),
    situation_tags = coalesce(p_situation_tags, situation_tags),
    season_tags = coalesce(p_season_tags, season_tags)
  where id = p_track_id;
  if p_energy_level is not null and v_ai_energy is not null then
    perform public._log_ai_correction(p_track_id, 'energy_level',
      v_ai_energy::text, v_old_energy::text, p_energy_level::text, v_ai_conf);
  end if;
  if p_bpm is not null and v_ai_bpm is not null then
    perform public._log_ai_correction(p_track_id, 'bpm',
      v_ai_bpm::text, v_old_bpm::text, p_bpm::text, null);
  end if;
  if p_tempo_feel is not null and v_ai_tempo is not null then
    perform public._log_ai_correction(p_track_id, 'tempo_feel',
      v_ai_tempo, v_old_tempo, p_tempo_feel, null);
  end if;
  if p_main_genre is not null and v_old_genre is distinct from nullif(btrim(p_main_genre), '') then
    perform public._log_ai_correction(p_track_id, 'main_genre',
      null, v_old_genre, btrim(p_main_genre), null);
  end if;
  if p_mood is not null and v_old_mood is distinct from nullif(btrim(p_mood), '') then
    perform public._log_ai_correction(p_track_id, 'mood',
      null, v_old_mood, btrim(p_mood), null);
  end if;
end;
$function$;

create or replace function public.bulk_delete_severe_mismatches(p_min_confidence numeric default 0.6, p_limit integer default 100)
 returns table(deleted_count integer, soft_deleted_count integer)
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_hard int := 0;
  v_soft int := 0;
  r record;
  result_row record;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  perform set_config('app.allow_audio_reencode', 'on', true);
  for r in
    select t.id from public.tracks t
    join public.track_ai_predictions p on p.track_id = t.id
    where t.visibility_status = 'approved' and t.removed_at is null
      and coalesce(p.energy_confidence, 0) >= p_min_confidence
      and (
        (t.mood in ('차분한','편안한','몽환적인','따뜻한') and p.predicted_energy_level >= 4)
        or (t.mood in ('신나는','활기찬','트렌디한') and p.predicted_energy_level <= 2)
        or (t.main_genre in ('Lo-fi','Jazz','Ambient','Classical','Lounge','Chillhop','Jazzhop') and p.predicted_bpm > 140)
        or (t.main_genre in ('House','EDM','Phonk','Hip-Hop','K-HipHop','Trap','Drill') and p.predicted_bpm is not null and p.predicted_bpm < 70)
      )
    order by p.energy_confidence desc nulls last
    limit p_limit
  loop
    for result_row in select * from public.admin_hard_delete_track(r.id) loop
      if result_row.mode = 'hard' then v_hard := v_hard + 1;
      else v_soft := v_soft + 1; end if;
    end loop;
  end loop;
  return query select v_hard, v_soft;
end;
$function$;

-- ══ Table Grants (RLS 로 backstop; Production 은 anon+authenticated 전체 CRUD 부여했으나
--    fail-closed 로 authenticated SELECT 만 부여 — 쓰기는 전부 SECURITY DEFINER 함수 경유,
--    anon 은 부여 안 함(내부 운영 테이블). RLS 가 admin/self 로 행을 제한한다.) ══
grant select on public.ai_metadata_corrections to authenticated;
grant select on public.artist_lifetime_streams to authenticated;

-- ══ Function Grants (fail-closed: revoke PUBLIC, anon 없음, authenticated + 내부 admin guard) ══
-- 내부 helper: client role grant 없음(정의자 컨텍스트 전용). service_role 제거(auth.uid 가드로 무의미).
revoke all on function public._log_ai_correction(uuid,text,text,text,text,numeric,text) from public;
revoke all on function public.snapshot_artist_lifetime_streams() from public;

revoke all on function public.get_admin_track_detail(uuid) from public;
revoke all on function public.list_admin_tracks_with_ai(integer) from public;
revoke all on function public.ai_correction_stats() from public;
revoke all on function public.list_severe_metadata_mismatches(integer) from public;
revoke all on function public.admin_hard_delete_track(uuid) from public;
revoke all on function public.admin_purge_all_tracks(text) from public;
revoke all on function public.admin_update_track_metadata_full(uuid,text,text,text,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,integer,integer,integer,text[],text[],text[],text[],text[],text[],text[]) from public;
revoke all on function public.bulk_delete_severe_mismatches(numeric,integer) from public;

grant execute on function public.get_admin_track_detail(uuid) to authenticated;
grant execute on function public.list_admin_tracks_with_ai(integer) to authenticated;
grant execute on function public.ai_correction_stats() to authenticated;
grant execute on function public.list_severe_metadata_mismatches(integer) to authenticated;
grant execute on function public.admin_hard_delete_track(uuid) to authenticated;
grant execute on function public.admin_purge_all_tracks(text) to authenticated;
grant execute on function public.admin_update_track_metadata_full(uuid,text,text,text,text,text,text,text,text,text,boolean,boolean,integer,integer,text,text,integer,integer,integer,text[],text[],text[],text[],text[],text[],text[]) to authenticated;
grant execute on function public.bulk_delete_severe_mismatches(numeric,integer) to authenticated;

comment on function public.get_admin_track_detail(uuid) is 'RPC-MIGRATION-RECOVERY-1DE: admin-guarded (was over-exposed to authenticated in Production).';
comment on function public.list_admin_tracks_with_ai(integer) is 'RPC-MIGRATION-RECOVERY-1DE: admin-guarded (was over-exposed to authenticated in Production).';
comment on function public.ai_correction_stats() is 'RPC-MIGRATION-RECOVERY-1DE: admin-guarded (was over-exposed to authenticated in Production).';
comment on function public.list_severe_metadata_mismatches(integer) is 'RPC-MIGRATION-RECOVERY-1DE: admin-guarded (was over-exposed to authenticated in Production).';
