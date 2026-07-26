-- HQ-OPS-1-VERIFY synthetic prerequisites — EXACT DDL copied from real migrations.
-- Faithful table/function definitions (columns/constraints/FKs verbatim).
-- Ancillary indexes / RLS policies / updated_at triggers omitted (not needed for functional verification;
--   RPC access is via SECURITY DEFINER + auth.uid() guards, tested directly). enterprise_accounts reused (exists in Test).

-- ==== fn _touch_updated_at (0015) ====
create or replace function public._touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ==== fn _is_super_admin (0349) ====
create or replace function public._is_super_admin()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin');
$$;

-- ==== users (0001) ====
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  role text not null default 'user' check (role in ('user', 'admin')),
  subscription_type text not null default 'free' check (subscription_type in ('free', 'personal', 'business')),
  business_category text,
  created_at timestamptz not null default now()
);

-- ==== users +cols (0014 signup_profiles alter) ====
alter table public.users
  add column if not exists account_type text default 'individual'
    check (account_type in ('individual','business')),
  add column if not exists full_name text,
  add column if not exists birth_date date,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists identity_verified boolean not null default false,
  add column if not exists identity_provider text,
  add column if not exists identity_verified_at timestamptz,
  add column if not exists identity_ci text,
  add column if not exists identity_di text,
  add column if not exists signup_completed boolean not null default false;

-- ==== users +cols (0056 withdrawal alter) ====
alter table public.users
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_reason text;

-- ==== tracks (0001) ====
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  genre text,
  mood text,
  audio_url text not null,
  cover_url text,
  duration int,
  created_at timestamptz not null default now()
);

-- ==== business_profiles (0007) ====
create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  store_name text,
  business_type text,
  timezone text not null default 'Asia/Seoul',
  open_time time,
  close_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==== business_verification_profiles (0014) ====
create table if not exists public.business_verification_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_number text not null,
  business_name text,
  representative_name text,
  business_open_date date,
  business_address text,
  business_type text,
  store_name text,
  store_address text,
  business_verified boolean not null default false,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','manual_review')),
  business_state text,
  tax_type text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (business_number)
);

-- ==== franchises (0349) ====
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

-- ==== franchise_regions (0349) ====
create table if not exists public.franchise_regions (
  id uuid primary key default gen_random_uuid(),
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (franchise_id, name)
);

-- ==== franchise_music_policies (0349) ====
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

-- ==== franchise_stores (0349) ====
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

-- ==== store_policy_sync_status base (0349) ====
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

-- ==== store_policy_sync_status +cols (0355 alters) ====
alter table public.store_policy_sync_status
  add column if not exists enterprise_region_id uuid references public.enterprise_regions(id) on delete set null;

alter table public.store_policy_sync_status
  add column if not exists last_policy_sync_at timestamptz;

alter table public.store_policy_sync_status
  add column if not exists last_player_version text;

alter table public.store_policy_sync_status
  add column if not exists device_model text;

alter table public.store_policy_sync_status
  add column if not exists device_os text;

alter table public.store_policy_sync_status
  add column if not exists battery_level integer;

alter table public.store_policy_sync_status
  add column if not exists volume integer;

alter table public.store_policy_sync_status
  add column if not exists current_track_started_at timestamptz;

alter table public.store_policy_sync_status
  add column if not exists playback_error text;

alter table public.store_policy_sync_status
  add column if not exists connection_type text;

alter table public.store_policy_sync_status
  add column if not exists wifi_ssid text;

alter table public.store_policy_sync_status
  add column if not exists app_version text;

alter table public.store_policy_sync_status
  add column if not exists device_identifier text;

-- ==== enterprise_regions (0352) ====
create table if not exists public.enterprise_regions (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete restrict,
  region_name text not null,
  region_code text not null,
  manager_name text,
  manager_email text,
  manager_phone text,
  status text not null default 'active'
    check (status in ('active','inactive','suspended')),
  store_count integer not null default 0 check (store_count >= 0),
  last_policy_applied_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  constraint enterprise_region_email_format
    check (
      manager_email is null
      or manager_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),
  constraint enterprise_region_phone_length
    check (manager_phone is null or (char_length(btrim(manager_phone)) between 8 and 20))
);

-- ==== enterprise_franchises (0363) ====
create table if not exists public.enterprise_franchises (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete cascade,
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary','secondary')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ==== enterprise_announcement_assets (0381) ====
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

-- ==== enterprise_announcement_schedules (0381) ====
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

-- ==== enterprise_announcement_play_logs (0381) ====
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

-- ==== enterprise_emergency_broadcasts (0384) ====
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

-- ==== enterprise_emergency_broadcast_targets (0384) ====
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

-- ==== enterprise_billing_invoices (0382) ====
create table if not exists public.enterprise_billing_invoices (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete restrict,
  billing_month         date not null,
  active_store_count    integer not null default 0 check (active_store_count >= 0),
  monthly_store_price   integer not null default 4900 check (monthly_store_price >= 0),
  subtotal_amount       integer not null default 0 check (subtotal_amount >= 0),
  discount_amount       integer not null default 0 check (discount_amount >= 0),
  tax_amount            integer not null default 0 check (tax_amount >= 0),
  total_amount          integer not null default 0 check (total_amount >= 0),
  currency              text not null default 'KRW',
  status                text not null default 'draft'
                          check (status in ('draft','issued','paid','overdue','cancelled','failed')),
  due_date              date,
  issued_at             timestamptz,
  paid_at               timestamptz,
  cancelled_at          timestamptz,
  payment_reference     text,
  payment_method        text,
  memo                  text,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- billing_month 는 항상 월 첫날
  constraint ebi_billing_month_first_day check (billing_month = date_trunc('month', billing_month)::date)
);

-- ==== enterprise_contracts (0383) ====
create table if not exists public.enterprise_contracts (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete restrict,
  contract_no           text not null,
  contract_name         text not null,
  contract_type         text not null default 'standard',
  start_date            date not null,
  end_date              date,
  auto_renew            boolean not null default true,
  renewal_period_month  integer not null default 12 check (renewal_period_month >= 1 and renewal_period_month <= 60),
  status                text not null default 'draft'
                          check (status in ('draft','active','expiring','expired','terminated')),
  monthly_store_price   integer check (monthly_store_price is null or monthly_store_price >= 0),
  commission_rate       numeric(5,2) check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)),
  minimum_payout        integer check (minimum_payout is null or minimum_payout >= 0),
  settlement_method     text check (settlement_method is null or settlement_method in ('monthly','weekly','manual')),
  memo                  text,
  signed_at             timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ec_end_after_start check (end_date is null or end_date >= start_date)
);

-- ==== enterprise_monthly_settlements (0372) ====
create table if not exists public.enterprise_monthly_settlements (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null
    references public.enterprise_accounts(id) on delete cascade,
  settlement_month date not null,
  -- 생성 당시 스냅샷 (실시간 재계산 금지)
  active_store_count int not null check (active_store_count >= 0),
  monthly_store_price int not null check (monthly_store_price >= 0),
  commission_rate numeric(5,2) not null check (commission_rate >= 0 and commission_rate <= 100),
  per_store_commission int not null check (per_store_commission >= 0),
  total_commission int not null check (total_commission >= 0),
  status text not null default 'pending'
    check (status in ('pending','approved','paid','cancelled')),
  generated_at timestamptz not null default now(),
  generated_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  payment_reference text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ==== enterprise_monthly_settlements +cols (0400 alters) ====
alter table public.enterprise_monthly_settlements
  add column if not exists previous_carryover           int not null default 0
    check (previous_carryover >= 0),
  add column if not exists carryover_amount             int not null default 0
    check (carryover_amount >= 0),
  add column if not exists carryover_source_settlement_id uuid
    references public.enterprise_monthly_settlements(id) on delete set null,
  add column if not exists carryover_applied            boolean not null default false;

-- ==== system_settings (0353) ====
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

-- ==== admin_operation_logs (0041) ====
create table if not exists public.admin_operation_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,         -- e.g., 'payapp-feedback', 'sync-payapp-payments'
  category text not null,       -- e.g., 'payment','webhook','analytics','member','system','rpc'
  level text not null check (level in ('info','success','warning','error')),
  status text not null,         -- 'started','completed','failed','skipped' 등
  message text not null,
  details jsonb not null default '{}'::jsonb,
  user_id uuid references public.users(id) on delete set null,
  related_id text,              -- 자유 형식 식별자 (payapp_mul_no / order_no / event_id 등)
  duration_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

-- ==== fn admin_log_operation (0041) ====
create or replace function public.admin_log_operation(
  p_source text,
  p_category text,
  p_level text,
  p_status text,
  p_message text,
  p_details jsonb default '{}'::jsonb,
  p_user_id uuid default null,
  p_related_id text default null,
  p_duration_ms int default null,
  p_error_code text default null,
  p_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  -- level 검증 (잘못된 값이 들어와도 'info' 로 fallback — 호출자를 막지 않음)
  insert into public.admin_operation_logs
    (source, category, level, status, message, details, user_id,
     related_id, duration_ms, error_code, error_message)
  values (
    coalesce(nullif(btrim(p_source), ''), 'unknown'),
    coalesce(nullif(btrim(p_category), ''), 'system'),
    case when p_level in ('info','success','warning','error') then p_level else 'info' end,
    coalesce(nullif(btrim(p_status), ''), 'unknown'),
    coalesce(nullif(btrim(p_message), ''), '(empty)'),
    coalesce(p_details, '{}'::jsonb),
    p_user_id, p_related_id, p_duration_ms, p_error_code, p_error_message
  )
  returning id into v_id;
  return v_id;
exception when others then
  -- 로그 기록 자체가 호출자를 막으면 안 됨
  return null;
end;
$$;

-- ==== fn admin_force_store_resync (0355) ====
create or replace function public.admin_force_store_resync(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.store_policy_sync_status
     set last_policy_sync_at = null, updated_at = now()
   where store_id = p_store_id;
  if not found then raise exception 'store not found in monitoring: %', p_store_id; end if;

  perform public.admin_log_operation(
    'store_policy_sync_status', 'admin', 'info', 'force_resync',
    format('Forced policy resync for store %s', p_store_id),
    jsonb_build_object('action', 'store_monitoring.force_resync', 'store_id', p_store_id),
    auth.uid(), p_store_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'store_id', p_store_id);
end;
$$;

-- ==== fn _hq_current_enterprise_account_id (0401) ====
create or replace function public._hq_current_enterprise_account_id()
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select ea.id
    from public.enterprise_accounts ea
   where ea.auth_user_id = auth.uid()
     and ea.deleted_at is null
     and ea.status in ('active','invited')
   limit 1;
$$;

-- ==== fn _hq_owns_store (0401) ====
create or replace function public._hq_owns_store(p_ea_id uuid, p_store_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.franchise_stores fs
      join public.enterprise_franchises ef
        on ef.franchise_id = fs.franchise_id
       and ef.deleted_at is null
     where fs.store_id = p_store_id
       and ef.enterprise_account_id = p_ea_id
  );
$$;

-- ============================================================
-- /enterprise/me 진입(CTA) 지원용 추가 스키마 (exact from migrations)
-- enterprise_accounts 는 Test DB에 사전 존재(간소화 정의)하므로, 대시보드 RPC가 읽는
-- 컬럼을 add column if not exists 로 보강한다. manager_name/email 은 사전 행(2건) 보존을 위해
-- NULLABLE 로 추가(원본 0351 은 NOT NULL — harness 편차, 문서화됨). cleanup 이 추가 컬럼만 제거.
-- ============================================================
alter table public.enterprise_accounts add column if not exists manager_name text;
alter table public.enterprise_accounts add column if not exists manager_email text;
alter table public.enterprise_accounts add column if not exists manager_phone text;
alter table public.enterprise_accounts add column if not exists role text;
alter table public.enterprise_accounts add column if not exists last_login_at timestamptz;
alter table public.enterprise_accounts add column if not exists notes text;
alter table public.enterprise_accounts add column if not exists updated_at timestamptz;
alter table public.enterprise_accounts add column if not exists brand_code text;
alter table public.enterprise_accounts add column if not exists hq_invite_code text;
alter table public.enterprise_accounts add column if not exists invite_code_rotated_at timestamptz;
alter table public.enterprise_accounts add column if not exists onboarding_enabled boolean not null default true;
alter table public.enterprise_accounts add column if not exists allow_self_register_region boolean not null default false;

-- franchise_stores.enterprise_region_id (0363)
alter table public.franchise_stores
  add column if not exists enterprise_region_id uuid
  references public.enterprise_regions(id) on delete set null;

-- enterprise_business_profiles (0364)
create table if not exists public.enterprise_business_profiles (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null unique references public.enterprise_accounts(id) on delete cascade,
  company_name text,
  business_number text,
  representative_name text,
  business_address text,
  contact_phone text,
  tax_invoice_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- enterprise_settlement_profiles (0367a) + monthly_store_price/commission_rate (0370/0371)
create table if not exists public.enterprise_settlement_profiles (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null unique references public.enterprise_accounts(id) on delete cascade,
  bank_name text,
  account_number text,
  account_holder text,
  business_license_path text,
  bankbook_path text,
  settlement_status text not null default 'unregistered'
    check (settlement_status in ('unregistered','reviewing','approved','rejected')),
  settlement_method text not null default 'monthly'
    check (settlement_method in ('monthly','weekly','manual')),
  minimum_payout integer not null default 0 check (minimum_payout >= 0),
  rejection_reason text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.enterprise_settlement_profiles add column if not exists commission_rate numeric(5,2) not null default 20.00;
alter table public.enterprise_settlement_profiles add column if not exists monthly_store_price int not null default 4900;
