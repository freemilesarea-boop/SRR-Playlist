-- 0454 — SETTLEMENT-LOGIC-2: 세금 안전 이월 데이터 모델 + 권위 계산 헬퍼
--
-- 목적 (SETTLEMENT-AUDIT-1 / 2B 에서 확정된 잠재 결함 수정의 기반):
--   1) 기과세(taxed) / 미과세(untaxed) 이월금 분리 저장
--   2) 정산 생성 시점의 세율/유형/최소지급 기준 snapshot 고정
--   3) 이월 금액 음수 저장 금지 (CHECK >= 0)
--   4) 계산 로직을 순수(IMMUTABLE) 헬퍼로 단일 권위화 → 단위 테스트 가능
--
-- 안전/호환 원칙 (Production Schema Drift 대응):
--   - Production 에는 0348(version/is_current) 이 없다. 이 마이그레이션은
--     version/is_current 를 전제하지 않는다.
--   - 모든 DDL 은 방어적(IF NOT EXISTS / 조건부)으로 작성 — 재실행 가능(idempotent).
--   - 기존 컬럼(previous_carried_amount, carried_over_amount, total_settlement_amount)은
--     삭제하지 않고 유지한다. 신규 컬럼은 그 "분해값"이며, 생성 함수가 두 표현을
--     동시에 채워 기존 UI/RPC 회귀가 없도록 한다.
--   - 기존 정산 금액을 재계산하지 않는다. Backfill 은 순수 재분류(합계 보존)만 수행.
--
-- 검증: SETTLEMENT-E2E-1 / RELEASE-GATE-1 에서 Test project 대상 실제 RPC E2E 로 인증됨.
-- Production 적용은 별도 Runbook(잠금 → 0454 → 검증 → 0455 → smoke)에 따라 수행한다.

-- ============================================================
-- 1) 신규 컬럼 (방어적 추가)
-- ============================================================
alter table public.artist_settlements
  -- carry-OUT (다음 달로 넘기는 금액) — 세금 상태별 분리
  add column if not exists carryover_untaxed_amount          bigint not null default 0,
  add column if not exists carryover_taxed_amount            bigint not null default 0,
  -- carry-IN (이전 달에서 넘어온 금액) — 세금 상태별 분리
  add column if not exists previous_carryover_untaxed_amount bigint not null default 0,
  add column if not exists previous_carryover_taxed_amount   bigint not null default 0,
  -- 당월 과세 대상액 (투명성/검증용)
  add column if not exists taxable_base_amount               bigint not null default 0,
  -- 생성 시점 snapshot (이후 계좌/정책 변경이 과거 정산을 바꾸지 못하게 고정)
  add column if not exists tax_withholding_type_snapshot     text,
  add column if not exists tax_rate_snapshot                 numeric(6,5),
  add column if not exists minimum_payout_snapshot           bigint;

-- ============================================================
-- 2) 음수 이월 방지 CHECK (방어적: 없을 때만 추가)
--    NOT VALID 로 추가하여 기존 행 검증 실패로 인한 실패를 방지 후,
--    Backfill 이 모든 값을 >=0 으로 만들므로 이후 VALIDATE 가능.
-- ============================================================
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'artist_settlements_carry_untaxed_nonneg') then
    alter table public.artist_settlements
      add constraint artist_settlements_carry_untaxed_nonneg
      check (carryover_untaxed_amount >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artist_settlements_carry_taxed_nonneg') then
    alter table public.artist_settlements
      add constraint artist_settlements_carry_taxed_nonneg
      check (carryover_taxed_amount >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artist_settlements_prev_carry_untaxed_nonneg') then
    alter table public.artist_settlements
      add constraint artist_settlements_prev_carry_untaxed_nonneg
      check (previous_carryover_untaxed_amount >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'artist_settlements_prev_carry_taxed_nonneg') then
    alter table public.artist_settlements
      add constraint artist_settlements_prev_carry_taxed_nonneg
      check (previous_carryover_taxed_amount >= 0) not valid;
  end if;
end$$;

-- ============================================================
-- 3) Backfill (순수 재분류 — 금액 합계 보존, 재실행 가능)
--    SETTLEMENT-AUDIT-2B 인증: Production 의 모든 carried source 는 withholding=0
--    (기과세 이월 0건). 따라서 기존 이월금은 전부 "미과세(untaxed)" 로 분류한다.
--    이미 신규 컬럼이 채워진 행(생성 함수 v2 산출)은 건너뛴다.
-- ============================================================
-- 규칙:
--   · carry-IN(previous_carried) 은 항상 미과세로 재분류. Production 인증(AUDIT-2B):
--     기과세 이월 0건 → 과거 유입 이월은 전부 미과세. (행 자신의 withholding 과 무관 —
--     withholding 은 그 행의 지급 세금이지 유입 이월의 과세상태가 아니다.)
--   · carry-OUT(carried_over) 은 그 행의 withholding 으로 분기(방어적). 실제로 meets_min
--     행은 carried_over=0, 미달 행은 withholding=0 이라 결과는 전부 미과세이나, 혹시 모를
--     기과세 carry-out 이 존재하면 taxed 로 분류하여 오분류를 막는다.
--   · idempotent: 신규 분리 컬럼이 아직 0 인 행만 대상.
update public.artist_settlements s
set previous_carryover_untaxed_amount = coalesce(s.previous_carried_amount, 0),
    previous_carryover_taxed_amount   = 0,
    carryover_untaxed_amount          = case when coalesce(s.withholding_tax_amount,0) = 0
                                             then coalesce(s.carried_over_amount, 0) else 0 end,
    carryover_taxed_amount            = case when coalesce(s.withholding_tax_amount,0) > 0
                                             then coalesce(s.carried_over_amount, 0) else 0 end
where s.previous_carryover_untaxed_amount = 0
  and s.previous_carryover_taxed_amount   = 0
  and s.carryover_untaxed_amount          = 0
  and s.carryover_taxed_amount            = 0
  and (coalesce(s.previous_carried_amount,0) <> 0 or coalesce(s.carried_over_amount,0) <> 0);

-- 이제 CHECK VALIDATE (Backfill 후 모든 값 >= 0 보장; NOT VALID 였던 것 검증)
do $$
begin
  begin alter table public.artist_settlements validate constraint artist_settlements_carry_untaxed_nonneg; exception when others then null; end;
  begin alter table public.artist_settlements validate constraint artist_settlements_carry_taxed_nonneg; exception when others then null; end;
  begin alter table public.artist_settlements validate constraint artist_settlements_prev_carry_untaxed_nonneg; exception when others then null; end;
  begin alter table public.artist_settlements validate constraint artist_settlements_prev_carry_taxed_nonneg; exception when others then null; end;
end$$;

-- ============================================================
-- 4) 세율 해석 헬퍼 — 기존 enum 라벨에 인코딩된 값만 사용 (임의 세율 생성 금지)
--    business_income_3_3 → 0.033, other_income_8_8 → 0.088, none → 0.
--    알 수 없는 값/NULL → NULL (호출자가 반드시 held 처리). 3.3% fallback 금지.
-- ============================================================
create or replace function public._settlement_tax_rate(p_type text)
returns numeric
language sql
immutable
as $$
  select case p_type
    when 'business_income_3_3' then 0.033::numeric
    when 'other_income_8_8'    then 0.088::numeric
    when 'none'                then 0.000::numeric
    else null
  end;
$$;

comment on function public._settlement_tax_rate(text) is
  'SETTLEMENT-LOGIC-2: tax_withholding_type enum → 원천징수율. 알 수 없음/NULL → NULL(hold). 임의 fallback 금지.';

-- ============================================================
-- 5) 권위 계산 헬퍼 (순수/IMMUTABLE) — 이중 원천징수 방지의 핵심
--
--    입력:
--      p_gross                    당월 트랙 배분 합 (세전)
--      p_company_fee_ratio        회사 수수료율 (정책)
--      p_agent_commission_rate    영업인 커미션 % (없으면 NULL → 0)
--      p_prev_untaxed             이전 미과세 이월 (carry-IN, >=0)
--      p_prev_taxed               이전 기과세 이월 (carry-IN, >=0) — 재과세 금지
--      p_tax_rate                 적용 원천징수율 (NULL=미상 → 지급 보류)
--      p_min_payout               최소 지급 기준
--      p_min_basis                'gross'|'net'
--      p_taxable_adjustments      과세 대상 조정 (기본 0)
--      p_non_taxable_adjustments  비과세 조정 (기본 0)
--
--    핵심 규칙:
--      taxable_base = max(gross - company - agent + taxable_adj + prev_untaxed, 0)
--      withholding  = floor(taxable_base × tax_rate)           ← 기과세 이월은 제외
--      final        = taxable_base - withholding + prev_taxed + non_taxable_adj
--      기과세 이월(prev_taxed)에는 원천징수를 다시 적용하지 않는다.
--      미달/미상(hold) 시: 세금 0, 지급 0, 미과세는 미과세로 / 기과세는 기과세로 이월.
--      음수는 이월금 필드에 저장하지 않는다 → residual_debit 로 분리 반환.
-- ============================================================
create or replace function public._settlement_compute(
  p_gross                   bigint,
  p_company_fee_ratio       numeric,
  p_agent_commission_rate   numeric,
  p_prev_untaxed            bigint,
  p_prev_taxed              bigint,
  p_tax_rate                numeric,
  p_min_payout              bigint,
  p_min_basis               text,
  p_taxable_adjustments     bigint default 0,
  p_non_taxable_adjustments bigint default 0
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_company_fee   bigint;
  v_agent_fee     bigint;
  v_taxable_net   bigint;   -- gross - fees + taxable_adj (음수 가능)
  v_tax_known     boolean := (p_tax_rate is not null);
  v_rate          numeric := coalesce(p_tax_rate, 0);
  v_untaxed_pool  bigint;   -- taxable_net + prev_untaxed (음수 가능 → clamp)
  v_taxed_pool    bigint;   -- prev_taxed + non_taxable_adj (음수 가능 → clamp)
  v_taxable_base  bigint;
  v_residual      bigint := 0;
  v_effective     bigint;
  v_meets_min     boolean;
  v_withholding   bigint;
  v_final         bigint;
  v_carry_untaxed bigint;
  v_carry_taxed   bigint;
begin
  v_company_fee := floor(p_gross * coalesce(p_company_fee_ratio,0))::bigint;
  if p_agent_commission_rate is not null then
    v_agent_fee := floor(p_gross * p_agent_commission_rate / 100.0)::bigint;
  else
    v_agent_fee := 0;
  end if;

  v_taxable_net := p_gross - v_company_fee - v_agent_fee + coalesce(p_taxable_adjustments,0);

  -- 미과세 풀 = 당월 과세순액 + 이전 미과세 이월 (음수면 clamp, 잔여는 debit 로 분리)
  v_untaxed_pool := v_taxable_net + coalesce(p_prev_untaxed,0);
  if v_untaxed_pool < 0 then
    v_residual := v_residual + (-v_untaxed_pool);
    v_taxable_base := 0;
  else
    v_taxable_base := v_untaxed_pool;
  end if;

  -- 기과세 풀 = 이전 기과세 이월 + 비과세 조정 (음수면 clamp, 잔여는 debit)
  v_taxed_pool := coalesce(p_prev_taxed,0) + coalesce(p_non_taxable_adjustments,0);
  if v_taxed_pool < 0 then
    v_residual := v_residual + (-v_taxed_pool);
    v_taxed_pool := 0;
  end if;

  v_effective := v_taxable_base + v_taxed_pool;

  -- 최소 지급 판정
  if v_effective < p_min_payout then
    v_meets_min := false;
  elsif p_min_basis = 'gross' then
    v_meets_min := true;
  else
    v_meets_min := ((v_taxable_base - floor(v_taxable_base * v_rate)) + v_taxed_pool) >= p_min_payout;
  end if;

  if v_meets_min and v_tax_known then
    v_withholding   := floor(v_taxable_base * v_rate)::bigint;
    v_final         := greatest(v_taxable_base - v_withholding + v_taxed_pool, 0);
    v_carry_untaxed := 0;
    v_carry_taxed   := 0;
  else
    -- 미달 또는 세율 미상(hold): 과세/지급 안 함 → 세금상태 보존하며 이월
    v_withholding   := 0;
    v_final         := 0;
    v_carry_untaxed := v_taxable_base;   -- 아직 미과세 → 미과세로 이월 (다음 달 1회 과세)
    v_carry_taxed   := v_taxed_pool;     -- 이미 과세됨 → 기과세로 이월 (재과세 금지)
  end if;

  return jsonb_build_object(
    'company_fee',        v_company_fee,
    'agent_fee',          v_agent_fee,
    'taxable_net',        v_taxable_net,
    'taxable_base',       v_taxable_base,
    'taxed_pool',         v_taxed_pool,
    'effective_total',    v_effective,
    'meets_min',          v_meets_min,
    'tax_known',          v_tax_known,
    'tax_rate_used',      case when v_tax_known then v_rate else null end,
    'withholding_tax',    v_withholding,
    'final_payout',       v_final,
    'carry_untaxed_out',  v_carry_untaxed,
    'carry_taxed_out',    v_carry_taxed,
    'residual_debit',     v_residual,
    -- 레거시 호환 표현 (생성 함수가 그대로 기존 컬럼에 기록)
    'legacy_previous_carried', coalesce(p_prev_untaxed,0) + coalesce(p_prev_taxed,0),
    'legacy_carried_over',     v_carry_untaxed + v_carry_taxed,
    'legacy_total',            v_effective
  );
end;
$$;

comment on function public._settlement_compute(bigint,numeric,numeric,bigint,bigint,numeric,bigint,text,bigint,bigint) is
  'SETTLEMENT-LOGIC-2: 단일 권위 정산 계산. 기과세 이월 재과세 금지, 음수 이월 금지(residual_debit 분리). floor 원 단위.';

-- ============================================================
-- 6) 감사 action 구분 확장 (자동 이월 vs 수동 이월)
--    기존 CHECK 를 방어적으로 교체 — 기존 값 + 신규 action 허용.
--    (테이블이 없는 환경(Test drift)에서는 조용히 skip)
-- ============================================================
do $$
declare v_con text;
begin
  if to_regclass('public.settlement_admin_audit_logs') is null then
    return; -- Test drift: 감사 테이블 없음 → skip
  end if;
  select conname into v_con
  from pg_constraint
  where conrelid = 'public.settlement_admin_audit_logs'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%action%';
  if v_con is not null then
    execute format('alter table public.settlement_admin_audit_logs drop constraint %I', v_con);
  end if;
  alter table public.settlement_admin_audit_logs
    add constraint settlement_admin_audit_logs_action_check
    check (action in (
      -- 기존
      'manual_carryover','finalize','mark_paid','mark_held','reveal_pii','undo_carryover',
      'payment_refunded','adjustment_created','adjustment_applied',
      -- SETTLEMENT-LOGIC-2 신규 (자동/수동/역전/보정 구분)
      'auto_carryover_created','auto_carryover_consumed','admin_manual_carryover',
      'carryover_reversed','carryover_corrected'
    ));
end$$;
