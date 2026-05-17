-- ============================================
-- 0059_settlement_policies_revenues.sql
--
-- Phase 4 Step 1: 정산 정책 + 월별 매출 캐시
--
--   - settlement_policies (append-only history)
--   - streaming_revenues (월×아티스트×트랙 snapshot)
--   - _mask_account_number 헬퍼
--   - 정책 seed (사용자 명시 기본값)
--
-- 정책:
--   - settlement_policies 는 UPDATE 차단 (append-only)
--   - streaming_revenues 는 UNIQUE(month, artist, track) 으로 중복 INSERT 방지
--   - RLS: 본인 SELECT + admin all
-- ============================================

-- ----------------------
-- 1) 계좌번호 마스킹 헬퍼
-- ----------------------
create or replace function public._mask_account_number(p_acct text)
returns text language plpgsql immutable as $$
declare
  v_clean text;
begin
  if p_acct is null then return null; end if;
  v_clean := regexp_replace(p_acct, '\D', '', 'g');
  if length(v_clean) <= 8 then
    return p_acct;  -- 너무 짧으면 마스킹 의미 없음 — 원본 그대로 (운영 데이터엔 발생 안 함)
  end if;
  return left(v_clean, 4) || '-**-****-' || right(v_clean, 4);
end;
$$;

-- ----------------------
-- 2) settlement_policies — append-only 정책 이력
-- ----------------------
create table if not exists public.settlement_policies (
  id uuid primary key default gen_random_uuid(),
  effective_from date not null unique,
  pool_revenue_ratio numeric(5,4) not null
    check (pool_revenue_ratio >= 0 and pool_revenue_ratio <= 1),
  company_fee_ratio numeric(5,4) not null
    check (company_fee_ratio >= 0 and company_fee_ratio <= 1),
  withholding_tax_ratio numeric(5,4) not null
    check (withholding_tax_ratio >= 0 and withholding_tax_ratio <= 1),
  min_payout_amount integer not null check (min_payout_amount >= 0),
  min_payout_basis text not null check (min_payout_basis in ('gross','net')),
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_settlement_policies_effective
  on public.settlement_policies(effective_from desc);

-- append-only 트리거
create or replace function public._settlement_policies_protect()
returns trigger language plpgsql as $$
begin
  if TG_OP = 'UPDATE' then
    raise exception 'settlement_policies is append-only (id=%)', OLD.id
      using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'settlement_policies cannot be deleted (id=%)', OLD.id
      using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_settlement_policies_protect on public.settlement_policies;
create trigger trg_settlement_policies_protect
  before update or delete on public.settlement_policies
  for each row execute function public._settlement_policies_protect();

-- RLS: admin write, all authenticated read (정책은 공개)
alter table public.settlement_policies enable row level security;

drop policy if exists "settlement_policies_select_all" on public.settlement_policies;
create policy "settlement_policies_select_all" on public.settlement_policies
  for select using (true);

drop policy if exists "settlement_policies_admin_insert" on public.settlement_policies;
create policy "settlement_policies_admin_insert" on public.settlement_policies
  for insert with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 3) 초기 정책 seed (사용자 명시 기본값)
-- ----------------------
insert into public.settlement_policies (
  effective_from, pool_revenue_ratio, company_fee_ratio, withholding_tax_ratio,
  min_payout_amount, min_payout_basis, note
) values (
  '2024-01-01', 0.70, 0.20, 0.033, 50000, 'gross',
  'Phase 4 초기 기본 정책. 매출 풀 70%, 회사 수수료 20%, 원천징수 3.3%, 최소 지급 5만원 (공제 전 기준)'
) on conflict (effective_from) do nothing;

-- ----------------------
-- 4) streaming_revenues — 월×아티스트×트랙 매출 snapshot
-- ----------------------
create table if not exists public.streaming_revenues (
  id uuid primary key default gen_random_uuid(),
  revenue_month date not null,                  -- KST 월 1일
  artist_user_id uuid not null references public.users(id) on delete restrict,
  track_id uuid not null references public.tracks(id) on delete restrict,
  track_code text,                              -- snapshot
  stream_count integer not null check (stream_count >= 0),
  total_pool_revenue bigint not null check (total_pool_revenue >= 0),
  total_pool_streams bigint not null check (total_pool_streams >= 0),
  gross_artist_amount bigint not null check (gross_artist_amount >= 0),
  policy_id uuid not null references public.settlement_policies(id) on delete restrict,
  computed_at timestamptz not null default now(),
  unique(revenue_month, artist_user_id, track_id)
);

create index if not exists idx_streaming_revenues_month
  on public.streaming_revenues(revenue_month desc);
create index if not exists idx_streaming_revenues_artist
  on public.streaming_revenues(artist_user_id, revenue_month desc);

-- RLS: 본인 SELECT + admin all. INSERT/UPDATE/DELETE 차단 (RPC only)
alter table public.streaming_revenues enable row level security;

drop policy if exists "streaming_revenues_select_self" on public.streaming_revenues;
create policy "streaming_revenues_select_self" on public.streaming_revenues
  for select using (artist_user_id = auth.uid());

drop policy if exists "streaming_revenues_admin_all" on public.streaming_revenues;
create policy "streaming_revenues_admin_all" on public.streaming_revenues
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
