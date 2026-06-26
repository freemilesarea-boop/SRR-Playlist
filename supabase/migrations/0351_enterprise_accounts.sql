-- 0351 — Enterprise Phase 1-1: 본사 계정 관리 (enterprise_accounts)
--
-- 목적:
--   본사 담당자 정보 + 권한 관리. 출시 전 Priority 1.
--   franchise_admins (X6.89) 는 user_id 가 이미 있어야 하는 binding 테이블.
--   enterprise_accounts 는 contact directory — 사용자 가입 전부터 등록 가능
--   (status='invited'). 향후 auth_user_id 채워지면 franchise_admins 와 연동 가능.
--
-- 절대 금지:
--   - 기존 franchise_admins / franchises / payment / artist_settlement / store player 무수정
--   - users 스키마 변경 X
--   - hard delete 금지 (API/RPC 가 soft delete 만 노출)

-- ============================================================
-- 1) enterprise_accounts 테이블
-- ============================================================
create table if not exists public.enterprise_accounts (
  id uuid primary key default gen_random_uuid(),
  enterprise_name text not null,
  manager_name text not null,
  manager_email text not null,
  manager_phone text,
  role text not null default 'enterprise_manager'
    check (role in ('owner','admin','enterprise_manager','viewer')),
  status text not null default 'active'
    check (status in ('active','invited','suspended','inactive')),
  last_login_at timestamptz,
  auth_user_id uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  constraint enterprise_email_format
    check (manager_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  constraint enterprise_phone_length
    check (manager_phone is null or (char_length(btrim(manager_phone)) between 8 and 20))
);

-- soft delete 기준 partial unique email (deleted_at IS NULL 만)
create unique index if not exists enterprise_accounts_email_active_unique
  on public.enterprise_accounts (lower(btrim(manager_email)))
  where deleted_at is null;

create index if not exists idx_enterprise_accounts_name
  on public.enterprise_accounts (enterprise_name) where deleted_at is null;
create index if not exists idx_enterprise_accounts_status
  on public.enterprise_accounts (status) where deleted_at is null;
create index if not exists idx_enterprise_accounts_role
  on public.enterprise_accounts (role) where deleted_at is null;
create index if not exists idx_enterprise_accounts_auth_user
  on public.enterprise_accounts (auth_user_id) where auth_user_id is not null;
create index if not exists idx_enterprise_accounts_active
  on public.enterprise_accounts (created_at desc) where deleted_at is null;

-- updated_at trigger (기존 _touch_updated_at 재사용)
drop trigger if exists trg_enterprise_accounts_updated_at on public.enterprise_accounts;
create trigger trg_enterprise_accounts_updated_at
  before update on public.enterprise_accounts
  for each row execute function public._touch_updated_at();

-- ============================================================
-- 2) RLS — admin 전체 / 본인(auth_user_id) select / mutation RPC 만
-- ============================================================
alter table public.enterprise_accounts enable row level security;

drop policy if exists enterprise_accounts_select on public.enterprise_accounts;
create policy enterprise_accounts_select on public.enterprise_accounts
  for select using (
    public._is_super_admin()
    or (auth_user_id is not null and auth_user_id = auth.uid())
  );

-- INSERT/UPDATE/DELETE 는 RPC (security definer) 만 허용
revoke insert, update, delete on public.enterprise_accounts from authenticated, anon;


-- ============================================================
-- 3) 목록 조회 RPC (검색 + 필터 + 페이지네이션)
-- ============================================================
create or replace function public.admin_list_enterprise_accounts(
  p_search text default null,
  p_status text default null,
  p_role text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_include_deleted boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;

  with filtered as (
    select * from public.enterprise_accounts ea
     where (p_include_deleted or ea.deleted_at is null)
       and (p_status is null or ea.status = p_status)
       and (p_role is null or ea.role = p_role)
       and (
         v_search is null
         or ea.enterprise_name ilike '%' || v_search || '%'
         or ea.manager_name ilike '%' || v_search || '%'
         or lower(ea.manager_email) like '%' || lower(v_search) || '%'
         or (ea.manager_phone is not null and ea.manager_phone like '%' || v_search || '%')
       )
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select * from public.enterprise_accounts ea
     where (p_include_deleted or ea.deleted_at is null)
       and (p_status is null or ea.status = p_status)
       and (p_role is null or ea.role = p_role)
       and (
         v_search is null
         or ea.enterprise_name ilike '%' || v_search || '%'
         or ea.manager_name ilike '%' || v_search || '%'
         or lower(ea.manager_email) like '%' || lower(v_search) || '%'
         or (ea.manager_phone is not null and ea.manager_phone like '%' || v_search || '%')
       )
     order by ea.created_at desc
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(filtered)), '[]'::jsonb) into v_rows from filtered;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    )
  );
end;
$$;
revoke execute on function public.admin_list_enterprise_accounts(text, text, text, int, int, boolean) from public, anon;
grant execute on function public.admin_list_enterprise_accounts(text, text, text, int, int, boolean) to authenticated;


-- ============================================================
-- 4) 생성
-- ============================================================
create or replace function public.admin_create_enterprise_account(
  p_enterprise_name text,
  p_manager_name text,
  p_manager_email text,
  p_manager_phone text default null,
  p_role text default 'enterprise_manager',
  p_status text default 'active',
  p_notes text default null,
  p_auth_user_id uuid default null
)
returns public.enterprise_accounts
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.enterprise_accounts;
  v_email text := lower(btrim(p_manager_email));
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_enterprise_name), '') = '' then raise exception 'enterprise_name required'; end if;
  if coalesce(btrim(p_manager_name), '') = '' then raise exception 'manager_name required'; end if;
  if coalesce(v_email, '') = '' then raise exception 'manager_email required'; end if;

  begin
    insert into public.enterprise_accounts
      (enterprise_name, manager_name, manager_email, manager_phone,
       role, status, notes, auth_user_id, created_by, updated_by)
    values
      (btrim(p_enterprise_name), btrim(p_manager_name), v_email,
       nullif(btrim(coalesce(p_manager_phone, '')), ''),
       coalesce(p_role, 'enterprise_manager'), coalesce(p_status, 'active'),
       nullif(btrim(coalesce(p_notes, '')), ''),
       p_auth_user_id, auth.uid(), auth.uid())
    returning * into v_row;
  exception when unique_violation then
    raise exception '이미 등록된 이메일입니다: %', v_email;
  end;

  -- audit log
  perform public.admin_log_operation(
    'enterprise_accounts',
    'admin',
    'success',
    'created',
    format('Created enterprise account: %s (%s)', v_row.enterprise_name, v_row.manager_email),
    jsonb_build_object('action', 'create', 'target_table', 'enterprise_accounts',
      'target_id', v_row.id, 'after', to_jsonb(v_row)),
    auth.uid(), v_row.id::text, null, null, null
  );

  return v_row;
end;
$$;
revoke execute on function public.admin_create_enterprise_account(text, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.admin_create_enterprise_account(text, text, text, text, text, text, text, uuid) to authenticated;


-- ============================================================
-- 5) 수정
-- ============================================================
create or replace function public.admin_update_enterprise_account(
  p_id uuid,
  p_enterprise_name text default null,
  p_manager_name text default null,
  p_manager_email text default null,
  p_manager_phone text default null,
  p_role text default null,
  p_status text default null,
  p_notes text default null,
  p_auth_user_id uuid default null
)
returns public.enterprise_accounts
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before public.enterprise_accounts;
  v_row public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select * into v_before from public.enterprise_accounts where id = p_id;
  if v_before.id is null then raise exception 'enterprise_account not found: %', p_id; end if;
  if v_before.deleted_at is not null then raise exception 'cannot modify deleted account'; end if;

  begin
    update public.enterprise_accounts set
      enterprise_name = coalesce(nullif(btrim(p_enterprise_name), ''), enterprise_name),
      manager_name = coalesce(nullif(btrim(p_manager_name), ''), manager_name),
      manager_email = coalesce(nullif(lower(btrim(p_manager_email)), ''), manager_email),
      manager_phone = case
        when p_manager_phone is null then manager_phone
        when btrim(p_manager_phone) = '' then null
        else btrim(p_manager_phone)
      end,
      role = coalesce(p_role, role),
      status = coalesce(p_status, status),
      notes = case
        when p_notes is null then notes
        when btrim(p_notes) = '' then null
        else btrim(p_notes)
      end,
      auth_user_id = case
        when p_auth_user_id is not null then p_auth_user_id
        else auth_user_id
      end,
      updated_by = auth.uid()
    where id = p_id
    returning * into v_row;
  exception when unique_violation then
    raise exception '이미 등록된 이메일입니다';
  end;

  perform public.admin_log_operation(
    'enterprise_accounts',
    'admin',
    'success',
    'updated',
    format('Updated enterprise account: %s', v_row.enterprise_name),
    jsonb_build_object('action', 'update', 'target_table', 'enterprise_accounts',
      'target_id', v_row.id, 'before', to_jsonb(v_before), 'after', to_jsonb(v_row)),
    auth.uid(), v_row.id::text, null, null, null
  );

  return v_row;
end;
$$;
revoke execute on function public.admin_update_enterprise_account(uuid, text, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.admin_update_enterprise_account(uuid, text, text, text, text, text, text, text, uuid) to authenticated;


-- ============================================================
-- 6) 상태 변경
-- ============================================================
create or replace function public.admin_set_enterprise_account_status(
  p_id uuid, p_status text
)
returns public.enterprise_accounts
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_before public.enterprise_accounts; v_row public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('active','invited','suspended','inactive') then
    raise exception 'invalid status: %', p_status;
  end if;

  select * into v_before from public.enterprise_accounts where id = p_id and deleted_at is null;
  if v_before.id is null then raise exception 'enterprise_account not found or deleted'; end if;

  update public.enterprise_accounts
     set status = p_status, updated_by = auth.uid()
   where id = p_id returning * into v_row;

  perform public.admin_log_operation(
    'enterprise_accounts',
    'admin',
    'success',
    'status_changed',
    format('Status %s → %s for %s', v_before.status, p_status, v_row.enterprise_name),
    jsonb_build_object('action', 'set_status', 'target_id', v_row.id,
      'before', jsonb_build_object('status', v_before.status),
      'after', jsonb_build_object('status', p_status)),
    auth.uid(), v_row.id::text, null, null, null
  );

  return v_row;
end;
$$;
revoke execute on function public.admin_set_enterprise_account_status(uuid, text) from public, anon;
grant execute on function public.admin_set_enterprise_account_status(uuid, text) to authenticated;


-- ============================================================
-- 7) Soft delete
-- ============================================================
create or replace function public.admin_soft_delete_enterprise_account(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_before public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_before from public.enterprise_accounts where id = p_id and deleted_at is null;
  if v_before.id is null then raise exception 'enterprise_account not found or already deleted'; end if;

  update public.enterprise_accounts
     set deleted_at = now(), status = 'inactive', updated_by = auth.uid()
   where id = p_id;

  perform public.admin_log_operation(
    'enterprise_accounts',
    'admin',
    'warning',
    'soft_deleted',
    format('Soft-deleted enterprise account: %s', v_before.enterprise_name),
    jsonb_build_object('action', 'soft_delete', 'target_id', p_id,
      'before', to_jsonb(v_before)),
    auth.uid(), p_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'id', p_id);
end;
$$;
revoke execute on function public.admin_soft_delete_enterprise_account(uuid) from public, anon;
grant execute on function public.admin_soft_delete_enterprise_account(uuid) to authenticated;


-- ============================================================
-- 8) last_login_at 갱신 (auth_user_id 기준)
--     향후 onLogin 훅에서 호출. 본인 갱신 + admin 강제 갱신 가능.
-- ============================================================
create or replace function public.record_enterprise_login(p_auth_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_target uuid := coalesce(p_auth_user_id, auth.uid());
begin
  if v_target is null then return jsonb_build_object('success', false, 'reason', 'no_user'); end if;
  if v_target <> auth.uid() and not public._is_super_admin() then
    raise exception 'forbidden: can only record own login';
  end if;

  update public.enterprise_accounts
     set last_login_at = now()
   where auth_user_id = v_target and deleted_at is null;

  return jsonb_build_object('success', true, 'auth_user_id', v_target, 'recorded_at', now());
end;
$$;
revoke execute on function public.record_enterprise_login(uuid) from public, anon;
grant execute on function public.record_enterprise_login(uuid) to authenticated;


-- ============================================================
-- 9) KPI 요약 RPC
-- ============================================================
create or replace function public.admin_enterprise_account_kpi()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_recent_threshold timestamptz := now() - interval '7 days';
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return jsonb_build_object(
    'total', (select count(*) from public.enterprise_accounts where deleted_at is null),
    'active', (select count(*) from public.enterprise_accounts where deleted_at is null and status='active'),
    'invited', (select count(*) from public.enterprise_accounts where deleted_at is null and status='invited'),
    'suspended', (select count(*) from public.enterprise_accounts where deleted_at is null and status='suspended'),
    'inactive', (select count(*) from public.enterprise_accounts where deleted_at is null and status='inactive'),
    'recent_login_7d', (
      select count(*) from public.enterprise_accounts
       where deleted_at is null and last_login_at is not null and last_login_at >= v_recent_threshold
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_account_kpi() from public, anon;
grant execute on function public.admin_enterprise_account_kpi() to authenticated;


comment on table public.enterprise_accounts is
  'Enterprise Phase 1-1 — 본사 담당자 directory. auth_user_id 채워지면 franchise_admins 연동 가능.';
