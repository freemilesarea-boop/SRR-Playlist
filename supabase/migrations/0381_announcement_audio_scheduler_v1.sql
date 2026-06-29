-- 0381 — Announcement Audio Scheduler V1 (Priority 5)
--
-- 광고/안내 음원 업로드 + 매장 예약 재생 (BGM 사이 삽입).
--
-- 절대 원칙:
--   - 기존 BGM queue / crossfade / 정산 / artist stream count / 추천 / AI /
--     기존 정책 자동화 rule / player 안정성 패치 무수정
--   - 본 migration 은 "광고/안내 오버레이" 레이어를 추가하는 additive only
--   - V1 곡 중간 강제 interrupt 금지 (서버 RPC 가 due 만 반환, 실제 삽입 시점은 클라이언트)
--
-- 추가 객체:
--   tables:
--     enterprise_announcement_assets       (음원 파일 metadata)
--     enterprise_announcement_schedules    (대상/시간/반복)
--     enterprise_announcement_play_logs    (실행 결과)
--   helper:
--     _announcement_is_due_now(rule, starts_at, ends_at, now, tz) → boolean
--   storage:
--     bucket 'enterprise-announcements' (public read, admin write only, 20MB cap)
--   RPCs (11):
--     admin_list_announcement_assets
--     admin_create_announcement_asset
--     admin_update_announcement_asset
--     admin_soft_delete_announcement_asset
--     admin_list_announcement_schedules
--     admin_create_announcement_schedule
--     admin_update_announcement_schedule
--     admin_set_announcement_schedule_status
--     admin_delete_announcement_schedule
--     store_get_due_announcements
--     store_mark_announcement_played

-- ============================================================
-- 1) Tables
-- ============================================================
create table if not exists public.enterprise_announcement_assets (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid references public.enterprise_accounts(id) on delete set null,
  title                 text not null,
  description           text,
  file_url              text not null,
  file_path             text not null,
  file_name             text,
  mime_type             text,
  file_size_bytes       bigint check (file_size_bytes is null or file_size_bytes >= 0),
  duration_seconds      numeric check (duration_seconds is null or duration_seconds >= 0),
  status                text not null default 'active' check (status in ('active','archived','disabled')),
  created_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_eaa_enterprise on public.enterprise_announcement_assets(enterprise_account_id) where deleted_at is null;
create index if not exists idx_eaa_status     on public.enterprise_announcement_assets(status) where deleted_at is null;
create index if not exists idx_eaa_created    on public.enterprise_announcement_assets(created_at desc) where deleted_at is null;

create table if not exists public.enterprise_announcement_schedules (
  id                    uuid primary key default gen_random_uuid(),
  asset_id              uuid not null references public.enterprise_announcement_assets(id) on delete cascade,
  enterprise_account_id uuid references public.enterprise_accounts(id) on delete set null,
  region_id             uuid references public.enterprise_regions(id) on delete set null,
  scope_type            text not null check (scope_type in ('enterprise','region','store')),
  scope_store_ids       uuid[],
  name                  text not null,
  description           text,
  status                text not null default 'active' check (status in ('active','paused','expired','disabled')),
  starts_at             timestamptz,
  ends_at               timestamptz,
  timezone              text not null default 'Asia/Seoul',
  recurrence_rule       text,
  play_mode             text not null default 'after_current_track'
                          check (play_mode in ('after_current_track','between_tracks')),
  max_plays_per_day     integer not null default 10 check (max_plays_per_day between 1 and 100),
  last_triggered_at     timestamptz,
  next_run_at           timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint eas_ends_after_starts check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index if not exists idx_eas_asset      on public.enterprise_announcement_schedules(asset_id) where deleted_at is null;
create index if not exists idx_eas_enterprise on public.enterprise_announcement_schedules(enterprise_account_id) where deleted_at is null;
create index if not exists idx_eas_region     on public.enterprise_announcement_schedules(region_id) where region_id is not null and deleted_at is null;
create index if not exists idx_eas_status     on public.enterprise_announcement_schedules(status) where deleted_at is null;
create index if not exists idx_eas_scope      on public.enterprise_announcement_schedules(scope_type) where deleted_at is null;

create table if not exists public.enterprise_announcement_play_logs (
  id            uuid primary key default gen_random_uuid(),
  schedule_id   uuid references public.enterprise_announcement_schedules(id) on delete set null,
  asset_id      uuid references public.enterprise_announcement_assets(id) on delete set null,
  store_id      uuid not null references public.users(id) on delete cascade,
  status        text not null check (status in ('queued','played','skipped','failed')),
  played_at     timestamptz,
  error_message text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_eapl_store    on public.enterprise_announcement_play_logs(store_id, created_at desc);
create index if not exists idx_eapl_schedule on public.enterprise_announcement_play_logs(schedule_id, created_at desc);
create index if not exists idx_eapl_today    on public.enterprise_announcement_play_logs(store_id, schedule_id, played_at desc);

-- updated_at triggers (재사용)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_eaa_updated_at') then
    create trigger trg_eaa_updated_at before update on public.enterprise_announcement_assets
      for each row execute function public._touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_eas_updated_at') then
    create trigger trg_eas_updated_at before update on public.enterprise_announcement_schedules
      for each row execute function public._touch_updated_at();
  end if;
end$$;

-- ============================================================
-- 2) RLS
-- ============================================================
alter table public.enterprise_announcement_assets    enable row level security;
alter table public.enterprise_announcement_schedules enable row level security;
alter table public.enterprise_announcement_play_logs enable row level security;

-- assets: super admin / 자기 enterprise / 자기 스케줄 대상 매장 (조회는 폭넓게 — file_url 만 공개)
drop policy if exists eaa_select on public.enterprise_announcement_assets;
create policy eaa_select on public.enterprise_announcement_assets
  for select to authenticated using (
    public._is_super_admin()
    or exists (select 1 from public.enterprise_accounts ea
                where ea.id = enterprise_announcement_assets.enterprise_account_id
                  and ea.auth_user_id = auth.uid())
  );

drop policy if exists eas_select on public.enterprise_announcement_schedules;
create policy eas_select on public.enterprise_announcement_schedules
  for select to authenticated using (
    public._is_super_admin()
    or exists (select 1 from public.enterprise_accounts ea
                where ea.id = enterprise_announcement_schedules.enterprise_account_id
                  and ea.auth_user_id = auth.uid())
  );

drop policy if exists eapl_select on public.enterprise_announcement_play_logs;
create policy eapl_select on public.enterprise_announcement_play_logs
  for select to authenticated using (
    public._is_super_admin() or store_id = auth.uid()
  );

revoke insert, update, delete on public.enterprise_announcement_assets    from authenticated, anon;
revoke insert, update, delete on public.enterprise_announcement_schedules from authenticated, anon;
revoke insert, update, delete on public.enterprise_announcement_play_logs from authenticated, anon;

-- ============================================================
-- 3) Storage bucket — enterprise-announcements
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'enterprise-announcements', 'enterprise-announcements', true, 20971520,  -- 20MB
  array['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/mp4','audio/aac','audio/m4a','audio/x-m4a']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- storage.objects 의 RLS 정책 — public read, admin only write
do $$
begin
  -- public read
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_announcements_public_read'
  ) then
    create policy enterprise_announcements_public_read on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'enterprise-announcements');
  end if;

  -- super admin write (insert/update/delete)
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_announcements_admin_write'
  ) then
    create policy enterprise_announcements_admin_write on storage.objects
      for all to authenticated
      using (bucket_id = 'enterprise-announcements' and public._is_super_admin())
      with check (bucket_id = 'enterprise-announcements' and public._is_super_admin());
  end if;
end$$;

-- ============================================================
-- 4) Helper — recurrence parser ("once" / "daily" / "weekly")
-- ============================================================
create or replace function public._announcement_is_due_now(
  p_recurrence text,
  p_starts_at  timestamptz,
  p_ends_at    timestamptz,
  p_now        timestamptz default now(),
  p_tz         text default 'Asia/Seoul'
) returns boolean
language plpgsql
immutable
as $$
declare
  v_parts      text[];
  v_local      timestamp;
  v_hour       int;
  v_minute     int;
  v_dow_tokens text[];
  v_dow        text;
  v_dow_now    int;
  v_target_dow int;
  v_target     timestamptz;
  v_once       timestamp;
begin
  if p_recurrence is null then return false; end if;
  if p_starts_at is not null and p_now < p_starts_at then return false; end if;
  if p_ends_at   is not null and p_now > p_ends_at   then return false; end if;

  v_parts := string_to_array(p_recurrence, ':');
  v_local := (p_now at time zone p_tz);

  -- once:YYYY-MM-DDTHH:MM  (string_to_array splits into 3 parts: ['once','YYYY-MM-DDTHH','MM'])
  if v_parts[1] = 'once' and array_length(v_parts, 1) >= 3 then
    v_once  := (v_parts[2] || ':' || v_parts[3])::timestamp;
    v_target := v_once at time zone p_tz;
    return p_now between v_target and (v_target + interval '5 minutes');
  end if;

  -- daily:HH:MM
  if v_parts[1] = 'daily' and array_length(v_parts, 1) >= 3 then
    v_hour   := v_parts[2]::int;
    v_minute := v_parts[3]::int;
    v_target := (v_local::date + make_time(v_hour, v_minute, 0)) at time zone p_tz;
    return p_now between v_target and (v_target + interval '5 minutes');
  end if;

  -- weekly:DOW1,DOW2,...:HH:MM   (DOW=SUN..SAT)
  if v_parts[1] = 'weekly' and array_length(v_parts, 1) >= 4 then
    v_dow_tokens := string_to_array(v_parts[2], ',');
    v_hour       := v_parts[3]::int;
    v_minute     := v_parts[4]::int;
    v_dow_now    := extract(dow from v_local)::int;
    foreach v_dow in array v_dow_tokens loop
      v_target_dow := case upper(btrim(v_dow))
        when 'SUN' then 0
        when 'MON' then 1
        when 'TUE' then 2
        when 'WED' then 3
        when 'THU' then 4
        when 'FRI' then 5
        when 'SAT' then 6
        else -1
      end;
      if v_dow_now = v_target_dow then
        v_target := (v_local::date + make_time(v_hour, v_minute, 0)) at time zone p_tz;
        return p_now between v_target and (v_target + interval '5 minutes');
      end if;
    end loop;
    return false;
  end if;

  return false;
exception when others then
  return false;
end;
$$;

-- ============================================================
-- 5) Admin RPCs — assets CRUD
-- ============================================================
create or replace function public.admin_list_announcement_assets(
  p_search                text default null,
  p_status                text default null,
  p_enterprise_account_id uuid default null,
  p_limit                 int  default 50,
  p_offset                int  default 0
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint := 0;
  v_rows   jsonb := '[]'::jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select a.*,
           ea.enterprise_name,
           (select count(*) from public.enterprise_announcement_schedules s
             where s.asset_id = a.id and s.deleted_at is null)::int as schedule_count
      from public.enterprise_announcement_assets a
      left join public.enterprise_accounts ea on ea.id = a.enterprise_account_id
     where a.deleted_at is null
       and (p_status is null or a.status = p_status)
       and (p_enterprise_account_id is null or a.enterprise_account_id = p_enterprise_account_id)
       and (
         p_search is null
         or a.title ilike '%' || p_search || '%'
         or coalesce(a.description, '') ilike '%' || p_search || '%'
         or coalesce(a.file_name, '')   ilike '%' || p_search || '%'
       )
  ),
  total_cte as (select count(*)::bigint as c from base),
  paged as (
    select * from base order by created_at desc limit v_limit offset v_offset
  )
  select coalesce((select c from total_cte), 0),
         coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
    into v_total, v_rows
    from paged p;

  return jsonb_build_object(
    'success', true, 'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_announcement_assets(text,text,uuid,int,int) from public, anon;
grant   execute on function public.admin_list_announcement_assets(text,text,uuid,int,int) to authenticated;

create or replace function public.admin_create_announcement_asset(
  p_title                 text,
  p_file_url              text,
  p_file_path             text,
  p_file_name             text default null,
  p_mime_type             text default null,
  p_file_size_bytes       bigint default null,
  p_duration_seconds      numeric default null,
  p_description           text default null,
  p_enterprise_account_id uuid default null,
  p_status                text default 'active'
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if nullif(btrim(coalesce(p_title, '')), '')     is null then raise exception 'title required'; end if;
  if nullif(btrim(coalesce(p_file_url, '')), '')  is null then raise exception 'file_url required'; end if;
  if nullif(btrim(coalesce(p_file_path, '')), '') is null then raise exception 'file_path required'; end if;
  if coalesce(p_status, 'active') not in ('active','archived','disabled') then
    raise exception 'invalid status: %', p_status;
  end if;

  insert into public.enterprise_announcement_assets (
    enterprise_account_id, title, description, file_url, file_path, file_name,
    mime_type, file_size_bytes, duration_seconds, status, created_by
  ) values (
    p_enterprise_account_id, p_title, p_description, p_file_url, p_file_path, p_file_name,
    p_mime_type, p_file_size_bytes, p_duration_seconds, coalesce(p_status, 'active'), auth.uid()
  ) returning id into v_id;

  perform public.admin_log_operation(
    'enterprise_announcement','announcement.asset.create','info','created',
    format('announcement asset registered — %s', p_title),
    jsonb_build_object('asset_id', v_id, 'file_path', p_file_path, 'mime_type', p_mime_type),
    auth.uid(), v_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'asset_id', v_id);
end;
$$;
revoke execute on function public.admin_create_announcement_asset(text,text,text,text,text,bigint,numeric,text,uuid,text) from public, anon;
grant   execute on function public.admin_create_announcement_asset(text,text,text,text,text,bigint,numeric,text,uuid,text) to authenticated;

create or replace function public.admin_update_announcement_asset(
  p_id            uuid,
  p_title         text default null,
  p_description   text default null,
  p_status        text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status is not null and p_status not in ('active','archived','disabled') then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.enterprise_announcement_assets
     set title       = coalesce(p_title, title),
         description = coalesce(p_description, description),
         status      = coalesce(p_status, status),
         updated_at  = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'asset not found: %', p_id; end if;

  perform public.admin_log_operation(
    'enterprise_announcement','announcement.asset.update','info','updated',
    format('announcement asset updated — id=%s', p_id),
    jsonb_build_object('asset_id', p_id, 'status', p_status),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'asset_id', p_id);
end;
$$;
revoke execute on function public.admin_update_announcement_asset(uuid,text,text,text) from public, anon;
grant   execute on function public.admin_update_announcement_asset(uuid,text,text,text) to authenticated;

create or replace function public.admin_soft_delete_announcement_asset(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.enterprise_announcement_assets
     set deleted_at = now(), status = 'disabled', updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'asset not found or already deleted: %', p_id; end if;

  perform public.admin_log_operation(
    'enterprise_announcement','announcement.asset.delete','warning','deleted',
    format('announcement asset soft-deleted — id=%s', p_id),
    jsonb_build_object('asset_id', p_id),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'asset_id', p_id);
end;
$$;
revoke execute on function public.admin_soft_delete_announcement_asset(uuid) from public, anon;
grant   execute on function public.admin_soft_delete_announcement_asset(uuid) to authenticated;

-- ============================================================
-- 6) Admin RPCs — schedules CRUD
-- ============================================================
create or replace function public.admin_list_announcement_schedules(
  p_search                text default null,
  p_status                text default null,
  p_scope_type            text default null,
  p_enterprise_account_id uuid default null,
  p_region_id             uuid default null,
  p_asset_id              uuid default null,
  p_limit                 int  default 50,
  p_offset                int  default 0
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint := 0;
  v_rows   jsonb := '[]'::jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select s.*,
           a.title as asset_title,
           a.duration_seconds as asset_duration,
           ea.enterprise_name,
           er.region_name, er.region_code,
           (select count(*) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.played_at >= now() - interval '7 days')::int as plays_7d,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id) as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a on a.id = s.asset_id and a.deleted_at is null
      left join public.enterprise_accounts ea on ea.id = s.enterprise_account_id
      left join public.enterprise_regions  er on er.id = s.region_id
     where s.deleted_at is null
       and (p_status                is null or s.status = p_status)
       and (p_scope_type            is null or s.scope_type = p_scope_type)
       and (p_enterprise_account_id is null or s.enterprise_account_id = p_enterprise_account_id)
       and (p_region_id             is null or s.region_id = p_region_id)
       and (p_asset_id              is null or s.asset_id = p_asset_id)
       and (
         p_search is null
         or s.name ilike '%' || p_search || '%'
         or coalesce(s.description, '') ilike '%' || p_search || '%'
         or coalesce(a.title, '') ilike '%' || p_search || '%'
       )
  ),
  total_cte as (select count(*)::bigint as c from base),
  paged as (
    select * from base
     order by case when status = 'active' then 0 else 1 end, next_run_at asc nulls last, updated_at desc
     limit v_limit offset v_offset
  )
  select coalesce((select c from total_cte), 0),
         coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc), '[]'::jsonb)
    into v_total, v_rows
    from paged p;

  return jsonb_build_object(
    'success', true, 'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_announcement_schedules(text,text,text,uuid,uuid,uuid,int,int) from public, anon;
grant   execute on function public.admin_list_announcement_schedules(text,text,text,uuid,uuid,uuid,int,int) to authenticated;

create or replace function public.admin_create_announcement_schedule(
  p_asset_id              uuid,
  p_name                  text,
  p_scope_type            text,
  p_enterprise_account_id uuid default null,
  p_region_id             uuid default null,
  p_scope_store_ids       uuid[] default null,
  p_description           text default null,
  p_status                text default 'active',
  p_starts_at             timestamptz default null,
  p_ends_at               timestamptz default null,
  p_timezone              text default 'Asia/Seoul',
  p_recurrence_rule       text default null,
  p_play_mode             text default 'after_current_track',
  p_max_plays_per_day     int  default 10
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_asset_id is null then raise exception 'asset_id required'; end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then raise exception 'name required'; end if;
  if p_scope_type not in ('enterprise','region','store') then raise exception 'invalid scope_type: %', p_scope_type; end if;
  if p_scope_type = 'region' and p_region_id is null then raise exception 'region scope requires region_id'; end if;
  if p_scope_type = 'store'  and (p_scope_store_ids is null or array_length(p_scope_store_ids, 1) = 0) then
    raise exception 'store scope requires non-empty scope_store_ids';
  end if;
  if coalesce(p_status, 'active') not in ('active','paused','expired','disabled') then
    raise exception 'invalid status: %', p_status;
  end if;
  if coalesce(p_play_mode, 'after_current_track') not in ('after_current_track','between_tracks') then
    raise exception 'invalid play_mode: %', p_play_mode;
  end if;
  if coalesce(p_max_plays_per_day, 10) < 1 or coalesce(p_max_plays_per_day, 10) > 100 then
    raise exception 'max_plays_per_day must be 1..100';
  end if;
  if p_ends_at is not null and p_starts_at is not null and p_ends_at < p_starts_at then
    raise exception 'ends_at must be >= starts_at';
  end if;

  insert into public.enterprise_announcement_schedules (
    asset_id, enterprise_account_id, region_id, scope_type, scope_store_ids,
    name, description, status, starts_at, ends_at, timezone, recurrence_rule,
    play_mode, max_plays_per_day, created_by
  ) values (
    p_asset_id, p_enterprise_account_id, p_region_id, p_scope_type, p_scope_store_ids,
    p_name, p_description, coalesce(p_status, 'active'),
    p_starts_at, p_ends_at, coalesce(p_timezone, 'Asia/Seoul'),
    p_recurrence_rule, coalesce(p_play_mode, 'after_current_track'),
    coalesce(p_max_plays_per_day, 10), auth.uid()
  ) returning id into v_id;

  perform public.admin_log_operation(
    'enterprise_announcement','announcement.schedule.create','info','created',
    format('announcement schedule registered — %s', p_name),
    jsonb_build_object('schedule_id', v_id, 'asset_id', p_asset_id, 'scope_type', p_scope_type),
    auth.uid(), v_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'schedule_id', v_id);
end;
$$;
revoke execute on function public.admin_create_announcement_schedule(uuid,text,text,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,text,text,int) from public, anon;
grant   execute on function public.admin_create_announcement_schedule(uuid,text,text,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,text,text,int) to authenticated;

create or replace function public.admin_update_announcement_schedule(
  p_id                uuid,
  p_name              text default null,
  p_description       text default null,
  p_status            text default null,
  p_starts_at         timestamptz default null,
  p_ends_at           timestamptz default null,
  p_timezone          text default null,
  p_recurrence_rule   text default null,
  p_play_mode         text default null,
  p_max_plays_per_day int  default null,
  p_region_id         uuid default null,
  p_scope_type        text default null,
  p_scope_store_ids   uuid[] default null,
  p_clear_region        boolean default false,
  p_clear_scope_stores  boolean default false
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status     is not null and p_status     not in ('active','paused','expired','disabled') then
    raise exception 'invalid status: %', p_status;
  end if;
  if p_scope_type is not null and p_scope_type not in ('enterprise','region','store') then
    raise exception 'invalid scope_type: %', p_scope_type;
  end if;
  if p_play_mode  is not null and p_play_mode  not in ('after_current_track','between_tracks') then
    raise exception 'invalid play_mode: %', p_play_mode;
  end if;

  update public.enterprise_announcement_schedules
     set name              = coalesce(p_name, name),
         description       = coalesce(p_description, description),
         status            = coalesce(p_status, status),
         starts_at         = coalesce(p_starts_at, starts_at),
         ends_at           = coalesce(p_ends_at, ends_at),
         timezone          = coalesce(p_timezone, timezone),
         recurrence_rule   = coalesce(p_recurrence_rule, recurrence_rule),
         play_mode         = coalesce(p_play_mode, play_mode),
         max_plays_per_day = coalesce(p_max_plays_per_day, max_plays_per_day),
         scope_type        = coalesce(p_scope_type, scope_type),
         region_id         = case when p_clear_region        then null else coalesce(p_region_id, region_id) end,
         scope_store_ids   = case when p_clear_scope_stores  then null else coalesce(p_scope_store_ids, scope_store_ids) end,
         updated_at        = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'schedule not found: %', p_id; end if;

  perform public.admin_log_operation(
    'enterprise_announcement','announcement.schedule.update','info','updated',
    format('announcement schedule updated — id=%s', p_id),
    jsonb_build_object('schedule_id', p_id),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'schedule_id', p_id);
end;
$$;
revoke execute on function public.admin_update_announcement_schedule(uuid,text,text,text,timestamptz,timestamptz,text,text,text,int,uuid,text,uuid[],boolean,boolean) from public, anon;
grant   execute on function public.admin_update_announcement_schedule(uuid,text,text,text,timestamptz,timestamptz,text,text,text,int,uuid,text,uuid[],boolean,boolean) to authenticated;

create or replace function public.admin_set_announcement_schedule_status(
  p_id uuid, p_status text
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_prev text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('active','paused','expired','disabled') then raise exception 'invalid status: %', p_status; end if;
  select status into v_prev from public.enterprise_announcement_schedules where id = p_id and deleted_at is null;
  if v_prev is null then raise exception 'schedule not found: %', p_id; end if;
  update public.enterprise_announcement_schedules
     set status = p_status, updated_at = now()
   where id = p_id;
  perform public.admin_log_operation(
    'enterprise_announcement','announcement.schedule.status','info',p_status,
    format('schedule status %s → %s', v_prev, p_status),
    jsonb_build_object('schedule_id', p_id, 'previous_status', v_prev, 'new_status', p_status),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'schedule_id', p_id, 'status', p_status, 'previous_status', v_prev);
end;
$$;
revoke execute on function public.admin_set_announcement_schedule_status(uuid, text) from public, anon;
grant   execute on function public.admin_set_announcement_schedule_status(uuid, text) to authenticated;

create or replace function public.admin_delete_announcement_schedule(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.enterprise_announcement_schedules
     set deleted_at = now(), status = 'disabled', updated_at = now()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'schedule not found or already deleted: %', p_id; end if;
  perform public.admin_log_operation(
    'enterprise_announcement','announcement.schedule.delete','warning','deleted',
    format('announcement schedule soft-deleted — id=%s', p_id),
    jsonb_build_object('schedule_id', p_id),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'schedule_id', p_id);
end;
$$;
revoke execute on function public.admin_delete_announcement_schedule(uuid) from public, anon;
grant   execute on function public.admin_delete_announcement_schedule(uuid) to authenticated;

-- ============================================================
-- 7) Store RPCs — get due / mark played
-- ============================================================
create or replace function public.store_get_due_announcements(
  p_store_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid          uuid := coalesce(p_store_id, auth.uid());
  v_now          timestamptz := now();
  v_today_start  timestamptz;
  v_results      jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_uid <> auth.uid() and not public._is_super_admin() then raise exception 'forbidden'; end if;

  v_today_start := ((v_now at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul';

  with eligible as (
    select s.id as schedule_id, s.asset_id, s.name as schedule_name, s.play_mode,
           s.max_plays_per_day, s.timezone, s.recurrence_rule, s.starts_at, s.ends_at,
           a.title as asset_title, a.file_url as asset_file_url,
           a.duration_seconds as asset_duration, a.mime_type as asset_mime_type,
           (select count(*) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.played_at >= v_today_start
               and pl.status = 'played')::int as today_count,
           (select max(pl.played_at) from public.enterprise_announcement_play_logs pl
             where pl.schedule_id = s.id and pl.store_id = v_uid
               and pl.status = 'played') as last_played_at
      from public.enterprise_announcement_schedules s
      join public.enterprise_announcement_assets a
        on a.id = s.asset_id and a.deleted_at is null and a.status = 'active'
     where s.deleted_at is null and s.status = 'active'
       and public._announcement_is_due_now(s.recurrence_rule, s.starts_at, s.ends_at, v_now, coalesce(s.timezone, 'Asia/Seoul'))
       and (
         -- scope match
         (s.scope_type = 'enterprise')
         or (s.scope_type = 'region' and exists (
              select 1 from public.store_policy_sync_status sps
               where sps.store_id = v_uid and sps.enterprise_region_id = s.region_id
            ))
         or (s.scope_type = 'store' and v_uid = any(s.scope_store_ids))
       )
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'schedule_id',     e.schedule_id,
           'asset_id',        e.asset_id,
           'schedule_name',   e.schedule_name,
           'asset_title',     e.asset_title,
           'asset_file_url',  e.asset_file_url,
           'asset_duration',  e.asset_duration,
           'asset_mime_type', e.asset_mime_type,
           'play_mode',       e.play_mode,
           'today_count',     e.today_count,
           'max_plays_per_day', e.max_plays_per_day,
           'last_played_at',  e.last_played_at
         ) order by e.schedule_id), '[]'::jsonb)
    into v_results
    from eligible e
   where e.today_count < e.max_plays_per_day
     and (e.last_played_at is null or e.last_played_at < (v_now - interval '5 minutes'));

  return jsonb_build_object(
    'success', true, 'store_id', v_uid, 'now_at', v_now, 'data', v_results
  );
end;
$$;
revoke execute on function public.store_get_due_announcements(uuid) from public, anon;
grant   execute on function public.store_get_due_announcements(uuid) to authenticated;

create or replace function public.store_mark_announcement_played(
  p_schedule_id   uuid,
  p_asset_id      uuid,
  p_status        text default 'played',
  p_error_message text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_log_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_status not in ('queued','played','skipped','failed') then
    raise exception 'invalid status: %', p_status;
  end if;
  if p_schedule_id is null then raise exception 'schedule_id required'; end if;
  if p_asset_id    is null then raise exception 'asset_id required';    end if;

  insert into public.enterprise_announcement_play_logs (
    schedule_id, asset_id, store_id, status, played_at, error_message
  ) values (
    p_schedule_id, p_asset_id, v_uid, p_status,
    case when p_status = 'played' then now() else null end,
    p_error_message
  ) returning id into v_log_id;

  if p_status = 'played' then
    update public.enterprise_announcement_schedules
       set last_triggered_at = now()
     where id = p_schedule_id;
  end if;

  return jsonb_build_object('success', true, 'log_id', v_log_id, 'status', p_status);
end;
$$;
revoke execute on function public.store_mark_announcement_played(uuid,uuid,text,text) from public, anon;
grant   execute on function public.store_mark_announcement_played(uuid,uuid,text,text) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_assets int; v_sched int; v_logs int; v_rpc int; v_bucket int;
begin
  select count(*) into v_assets from pg_class where relname='enterprise_announcement_assets';
  select count(*) into v_sched  from pg_class where relname='enterprise_announcement_schedules';
  select count(*) into v_logs   from pg_class where relname='enterprise_announcement_play_logs';
  select count(*) into v_rpc from pg_proc where pronamespace='public'::regnamespace and proname in (
    'admin_list_announcement_assets','admin_create_announcement_asset','admin_update_announcement_asset',
    'admin_soft_delete_announcement_asset','admin_list_announcement_schedules','admin_create_announcement_schedule',
    'admin_update_announcement_schedule','admin_set_announcement_schedule_status','admin_delete_announcement_schedule',
    'store_get_due_announcements','store_mark_announcement_played','_announcement_is_due_now'
  );
  select count(*) into v_bucket from storage.buckets where id='enterprise-announcements';

  raise notice '====== 0381 Announcement Audio Scheduler V1 ======';
  raise notice 'tables   : assets=% sched=% logs=%', v_assets, v_sched, v_logs;
  raise notice 'rpcs+helper: % / 12', v_rpc;
  raise notice 'bucket   : % / 1', v_bucket;
  if v_assets=1 and v_sched=1 and v_logs=1 and v_rpc>=12 and v_bucket=1 then
    raise notice '0381 COMPLETE — assets + schedules + logs + 11 RPCs + bucket ready';
  else
    raise warning '0381 INCOMPLETE';
  end if;
end$$;
