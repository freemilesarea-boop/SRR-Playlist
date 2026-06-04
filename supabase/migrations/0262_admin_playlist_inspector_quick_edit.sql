-- 0262 — Admin Playlist Metadata Quick Edit / Remove Flow
--
-- 관리자가 플레이리스트 상세에서:
--  1. 곡 메타데이터 quick edit (큐레이션 필드만, 유통 메타는 불가)
--  2. playlist_tracks soft remove + audit
--  3. fit status 변경 (active/review_needed/excluded) + admin source 표기
--  4. fit_score 재계산
--  5. 모든 액션 admin_track_audit_logs 기록

-- ===== A. playlist_tracks soft delete + admin status override =====
alter table public.playlist_tracks
  add column if not exists removed_at      timestamptz,
  add column if not exists removed_by      uuid references public.users(id) on delete set null,
  add column if not exists removed_reason  text;

create index if not exists ix_pt_active on public.playlist_tracks(playlist_id, order_index)
  where removed_at is null;

-- ===== B. admin_track_audit_logs =====
create table if not exists public.admin_track_audit_logs (
  id              uuid primary key default gen_random_uuid(),
  admin_user_id   uuid not null references public.users(id) on delete restrict,
  track_id        uuid not null references public.tracks(id) on delete cascade,
  playlist_id     uuid references public.playlists(id) on delete set null,
  action_type     text not null check (action_type in (
                    'metadata_update','playlist_remove','status_change',
                    'fit_score_recalculate','playlist_restore')),
  before_data     jsonb,
  after_data      jsonb,
  reason          text,
  created_at      timestamptz not null default now()
);

create index if not exists ix_atal_track     on public.admin_track_audit_logs(track_id, created_at desc);
create index if not exists ix_atal_playlist  on public.admin_track_audit_logs(playlist_id, created_at desc) where playlist_id is not null;
create index if not exists ix_atal_admin     on public.admin_track_audit_logs(admin_user_id, created_at desc);

alter table public.admin_track_audit_logs enable row level security;
drop policy if exists "atal admin read" on public.admin_track_audit_logs;
create policy "atal admin read" on public.admin_track_audit_logs for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
-- write 는 SECURITY DEFINER RPC 로만 가능 (정책 없음 = 차단)

-- ===== C. get_playlist_tracks — removed_at IS NULL 필터 =====
create or replace function public.get_playlist_tracks(p_playlist_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v jsonb; v_sk text;
begin
  v_sk := public._playlist_store_key(p_playlist_id);
  select coalesce(jsonb_agg(to_jsonb(t) order by pt.order_index), '[]'::jsonb) into v
  from public.playlist_tracks pt
  join public.tracks t on t.id = pt.track_id
  left join public.playlist_track_fit_scores f
    on f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
  where pt.playlist_id = p_playlist_id
    and pt.removed_at is null
    and t.release_status in ('released','approved') and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
    and not public._business_track_excluded(t.id, v_sk)
    and (f.status is null or f.status <> 'excluded');
  return v;
end; $$;

-- ===== D. admin_get_playlist_inspector — 풍부한 곡 목록 =====
create or replace function public.admin_get_playlist_inspector(
  p_playlist_id uuid,
  p_include_removed boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_result jsonb;
begin
  if v_admin is not null and not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select jsonb_build_object(
    'playlist', (select to_jsonb(pl) from public.playlists pl where pl.id=p_playlist_id),
    'tracks', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'pt_id', pt.id, 'order_index', pt.order_index,
          'placement_reason', pt.placement_reason, 'placed_by', pt.placed_by,
          'removed_at', pt.removed_at, 'removed_by', pt.removed_by, 'removed_reason', pt.removed_reason,
          'track_id', t.id, 'title', t.title, 'artist', t.artist, 'cover_url', t.cover_url,
          'main_genre', t.main_genre, 'sub_genre', t.sub_genre,
          'mood', t.mood, 'mood_tags', t.mood_tags, 'genre_tags', t.genre_tags,
          'suitable_store', t.suitable_store, 'business_tags', t.business_tags,
          'bpm', t.bpm, 'energy_level', t.energy_level,
          'instrumental', t.instrumental, 'explicit_content', t.explicit_content,
          'language', t.language, 'vocal_type', t.vocal_type, 'admin_note', t.admin_note,
          'duration', t.duration,
          'af_energy', af.energy, 'af_instrumentalness', af.instrumentalness,
          'af_acousticness', af.acousticness, 'af_speechiness', af.speechiness,
          'af_danceability', af.danceability, 'af_valence', af.valence,
          'af_analyzer', af.analyzer,
          'fit_score', f.fit_score, 'fit_status', f.status, 'fit_source', f.source,
          'reason', f.reason, 'reason_codes', f.reason_codes,
          'audio_score', f.audio_score, 'metadata_score', f.metadata_score,
          'behavior_score', f.behavior_score, 'penalty_score', f.penalty_score,
          'normalized_store_slug', f.normalized_store_slug
        ) order by case when pt.removed_at is null then 0 else 1 end, pt.order_index
      )
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
      left join public.track_audio_features af on af.track_id = pt.track_id
      left join public.playlist_track_fit_scores f
        on f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
      where pt.playlist_id = p_playlist_id
        and (p_include_removed or pt.removed_at is null)
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end; $$;

-- ===== E. admin_update_track_metadata =====
-- 화이트리스트: main_genre / sub_genre / mood / mood_tags / genre_tags
--                suitable_store / business_tags / energy_level / instrumental
--                vocal_type / explicit_content / language / admin_note
-- 블랙리스트: title / artist / isrc / audio_url / cover_url / release_date / rights_holder_name
create or replace function public.admin_update_track_metadata(
  p_track_id uuid,
  p_payload jsonb,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_before jsonb;
  v_after  jsonb;
  v_main_genre text; v_sub_genre text; v_mood text; v_suitable_store text;
  v_vocal_type text; v_language text; v_admin_note text;
  v_energy_level int;
  v_instrumental boolean; v_explicit boolean;
  v_mood_tags text[]; v_genre_tags text[]; v_business_tags text[];
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_track_id is null or p_payload is null then
    raise exception 'track_id and payload required';
  end if;

  select jsonb_build_object(
    'main_genre', main_genre, 'sub_genre', sub_genre,
    'mood', mood, 'mood_tags', mood_tags, 'genre_tags', genre_tags,
    'suitable_store', suitable_store, 'business_tags', business_tags,
    'energy_level', energy_level, 'instrumental', instrumental,
    'vocal_type', vocal_type, 'explicit_content', explicit_content,
    'language', language, 'admin_note', admin_note
  ) into v_before from public.tracks where id = p_track_id;
  if v_before is null then raise exception 'track_not_found'; end if;

  -- whitelist 추출 (key 누락 시 기존 값 유지)
  if p_payload ? 'main_genre' then v_main_genre := nullif(p_payload->>'main_genre',''); end if;
  if p_payload ? 'sub_genre' then v_sub_genre := nullif(p_payload->>'sub_genre',''); end if;
  if p_payload ? 'mood' then v_mood := nullif(p_payload->>'mood',''); end if;
  if p_payload ? 'suitable_store' then v_suitable_store := nullif(p_payload->>'suitable_store',''); end if;
  if p_payload ? 'vocal_type' then v_vocal_type := nullif(p_payload->>'vocal_type',''); end if;
  if p_payload ? 'language' then v_language := nullif(p_payload->>'language',''); end if;
  if p_payload ? 'admin_note' then v_admin_note := nullif(p_payload->>'admin_note',''); end if;
  if p_payload ? 'energy_level' then v_energy_level := (p_payload->>'energy_level')::int; end if;
  if p_payload ? 'instrumental' then v_instrumental := (p_payload->>'instrumental')::boolean; end if;
  if p_payload ? 'explicit_content' then v_explicit := (p_payload->>'explicit_content')::boolean; end if;
  if p_payload ? 'mood_tags' and jsonb_typeof(p_payload->'mood_tags')='array' then
    v_mood_tags := array(select jsonb_array_elements_text(p_payload->'mood_tags'));
  end if;
  if p_payload ? 'genre_tags' and jsonb_typeof(p_payload->'genre_tags')='array' then
    v_genre_tags := array(select jsonb_array_elements_text(p_payload->'genre_tags'));
  end if;
  if p_payload ? 'business_tags' and jsonb_typeof(p_payload->'business_tags')='array' then
    v_business_tags := array(select jsonb_array_elements_text(p_payload->'business_tags'));
  end if;

  update public.tracks set
    main_genre       = case when p_payload ? 'main_genre'       then v_main_genre       else main_genre end,
    sub_genre        = case when p_payload ? 'sub_genre'        then v_sub_genre        else sub_genre end,
    mood             = case when p_payload ? 'mood'             then v_mood             else mood end,
    mood_tags        = case when p_payload ? 'mood_tags'        then v_mood_tags        else mood_tags end,
    genre_tags       = case when p_payload ? 'genre_tags'       then v_genre_tags       else genre_tags end,
    suitable_store   = case when p_payload ? 'suitable_store'   then v_suitable_store   else suitable_store end,
    business_tags    = case when p_payload ? 'business_tags'    then v_business_tags    else business_tags end,
    energy_level     = case when p_payload ? 'energy_level'     then v_energy_level     else energy_level end,
    instrumental     = case when p_payload ? 'instrumental'     then v_instrumental     else instrumental end,
    vocal_type       = case when p_payload ? 'vocal_type'       then v_vocal_type       else vocal_type end,
    explicit_content = case when p_payload ? 'explicit_content' then v_explicit         else explicit_content end,
    language         = case when p_payload ? 'language'         then v_language         else language end,
    admin_note       = case when p_payload ? 'admin_note'       then v_admin_note       else admin_note end
  where id = p_track_id;

  -- track_analysis + audio_features (heuristic only) 재유도
  perform public.derive_track_analysis(p_track_id);
  if exists (select 1 from public.track_audio_features af
             where af.track_id=p_track_id and af.analyzer='heuristic_v1') then
    perform public.backfill_track_audio_features(p_track_id, true);
  end if;

  -- 영향 playlist 전체 fit_score 재계산
  perform public._ai_compute_fit(pt.playlist_id, p_track_id)
  from public.playlist_tracks pt where pt.track_id = p_track_id and pt.removed_at is null;

  select jsonb_build_object(
    'main_genre', main_genre, 'sub_genre', sub_genre,
    'mood', mood, 'mood_tags', mood_tags, 'genre_tags', genre_tags,
    'suitable_store', suitable_store, 'business_tags', business_tags,
    'energy_level', energy_level, 'instrumental', instrumental,
    'vocal_type', vocal_type, 'explicit_content', explicit_content,
    'language', language, 'admin_note', admin_note
  ) into v_after from public.tracks where id = p_track_id;

  insert into public.admin_track_audit_logs
    (admin_user_id, track_id, playlist_id, action_type, before_data, after_data, reason)
  values (v_admin, p_track_id, null, 'metadata_update', v_before, v_after, p_reason);

  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after);
end; $$;

-- ===== F. admin_remove_track_from_playlist (soft delete + audit) =====
create or replace function public.admin_remove_track_from_playlist(
  p_playlist_id uuid,
  p_track_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_pt record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_pt from public.playlist_tracks
    where playlist_id = p_playlist_id and track_id = p_track_id and removed_at is null
    limit 1;
  if v_pt.id is null then
    raise exception 'playlist_track_not_found_or_already_removed';
  end if;

  update public.playlist_tracks
    set removed_at = now(), removed_by = v_admin, removed_reason = p_reason
    where id = v_pt.id;

  insert into public.admin_track_audit_logs
    (admin_user_id, track_id, playlist_id, action_type, before_data, after_data, reason)
  values (v_admin, p_track_id, p_playlist_id, 'playlist_remove',
          jsonb_build_object('pt_id', v_pt.id, 'order_index', v_pt.order_index, 'removed_at', null),
          jsonb_build_object('pt_id', v_pt.id, 'order_index', v_pt.order_index, 'removed_at', now()),
          p_reason);

  return jsonb_build_object('ok', true, 'pt_id', v_pt.id);
end; $$;

-- ===== G. admin_restore_track_to_playlist =====
create or replace function public.admin_restore_track_to_playlist(
  p_pt_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_admin uuid := auth.uid(); v_pt record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select * into v_pt from public.playlist_tracks where id = p_pt_id;
  if v_pt.id is null then raise exception 'not_found'; end if;
  update public.playlist_tracks set removed_at = null, removed_by = null, removed_reason = null
    where id = p_pt_id;
  perform public._ai_compute_fit(v_pt.playlist_id, v_pt.track_id);
  insert into public.admin_track_audit_logs
    (admin_user_id, track_id, playlist_id, action_type, before_data, after_data, reason)
  values (v_admin, v_pt.track_id, v_pt.playlist_id, 'playlist_restore',
          jsonb_build_object('removed_at', v_pt.removed_at),
          jsonb_build_object('removed_at', null), p_reason);
  return jsonb_build_object('ok', true);
end; $$;

-- ===== H. admin_change_track_fit_status =====
create or replace function public.admin_change_track_fit_status(
  p_playlist_id uuid,
  p_track_id uuid,
  p_status text,
  p_reason text default null,
  p_admin_note text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_admin uuid := auth.uid(); v_before record;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('active','review_needed','excluded') then
    raise exception 'invalid_status: %', p_status;
  end if;
  select fit_score, status, source, reason, reason_codes
    into v_before from public.playlist_track_fit_scores
    where playlist_id=p_playlist_id and track_id=p_track_id;

  insert into public.playlist_track_fit_scores
    (playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score,
     reason, source, status, updated_at, reason_codes)
  values
    (p_playlist_id, p_track_id, coalesce(v_before.fit_score, 50), 0, 0, 0, 0,
     coalesce('[admin_override] ' || p_reason, '[admin_override]'),
     'admin', p_status, now(),
     array_append(coalesce(v_before.reason_codes,'{}'::text[]), 'admin_status:' || p_status))
  on conflict (playlist_id, track_id) do update set
    status = excluded.status, source='admin', reason = excluded.reason,
    updated_at = now(),
    reason_codes = array_append(coalesce(public.playlist_track_fit_scores.reason_codes,'{}'::text[]),
                                'admin_status:' || p_status);

  if p_admin_note is not null then
    update public.tracks set admin_note = p_admin_note where id = p_track_id;
  end if;

  insert into public.admin_track_audit_logs
    (admin_user_id, track_id, playlist_id, action_type, before_data, after_data, reason)
  values (v_admin, p_track_id, p_playlist_id, 'status_change',
          to_jsonb(v_before), jsonb_build_object('status', p_status, 'source','admin'), p_reason);

  return jsonb_build_object('ok', true, 'status', p_status);
end; $$;

-- ===== I. admin_recompute_track_fit =====
create or replace function public.admin_recompute_track_fit(
  p_playlist_id uuid,
  p_track_id uuid,
  p_also_auto_place boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_before record; v_after record; v_auto jsonb := null;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  select fit_score, status, reason_codes into v_before
    from public.playlist_track_fit_scores
    where playlist_id=p_playlist_id and track_id=p_track_id;

  perform public._ai_compute_fit(p_playlist_id, p_track_id);

  select fit_score, status, reason_codes into v_after
    from public.playlist_track_fit_scores
    where playlist_id=p_playlist_id and track_id=p_track_id;

  if p_also_auto_place then
    v_auto := public.auto_place_track(p_track_id);
  end if;

  insert into public.admin_track_audit_logs
    (admin_user_id, track_id, playlist_id, action_type, before_data, after_data, reason)
  values (v_admin, p_track_id, p_playlist_id, 'fit_score_recalculate',
          to_jsonb(v_before), to_jsonb(v_after),
          case when p_also_auto_place then 'also_auto_place=true' else null end);

  return jsonb_build_object('ok', true, 'before', to_jsonb(v_before), 'after', to_jsonb(v_after),
                            'auto_place', v_auto);
end; $$;

-- ===== J. admin_list_track_audit (UI 변경 이력 조회) =====
create or replace function public.admin_list_track_audit(
  p_track_id uuid default null,
  p_playlist_id uuid default null,
  p_limit int default 50
) returns table (
  id uuid, admin_user_id uuid, admin_name text,
  track_id uuid, playlist_id uuid, action_type text,
  before_data jsonb, after_data jsonb, reason text, created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select a.id, a.admin_user_id,
         (select u.full_name from public.users u where u.id=a.admin_user_id),
         a.track_id, a.playlist_id, a.action_type,
         a.before_data, a.after_data, a.reason, a.created_at
  from public.admin_track_audit_logs a
  where (p_track_id is null or a.track_id = p_track_id)
    and (p_playlist_id is null or a.playlist_id = p_playlist_id)
  order by a.created_at desc
  limit coalesce(p_limit, 50);
$$;

-- ===== K. 권한 =====
revoke all on function public.admin_get_playlist_inspector(uuid, boolean) from public, anon;
revoke all on function public.admin_update_track_metadata(uuid, jsonb, text) from public, anon;
revoke all on function public.admin_remove_track_from_playlist(uuid, uuid, text) from public, anon;
revoke all on function public.admin_restore_track_to_playlist(uuid, text) from public, anon;
revoke all on function public.admin_change_track_fit_status(uuid, uuid, text, text, text) from public, anon;
revoke all on function public.admin_recompute_track_fit(uuid, uuid, boolean) from public, anon;
revoke all on function public.admin_list_track_audit(uuid, uuid, int) from public, anon;

grant execute on function public.admin_get_playlist_inspector(uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_update_track_metadata(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.admin_remove_track_from_playlist(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.admin_restore_track_to_playlist(uuid, text) to authenticated, service_role;
grant execute on function public.admin_change_track_fit_status(uuid, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.admin_recompute_track_fit(uuid, uuid, boolean) to authenticated, service_role;
grant execute on function public.admin_list_track_audit(uuid, uuid, int) to authenticated, service_role;
