-- 0292 — 관리자 큐레이터 관리 (soft delete / inactive / restore) [X6.6]
--
-- 목적: 유령/미사용 큐레이터를 안전하게 정리.
--   - hard delete 절대 금지
--   - status: active / inactive / deleted (3-state)
--   - inactive: 로그인 가능, 큐레이터 기능 비활성, 자동 노출/추천에서 제외
--   - deleted: 큐레이터 목록 비공개, 운영 중인 playlist 는 유지 (created_by_user_id 보존)
--   - draft 상태 playlist 만 옵션으로 archive
--   - admin 만 RPC 호출 가능
--   - 모든 동작 curator_admin_audit_logs 에 기록

-- ===== A. curator_profiles 컬럼 확장 =====
alter table public.curator_profiles
  add column if not exists status text not null default 'active'
    check (status in ('active','inactive','deleted')),
  add column if not exists last_active_at timestamptz,
  add column if not exists deactivated_at timestamptz,
  add column if not exists deactivate_reason text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.users(id) on delete set null,
  add column if not exists delete_reason text;

create index if not exists idx_curator_profiles_status
  on public.curator_profiles(status);

-- ===== B. curator_admin_audit_logs =====
create table if not exists public.curator_admin_audit_logs (
  id bigserial primary key,
  curator_id uuid not null references public.curator_profiles(user_id) on delete cascade,
  action text not null check (action in (
    'deactivate','soft_delete','restore','archive_playlist','reassign_playlist','update'
  )),
  before_status text,
  after_status text,
  admin_user_id uuid references public.users(id) on delete set null,
  reason text,
  detail jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_caal_curator_created
  on public.curator_admin_audit_logs(curator_id, created_at desc);
create index if not exists idx_caal_action
  on public.curator_admin_audit_logs(action, created_at desc);

alter table public.curator_admin_audit_logs enable row level security;
drop policy if exists "caal admin read" on public.curator_admin_audit_logs;
create policy "caal admin read" on public.curator_admin_audit_logs
  for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== C. 공개 RPC 에 status='active' 필터 추가 =====
-- get_featured_curators / search_curators: deleted/inactive 큐레이터 노출 제외
-- get_curator_profile: deleted 만 차단 (inactive 는 직접 URL 진입 시 표시는 유지하되 검색에선 빠짐)

create or replace function public.get_featured_curators(p_limit int default 12)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  profile_image_url text,
  is_verified boolean,
  is_featured boolean,
  playlist_count bigint,
  total_streams bigint
)
language sql security definer set search_path = public as $$
  with own as (
    select cp.user_id, count(p.id)::bigint as pc
    from public.curator_profiles cp
    left join public.playlists p on p.created_by_user_id = cp.user_id
    where cp.status = 'active'
    group by cp.user_id
  ),
  streams as (
    select p.created_by_user_id as user_id,
           count(*)::bigint as ts
    from public.stream_events se
    join public.playlists p on p.id = se.playlist_id
    where se.event_type = 'milestone_30s' and p.created_by_user_id is not null
    group by p.created_by_user_id
  )
  select cp.user_id, cp.display_name, cp.handle, cp.bio, cp.profile_image_url,
         cp.is_verified, cp.is_featured,
         coalesce(o.pc, 0), coalesce(s.ts, 0)
  from public.curator_profiles cp
  left join own o on o.user_id = cp.user_id
  left join streams s on s.user_id = cp.user_id
  where cp.status = 'active'
  order by cp.is_featured desc, coalesce(s.ts, 0) desc, cp.created_at desc
  limit greatest(1, p_limit);
$$;

create or replace function public.search_curators(p_query text)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  profile_image_url text,
  is_verified boolean
)
language sql security definer set search_path = public as $$
  select cp.user_id, cp.display_name, cp.handle, cp.profile_image_url, cp.is_verified
  from public.curator_profiles cp
  where cp.status = 'active'
    and (p_query is null or length(btrim(p_query)) = 0
      or lower(cp.display_name) like '%' || lower(p_query) || '%'
      or lower(cp.handle) like '%' || lower(p_query) || '%')
  order by cp.is_featured desc, cp.is_verified desc, cp.created_at desc
  limit 20;
$$;

-- get_curator_profile: deleted 만 차단 (inactive 는 직접 link 접근 시 보일 수 있음)
-- 0097_fix_get_curator_profile 정의를 status 필터만 추가해서 재선언.
create or replace function public.get_curator_profile(p_handle text)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  profile_image_url text,
  contact_email text,
  instagram_url text,
  youtube_url text,
  website_url text,
  allow_business_contact boolean,
  is_verified boolean,
  is_featured boolean,
  created_at timestamptz,
  follower_count bigint,
  playlist_count bigint,
  total_playlist_streams bigint,
  monthly_streams bigint,
  chart_entries bigint,
  playlists jsonb
)
language plpgsql security definer set search_path = public as $$
declare v_user_id uuid;
begin
  select cp.user_id into v_user_id
  from public.curator_profiles cp
  where cp.handle = lower(p_handle)
    and cp.status <> 'deleted';
  if v_user_id is null then return; end if;

  return query
  with
    own_pls as (
      select id, title, thumbnail_url, category, created_at
      from public.playlists where created_by_user_id = v_user_id
    ),
    pl_follows as (
      select pf.playlist_id, count(*)::bigint as fc
      from public.playlist_follows pf
      where pf.playlist_id in (select id from own_pls)
      group by pf.playlist_id
    ),
    pl_streams as (
      select se.playlist_id,
             count(*) filter (where se.event_type = 'milestone_30s')::bigint as total,
             count(*) filter (where se.event_type = 'milestone_30s'
                              and se.created_at >= now() - interval '30 days')::bigint as monthly
      from public.stream_events se
      where se.playlist_id in (select id from own_pls)
      group by se.playlist_id
    ),
    user_followers as (
      select count(distinct pf.user_id)::bigint as fc
      from public.playlist_follows pf
      where pf.playlist_id in (select id from own_pls)
    ),
    chart_cnt as (
      select count(*)::bigint as ce
      from public.stream_events se
      where se.playlist_id in (select id from own_pls)
        and se.event_type = 'complete'
    ),
    pl_array as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id, 'title', p.title,
            'thumbnail_url', p.thumbnail_url, 'category', p.category,
            'follower_count', coalesce(plf.fc, 0),
            'stream_count', coalesce(pls.total, 0)
          ) order by coalesce(pls.total, 0) desc, p.created_at desc
        ), '[]'::jsonb
      ) as arr
      from own_pls p
      left join pl_follows plf on plf.playlist_id = p.id
      left join pl_streams pls on pls.playlist_id = p.id
    )
  select
    cp.user_id, cp.display_name, cp.handle, cp.bio, cp.profile_image_url,
    cp.contact_email, cp.instagram_url, cp.youtube_url, cp.website_url,
    cp.allow_business_contact, cp.is_verified, cp.is_featured, cp.created_at,
    coalesce((select fc from user_followers), 0) as follower_count,
    (select count(*)::bigint from own_pls) as playlist_count,
    coalesce((select sum(total) from pl_streams), 0) as total_playlist_streams,
    coalesce((select sum(monthly) from pl_streams), 0) as monthly_streams,
    coalesce((select ce from chart_cnt), 0) as chart_entries,
    (select arr from pl_array) as playlists
  from public.curator_profiles cp
  where cp.user_id = v_user_id;
end; $$;

grant execute on function public.get_featured_curators(int) to anon, authenticated;
grant execute on function public.search_curators(text) to anon, authenticated;
grant execute on function public.get_curator_profile(text) to anon, authenticated;

-- ===== D. admin_list_curators =====
create or replace function public.admin_list_curators(
  p_status text default null,
  p_search text default null,
  p_limit int default 100,
  p_offset int default 0
) returns table (
  curator_id uuid,
  display_name text,
  handle text,
  contact_email text,
  user_email text,
  user_id uuid,
  status text,
  is_verified boolean,
  is_featured boolean,
  created_at timestamptz,
  last_active_at timestamptz,
  deactivated_at timestamptz,
  deactivate_reason text,
  deleted_at timestamptz,
  delete_reason text,
  deleted_by uuid,
  playlist_count bigint,
  active_playlist_count bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select
    c.user_id as curator_id,
    c.display_name,
    c.handle,
    c.contact_email,
    au.email::text as user_email,
    c.user_id,
    c.status,
    c.is_verified,
    c.is_featured,
    c.created_at,
    c.last_active_at,
    c.deactivated_at,
    c.deactivate_reason,
    c.deleted_at,
    c.delete_reason,
    c.deleted_by,
    coalesce(pc.total, 0)::bigint as playlist_count,
    coalesce(pc.active, 0)::bigint as active_playlist_count
  from public.curator_profiles c
  left join auth.users au on au.id = c.user_id
  left join lateral (
    select count(*)::bigint as total,
           count(*) filter (where p.status in ('released'))::bigint as active
    from public.playlists p
    where p.created_by_user_id = c.user_id
  ) pc on true
  where (p_status is null or p_status = '' or c.status = p_status)
    and (p_search is null or p_search = ''
         or c.display_name ilike '%'||p_search||'%'
         or c.handle ilike '%'||p_search||'%'
         or coalesce(c.contact_email,'') ilike '%'||p_search||'%'
         or coalesce(au.email::text,'') ilike '%'||p_search||'%')
  order by
    case c.status when 'active' then 0 when 'inactive' then 1 else 2 end,
    c.created_at desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end; $$;

-- ===== E. admin_deactivate_curator =====
create or replace function public.admin_deactivate_curator(
  p_curator_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_before text;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select status into v_before from public.curator_profiles where user_id = p_curator_id;
  if v_before is null then raise exception 'curator_not_found'; end if;
  if v_before = 'deleted' then raise exception 'curator_already_deleted'; end if;
  if v_before = 'inactive' then
    return jsonb_build_object('ok', true, 'curator_id', p_curator_id, 'status', 'inactive', 'noop', true);
  end if;

  update public.curator_profiles set
    status = 'inactive',
    deactivated_at = now(),
    deactivate_reason = p_reason,
    updated_at = now()
  where user_id = p_curator_id;

  update public.users set is_curator = false where id = p_curator_id;

  insert into public.curator_admin_audit_logs
    (curator_id, action, before_status, after_status, admin_user_id, reason)
  values (p_curator_id, 'deactivate', v_before, 'inactive', v_admin, p_reason);

  return jsonb_build_object('ok', true, 'curator_id', p_curator_id, 'status', 'inactive');
end; $$;

-- ===== F. admin_soft_delete_curator =====
create or replace function public.admin_soft_delete_curator(
  p_curator_id uuid,
  p_reason text default null,
  p_archive_drafts boolean default true,
  p_reassign_playlists boolean default true  -- 현재 created_by_user_id 보존; 향후 system curator 이전 시 사용
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_before text;
  v_archived int := 0;
  v_total_pl int := 0;
  v_active_pl int := 0;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select status into v_before from public.curator_profiles where user_id = p_curator_id;
  if v_before is null then raise exception 'curator_not_found'; end if;

  select count(*),
         count(*) filter (where status='released')
    into v_total_pl, v_active_pl
  from public.playlists where created_by_user_id = p_curator_id;

  -- 옵션 1: draft archive (released/active 는 절대 건드리지 않음)
  if p_archive_drafts then
    update public.playlists set
      status = 'archived',
      archived_at = now(),
      archived_reason = format('curator_deleted: %s', coalesce(p_reason,'no_reason'))
    where created_by_user_id = p_curator_id
      and status not in ('released','archived')
      and archived_at is null;
    get diagnostics v_archived = row_count;

    if v_archived > 0 then
      insert into public.curator_admin_audit_logs
        (curator_id, action, admin_user_id, reason, detail)
      values (p_curator_id, 'archive_playlist', v_admin, p_reason,
              jsonb_build_object('archived_count', v_archived));
    end if;
  end if;

  -- 옵션 2: 향후 reassign 옵션 자리 (현재는 created_by_user_id 유지 — 보존 우선)
  if p_reassign_playlists then
    insert into public.curator_admin_audit_logs
      (curator_id, action, admin_user_id, reason, detail)
    values (p_curator_id, 'reassign_playlist', v_admin, p_reason,
            jsonb_build_object('strategy', 'preserve_created_by',
                               'active_playlists', v_active_pl));
  end if;

  update public.curator_profiles set
    status = 'deleted',
    deleted_at = now(),
    deleted_by = v_admin,
    delete_reason = p_reason,
    updated_at = now()
  where user_id = p_curator_id;

  update public.users set is_curator = false where id = p_curator_id;

  insert into public.curator_admin_audit_logs
    (curator_id, action, before_status, after_status, admin_user_id, reason, detail)
  values (p_curator_id, 'soft_delete', v_before, 'deleted', v_admin, p_reason,
          jsonb_build_object(
            'archived_drafts', v_archived,
            'preserved_active_playlists', v_active_pl,
            'total_playlists', v_total_pl));

  return jsonb_build_object('ok', true,
    'curator_id', p_curator_id,
    'status', 'deleted',
    'archived_drafts', v_archived,
    'preserved_active_playlists', v_active_pl,
    'total_playlists', v_total_pl);
end; $$;

-- ===== G. admin_restore_curator =====
create or replace function public.admin_restore_curator(p_curator_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_before text;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select status into v_before from public.curator_profiles where user_id = p_curator_id;
  if v_before is null then raise exception 'curator_not_found'; end if;
  if v_before = 'active' then
    return jsonb_build_object('ok', true, 'curator_id', p_curator_id, 'status', 'active', 'noop', true);
  end if;

  update public.curator_profiles set
    status = 'active',
    deleted_at = null,
    deleted_by = null,
    delete_reason = null,
    deactivated_at = null,
    deactivate_reason = null,
    updated_at = now()
  where user_id = p_curator_id;

  update public.users set is_curator = true where id = p_curator_id;

  insert into public.curator_admin_audit_logs
    (curator_id, action, before_status, after_status, admin_user_id)
  values (p_curator_id, 'restore', v_before, 'active', v_admin);

  return jsonb_build_object('ok', true, 'curator_id', p_curator_id, 'status', 'active');
end; $$;

-- ===== H. admin_get_curator_audit_logs =====
create or replace function public.admin_get_curator_audit_logs(
  p_curator_id uuid, p_limit int default 50
)
returns table (
  id bigint,
  action text,
  before_status text,
  after_status text,
  admin_user_id uuid,
  admin_email text,
  reason text,
  detail jsonb,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select l.id, l.action, l.before_status, l.after_status,
         l.admin_user_id, au.email::text, l.reason, l.detail, l.created_at
  from public.curator_admin_audit_logs l
  left join auth.users au on au.id = l.admin_user_id
  where l.curator_id = p_curator_id
  order by l.created_at desc
  limit greatest(p_limit, 1);
end; $$;

-- ===== I. 권한 =====
revoke all on function public.admin_list_curators(text,text,int,int) from public, anon;
revoke all on function public.admin_deactivate_curator(uuid,text) from public, anon;
revoke all on function public.admin_soft_delete_curator(uuid,text,boolean,boolean) from public, anon;
revoke all on function public.admin_restore_curator(uuid) from public, anon;
revoke all on function public.admin_get_curator_audit_logs(uuid,int) from public, anon;
grant execute on function public.admin_list_curators(text,text,int,int) to authenticated, service_role;
grant execute on function public.admin_deactivate_curator(uuid,text) to authenticated, service_role;
grant execute on function public.admin_soft_delete_curator(uuid,text,boolean,boolean) to authenticated, service_role;
grant execute on function public.admin_restore_curator(uuid) to authenticated, service_role;
grant execute on function public.admin_get_curator_audit_logs(uuid,int) to authenticated, service_role;
