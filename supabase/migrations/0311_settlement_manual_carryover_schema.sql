-- 0311 — 정산 수동 이월 (manual carryover) 컬럼 + 보호 트리거 완화 +
--        settlement_admin_audit_logs 테이블 (X6.25)
--
-- 배경:
--   현재 carryover 는 admin_generate_monthly_settlement 이 자동으로 (총 정산
--   < min_payout) 만들어주는 케이스만 있음. 관리자가 정산 가능한 금액을
--   "이번 달 보류 → 다음 달 이월" 처리할 수단이 없다.
--
-- 추가 컬럼 (artist_settlements):
--   * carried_over_to_month  (date)       — 이월 대상 월 (다음 정산월)
--   * carried_over_at        (timestamptz) — 이월 처리 시점
--   * carried_over_by        (uuid)       — 처리한 관리자
--   * carryover_applied      (bool)       — 다음 달 생성 시 이월금 소비 표시
--   * carryover_reason       (text)       — 사유 (manual carryover 필수)
--   * is_manual_carryover    (bool)       — auto vs manual 구분
--
-- 보호 트리거:
--   기존 _artist_settlements_protect 는 status != 'pending' 인 row 의
--   carried_over_amount 변경을 차단. 수동 이월에서는 payable → carried_over
--   전환 시 carried_over_amount 를 새로 채워야 하므로,
--     - NEW.is_manual_carryover = true (방금 manual flag 세팅됨)
--   인 케이스를 화이트리스트.
--   carryover_applied 토글은 status 무관하게 허용 (auto/manual 동일).
--
-- 감사 로그 (settlement_admin_audit_logs):
--   curator_admin_audit_logs 와 동일 패턴. action='manual_carryover' 외에도
--   향후 'finalize'/'pay'/'hold' 등 다른 액션도 적재 가능.

-- ===== 1) artist_settlements 컬럼 추가 =====
alter table public.artist_settlements
  add column if not exists carried_over_to_month date,
  add column if not exists carried_over_at timestamptz,
  add column if not exists carried_over_by uuid references public.users(id),
  add column if not exists carryover_applied boolean not null default false,
  add column if not exists carryover_reason text,
  add column if not exists is_manual_carryover boolean not null default false;

create index if not exists artist_settlements_carryover_to_idx
  on public.artist_settlements (carried_over_to_month)
  where is_manual_carryover = true and carryover_applied = false;

-- ===== 2) 보호 트리거 완화 =====
create or replace function public._artist_settlements_protect()
returns trigger language plpgsql set search_path = public as $$
declare
  v_immutable_calc_changed boolean;
  v_manual_carryover_just_set boolean;
begin
  if TG_OP = 'DELETE' then
    if OLD.status = 'paid' then
      raise exception 'paid settlement cannot be deleted (id=%)', OLD.id using errcode = '42501';
    end if;
    return OLD;
  end if;
  if OLD.status = 'paid' then
    raise exception 'paid settlement is immutable (id=%)', OLD.id using errcode = '42501';
  end if;
  if NEW.settlement_month <> OLD.settlement_month then
    raise exception 'cannot change settlement_month of settlement %', OLD.id using errcode = '42501';
  end if;
  if NEW.artist_user_id <> OLD.artist_user_id then
    raise exception 'cannot change artist_user_id of settlement %', OLD.id using errcode = '42501';
  end if;
  if NEW.policy_id <> OLD.policy_id then
    raise exception 'cannot change policy_id of settlement %', OLD.id using errcode = '42501';
  end if;

  v_manual_carryover_just_set :=
    (coalesce(OLD.is_manual_carryover, false) = false)
    and (coalesce(NEW.is_manual_carryover, false) = true);

  v_immutable_calc_changed :=
    NEW.gross_settlement_amount is distinct from OLD.gross_settlement_amount or
    NEW.company_fee_amount is distinct from OLD.company_fee_amount or
    NEW.sales_agent_fee_amount is distinct from OLD.sales_agent_fee_amount or
    NEW.artist_net_settlement is distinct from OLD.artist_net_settlement or
    NEW.previous_carried_amount is distinct from OLD.previous_carried_amount or
    NEW.total_settlement_amount is distinct from OLD.total_settlement_amount or
    NEW.withholding_tax_amount is distinct from OLD.withholding_tax_amount or
    NEW.final_payout_amount is distinct from OLD.final_payout_amount or
    NEW.meets_min_payout is distinct from OLD.meets_min_payout;

  -- X6.25: 수동 이월 (admin_carryover_settlement) 이 status=pending|payable →
  -- carried_over 로 옮기는 순간에는 carried_over_amount 단일 컬럼 변경 허용.
  -- 그 외 계산 컬럼은 여전히 immutable.
  if OLD.status <> 'pending' and v_immutable_calc_changed then
    raise exception 'cannot change calculated amounts after finalize (id=%, status=%)', OLD.id, OLD.status using errcode = '42501';
  end if;

  if OLD.status <> 'pending'
     and NEW.carried_over_amount is distinct from OLD.carried_over_amount
     and not v_manual_carryover_just_set
  then
    raise exception 'cannot change carried_over_amount after finalize (id=%, status=%)', OLD.id, OLD.status using errcode = '42501';
  end if;

  return NEW;
end;
$$;

-- ===== 3) settlement_admin_audit_logs =====
create table if not exists public.settlement_admin_audit_logs (
  id bigserial primary key,
  settlement_id uuid not null references public.artist_settlements(id) on delete restrict,
  artist_id uuid not null references public.users(id),
  action text not null,
  amount bigint,
  from_month date,
  to_month date,
  admin_user_id uuid references public.users(id),
  reason text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint settlement_admin_audit_logs_action_check check (
    action in ('manual_carryover','finalize','mark_paid','mark_held','reveal_pii','undo_carryover')
  )
);

create index if not exists settlement_admin_audit_logs_settlement_idx
  on public.settlement_admin_audit_logs (settlement_id);
create index if not exists settlement_admin_audit_logs_artist_idx
  on public.settlement_admin_audit_logs (artist_id, created_at desc);
create index if not exists settlement_admin_audit_logs_created_idx
  on public.settlement_admin_audit_logs (created_at desc);

alter table public.settlement_admin_audit_logs enable row level security;

drop policy if exists settlement_admin_audit_logs_admin_read on public.settlement_admin_audit_logs;
create policy settlement_admin_audit_logs_admin_read on public.settlement_admin_audit_logs
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
-- write only via SECURITY DEFINER RPC

create or replace function public._settlement_admin_audit_logs_protect()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'UPDATE' then
    raise exception 'settlement_admin_audit_logs is append-only' using errcode = '42501';
  end if;
  if TG_OP = 'DELETE' then
    raise exception 'settlement_admin_audit_logs cannot be deleted' using errcode = '42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists settlement_admin_audit_logs_protect on public.settlement_admin_audit_logs;
create trigger settlement_admin_audit_logs_protect
before update or delete on public.settlement_admin_audit_logs
for each row execute function public._settlement_admin_audit_logs_protect();
