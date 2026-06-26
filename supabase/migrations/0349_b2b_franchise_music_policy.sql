-- 0349 — B2B Franchise Music Policy MVP
--
-- 목적:
--   프랜차이즈 본사가 음악 정책 (시간대별 플레이리스트) 을 정의하고
--   연결된 매장에 자동 동기화하는 MVP. 본사는 송출하지 않고 정책만 설정.
--   매장 플레이어는 store_id 기준으로 최신 정책을 폴링해 자동 적용.
--
-- 핵심 설계:
--   - 매장(store_id) = 기존 users.id (business 플랜 사용자, X6.84 컨벤션)
--   - 별도 stores 테이블 만들지 않음 (기존 구조 보존)
--   - 정책 적용은 store > region > all 우선순위
--   - 정책 변경은 다음 곡부터 (현재 곡 강제 중단 X)
--   - 프랜차이즈 정책 없으면 기존 useStartBusinessMode 로직 그대로 사용 (회귀 0)
--
-- 절대 금지:
--   - 기존 StorePlayerPage / 개인 매장 재생 로직 파괴 금지
--   - 기존 playlists / playlist_tracks 스키마 변경 금지
--   - WebSocket 미구현 (60s polling + heartbeat)

-- ============================================================
-- 1. franchises — 본사 단위
-- ============================================================
create table if not exists public.franchises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  description text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_franchises_status on public.franchises(status);
create index if not exists idx_franchises_slug on public.franchises(slug) where slug is not null;

drop trigger if exists trg_franchises_updated_at on public.franchises;
create trigger trg_franchises_updated_at
  before update on public.franchises
  for each row execute function public._touch_updated_at();


-- ============================================================
-- 2. franchise_regions — 지역/그룹
-- ============================================================
create table if not exists public.franchise_regions (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (franchise_id, name)
);
create index if not exists idx_franchise_regions_franchise on public.franchise_regions(franchise_id, sort_order);


-- ============================================================
-- 3. franchise_admins — 본사 관리자 (운영자/뷰어)
-- ============================================================
create table if not exists public.franchise_admins (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now(),
  unique (franchise_id, user_id)
);
create index if not exists idx_franchise_admins_user on public.franchise_admins(user_id);
create index if not exists idx_franchise_admins_franchise on public.franchise_admins(franchise_id);


-- ============================================================
-- 4. franchise_stores — 본사 ↔ 매장 연결 (bridge)
--    store_id = users.id (business 플랜 사용자)
-- ============================================================
create table if not exists public.franchise_stores (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  region_id uuid references public.franchise_regions(id) on delete set null,
  store_id uuid not null references public.users(id) on delete cascade,
  store_name text,  -- 표시용 (없으면 users.business_name fallback)
  status text not null default 'active' check (status in ('active','inactive','suspended')),
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (franchise_id, store_id)
);
create index if not exists idx_franchise_stores_franchise on public.franchise_stores(franchise_id, status);
create index if not exists idx_franchise_stores_region on public.franchise_stores(region_id) where region_id is not null;
create index if not exists idx_franchise_stores_store on public.franchise_stores(store_id);


-- ============================================================
-- 5. franchise_music_policies — 본사 음악 정책
-- ============================================================
create table if not exists public.franchise_music_policies (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  effective_from timestamptz,
  effective_until timestamptz,
  is_default boolean not null default false,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_franchise_policies_franchise on public.franchise_music_policies(franchise_id, status);
create index if not exists idx_franchise_policies_default on public.franchise_music_policies(franchise_id) where is_default;
create index if not exists idx_franchise_policies_effective
  on public.franchise_music_policies(effective_from, effective_until) where status='active';

drop trigger if exists trg_franchise_policies_updated_at on public.franchise_music_policies;
create trigger trg_franchise_policies_updated_at
  before update on public.franchise_music_policies
  for each row execute function public._touch_updated_at();


-- ============================================================
-- 6. franchise_music_policy_slots — 시간대별 플레이리스트 슬롯
-- ============================================================
create table if not exists public.franchise_music_policy_slots (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.franchise_music_policies(id) on delete cascade,
  slot_name text not null,
  start_time time not null,
  end_time time not null,
  playlist_id uuid not null references public.playlists(id) on delete restrict,
  days_of_week int[] not null default array[1,2,3,4,5,6,7],  -- 1=월 ... 7=일 (ISO)
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_franchise_slots_policy on public.franchise_music_policy_slots(policy_id, sort_order);
create index if not exists idx_franchise_slots_time on public.franchise_music_policy_slots(policy_id, start_time, end_time);


-- ============================================================
-- 7. franchise_policy_assignments — 정책 적용 대상
--    target_type: all | region | store
-- ============================================================
create table if not exists public.franchise_policy_assignments (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  policy_id uuid not null references public.franchise_music_policies(id) on delete cascade,
  target_type text not null check (target_type in ('all','region','store')),
  target_id uuid,  -- all=null, region=franchise_regions.id, store=franchise_stores.store_id
  effective_from timestamptz,
  applied_at timestamptz not null default now(),
  applied_by uuid references public.users(id) on delete set null,
  -- target_type='all' 이면 target_id 는 null 이어야 함
  check ((target_type = 'all' and target_id is null) or (target_type <> 'all' and target_id is not null))
);
create index if not exists idx_franchise_assignments_franchise on public.franchise_policy_assignments(franchise_id, applied_at desc);
create index if not exists idx_franchise_assignments_policy on public.franchise_policy_assignments(policy_id);
create index if not exists idx_franchise_assignments_target on public.franchise_policy_assignments(target_type, target_id);


-- ============================================================
-- 8. franchise_policy_versions — 정책 버전 이력
-- ============================================================
create table if not exists public.franchise_policy_versions (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  policy_id uuid not null references public.franchise_music_policies(id) on delete cascade,
  version_number int not null check (version_number >= 1),
  change_summary text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (policy_id, version_number)
);
create index if not exists idx_franchise_versions_policy on public.franchise_policy_versions(policy_id, version_number desc);


-- ============================================================
-- 9. store_policy_sync_status — 매장 플레이어 동기화 상태
-- ============================================================
create table if not exists public.store_policy_sync_status (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.users(id) on delete cascade,
  franchise_id uuid references public.franchises(id) on delete set null,
  active_policy_id uuid references public.franchise_music_policies(id) on delete set null,
  active_version_number int not null default 1,
  last_synced_at timestamptz,
  last_seen_at timestamptz,
  current_track_id uuid references public.tracks(id) on delete set null,
  player_status text not null default 'unknown'
    check (player_status in ('playing','paused','stopped','offline','unknown')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id)  -- 매장당 1행
);
create index if not exists idx_sync_status_franchise on public.store_policy_sync_status(franchise_id);
create index if not exists idx_sync_status_last_seen on public.store_policy_sync_status(last_seen_at desc);

drop trigger if exists trg_sync_status_updated_at on public.store_policy_sync_status;
create trigger trg_sync_status_updated_at
  before update on public.store_policy_sync_status
  for each row execute function public._touch_updated_at();


-- ============================================================
-- 10. RLS — 모든 테이블
--    Super Admin (users.role='admin'): 전체 접근
--    Franchise Admin (franchise_admins): 본인 franchise 만
--    Store (users.id = store_id): 본인 sync_status 만
-- ============================================================
alter table public.franchises enable row level security;
alter table public.franchise_regions enable row level security;
alter table public.franchise_admins enable row level security;
alter table public.franchise_stores enable row level security;
alter table public.franchise_music_policies enable row level security;
alter table public.franchise_music_policy_slots enable row level security;
alter table public.franchise_policy_assignments enable row level security;
alter table public.franchise_policy_versions enable row level security;
alter table public.store_policy_sync_status enable row level security;

-- helper: is_super_admin
create or replace function public._is_super_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin');
$$;

-- helper: is_franchise_admin(franchise_id)
create or replace function public._is_franchise_admin(p_franchise_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.franchise_admins fa
     where fa.franchise_id = p_franchise_id and fa.user_id = auth.uid()
  );
$$;

-- franchises
drop policy if exists franchises_select on public.franchises;
create policy franchises_select on public.franchises
  for select using (
    public._is_super_admin()
    or exists (select 1 from public.franchise_admins fa where fa.franchise_id = franchises.id and fa.user_id = auth.uid())
  );
-- INSERT/UPDATE/DELETE: super admin only (관리자 페이지 RPC 경유)
drop policy if exists franchises_admin_write on public.franchises;
create policy franchises_admin_write on public.franchises
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- franchise_regions
drop policy if exists franchise_regions_select on public.franchise_regions;
create policy franchise_regions_select on public.franchise_regions
  for select using (public._is_super_admin() or public._is_franchise_admin(franchise_id));
drop policy if exists franchise_regions_admin_write on public.franchise_regions;
create policy franchise_regions_admin_write on public.franchise_regions
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- franchise_admins (본인 + super admin)
drop policy if exists franchise_admins_select on public.franchise_admins;
create policy franchise_admins_select on public.franchise_admins
  for select using (public._is_super_admin() or user_id = auth.uid());
drop policy if exists franchise_admins_admin_write on public.franchise_admins;
create policy franchise_admins_admin_write on public.franchise_admins
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- franchise_stores
drop policy if exists franchise_stores_select on public.franchise_stores;
create policy franchise_stores_select on public.franchise_stores
  for select using (
    public._is_super_admin()
    or public._is_franchise_admin(franchise_id)
    or store_id = auth.uid()
  );
drop policy if exists franchise_stores_admin_write on public.franchise_stores;
create policy franchise_stores_admin_write on public.franchise_stores
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- franchise_music_policies
drop policy if exists franchise_policies_select on public.franchise_music_policies;
create policy franchise_policies_select on public.franchise_music_policies
  for select using (
    public._is_super_admin()
    or public._is_franchise_admin(franchise_id)
    or exists (
      select 1 from public.franchise_stores fs
       where fs.franchise_id = franchise_music_policies.franchise_id
         and fs.store_id = auth.uid()
    )
  );
drop policy if exists franchise_policies_admin_write on public.franchise_music_policies;
create policy franchise_policies_admin_write on public.franchise_music_policies
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- franchise_music_policy_slots (slot 도 정책 권한 따름)
drop policy if exists franchise_slots_select on public.franchise_music_policy_slots;
create policy franchise_slots_select on public.franchise_music_policy_slots
  for select using (
    exists (
      select 1 from public.franchise_music_policies p
       where p.id = franchise_music_policy_slots.policy_id
         and (
           public._is_super_admin()
           or public._is_franchise_admin(p.franchise_id)
           or exists (select 1 from public.franchise_stores fs where fs.franchise_id = p.franchise_id and fs.store_id = auth.uid())
         )
    )
  );
drop policy if exists franchise_slots_admin_write on public.franchise_music_policy_slots;
create policy franchise_slots_admin_write on public.franchise_music_policy_slots
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- franchise_policy_assignments
drop policy if exists franchise_assignments_select on public.franchise_policy_assignments;
create policy franchise_assignments_select on public.franchise_policy_assignments
  for select using (public._is_super_admin() or public._is_franchise_admin(franchise_id));
drop policy if exists franchise_assignments_admin_write on public.franchise_policy_assignments;
create policy franchise_assignments_admin_write on public.franchise_policy_assignments
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- franchise_policy_versions
drop policy if exists franchise_versions_select on public.franchise_policy_versions;
create policy franchise_versions_select on public.franchise_policy_versions
  for select using (public._is_super_admin() or public._is_franchise_admin(franchise_id));
drop policy if exists franchise_versions_admin_write on public.franchise_policy_versions;
create policy franchise_versions_admin_write on public.franchise_policy_versions
  for all using (public._is_super_admin()) with check (public._is_super_admin());

-- store_policy_sync_status (매장은 본인 row 만, admin/franchise_admin 은 본 franchise 전체)
drop policy if exists sync_status_select on public.store_policy_sync_status;
create policy sync_status_select on public.store_policy_sync_status
  for select using (
    public._is_super_admin()
    or store_id = auth.uid()
    or (franchise_id is not null and public._is_franchise_admin(franchise_id))
  );
-- INSERT/UPDATE/DELETE 는 RPC (security definer) 만 — 직접 차단
revoke insert, update, delete on public.store_policy_sync_status from authenticated, anon;


-- ============================================================
-- 11. RPC: get_franchise_dashboard(franchise_id)
-- ============================================================
create or replace function public.get_franchise_dashboard(p_franchise_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_offline_threshold timestamptz := now() - interval '3 minutes';
begin
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then
    raise exception 'forbidden: not authorized for this franchise';
  end if;

  return (
    select jsonb_build_object(
      'franchise', (
        select to_jsonb(f) from public.franchises f where f.id = p_franchise_id
      ),
      'total_stores', (
        select count(*) from public.franchise_stores
         where franchise_id = p_franchise_id and status='active'
      ),
      'online_stores', (
        select count(*) from public.franchise_stores fs
         left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
         where fs.franchise_id = p_franchise_id and fs.status='active'
           and ss.last_seen_at is not null and ss.last_seen_at >= v_offline_threshold
      ),
      'offline_stores', (
        select count(*) from public.franchise_stores fs
         left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
         where fs.franchise_id = p_franchise_id and fs.status='active'
           and (ss.last_seen_at is null or ss.last_seen_at < v_offline_threshold)
      ),
      'regions', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'name', r.name, 'sort_order', r.sort_order,
          'store_count', (select count(*) from public.franchise_stores fs where fs.region_id = r.id and fs.status='active')
        ) order by r.sort_order), '[]'::jsonb)
        from public.franchise_regions r where r.franchise_id = p_franchise_id
      ),
      'active_policies', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', p.id, 'name', p.name, 'is_default', p.is_default,
          'effective_from', p.effective_from, 'effective_until', p.effective_until
        ) order by p.is_default desc, p.updated_at desc), '[]'::jsonb)
        from public.franchise_music_policies p
        where p.franchise_id = p_franchise_id and p.status='active'
      ),
      'recent_assignments', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', a.id, 'policy_id', a.policy_id, 'policy_name', p.name,
          'target_type', a.target_type, 'target_id', a.target_id,
          'applied_at', a.applied_at
        ) order by a.applied_at desc), '[]'::jsonb)
        from (
          select * from public.franchise_policy_assignments
           where franchise_id = p_franchise_id
           order by applied_at desc limit 10
        ) a
        left join public.franchise_music_policies p on p.id = a.policy_id
      ),
      'computed_at', now(),
      'offline_threshold_seconds', 180
    )
  );
end;
$$;

revoke execute on function public.get_franchise_dashboard(uuid) from public, anon;
grant execute on function public.get_franchise_dashboard(uuid) to authenticated;


-- ============================================================
-- 12. RPC: apply_franchise_policy
-- ============================================================
create or replace function public.apply_franchise_policy(
  p_franchise_id uuid,
  p_policy_id uuid,
  p_target_type text,
  p_target_id uuid default null,
  p_effective_from timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_assignment_id uuid;
  v_version_number int;
  v_applied_count int := 0;
begin
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then
    raise exception 'forbidden: not authorized for this franchise';
  end if;
  if not exists (select 1 from public.franchise_music_policies where id = p_policy_id and franchise_id = p_franchise_id) then
    raise exception 'policy % not found for franchise %', p_policy_id, p_franchise_id;
  end if;
  if p_target_type not in ('all','region','store') then
    raise exception 'invalid target_type: % (must be all|region|store)', p_target_type;
  end if;
  if p_target_type = 'all' and p_target_id is not null then
    raise exception 'target_id must be null for target_type=all';
  elsif p_target_type <> 'all' and p_target_id is null then
    raise exception 'target_id required for target_type=%', p_target_type;
  end if;

  -- 1) assignment 저장
  insert into public.franchise_policy_assignments
    (franchise_id, policy_id, target_type, target_id, effective_from, applied_by)
  values
    (p_franchise_id, p_policy_id, p_target_type, p_target_id, p_effective_from, v_uid)
  returning id into v_assignment_id;

  -- 2) version 증가 (정책당 누적)
  select coalesce(max(version_number), 0) + 1
    into v_version_number
    from public.franchise_policy_versions where policy_id = p_policy_id;

  insert into public.franchise_policy_versions
    (franchise_id, policy_id, version_number, change_summary, created_by)
  values
    (p_franchise_id, p_policy_id, v_version_number,
     format('applied to %s%s', p_target_type, coalesce(' (' || p_target_id::text || ')', '')),
     v_uid);

  -- 3) 적용 대상 매장의 sync_status 업데이트
  with target_stores as (
    select fs.store_id from public.franchise_stores fs
     where fs.franchise_id = p_franchise_id
       and fs.status = 'active'
       and (
         p_target_type = 'all'
         or (p_target_type = 'region' and fs.region_id = p_target_id)
         or (p_target_type = 'store' and fs.store_id = p_target_id)
       )
  )
  insert into public.store_policy_sync_status (store_id, franchise_id, active_policy_id, active_version_number)
  select ts.store_id, p_franchise_id, p_policy_id, v_version_number
    from target_stores ts
  on conflict (store_id) do update set
    franchise_id = excluded.franchise_id,
    active_policy_id = excluded.active_policy_id,
    active_version_number = excluded.active_version_number,
    updated_at = now();
  get diagnostics v_applied_count = row_count;

  return jsonb_build_object(
    'ok', true,
    'assignment_id', v_assignment_id,
    'policy_id', p_policy_id,
    'version_number', v_version_number,
    'applied_store_count', v_applied_count,
    'target_type', p_target_type
  );
end;
$$;

revoke execute on function public.apply_franchise_policy(uuid, uuid, text, uuid, timestamptz) from public, anon;
grant execute on function public.apply_franchise_policy(uuid, uuid, text, uuid, timestamptz) to authenticated;


-- ============================================================
-- 13. RPC: get_store_active_music_policy
--     매장 플레이어가 호출. 우선순위: store > region > all
--     슬롯 매칭: 현재 KST 시간 + 요일 + 정책 effective window
-- ============================================================
create or replace function public.get_store_active_music_policy(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_franchise_id uuid;
  v_region_id uuid;
  v_policy_id uuid;
  v_policy record;
  v_slot record;
  v_kst_now timestamptz := now() at time zone 'Asia/Seoul';
  v_kst_time time := v_kst_now::time;
  v_kst_dow int;  -- 1=월 ... 7=일
  v_version int;
begin
  -- 권한: super admin / franchise admin / 본인 store / 일반 authenticated 도 자기 store_id 조회는 가능
  -- (RPC 가 security definer 이므로 RLS 무력화됨; auth 체크는 함수 안에서)
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  if not (public._is_super_admin() or auth.uid() = p_store_id) then
    -- franchise admin 도 자기 매장 정책은 볼 수 있게
    if not exists (
      select 1 from public.franchise_stores fs
        join public.franchise_admins fa on fa.franchise_id = fs.franchise_id and fa.user_id = auth.uid()
       where fs.store_id = p_store_id
    ) then
      raise exception 'forbidden';
    end if;
  end if;

  -- KST 요일 (월=1 ... 일=7)
  select case extract(isodow from v_kst_now)::int when 7 then 7 else extract(isodow from v_kst_now)::int end into v_kst_dow;

  -- 매장 → 프랜차이즈 연결 확인
  select fs.franchise_id, fs.region_id
    into v_franchise_id, v_region_id
    from public.franchise_stores fs
   where fs.store_id = p_store_id and fs.status = 'active'
   limit 1;

  if v_franchise_id is null then
    -- 프랜차이즈 매장 아님 → 기존 로직 fallback 신호
    return jsonb_build_object('has_franchise_policy', false);
  end if;

  -- 우선순위 1: store 직접 적용 (가장 최근)
  select a.policy_id into v_policy_id
    from public.franchise_policy_assignments a
   where a.franchise_id = v_franchise_id
     and a.target_type = 'store' and a.target_id = p_store_id
   order by a.applied_at desc limit 1;

  -- 우선순위 2: region
  if v_policy_id is null and v_region_id is not null then
    select a.policy_id into v_policy_id
      from public.franchise_policy_assignments a
     where a.franchise_id = v_franchise_id
       and a.target_type = 'region' and a.target_id = v_region_id
     order by a.applied_at desc limit 1;
  end if;

  -- 우선순위 3: all
  if v_policy_id is null then
    select a.policy_id into v_policy_id
      from public.franchise_policy_assignments a
     where a.franchise_id = v_franchise_id
       and a.target_type = 'all'
     order by a.applied_at desc limit 1;
  end if;

  if v_policy_id is null then
    return jsonb_build_object('has_franchise_policy', false, 'franchise_id', v_franchise_id);
  end if;

  -- 정책 active + effective window 검증
  select * into v_policy from public.franchise_music_policies
   where id = v_policy_id and status = 'active'
     and (effective_from is null or effective_from <= now())
     and (effective_until is null or effective_until > now());

  if v_policy.id is null then
    return jsonb_build_object('has_franchise_policy', false, 'franchise_id', v_franchise_id);
  end if;

  -- 현재 시간 + 요일에 맞는 슬롯 (정확 매칭)
  -- start_time <= end_time (정상): now in [start, end]
  -- start_time > end_time (자정 넘김): now >= start OR now < end
  select * into v_slot
    from public.franchise_music_policy_slots
   where policy_id = v_policy.id
     and (v_kst_dow = any(days_of_week))
     and (
       (start_time <= end_time and v_kst_time >= start_time and v_kst_time < end_time)
       or (start_time > end_time and (v_kst_time >= start_time or v_kst_time < end_time))
     )
   order by sort_order asc, created_at asc
   limit 1;

  if v_slot.id is null then
    return jsonb_build_object(
      'has_franchise_policy', true,
      'franchise_id', v_franchise_id,
      'policy_id', v_policy.id,
      'policy_name', v_policy.name,
      'matched_slot', null,
      'message', 'no slot matches current time/day'
    );
  end if;

  -- 현재 적용된 version
  select coalesce(max(version_number), 1) into v_version
    from public.franchise_policy_versions where policy_id = v_policy.id;

  return jsonb_build_object(
    'has_franchise_policy', true,
    'franchise_id', v_franchise_id,
    'policy_id', v_policy.id,
    'policy_name', v_policy.name,
    'version_number', v_version,
    'matched_slot', jsonb_build_object(
      'id', v_slot.id,
      'slot_name', v_slot.slot_name,
      'start_time', v_slot.start_time,
      'end_time', v_slot.end_time,
      'days_of_week', v_slot.days_of_week,
      'playlist_id', v_slot.playlist_id
    ),
    'playlist', (
      select jsonb_build_object(
        'id', p.id, 'title', p.title, 'category', p.category,
        'thumbnail_url', p.thumbnail_url, 'business_category', p.business_category
      ) from public.playlists p where p.id = v_slot.playlist_id
    ),
    'kst_now', v_kst_now,
    'kst_dow', v_kst_dow,
    'computed_at', now()
  );
end;
$$;

revoke execute on function public.get_store_active_music_policy(uuid) from public, anon;
grant execute on function public.get_store_active_music_policy(uuid) to authenticated;


-- ============================================================
-- 14. RPC: update_store_player_heartbeat
-- ============================================================
create or replace function public.update_store_player_heartbeat(
  p_store_id uuid,
  p_player_status text default 'unknown',
  p_current_track_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_franchise_id uuid;
begin
  if auth.uid() is null or auth.uid() <> p_store_id then
    -- super admin 은 다른 매장도 갱신 가능 (운영 모니터링)
    if not public._is_super_admin() then
      raise exception 'forbidden: can only update own store heartbeat';
    end if;
  end if;
  if p_player_status not in ('playing','paused','stopped','offline','unknown') then
    raise exception 'invalid player_status: %', p_player_status;
  end if;

  -- franchise_id 추론 (있으면)
  select fs.franchise_id into v_franchise_id
    from public.franchise_stores fs
   where fs.store_id = p_store_id and fs.status = 'active'
   limit 1;

  insert into public.store_policy_sync_status
    (store_id, franchise_id, player_status, current_track_id, last_seen_at, last_synced_at)
  values
    (p_store_id, v_franchise_id, p_player_status, p_current_track_id, now(), now())
  on conflict (store_id) do update set
    franchise_id = coalesce(excluded.franchise_id, public.store_policy_sync_status.franchise_id),
    player_status = excluded.player_status,
    current_track_id = excluded.current_track_id,
    last_seen_at = now(),
    last_synced_at = now(),
    updated_at = now();

  return jsonb_build_object('ok', true, 'store_id', p_store_id, 'updated_at', now());
end;
$$;

revoke execute on function public.update_store_player_heartbeat(uuid, text, uuid) from public, anon;
grant execute on function public.update_store_player_heartbeat(uuid, text, uuid) to authenticated;


-- ============================================================
-- 15. Admin RPCs: 프랜차이즈 / 정책 / 매장 CRUD (간단)
-- ============================================================

-- 프랜차이즈 목록
create or replace function public.admin_list_franchises()
returns table (
  id uuid, name text, slug text, status text,
  store_count bigint, online_store_count bigint,
  active_policy_count bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_threshold timestamptz := now() - interval '3 minutes';
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;
  return query
    select f.id, f.name, f.slug, f.status,
      (select count(*) from public.franchise_stores where franchise_id = f.id and status='active'),
      (select count(*) from public.franchise_stores fs
         left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
        where fs.franchise_id = f.id and fs.status='active'
          and ss.last_seen_at is not null and ss.last_seen_at >= v_threshold),
      (select count(*) from public.franchise_music_policies where franchise_id = f.id and status='active'),
      f.created_at
    from public.franchises f
    order by f.created_at desc;
end;
$$;
grant execute on function public.admin_list_franchises() to authenticated;

-- 프랜차이즈 생성
create or replace function public.admin_create_franchise(p_name text, p_slug text default null, p_description text default null)
returns public.franchises
language plpgsql security definer set search_path to 'public' as $$
declare v_row public.franchises;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.franchises (name, slug, description, created_by)
  values (p_name, p_slug, p_description, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.admin_create_franchise(text, text, text) to authenticated;

-- 지역 생성
create or replace function public.admin_create_franchise_region(p_franchise_id uuid, p_name text, p_sort_order int default 0)
returns public.franchise_regions
language plpgsql security definer set search_path to 'public' as $$
declare v_row public.franchise_regions;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.franchise_regions (franchise_id, name, sort_order)
  values (p_franchise_id, p_name, p_sort_order)
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.admin_create_franchise_region(uuid, text, int) to authenticated;

-- 매장 연결
create or replace function public.admin_link_franchise_store(
  p_franchise_id uuid, p_store_id uuid, p_region_id uuid default null, p_store_name text default null
)
returns public.franchise_stores
language plpgsql security definer set search_path to 'public' as $$
declare v_row public.franchise_stores;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if not exists (select 1 from public.users where id = p_store_id and subscription_type = 'business') then
    raise exception 'store user must be business plan: %', p_store_id;
  end if;
  insert into public.franchise_stores (franchise_id, region_id, store_id, store_name)
  values (p_franchise_id, p_region_id, p_store_id, p_store_name)
  on conflict (franchise_id, store_id) do update set
    region_id = excluded.region_id, store_name = coalesce(excluded.store_name, public.franchise_stores.store_name),
    status = 'active'
  returning * into v_row;
  return v_row;
end;
$$;
grant execute on function public.admin_link_franchise_store(uuid, uuid, uuid, text) to authenticated;

-- 매장 연결 해제
create or replace function public.admin_unlink_franchise_store(p_franchise_id uuid, p_store_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.franchise_stores set status='inactive'
   where franchise_id = p_franchise_id and store_id = p_store_id;
  -- sync_status 도 franchise 연관 해제
  update public.store_policy_sync_status
     set franchise_id = null, active_policy_id = null
   where store_id = p_store_id and franchise_id = p_franchise_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_unlink_franchise_store(uuid, uuid) to authenticated;

-- 정책 생성/수정
create or replace function public.admin_upsert_franchise_policy(
  p_franchise_id uuid,
  p_name text,
  p_description text default null,
  p_status text default 'draft',
  p_effective_from timestamptz default null,
  p_effective_until timestamptz default null,
  p_is_default boolean default false,
  p_policy_id uuid default null
)
returns public.franchise_music_policies
language plpgsql security definer set search_path to 'public' as $$
declare v_row public.franchise_music_policies;
begin
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then
    raise exception 'forbidden';
  end if;
  if p_status not in ('draft','active','archived') then
    raise exception 'invalid status: %', p_status;
  end if;

  if p_policy_id is null then
    insert into public.franchise_music_policies
      (franchise_id, name, description, status, effective_from, effective_until, is_default, created_by)
    values
      (p_franchise_id, p_name, p_description, p_status, p_effective_from, p_effective_until, p_is_default, auth.uid())
    returning * into v_row;
  else
    update public.franchise_music_policies set
      name = p_name,
      description = p_description,
      status = p_status,
      effective_from = p_effective_from,
      effective_until = p_effective_until,
      is_default = p_is_default,
      updated_at = now()
    where id = p_policy_id and franchise_id = p_franchise_id
    returning * into v_row;
    if v_row.id is null then raise exception 'policy not found: %', p_policy_id; end if;
  end if;
  return v_row;
end;
$$;
grant execute on function public.admin_upsert_franchise_policy(uuid, text, text, text, timestamptz, timestamptz, boolean, uuid) to authenticated;

-- 슬롯 추가/수정
create or replace function public.admin_upsert_franchise_slot(
  p_policy_id uuid,
  p_slot_name text,
  p_start_time time,
  p_end_time time,
  p_playlist_id uuid,
  p_days_of_week int[] default array[1,2,3,4,5,6,7],
  p_sort_order int default 0,
  p_slot_id uuid default null
)
returns public.franchise_music_policy_slots
language plpgsql security definer set search_path to 'public' as $$
declare v_row public.franchise_music_policy_slots; v_franchise_id uuid;
begin
  select franchise_id into v_franchise_id from public.franchise_music_policies where id = p_policy_id;
  if v_franchise_id is null then raise exception 'policy not found: %', p_policy_id; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(v_franchise_id)) then
    raise exception 'forbidden';
  end if;
  if not exists (select 1 from public.playlists where id = p_playlist_id) then
    raise exception 'playlist not found: %', p_playlist_id;
  end if;
  if p_slot_id is null then
    insert into public.franchise_music_policy_slots
      (policy_id, slot_name, start_time, end_time, playlist_id, days_of_week, sort_order)
    values
      (p_policy_id, p_slot_name, p_start_time, p_end_time, p_playlist_id, p_days_of_week, p_sort_order)
    returning * into v_row;
  else
    update public.franchise_music_policy_slots set
      slot_name = p_slot_name, start_time = p_start_time, end_time = p_end_time,
      playlist_id = p_playlist_id, days_of_week = p_days_of_week, sort_order = p_sort_order
    where id = p_slot_id and policy_id = p_policy_id
    returning * into v_row;
    if v_row.id is null then raise exception 'slot not found: %', p_slot_id; end if;
  end if;
  return v_row;
end;
$$;
grant execute on function public.admin_upsert_franchise_slot(uuid, text, time, time, uuid, int[], int, uuid) to authenticated;

-- 슬롯 삭제
create or replace function public.admin_delete_franchise_slot(p_slot_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_franchise_id uuid;
begin
  select p.franchise_id into v_franchise_id
    from public.franchise_music_policy_slots s
    join public.franchise_music_policies p on p.id = s.policy_id
   where s.id = p_slot_id;
  if v_franchise_id is null then raise exception 'slot not found'; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(v_franchise_id)) then
    raise exception 'forbidden';
  end if;
  delete from public.franchise_music_policy_slots where id = p_slot_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.admin_delete_franchise_slot(uuid) to authenticated;

-- 매장 동기화 상태 목록 (admin/franchise_admin)
create or replace function public.admin_list_franchise_sync_status(p_franchise_id uuid)
returns table (
  store_id uuid, store_name text, region_id uuid, region_name text,
  active_policy_id uuid, active_policy_name text, active_version_number int,
  last_seen_at timestamptz, last_synced_at timestamptz,
  current_track_id uuid, current_track_title text,
  player_status text, is_offline boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
declare v_threshold timestamptz := now() - interval '3 minutes';
begin
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then
    raise exception 'forbidden';
  end if;
  return query
    select fs.store_id,
           coalesce(fs.store_name, u.business_name, u.nickname) as store_name,
           fs.region_id, fr.name as region_name,
           ss.active_policy_id, fmp.name as active_policy_name,
           coalesce(ss.active_version_number, 1) as active_version_number,
           ss.last_seen_at, ss.last_synced_at,
           ss.current_track_id, t.title as current_track_title,
           coalesce(ss.player_status, 'unknown') as player_status,
           (ss.last_seen_at is null or ss.last_seen_at < v_threshold) as is_offline
      from public.franchise_stores fs
      join public.users u on u.id = fs.store_id
      left join public.franchise_regions fr on fr.id = fs.region_id
      left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
      left join public.franchise_music_policies fmp on fmp.id = ss.active_policy_id
      left join public.tracks t on t.id = ss.current_track_id
     where fs.franchise_id = p_franchise_id and fs.status = 'active'
     order by is_offline asc, store_name asc;
end;
$$;
grant execute on function public.admin_list_franchise_sync_status(uuid) to authenticated;


comment on table public.franchises is 'X6.89 — B2B 프랜차이즈 본사';
comment on table public.franchise_stores is 'X6.89 — 본사 ↔ 매장(users.id) bridge';
comment on table public.franchise_music_policies is 'X6.89 — 본사 음악 정책 (시간대별 슬롯 컨테이너)';
comment on function public.get_store_active_music_policy(uuid) is
  'X6.89 — 매장 플레이어 호출. 우선순위 store > region > all. 60s 폴링.';
