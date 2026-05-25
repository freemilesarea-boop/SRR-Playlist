-- 0182 — 사업자 회원 30초 이내 스킵 기반 플레이리스트 자동 제외.
-- 정산/stream_events 미수정. playlist_tracks 물리삭제 없음(조회 시 exclusion layer 로 제외). 관리자 복구 가능.

-- cafe 계열 store group 매핑
create or replace function public._store_group_of(p_store_key text)
returns text language sql immutable as $$
  select case when p_store_key in ('cafe_independent','cafe_franchise','brunch_cafe') then 'cafe' else null end;
$$;

-- playlist 의 정규 store_key (ai_store_key 우선, 없으면 카테고리/시간대에서 유도)
create or replace function public._playlist_store_key(p_playlist_id uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select coalesce(nullif(btrim(p.ai_store_key),''), public._ai_playlist_store_key(p.business_category, p.category, p.daypart))
  from public.playlists p where p.id = p_playlist_id;
$$;

create table if not exists public.business_early_skip_events (
  id uuid primary key default gen_random_uuid(),
  business_user_id uuid not null references public.users(id) on delete cascade,
  business_profile_id uuid,
  playlist_id uuid not null,
  playlist_store_key text,
  store_group_key text,
  track_id uuid not null,
  played_seconds numeric,
  track_duration numeric,
  skip_reason text,
  session_id text,
  device text,
  created_at timestamptz not null default now(),
  unique (business_user_id, playlist_id, track_id, session_id)
);
create index if not exists idx_bese_track_store on public.business_early_skip_events(track_id, playlist_store_key, created_at);
alter table public.business_early_skip_events enable row level security;
drop policy if exists bese_admin_read on public.business_early_skip_events;
create policy bese_admin_read on public.business_early_skip_events for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

create table if not exists public.business_track_playlist_exclusions (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  playlist_store_key text not null,
  store_group_key text,
  skip_count int not null default 0,
  unique_business_skip_count int not null default 0,
  status text not null default 'active' check (status in ('active','restored','ignored')),
  reason text,
  first_detected_at timestamptz, last_detected_at timestamptz,
  created_at timestamptz not null default now(),
  restored_by uuid, restored_at timestamptz, admin_note text,
  unique (track_id, playlist_store_key)
);
create index if not exists idx_btpe_status on public.business_track_playlist_exclusions(status, playlist_store_key);
alter table public.business_track_playlist_exclusions enable row level security;
drop policy if exists btpe_admin_read on public.business_track_playlist_exclusions;
create policy btpe_admin_read on public.business_track_playlist_exclusions for select using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- 곡이 특정 store_key 에서 제외 상태인지 (store_key 또는 그 group 매칭)
create or replace function public._business_track_excluded(p_track_id uuid, p_store_key text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select p_store_key is not null and exists (
    select 1 from public.business_track_playlist_exclusions x
    where x.track_id = p_track_id and x.status = 'active'
      and (x.playlist_store_key = p_store_key
           or (x.store_group_key is not null and x.store_group_key = public._store_group_of(p_store_key))));
$$;

-- 사업자 early_skip 기록 + 임계 도달 시 자동 제외
create or replace function public.record_business_early_skip(
  p_playlist_id uuid, p_track_id uuid, p_played_seconds numeric, p_duration numeric, p_session_id text, p_skip_reason text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_bp uuid; v_sk text; v_grp text; v_cnt int; v_uniq int;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'recorded', false); end if;
  if not exists (select 1 from public.users u where u.id=v_uid and u.account_type='business') then
    return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'not_business');
  end if;
  if p_track_id is null or p_playlist_id is null then return jsonb_build_object('ok', false, 'recorded', false); end if;
  if coalesce(p_played_seconds, 999) > 30 then return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'over_30s'); end if;
  if coalesce(p_skip_reason,'') not in ('next_button','manual_next','manual_skip') then
    return jsonb_build_object('ok', true, 'recorded', false, 'reason', 'reason_excluded');
  end if;
  v_sk := public._playlist_store_key(p_playlist_id);
  v_grp := public._store_group_of(v_sk);
  select id into v_bp from public.business_profiles where user_id = v_uid limit 1;
  insert into public.business_early_skip_events(business_user_id, business_profile_id, playlist_id, playlist_store_key, store_group_key, track_id, played_seconds, track_duration, skip_reason, session_id)
  values (v_uid, v_bp, p_playlist_id, v_sk, v_grp, p_track_id, p_played_seconds, p_duration, p_skip_reason, p_session_id)
  on conflict (business_user_id, playlist_id, track_id, session_id) do nothing;

  if v_sk is null then return jsonb_build_object('ok', true, 'recorded', true, 'excluded', false, 'note', 'no_store_key'); end if;
  select count(*), count(distinct business_user_id) into v_cnt, v_uniq
  from public.business_early_skip_events
  where track_id = p_track_id and playlist_store_key = v_sk and created_at > now() - interval '90 days';

  if v_cnt >= 3 and v_uniq >= 2 then
    insert into public.business_track_playlist_exclusions(track_id, playlist_store_key, store_group_key, skip_count, unique_business_skip_count, status, reason, first_detected_at, last_detected_at)
    values (p_track_id, v_sk, null, v_cnt, v_uniq, 'active', format('사업자 30초내 스킵 %s회(고유 %s명)', v_cnt, v_uniq), now(), now())
    on conflict (track_id, playlist_store_key) do update set
      skip_count = excluded.skip_count, unique_business_skip_count = excluded.unique_business_skip_count, last_detected_at = now(),
      status = case when public.business_track_playlist_exclusions.status in ('restored','ignored') then public.business_track_playlist_exclusions.status else 'active' end,
      reason = excluded.reason;
    return jsonb_build_object('ok', true, 'recorded', true, 'excluded', true, 'store_key', v_sk, 'skip_count', v_cnt, 'unique', v_uniq);
  end if;
  return jsonb_build_object('ok', true, 'recorded', true, 'excluded', false, 'store_key', v_sk, 'skip_count', v_cnt, 'unique', v_uniq);
end; $$;
grant execute on function public.record_business_early_skip(uuid, uuid, numeric, numeric, text, text) to authenticated;

-- ============ 읽기 경로 exclusion 적용 ============
create or replace function public.get_ai_recommended_tracks_for_playlist(p_playlist_id uuid, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb; v_sk text;
begin
  v_sk := public._playlist_store_key(p_playlist_id);
  select coalesce(jsonb_agg(row_to_json(x) order by x.fit_score desc),'[]'::jsonb) into v from (
    select s.track_id, s.fit_score, s.audio_score, s.metadata_score, s.behavior_score, s.penalty_score, s.reason, s.status,
           t.title, t.artist, t.cover_url
    from public.playlist_track_fit_scores s
    join public.tracks t on t.id=s.track_id
    where s.playlist_id=p_playlist_id and s.status='active' and s.fit_score>=70
      and t.release_status in ('released','approved') and t.removed_at is null
      and not public._business_track_excluded(s.track_id, v_sk)
    order by s.fit_score desc limit greatest(1,p_limit)
  ) x;
  return v;
end; $function$;

create or replace function public.recommend_tracks_for_store(p_store_key text, p_model text default 'openl3'::text, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.similarity desc), '[]'::jsonb) into v from (
    select e.track_id, t.title, t.artist,
           round((1 - (e.embedding OPERATOR(public.<=>) s.embedding))::numeric, 4) as similarity
    from public.store_archetype_embeddings s
    join public.track_embeddings e on e.model_name = s.model_name and e.status='done' and e.embedding is not null
    join public.tracks t on t.id = e.track_id
    where s.store_key = p_store_key and s.model_name = p_model
      and t.release_status in ('released','approved') and t.removed_at is null
      and not public._business_track_excluded(e.track_id, p_store_key)
    order by (e.embedding OPERATOR(public.<=>) s.embedding) asc
    limit greatest(1, p_limit)
  ) x;
  return v;
end; $function$;

-- 플레이리스트 재생 트랙 조회 (exclusion 적용) — fetchPlaylistTracks 가 사용
create or replace function public.get_playlist_tracks(p_playlist_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_sk text;
begin
  v_sk := public._playlist_store_key(p_playlist_id);
  select coalesce(jsonb_agg(to_jsonb(t) order by pt.order_index), '[]'::jsonb) into v
  from public.playlist_tracks pt join public.tracks t on t.id = pt.track_id
  where pt.playlist_id = p_playlist_id
    and t.release_status in ('released','approved') and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
    and not public._business_track_excluded(t.id, v_sk);
  return v;
end; $$;
grant execute on function public.get_playlist_tracks(uuid) to authenticated, anon;

-- ============ 관리자 RPC ============
create or replace function public.admin_list_business_exclusions(p_store text default 'all', p_days int default 0, p_status text default 'all')
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.skip_count desc nulls last, x.last_detected_at desc nulls last), '[]'::jsonb) into v from (
    select e.id, e.track_id, t.title, t.artist, e.playlist_store_key, e.store_group_key, public._store_label(e.playlist_store_key) as store_label,
      e.skip_count, e.unique_business_skip_count, e.status, e.reason, e.first_detected_at, e.last_detected_at, e.created_at, e.admin_note
    from public.business_track_playlist_exclusions e join public.tracks t on t.id = e.track_id
    where (p_status = 'all' or e.status = p_status)
      and (p_store = 'all' or e.playlist_store_key = p_store or e.store_group_key = p_store)
      and (p_days <= 0 or e.last_detected_at > now() - make_interval(days => p_days))
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_business_exclusions(text, int, text) to authenticated;

create or replace function public.admin_business_skip_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'active', (select count(*) from public.business_track_playlist_exclusions where status='active'),
    'restored', (select count(*) from public.business_track_playlist_exclusions where status='restored'),
    'ignored', (select count(*) from public.business_track_playlist_exclusions where status='ignored'),
    'skip_events_7d', (select count(*) from public.business_early_skip_events where created_at > now() - interval '7 days'),
    'skip_events_30d', (select count(*) from public.business_early_skip_events where created_at > now() - interval '30 days'),
    'by_store', (select coalesce(jsonb_agg(jsonb_build_object('store_key', playlist_store_key, 'store_label', public._store_label(playlist_store_key), 'n', n) order by n desc), '[]'::jsonb)
                 from (select playlist_store_key, count(*) n from public.business_track_playlist_exclusions where status='active' group by 1) z));
end; $$;
grant execute on function public.admin_business_skip_summary() to authenticated;

create or replace function public.admin_restore_business_exclusion(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.business_track_playlist_exclusions set status='restored', restored_by=v_uid, restored_at=now(),
    admin_note=coalesce(nullif(btrim(p_note),''), admin_note) where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_restore_business_exclusion(uuid, text) to authenticated;

create or replace function public.admin_ignore_business_exclusion(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.business_track_playlist_exclusions set status='ignored',
    admin_note=coalesce(nullif(btrim(p_note),''), admin_note) where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_ignore_business_exclusion(uuid, text) to authenticated;

-- 관리자: 다시 active 로 (제외 유지)
create or replace function public.admin_reactivate_business_exclusion(p_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  update public.business_track_playlist_exclusions set status='active' where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_reactivate_business_exclusion(uuid) to authenticated;

-- 관리자: 특정 매장만 제외 / 전체 그룹 제외 (수동)
create or replace function public.admin_exclude_track_store(p_track_id uuid, p_store_key text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.business_track_playlist_exclusions(track_id, playlist_store_key, store_group_key, status, reason, first_detected_at, last_detected_at, admin_note)
  values (p_track_id, p_store_key, null, 'active', '관리자 수동 제외', now(), now(), p_note)
  on conflict (track_id, playlist_store_key) do update set status='active', reason='관리자 수동 제외', last_detected_at=now(),
    admin_note=coalesce(nullif(btrim(p_note),''), public.business_track_playlist_exclusions.admin_note);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_exclude_track_store(uuid, text, text) to authenticated;

create or replace function public.admin_exclude_track_group(p_track_id uuid, p_group_key text, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.business_track_playlist_exclusions(track_id, playlist_store_key, store_group_key, status, reason, first_detected_at, last_detected_at, admin_note)
  values (p_track_id, p_group_key, p_group_key, 'active', format('관리자 그룹 제외(%s)', p_group_key), now(), now(), p_note)
  on conflict (track_id, playlist_store_key) do update set status='active', store_group_key=excluded.store_group_key,
    reason=excluded.reason, last_detected_at=now(), admin_note=coalesce(nullif(btrim(p_note),''), public.business_track_playlist_exclusions.admin_note);
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_exclude_track_group(uuid, text, text) to authenticated;
