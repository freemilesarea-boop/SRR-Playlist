-- 0321 — 환불/취소 시 정산 영향 audit + 사후 정정 ledger (X6.34)
--
-- 문제:
--   _internal_apply_payapp_refund_event 가 결제/구독/membership_tier 만
--   처리. 이미 정산 generate 가 끝났으면 platform_revenue / 풀 분배가
--   환불 전 기준으로 남아있음. 정산 status='paid' 인 row 의 아티스트는
--   이미 송금받음 — 자동 회수 불가, 사후 정정 필요.
--
-- 설계 (안전한 점진적 접근):
--   1) settlement_adjustments ledger 신규
--      - admin 이 음수/양수 entry 생성 (운영자 수동 정정)
--      - generate 가 prev_carried 합산 시 미적용(applied=false) 만 흡수
--      - 적용 후 applied=true 마킹 (X6.28 carryover_applied 패턴 동일)
--   2) _internal_apply_payapp_refund_event 가 영향 정산 자동 식별
--      - 환불된 payment_orders.paid_at 의 settlement_month 계산
--      - 해당 (artist, month) 정산 status 별로 분기:
--          paid                 → 즉시 자동 adjustment 생성 (-amount 음수)
--          pending/held/payable → audit log 만 (다음 generate 가 정정)
--          carried_over         → audit log + adjustment 옵션
--   3) audit log action 확장: 'payment_refunded' / 'adjustment_created'
--      - settlement_admin_audit_logs.settlement_id nullable 화
--        (정산이 아직 없는 사후 adjustment 도 audit 가능)
--
-- 보존:
--   기존 환불 흐름 (membership_tier='free', subscription canceled) 그대로.
--   기존 generate 의 prev_carried SUM (X6.28) 동작 그대로 + adjustment 추가.

-- ===== 1) settlement_adjustments ledger =====
create table if not exists public.settlement_adjustments (
  id bigserial primary key,
  artist_user_id uuid not null references public.users(id),
  apply_to_month date not null,         -- 이 정산월의 row 에 반영
  amount bigint not null,                -- 양수=추가, 음수=차감
  reason text not null,
  source_payment_order_id uuid references public.payment_orders(id),
  source_settlement_id uuid references public.artist_settlements(id),
  applied boolean not null default false, -- generate 시 소비됐는지
  applied_to_settlement_id uuid references public.artist_settlements(id),
  applied_at timestamptz,
  created_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  constraint settlement_adjustments_amount_check check (amount <> 0),
  constraint settlement_adjustments_reason_check check (length(btrim(reason)) > 0)
);

create index if not exists settlement_adjustments_artist_month_idx
  on public.settlement_adjustments (artist_user_id, apply_to_month)
  where applied = false;
create index if not exists settlement_adjustments_source_payment_idx
  on public.settlement_adjustments (source_payment_order_id)
  where source_payment_order_id is not null;
create index if not exists settlement_adjustments_created_idx
  on public.settlement_adjustments (created_at desc);

alter table public.settlement_adjustments enable row level security;
drop policy if exists settlement_adjustments_admin_read on public.settlement_adjustments;
create policy settlement_adjustments_admin_read on public.settlement_adjustments
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- write only via SECURITY DEFINER RPC (직접 INSERT/UPDATE 차단)
create or replace function public._settlement_adjustments_protect()
returns trigger language plpgsql set search_path = public as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'settlement_adjustments cannot be deleted (audit ledger)' using errcode='42501';
  end if;
  -- UPDATE 는 applied / applied_to_settlement_id / applied_at 만 허용
  if TG_OP = 'UPDATE' then
    if NEW.artist_user_id is distinct from OLD.artist_user_id
       or NEW.apply_to_month is distinct from OLD.apply_to_month
       or NEW.amount is distinct from OLD.amount
       or NEW.reason is distinct from OLD.reason
       or NEW.source_payment_order_id is distinct from OLD.source_payment_order_id
       or NEW.source_settlement_id is distinct from OLD.source_settlement_id
       or NEW.created_by is distinct from OLD.created_by
       or NEW.created_at is distinct from OLD.created_at
    then
      raise exception 'settlement_adjustments core fields are immutable' using errcode='42501';
    end if;
  end if;
  return NEW;
end; $$;

drop trigger if exists settlement_adjustments_protect on public.settlement_adjustments;
create trigger settlement_adjustments_protect
before update or delete on public.settlement_adjustments
for each row execute function public._settlement_adjustments_protect();

-- ===== 2) audit log 확장 =====
alter table public.settlement_admin_audit_logs
  alter column settlement_id drop not null;

alter table public.settlement_admin_audit_logs
  drop constraint if exists settlement_admin_audit_logs_action_check;
alter table public.settlement_admin_audit_logs
  add constraint settlement_admin_audit_logs_action_check check (
    action in ('manual_carryover','finalize','mark_paid','mark_held',
               'reveal_pii','undo_carryover',
               'payment_refunded','adjustment_created','adjustment_applied')
  );
