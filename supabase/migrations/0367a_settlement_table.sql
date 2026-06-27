-- 0367a — Enterprise Phase 1-8 (split A): Settlement table + RLS
--
-- 분할 이유:
--   0367 single-file 실행 실패 (사용자 보고 — 모든 객체 미생성).
--   Dashboard SQL Editor 가 batch 를 단일 transaction 으로 실행 →
--   storage.* 영역 한 줄 실패 시 ALTER/TABLE/RPC 모두 rollback.
--
--   대응:
--     0367a  — ALTER + table + RLS (storage 무관, 가장 안전)
--     0367b  — 6 RPC (0367a 의존)
--     0367c  — storage bucket + policy (가장 위험, a/b 영향 없음)
--
-- 절대 원칙:
--   - additive only (DROP / 컬럼 제거 / 기존 RPC 변경 0)
--   - 매장 플레이어 / heartbeat / now-playing / policy deployment 변경 0

-- ============================================================
-- 1) enterprise_business_profiles ALTER — 정산 담당자 3 fields
-- ============================================================
alter table public.enterprise_business_profiles
  add column if not exists settlement_contact_name text;
alter table public.enterprise_business_profiles
  add column if not exists settlement_contact_phone text;
alter table public.enterprise_business_profiles
  add column if not exists settlement_contact_email text;


-- ============================================================
-- 2) enterprise_settlement_profiles — 정산/은행/증빙/지급 1:1
-- ============================================================
create table if not exists public.enterprise_settlement_profiles (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null unique
    references public.enterprise_accounts(id) on delete cascade,
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

create index if not exists idx_esp_enterprise
  on public.enterprise_settlement_profiles (enterprise_account_id);
create index if not exists idx_esp_status
  on public.enterprise_settlement_profiles (settlement_status);

drop trigger if exists trg_esp_updated_at on public.enterprise_settlement_profiles;
create trigger trg_esp_updated_at before update on public.enterprise_settlement_profiles
  for each row execute function public._touch_updated_at();

alter table public.enterprise_settlement_profiles enable row level security;

drop policy if exists esp_select on public.enterprise_settlement_profiles;
create policy esp_select on public.enterprise_settlement_profiles
  for select using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_settlement_profiles.enterprise_account_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke all on public.enterprise_settlement_profiles from anon;
revoke all on public.enterprise_settlement_profiles from authenticated;

comment on table public.enterprise_settlement_profiles is
  'Phase 1-8 (0367a) — HQ 정산/은행/증빙/지급 1:1. RPC 만 접근.';


-- ============================================================
-- 3) Diagnostics
-- ============================================================
do $$
declare v_business_cols int; v_table int;
begin
  select count(*) into v_business_cols from information_schema.columns
   where table_schema='public' and table_name='enterprise_business_profiles'
     and column_name in ('settlement_contact_name','settlement_contact_phone','settlement_contact_email');
  select count(*) into v_table from information_schema.tables
   where table_schema='public' and table_name='enterprise_settlement_profiles';

  raise notice '====== 0367a Settlement Table Diagnostics ======';
  raise notice 'enterprise_business_profiles +3 cols: % / 3', v_business_cols;
  raise notice 'enterprise_settlement_profiles table: % / 1', v_table;
  raise notice '================================================';

  if v_business_cols = 3 and v_table = 1 then
    raise notice '0367a COMPLETE — 다음: 0367b (RPC) 적용';
  else
    raise warning '0367a INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
