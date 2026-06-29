-- 0384 — Enterprise Emergency Broadcast V1 (Priority 7)
--
-- 긴급 방송 / 즉시 송출 시스템.
-- enterprise_announcement_assets (0381) 재사용 — 음원 별도 생성 안함.
-- 별도 emergency overlay layer (클라이언트) 로 안전 격리.
--
-- 절대 원칙:
--   - 기존 BGM queue / crossfade / Player.tsx / playerStore 무수정
--   - stream count / artist settlement 영향 0
--   - Announcement Scheduler V1 (0381) 동작 무수정
--   - Billing (0382) / Settlement (0372) / Contracts (0383) / Policy Automation /
--     Player 안정성 패치 / AI / Recommendation 무관
--   - 0381 의 enterprise-announcements bucket 재사용 (storage 변경 없음)
--
-- 추가:
--   tables (2):
--     enterprise_emergency_broadcasts
--     enterprise_emergency_broadcast_targets
--   RPCs (9):
--     admin_list_emergency_broadcasts
--     admin_get_emergency_broadcast_detail
--     admin_create_emergency_broadcast
--     admin_activate_emergency_broadcast
--     admin_cancel_emergency_broadcast
--     admin_complete_emergency_broadcast
--     admin_emergency_broadcast_kpi
--     store_get_active_emergency_broadcasts
--     store_mark_emergency_broadcast_status

-- ============================================================
-- 1) Tables
-- ============================================================
create table if not exists public.enterprise_emergency_broadcasts (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid references public.enterprise_accounts(id) on delete set null,
  asset_id              uuid not null references public.enterprise_announcement_assets(id) on delete restrict,
  title                 text not null,
  message               text,
  scope_type            text not null default 'enterprise'
                          check (scope_type in ('all','enterprise','region','store')),
  region_id             uuid references public.enterprise_regions(id) on delete set null,
  scope_store_ids       uuid[],
  priority              integer not null default 100 check (priority between 1 and 999),
  status                text not null default 'draft'
                          check (status in ('draft','active','completed','cancelled','failed')),
  interrupt_mode        text not null default 'fade_out'
                          check (interrupt_mode in ('fade_out','pause','after_current_track')),
  starts_at             timestamptz not null default now(),
  expires_at            timestamptz,
  target_store_count    integer not null default 0 check (target_store_count >= 0),
  played_count          integer not null default 0 check (played_count >= 0),
  failed_count          integer not null default 0 check (failed_count >= 0),
  skipped_count         integer not null default 0 check (skipped_count >= 0),
  activated_at          timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  memo                  text,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid references auth.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  constraint eeb_expires_after_starts check (expires_at is null or expires_at >= starts_at)
);
create index if not exists idx_eeb_status     on public.enterprise_emergency_broadcasts(status) where deleted_at is null;
create index if not exists idx_eeb_enterprise on public.enterprise_emergency_broadcasts(enterprise_account_id) where deleted_at is null;
create index if not exists idx_eeb_active     on public.enterprise_emergency_broadcasts(starts_at desc) where deleted_at is null and status = 'active';
create index if not exists idx_eeb_priority   on public.enterprise_emergency_broadcasts(priority desc, created_at desc) where deleted_at is null and status = 'active';

create table if not exists public.enterprise_emergency_broadcast_targets (
  id                    uuid primary key default gen_random_uuid(),
  broadcast_id          uuid not null references public.enterprise_emergency_broadcasts(id) on delete cascade,
  store_id              uuid not null references public.users(id) on delete cascade,
  enterprise_account_id uuid references public.enterprise_accounts(id) on delete set null,
  region_id             uuid references public.enterprise_regions(id) on delete set null,
  status                text not null default 'pending'
                          check (status in ('pending','playing','played','failed','skipped','expired')),
  first_seen_at         timestamptz,
  started_at            timestamptz,
  played_at             timestamptz,
  failed_at             timestamptz,
  error_message         text,
  attempt_count         integer not null default 0 check (attempt_count >= 0),
  device_info           jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (broadcast_id, store_id)
);
create index if not exists idx_eebt_broadcast on public.enterprise_emergency_broadcast_targets(broadcast_id);
create index if not exists idx_eebt_store     on public.enterprise_emergency_broadcast_targets(store_id, status);
create index if not exists idx_eebt_status    on public.enterprise_emergency_broadcast_targets(status);

-- updated_at triggers
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_eeb_updated_at') then
    create trigger trg_eeb_updated_at before update on public.enterprise_emergency_broadcasts
      for each row execute function public._touch_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname='trg_eebt_updated_at') then
    create trigger trg_eebt_updated_at before update on public.enterprise_emergency_broadcast_targets
      for each row execute function public._touch_updated_at();
  end if;
end$$;

-- ============================================================
-- 2) RLS
-- ============================================================
alter table public.enterprise_emergency_broadcasts        enable row level security;
alter table public.enterprise_emergency_broadcast_targets enable row level security;

drop policy if exists eeb_select on public.enterprise_emergency_broadcasts;
create policy eeb_select on public.enterprise_emergency_broadcasts
  for select to authenticated using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_emergency_broadcasts.enterprise_account_id
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

drop policy if exists eebt_select on public.enterprise_emergency_broadcast_targets;
create policy eebt_select on public.enterprise_emergency_broadcast_targets
  for select to authenticated using (
    public._is_super_admin()
    or store_id = auth.uid()
  );

revoke insert, update, delete on public.enterprise_emergency_broadcasts        from authenticated, anon;
revoke insert, update, delete on public.enterprise_emergency_broadcast_targets from authenticated, anon;

-- ============================================================
-- 3) Helper — target resolution
-- ============================================================
-- 대상 매장 uuid[] 해석 (scope 기반)
create or replace function public._emergency_resolve_target_stores(
  p_scope_type            text,
  p_enterprise_account_id uuid,
  p_region_id             uuid,
  p_scope_store_ids       uuid[]
) returns table (
  store_id              uuid,
  enterprise_account_id uuid,
  region_id             uuid
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with all_active as (
    select distinct fs.store_id
      from public.franchise_stores fs
     where fs.status = 'active'
  )
  -- all: 모든 active franchise store
  select s.store_id,
         (select ef.enterprise_account_id from public.enterprise_franchises ef
            join public.franchise_stores fs on fs.franchise_id = ef.franchise_id
           where fs.store_id = s.store_id and ef.deleted_at is null limit 1),
         (select sps.enterprise_region_id from public.store_policy_sync_status sps
           where sps.store_id = s.store_id limit 1)
    from all_active s
   where p_scope_type = 'all'
  union all
  -- enterprise: 해당 ea 의 active store
  select s.store_id, p_enterprise_account_id,
         (select sps.enterprise_region_id from public.store_policy_sync_status sps
           where sps.store_id = s.store_id limit 1)
    from public.franchise_stores s
    join public.enterprise_franchises ef
      on ef.franchise_id = s.franchise_id and ef.deleted_at is null
   where p_scope_type = 'enterprise'
     and p_enterprise_account_id is not null
     and ef.enterprise_account_id = p_enterprise_account_id
     and s.status = 'active'
  union all
  -- region: sync_status.enterprise_region_id 기준
  select s.store_id, p_enterprise_account_id, p_region_id
    from public.franchise_stores s
    join public.store_policy_sync_status sps on sps.store_id = s.store_id
   where p_scope_type = 'region'
     and p_region_id is not null
     and sps.enterprise_region_id = p_region_id
     and s.status = 'active'
  union all
  -- store: explicit store_ids ∩ active franchise stores
  select s.store_id, p_enterprise_account_id,
         (select sps.enterprise_region_id from public.store_policy_sync_status sps
           where sps.store_id = s.store_id limit 1)
    from public.franchise_stores s
   where p_scope_type = 'store'
     and p_scope_store_ids is not null
     and s.status = 'active'
     and s.store_id = any(p_scope_store_ids);
$$;

-- ============================================================
-- 4) Admin RPCs
-- ============================================================

create or replace function public.admin_create_emergency_broadcast(
  p_asset_id              uuid,
  p_title                 text,
  p_scope_type            text default 'enterprise',
  p_message               text default null,
  p_enterprise_account_id uuid default null,
  p_region_id             uuid default null,
  p_scope_store_ids       uuid[] default null,
  p_priority              int default 100,
  p_interrupt_mode        text default 'fade_out',
  p_expires_at            timestamptz default null,
  p_memo                  text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_id    uuid;
  v_count int := 0;
  v_t     record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_asset_id is null then raise exception 'asset_id required'; end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then raise exception 'title required'; end if;
  if p_scope_type not in ('all','enterprise','region','store') then raise exception 'invalid scope_type: %', p_scope_type; end if;
  if p_interrupt_mode not in ('fade_out','pause','after_current_track') then raise exception 'invalid interrupt_mode: %', p_interrupt_mode; end if;
  if p_priority < 1 or p_priority > 999 then raise exception 'priority must be 1..999'; end if;
  if p_scope_type = 'region' and p_region_id is null then raise exception 'region scope requires region_id'; end if;
  if p_scope_type = 'store' and (p_scope_store_ids is null or array_length(p_scope_store_ids, 1) = 0) then
    raise exception 'store scope requires non-empty scope_store_ids';
  end if;
  if p_scope_type = 'enterprise' and p_enterprise_account_id is null then
    raise exception 'enterprise scope requires enterprise_account_id';
  end if;
  -- asset 존재 확인
  if not exists (select 1 from public.enterprise_announcement_assets where id = p_asset_id and deleted_at is null and status = 'active') then
    raise exception 'asset not found or not active: %', p_asset_id;
  end if;

  -- broadcast (draft) 생성
  insert into public.enterprise_emergency_broadcasts (
    enterprise_account_id, asset_id, title, message,
    scope_type, region_id, scope_store_ids,
    priority, status, interrupt_mode, expires_at,
    memo, created_by
  ) values (
    p_enterprise_account_id, p_asset_id, p_title, p_message,
    p_scope_type, p_region_id, p_scope_store_ids,
    coalesce(p_priority, 100), 'draft', coalesce(p_interrupt_mode, 'fade_out'),
    p_expires_at, p_memo, auth.uid()
  ) returning id into v_id;

  -- target resolve + insert
  for v_t in
    select * from public._emergency_resolve_target_stores(
      p_scope_type, p_enterprise_account_id, p_region_id, p_scope_store_ids)
  loop
    insert into public.enterprise_emergency_broadcast_targets (
      broadcast_id, store_id, enterprise_account_id, region_id, status
    ) values (
      v_id, v_t.store_id, v_t.enterprise_account_id, v_t.region_id, 'pending'
    ) on conflict (broadcast_id, store_id) do nothing;
    v_count := v_count + 1;
  end loop;

  update public.enterprise_emergency_broadcasts
     set target_store_count = v_count
   where id = v_id;

  perform public.admin_log_operation(
    'emergency_broadcast', 'emergency_broadcast.create', 'info', 'created',
    format('emergency broadcast draft — %s (targets=%s)', p_title, v_count),
    jsonb_build_object('broadcast_id', v_id, 'asset_id', p_asset_id, 'title', p_title,
                       'scope_type', p_scope_type, 'enterprise_account_id', p_enterprise_account_id,
                       'region_id', p_region_id, 'target_store_count', v_count,
                       'priority', coalesce(p_priority, 100),
                       'interrupt_mode', coalesce(p_interrupt_mode, 'fade_out')),
    auth.uid(), v_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'broadcast_id', v_id, 'target_store_count', v_count);
end;
$$;
revoke execute on function public.admin_create_emergency_broadcast(uuid,text,text,text,uuid,uuid,uuid[],int,text,timestamptz,text) from public, anon;
grant   execute on function public.admin_create_emergency_broadcast(uuid,text,text,text,uuid,uuid,uuid[],int,text,timestamptz,text) to authenticated;

create or replace function public.admin_activate_emergency_broadcast(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_prev text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select status into v_prev from public.enterprise_emergency_broadcasts
   where id = p_id and deleted_at is null;
  if v_prev is null then raise exception 'broadcast not found: %', p_id; end if;
  if v_prev <> 'draft' then raise exception 'only draft broadcasts can be activated (current: %)', v_prev; end if;
  update public.enterprise_emergency_broadcasts
     set status = 'active', activated_at = coalesce(activated_at, now())
   where id = p_id;
  perform public.admin_log_operation(
    'emergency_broadcast', 'emergency_broadcast.activate', 'success', 'active',
    format('broadcast activated — id=%s', p_id),
    jsonb_build_object('broadcast_id', p_id, 'before_status', v_prev, 'after_status', 'active'),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'broadcast_id', p_id, 'status', 'active');
end;
$$;
revoke execute on function public.admin_activate_emergency_broadcast(uuid) from public, anon;
grant   execute on function public.admin_activate_emergency_broadcast(uuid) to authenticated;

create or replace function public.admin_cancel_emergency_broadcast(
  p_id   uuid,
  p_memo text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_prev text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select status into v_prev from public.enterprise_emergency_broadcasts
   where id = p_id and deleted_at is null;
  if v_prev is null then raise exception 'broadcast not found: %', p_id; end if;
  if v_prev not in ('draft','active') then
    raise exception 'cannot cancel broadcast in status: %', v_prev;
  end if;
  update public.enterprise_emergency_broadcasts
     set status = 'cancelled', cancelled_at = now(),
         memo = coalesce(p_memo, memo)
   where id = p_id;
  update public.enterprise_emergency_broadcast_targets
     set status = 'skipped'
   where broadcast_id = p_id and status = 'pending';
  perform public.admin_log_operation(
    'emergency_broadcast', 'emergency_broadcast.cancel', 'warning', 'cancelled',
    format('broadcast cancelled — id=%s', p_id),
    jsonb_build_object('broadcast_id', p_id, 'before_status', v_prev, 'after_status', 'cancelled', 'memo', p_memo),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'broadcast_id', p_id, 'status', 'cancelled', 'previous_status', v_prev);
end;
$$;
revoke execute on function public.admin_cancel_emergency_broadcast(uuid, text) from public, anon;
grant   execute on function public.admin_cancel_emergency_broadcast(uuid, text) to authenticated;

create or replace function public.admin_complete_emergency_broadcast(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_prev text; v_pending int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select status into v_prev from public.enterprise_emergency_broadcasts
   where id = p_id and deleted_at is null;
  if v_prev is null then raise exception 'broadcast not found: %', p_id; end if;
  if v_prev not in ('active') then raise exception 'cannot complete broadcast in status: %', v_prev; end if;
  -- pending → expired 처리
  update public.enterprise_emergency_broadcast_targets
     set status = 'expired'
   where broadcast_id = p_id and status in ('pending','playing');
  select count(*) into v_pending from public.enterprise_emergency_broadcast_targets
   where broadcast_id = p_id and status = 'pending';
  update public.enterprise_emergency_broadcasts
     set status = 'completed', completed_at = now()
   where id = p_id;
  perform public.admin_log_operation(
    'emergency_broadcast', 'emergency_broadcast.complete', 'success', 'completed',
    format('broadcast completed — id=%s', p_id),
    jsonb_build_object('broadcast_id', p_id, 'before_status', v_prev, 'after_status', 'completed',
                       'remaining_pending', v_pending),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'broadcast_id', p_id, 'status', 'completed');
end;
$$;
revoke execute on function public.admin_complete_emergency_broadcast(uuid) from public, anon;
grant   execute on function public.admin_complete_emergency_broadcast(uuid) to authenticated;

create or replace function public.admin_list_emergency_broadcasts(
  p_search                text default null,
  p_status                text default null,
  p_enterprise_account_id uuid default null,
  p_scope_type            text default null,
  p_active_only           boolean default false,
  p_limit                 int default 50,
  p_offset                int default 0
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
    select b.*,
           ea.enterprise_name,
           a.title as asset_title,
           a.duration_seconds as asset_duration,
           er.region_name, er.region_code,
           (select count(*) from public.enterprise_emergency_broadcast_targets t
             where t.broadcast_id = b.id and t.status = 'pending')::int as pending_count
      from public.enterprise_emergency_broadcasts b
      join public.enterprise_announcement_assets a on a.id = b.asset_id
      left join public.enterprise_accounts ea on ea.id = b.enterprise_account_id
      left join public.enterprise_regions  er on er.id = b.region_id
     where b.deleted_at is null
       and (p_status is null or b.status = p_status)
       and (p_enterprise_account_id is null or b.enterprise_account_id = p_enterprise_account_id)
       and (p_scope_type is null or b.scope_type = p_scope_type)
       and (not p_active_only or b.status = 'active')
       and (
         p_search is null
         or b.title ilike '%' || p_search || '%'
         or coalesce(b.message, '') ilike '%' || p_search || '%'
         or coalesce(a.title, '') ilike '%' || p_search || '%'
         or coalesce(ea.enterprise_name, '') ilike '%' || p_search || '%'
       )
  ),
  total_cte as (select count(*)::bigint as c from base),
  paged as (
    select * from base
     order by case when status = 'active' then 0 else 1 end, priority desc, created_at desc
     limit v_limit offset v_offset
  )
  select coalesce((select c from total_cte), 0),
         coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc), '[]'::jsonb)
    into v_total, v_rows
    from paged p;

  return jsonb_build_object(
    'success', true, 'data', v_rows,
    'pagination', jsonb_build_object('total', v_total, 'limit', v_limit, 'offset', v_offset,
                                      'has_more', (v_offset + v_limit) < v_total),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_emergency_broadcasts(text,text,uuid,text,boolean,int,int) from public, anon;
grant   execute on function public.admin_list_emergency_broadcasts(text,text,uuid,text,boolean,int,int) to authenticated;

create or replace function public.admin_get_emergency_broadcast_detail(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_b jsonb; v_a jsonb; v_targets jsonb; v_summary jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select to_jsonb(t) into v_b from (
    select b.*, ea.enterprise_name, er.region_name, er.region_code
      from public.enterprise_emergency_broadcasts b
      left join public.enterprise_accounts ea on ea.id = b.enterprise_account_id
      left join public.enterprise_regions  er on er.id = b.region_id
     where b.id = p_id and b.deleted_at is null
  ) t;
  if v_b is null then raise exception 'broadcast not found: %', p_id; end if;

  select to_jsonb(a) into v_a from (
    select a.id, a.title, a.file_url, a.mime_type, a.duration_seconds, a.file_size_bytes
      from public.enterprise_announcement_assets a
     where a.id = (v_b->>'asset_id')::uuid
  ) a;

  select jsonb_build_object(
    'total',    (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = p_id),
    'pending',  (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = p_id and status='pending'),
    'playing',  (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = p_id and status='playing'),
    'played',   (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = p_id and status='played'),
    'failed',   (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = p_id and status='failed'),
    'skipped',  (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = p_id and status='skipped'),
    'expired',  (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = p_id and status='expired')
  ) into v_summary;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.status, t.updated_at desc), '[]'::jsonb) into v_targets from (
    select t.*, er.region_name
      from public.enterprise_emergency_broadcast_targets t
      left join public.enterprise_regions er on er.id = t.region_id
     where t.broadcast_id = p_id
     order by case t.status when 'failed' then 0 when 'playing' then 1 when 'pending' then 2
                            when 'played' then 3 when 'skipped' then 4 else 5 end,
              t.updated_at desc
     limit 500
  ) t;

  return jsonb_build_object('success', true, 'broadcast', v_b, 'asset', v_a, 'summary', v_summary, 'targets', v_targets,
                             'computed_at', now());
end;
$$;
revoke execute on function public.admin_get_emergency_broadcast_detail(uuid) from public, anon;
grant   execute on function public.admin_get_emergency_broadcast_detail(uuid) to authenticated;

create or replace function public.admin_emergency_broadcast_kpi()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_today_start timestamptz := (now() at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul';
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return jsonb_build_object(
    'active_broadcasts',     (select count(*) from public.enterprise_emergency_broadcasts
                                where deleted_at is null and status = 'active'),
    'completed_today',       (select count(*) from public.enterprise_emergency_broadcasts
                                where deleted_at is null and status = 'completed'
                                  and completed_at >= v_today_start),
    'failed_broadcasts',     (select count(*) from public.enterprise_emergency_broadcasts
                                where deleted_at is null and status = 'failed'),
    'cancelled_broadcasts',  (select count(*) from public.enterprise_emergency_broadcasts
                                where deleted_at is null and status = 'cancelled'),
    'pending_targets',       (select count(*) from public.enterprise_emergency_broadcast_targets t
                                join public.enterprise_emergency_broadcasts b on b.id = t.broadcast_id
                               where b.deleted_at is null and b.status = 'active' and t.status = 'pending'),
    'played_targets_today',  (select count(*) from public.enterprise_emergency_broadcast_targets
                                where status = 'played' and played_at >= v_today_start),
    'failed_targets_today',  (select count(*) from public.enterprise_emergency_broadcast_targets
                                where status = 'failed' and failed_at >= v_today_start),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_emergency_broadcast_kpi() from public, anon;
grant   execute on function public.admin_emergency_broadcast_kpi() to authenticated;

-- ============================================================
-- 5) Store RPCs
-- ============================================================
create or replace function public.store_get_active_emergency_broadcasts(
  p_store_id    uuid default null,
  p_device_info jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := coalesce(p_store_id, auth.uid());
  v_now timestamptz := now();
  v_b   record;
  v_t   record;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_uid <> auth.uid() and not public._is_super_admin() then raise exception 'forbidden'; end if;

  -- expires_at 지난 broadcasts 의 pending targets 를 expired 처리 (lazy cleanup)
  update public.enterprise_emergency_broadcast_targets t
     set status = 'expired'
   from public.enterprise_emergency_broadcasts b
   where t.broadcast_id = b.id
     and t.store_id = v_uid
     and t.status = 'pending'
     and b.deleted_at is null
     and b.expires_at is not null
     and b.expires_at < v_now;

  -- 가장 우선순위 높은 active broadcast 1건 (pending target)
  select b.id, b.title, b.message, b.asset_id, b.priority, b.interrupt_mode,
         b.expires_at,
         a.title as asset_title, a.file_url as asset_file_url,
         a.mime_type as asset_mime_type, a.duration_seconds as asset_duration
    into v_b
    from public.enterprise_emergency_broadcasts b
    join public.enterprise_announcement_assets a on a.id = b.asset_id and a.deleted_at is null
    join public.enterprise_emergency_broadcast_targets t
      on t.broadcast_id = b.id
   where b.deleted_at is null
     and b.status = 'active'
     and (b.expires_at is null or b.expires_at >= v_now)
     and t.store_id = v_uid
     and t.status = 'pending'
   order by b.priority desc, b.created_at desc
   limit 1;

  if v_b.id is null then
    return jsonb_build_object('success', true, 'store_id', v_uid, 'now_at', v_now, 'broadcast', null);
  end if;

  -- target attempt 기록
  update public.enterprise_emergency_broadcast_targets
     set first_seen_at = coalesce(first_seen_at, v_now),
         attempt_count = attempt_count + 1,
         device_info   = coalesce(p_device_info, '{}'::jsonb)
   where broadcast_id = v_b.id and store_id = v_uid
   returning * into v_t;

  return jsonb_build_object(
    'success', true,
    'store_id', v_uid,
    'now_at', v_now,
    'broadcast', jsonb_build_object(
      'broadcast_id',     v_b.id,
      'asset_id',         v_b.asset_id,
      'title',            v_b.title,
      'message',          v_b.message,
      'asset_title',      v_b.asset_title,
      'file_url',         v_b.asset_file_url,
      'mime_type',        v_b.asset_mime_type,
      'duration_seconds', v_b.asset_duration,
      'interrupt_mode',   v_b.interrupt_mode,
      'priority',         v_b.priority,
      'expires_at',       v_b.expires_at,
      'attempt_count',    v_t.attempt_count
    )
  );
end;
$$;
revoke execute on function public.store_get_active_emergency_broadcasts(uuid, jsonb) from public, anon;
grant   execute on function public.store_get_active_emergency_broadcasts(uuid, jsonb) to authenticated;

create or replace function public.store_mark_emergency_broadcast_status(
  p_broadcast_id  uuid,
  p_status        text,
  p_error_message text default null,
  p_device_info   jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_log_category text;
  v_t_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_status not in ('playing','played','failed','skipped') then
    raise exception 'invalid status: %', p_status;
  end if;
  if p_broadcast_id is null then raise exception 'broadcast_id required'; end if;

  update public.enterprise_emergency_broadcast_targets
     set status        = p_status,
         started_at    = case when p_status = 'playing' then coalesce(started_at, v_now) else started_at end,
         played_at     = case when p_status = 'played'  then v_now else played_at end,
         failed_at     = case when p_status = 'failed'  then v_now else failed_at end,
         error_message = case when p_status = 'failed'  then p_error_message else error_message end,
         device_info   = coalesce(p_device_info, device_info)
   where broadcast_id = p_broadcast_id and store_id = v_uid
   returning id into v_t_id;

  if v_t_id is null then raise exception 'broadcast target not found for store'; end if;

  -- counts recompute (간단하게 rollup)
  update public.enterprise_emergency_broadcasts b
     set played_count  = (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = b.id and status = 'played'),
         failed_count  = (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = b.id and status = 'failed'),
         skipped_count = (select count(*) from public.enterprise_emergency_broadcast_targets where broadcast_id = b.id and status in ('skipped','expired'))
   where b.id = p_broadcast_id;

  if p_status in ('played','failed') then
    v_log_category := 'emergency_broadcast.store.' || p_status;
    perform public.admin_log_operation(
      'emergency_broadcast', v_log_category,
      case when p_status = 'played' then 'success' else 'error' end,
      p_status,
      format('store broadcast %s — broadcast=%s store=%s', p_status, p_broadcast_id, v_uid),
      jsonb_build_object('broadcast_id', p_broadcast_id, 'store_id', v_uid,
                         'status', p_status, 'error_message', p_error_message,
                         'device_info', p_device_info),
      v_uid, p_broadcast_id::text, null, null,
      case when p_status = 'failed' then p_error_message else null end
    );
  end if;

  return jsonb_build_object('success', true, 'broadcast_id', p_broadcast_id, 'store_id', v_uid, 'status', p_status);
end;
$$;
revoke execute on function public.store_mark_emergency_broadcast_status(uuid, text, text, jsonb) from public, anon;
grant   execute on function public.store_mark_emergency_broadcast_status(uuid, text, text, jsonb) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_t int; v_rpc int;
begin
  select count(*) into v_t from pg_class where relname in
    ('enterprise_emergency_broadcasts','enterprise_emergency_broadcast_targets');
  select count(*) into v_rpc from pg_proc where pronamespace='public'::regnamespace and proname in (
    '_emergency_resolve_target_stores',
    'admin_create_emergency_broadcast','admin_activate_emergency_broadcast',
    'admin_cancel_emergency_broadcast','admin_complete_emergency_broadcast',
    'admin_list_emergency_broadcasts','admin_get_emergency_broadcast_detail',
    'admin_emergency_broadcast_kpi',
    'store_get_active_emergency_broadcasts','store_mark_emergency_broadcast_status'
  );
  raise notice '====== 0384 Emergency Broadcast V1 ======';
  raise notice 'tables: % / 2', v_t;
  raise notice 'rpcs+helper: % / 10', v_rpc;
  if v_t = 2 and v_rpc >= 10 then
    raise notice '0384 COMPLETE — broadcasts + targets + 9 RPCs ready';
    raise notice 'NOTE: reuses enterprise-announcements bucket (0381). No storage changes.';
  else
    raise warning '0384 INCOMPLETE';
  end if;
end$$;
