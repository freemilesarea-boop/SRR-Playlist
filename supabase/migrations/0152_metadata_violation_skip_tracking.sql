-- 0152 — 스킵률 기반 메타데이터 위반 자동 신고/관리자 재세팅
-- 플레이리스트에서 특정 트랙이 반복적으로 스킵되면 메타데이터 불일치(위반) 후보로 보고
-- 관리자가 검수/재세팅할 수 있도록 한다.
--
-- 스킵 적격 기준: played_seconds >= 5 AND (track_duration null/<=0 OR played < 0.3*duration)
--   → 5초 미만 즉시 스킵(오작동/잘못 누름)이나 거의 끝까지 들은 경우는 제외.
-- 임계치: 같은 playlist+track 에서 최근 30일 distinct skipper >= 3 → 위반 후보 등록.
-- 자동 제외는 비활성화 — 관리자가 직접 제외. (사용자에게는 어떤 문구도 노출하지 않음)

-- 1) 스킵 이벤트 (append-only)
create table if not exists public.playlist_track_skip_events (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  session_id text,
  played_seconds numeric not null default 0,
  track_duration numeric,
  skip_reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_skip_events_pl_track_time
  on public.playlist_track_skip_events (playlist_id, track_id, created_at desc);
create index if not exists idx_skip_events_track_time
  on public.playlist_track_skip_events (track_id, created_at desc);

alter table public.playlist_track_skip_events enable row level security;

drop policy if exists skip_events_admin_read on public.playlist_track_skip_events;
create policy skip_events_admin_read on public.playlist_track_skip_events
  for select using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- 2) 메타데이터 위반 후보
create table if not exists public.metadata_violation_candidates (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  skip_count int not null default 0,
  status text not null default 'pending' check (status in ('pending','reviewed','resolved','ignored')),
  reason text,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  admin_note text,
  unique (playlist_id, track_id)
);

create index if not exists idx_mvc_status
  on public.metadata_violation_candidates (status, last_detected_at desc);

alter table public.metadata_violation_candidates enable row level security;

drop policy if exists mvc_admin_read on public.metadata_violation_candidates;
create policy mvc_admin_read on public.metadata_violation_candidates
  for select using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- 3) 스킵 기록 + 자동 후보 등록 (anon/authenticated 호출 가능, fire-and-forget)
create or replace function public.record_track_skip(
  p_playlist_id uuid,
  p_track_id uuid,
  p_played_seconds numeric,
  p_track_duration numeric,
  p_reason text default 'manual_skip',
  p_anon_id text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_is_catalog boolean;
  v_skippers int;
  v_threshold int := 3;
begin
  -- 카탈로그 플레이리스트 + 해당 트랙 링크 존재할 때만
  select exists(select 1 from public.playlists p where p.id = p_playlist_id) into v_is_catalog;
  if not v_is_catalog then return jsonb_build_object('ok', false, 'reason', 'not_catalog_playlist'); end if;

  insert into public.playlist_track_skip_events(playlist_id, track_id, user_id, session_id, played_seconds, track_duration, skip_reason)
  values (p_playlist_id, p_track_id, v_uid, nullif(btrim(coalesce(p_anon_id,'')),''), greatest(coalesce(p_played_seconds,0),0), p_track_duration, coalesce(p_reason,'manual_skip'));

  -- 적격 스킵의 distinct skipper 수 (최근 30일)
  select count(distinct coalesce(user_id::text, session_id, 'anon'))
    into v_skippers
  from public.playlist_track_skip_events e
  where e.playlist_id = p_playlist_id and e.track_id = p_track_id
    and e.created_at > now() - interval '30 days'
    and e.played_seconds >= 5
    and (e.track_duration is null or e.track_duration <= 0 or e.played_seconds < 0.3 * e.track_duration);

  if v_skippers >= v_threshold then
    insert into public.metadata_violation_candidates(playlist_id, track_id, skip_count, status, reason, first_detected_at, last_detected_at)
    values (p_playlist_id, p_track_id, v_skippers, 'pending',
            format('자동 등록 — 최근 30일 distinct 스킵 %s회', v_skippers), now(), now())
    on conflict (playlist_id, track_id) do update set
      skip_count = excluded.skip_count,
      last_detected_at = now(),
      -- resolved/ignored 였다가 재발생하면 reopen
      status = case when public.metadata_violation_candidates.status in ('resolved','ignored') then 'pending' else public.metadata_violation_candidates.status end,
      reason = case when public.metadata_violation_candidates.status in ('resolved','ignored')
                    then format('재발(reopened) — distinct 스킵 %s회', excluded.skip_count)
                    else public.metadata_violation_candidates.reason end;
  end if;

  return jsonb_build_object('ok', true, 'skippers', v_skippers, 'registered', v_skippers >= v_threshold);
end; $$;

grant execute on function public.record_track_skip(uuid, uuid, numeric, numeric, text, text) to anon, authenticated;

-- 4) 관리자: 위반 후보 목록 (#10 — 플레이리스트별 vs 전체 스킵 수 구분)
create or replace function public.admin_list_metadata_violations(p_status text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.last_detected_at desc), '[]'::jsonb) into v from (
    select c.id, c.playlist_id, c.track_id, c.skip_count, c.status, c.reason,
      c.first_detected_at, c.last_detected_at, c.reviewed_at, c.admin_note,
      t.title, t.artist, t.genre, t.main_genre, t.mood, t.energy_level,
      p.title as playlist_title, p.category as playlist_category,
      -- 이 플레이리스트에서의 적격 스킵 수
      (select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=c.playlist_id and e.track_id=c.track_id
           and e.played_seconds>=5 and (e.track_duration is null or e.track_duration<=0 or e.played_seconds<0.3*e.track_duration)) as playlist_skip_count,
      -- 전체(모든 플레이리스트) 적격 스킵 수 → 모든 곳에서 높으면 곡 자체 문제
      (select count(*) from public.playlist_track_skip_events e
         where e.track_id=c.track_id
           and e.played_seconds>=5 and (e.track_duration is null or e.track_duration<=0 or e.played_seconds<0.3*e.track_duration)) as total_skip_count,
      (select round(avg(e.played_seconds)::numeric,1) from public.playlist_track_skip_events e
         where e.playlist_id=c.playlist_id and e.track_id=c.track_id and e.played_seconds>=5) as avg_played_before_skip
    from public.metadata_violation_candidates c
    join public.tracks t on t.id=c.track_id
    join public.playlists p on p.id=c.playlist_id
    where p_status is null or c.status = p_status
  ) x;
  return v;
end; $$;

grant execute on function public.admin_list_metadata_violations(text) to authenticated;

-- 5) 관리자: 후보 상태 변경 (검수/해결/무시)
create or replace function public.admin_resolve_metadata_violation(p_id uuid, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  if p_status not in ('pending','reviewed','resolved','ignored') then raise exception 'invalid status'; end if;
  update public.metadata_violation_candidates set
    status = p_status,
    admin_note = coalesce(nullif(btrim(p_note),''), admin_note),
    reviewed_by = v_uid, reviewed_at = now()
  where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'status', p_status);
end; $$;

grant execute on function public.admin_resolve_metadata_violation(uuid, text, text) to authenticated;

-- 6) 관리자: 플레이리스트에서 트랙 제외 (수동 — 자동 제외 비활성)
create or replace function public.admin_exclude_track_from_playlist(p_playlist_id uuid, p_track_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  delete from public.playlist_tracks where playlist_id=p_playlist_id and track_id=p_track_id;
  update public.metadata_violation_candidates set status='resolved', reviewed_by=v_uid, reviewed_at=now(),
    admin_note = coalesce(admin_note,'') || ' [플레이리스트에서 제외]'
  where playlist_id=p_playlist_id and track_id=p_track_id;
  return jsonb_build_object('ok', true);
end; $$;

grant execute on function public.admin_exclude_track_from_playlist(uuid, uuid) to authenticated;

-- 7) 관리자: 대시보드 통계 (#9)
create or replace function public.admin_metadata_violation_stats()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select jsonb_build_object(
    'recent7d_candidates', (select count(*) from public.metadata_violation_candidates where last_detected_at > now()-interval '7 days'),
    'pending_candidates', (select count(*) from public.metadata_violation_candidates where status='pending'),
    'top_skipped_tracks', (select coalesce(jsonb_agg(row_to_json(a)),'[]'::jsonb) from (
        select e.track_id, t.title, t.artist, count(*) skips
        from public.playlist_track_skip_events e join public.tracks t on t.id=e.track_id
        where e.created_at>now()-interval '30 days' and e.played_seconds>=5
        group by e.track_id, t.title, t.artist order by skips desc limit 20) a),
    'top_skipped_playlists', (select coalesce(jsonb_agg(row_to_json(b)),'[]'::jsonb) from (
        select e.playlist_id, p.title, p.category, count(*) skips
        from public.playlist_track_skip_events e join public.playlists p on p.id=e.playlist_id
        where e.created_at>now()-interval '30 days' and e.played_seconds>=5
        group by e.playlist_id, p.title, p.category order by skips desc limit 10) b),
    'by_category', (select coalesce(jsonb_agg(row_to_json(c)),'[]'::jsonb) from (
        select p.category, count(distinct mvc.track_id) unfit_tracks
        from public.metadata_violation_candidates mvc join public.playlists p on p.id=mvc.playlist_id
        where mvc.status='pending' group by p.category order by unfit_tracks desc) c)
  ) into v;
  return v;
end; $$;

grant execute on function public.admin_metadata_violation_stats() to authenticated;
