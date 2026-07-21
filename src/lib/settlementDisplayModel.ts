/**
 * settlementDisplayModel.ts — SETTLEMENT-UX-2 권위 표시 View Model.
 *
 * 목적: 관리자 목록/상세/요약카드/CSV/아티스트 화면이 서로 다른 계산식을 만들지 않도록
 *       단일 status-aware 표시 모델을 제공한다. DB/정산 계산 로직은 변경하지 않으며,
 *       이미 계산·저장된 값을 "표시 규칙"에 맞게 해석만 한다.
 *
 * 핵심 안전장치 (SETTLEMENT-RELEASE-GATE-1 지적):
 *   수동 이월된 payable 행은 final_payout_amount(과거 계산, immutable)와
 *   carryover_taxed_amount(현재 이월)가 같은 돈을 두 필드로 표현한다.
 *   → 상태에 따라 "현재 지급 가능액"과 "현재 이월액" 중 하나만 유효하게 계산한다.
 *   두 값을 현재 금액으로 동시에 합산하지 않는다.
 */
import type { AdminSettlementRow, SettlementStatus } from './artistSettlementApi';

export interface SettlementDisplayModel {
  // 당월 신규
  currentGrossAmount: number;
  companyFeeAmount: number;
  salesAgentFeeAmount: number;
  currentNetAmount: number;
  // 이전 이월 (분리 — split 없으면 전액 untaxed 로 degrade)
  previousUntaxedCarryoverAmount: number;
  previousTaxedCarryoverAmount: number;
  totalPreviousCarryoverAmount: number;
  // 과세
  taxableBaseAmount: number;
  withholdingTaxAmount: number;
  taxRate: number | null;
  taxType: string | null;
  // 지급 (status-aware)
  calculatedFinalPayoutAmount: number; // 저장된 계산 최종액 (참고/과거)
  effectivePayableAmount: number;      // 현재 실제 지급 가능액 (중복 방지)
  paidAmount: number;
  remainingUnpaidAmount: number;
  // 다음 달 이월 (split 없으면 carried_over 전액 untaxed 로 degrade)
  nextUntaxedCarryoverAmount: number;
  nextTaxedCarryoverAmount: number;
  totalNextCarryoverAmount: number;
  // 상태
  status: SettlementStatus;
  holdReason: string | null;
  isPayable: boolean;
  isPaid: boolean;
  isCarried: boolean;
  isHeld: boolean;
  isManualCarryover: boolean;
  meetsMinPayout: boolean;
  minimumPayoutAmount: number | null;
}

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 상태·필드로부터 표시 모델을 계산한다. 계산식이 아니라 "표시 해석"이다.
 */
export function buildSettlementDisplayModel(row: AdminSettlementRow): SettlementDisplayModel {
  const status = row.status;
  const isPaid = status === 'paid';
  const isCarried = status === 'carried_over';
  const isHeld = status === 'held';
  const isPayable = status === 'payable';
  const meetsMin = row.meets_min_payout === true;

  // 이전 이월 (split 우선, 없으면 legacy previous_carried 전액 untaxed)
  const hasPrevSplit =
    row.previous_carryover_untaxed_amount != null || row.previous_carryover_taxed_amount != null;
  const prevUntaxed = hasPrevSplit ? n(row.previous_carryover_untaxed_amount) : n(row.previous_carried_amount);
  const prevTaxed = hasPrevSplit ? n(row.previous_carryover_taxed_amount) : 0;

  // 다음 달 이월 (split 우선, 없으면 legacy carried_over 전액 untaxed)
  const hasNextSplit =
    row.carryover_untaxed_amount != null || row.carryover_taxed_amount != null;
  const nextUntaxed = hasNextSplit ? n(row.carryover_untaxed_amount) : n(row.carried_over_amount);
  const nextTaxed = hasNextSplit ? n(row.carryover_taxed_amount) : 0;

  const calculatedFinal = n(row.final_payout_amount);

  // ── status-aware 현재 지급/이월 (중복 방지 핵심) ──
  // 지급 완료/지급 가능/기준 충족 pending → 지급 가능액 유효, 이월 0
  // 이월 완료/미달/보류 → 지급 가능 0 (계산액은 별도 참고), 이월 유효
  const payThrough = isPaid || isPayable || (status === 'pending' && meetsMin);
  // 지급 경로에서는 "다음 달 이월"이 현재 유효값이 아님 (stale final 중복 방지)
  const effectivePayable = payThrough ? calculatedFinal : 0;
  const effectiveNextUntaxed = payThrough ? 0 : nextUntaxed;
  const effectiveNextTaxed = payThrough ? 0 : nextTaxed;

  const paidAmount = isPaid ? calculatedFinal : 0;
  const remainingUnpaid = Math.max(effectivePayable - paidAmount, 0);

  return {
    currentGrossAmount: n(row.gross_settlement_amount),
    companyFeeAmount: n(row.company_fee_amount),
    salesAgentFeeAmount: n(row.sales_agent_fee_amount),
    currentNetAmount: n(row.artist_net_settlement),
    previousUntaxedCarryoverAmount: prevUntaxed,
    previousTaxedCarryoverAmount: prevTaxed,
    totalPreviousCarryoverAmount: prevUntaxed + prevTaxed,
    taxableBaseAmount: row.taxable_base_amount != null ? n(row.taxable_base_amount) : n(row.total_settlement_amount) - prevTaxed,
    withholdingTaxAmount: n(row.withholding_tax_amount),
    taxRate: row.tax_rate_snapshot != null ? n(row.tax_rate_snapshot) : null,
    taxType: row.tax_withholding_type_snapshot ?? row.tax_withholding_type ?? null,
    calculatedFinalPayoutAmount: calculatedFinal,
    effectivePayableAmount: effectivePayable,
    paidAmount,
    remainingUnpaidAmount: remainingUnpaid,
    nextUntaxedCarryoverAmount: effectiveNextUntaxed,
    nextTaxedCarryoverAmount: effectiveNextTaxed,
    totalNextCarryoverAmount: effectiveNextUntaxed + effectiveNextTaxed,
    status,
    holdReason: row.held_reason ?? null,
    isPayable,
    isPaid,
    isCarried,
    isHeld,
    isManualCarryover: row.is_manual_carryover === true,
    meetsMinPayout: meetsMin,
    minimumPayoutAmount: row.minimum_payout_snapshot != null ? n(row.minimum_payout_snapshot) : null,
  };
}

/** 지급 차단/보류 사유 → 사용자 친화 문구 (관리자). */
export function humanizeHoldReason(reason: string | null | undefined): string | null {
  if (!reason) return null;
  const map: Record<string, string> = {
    pii_incomplete: '주민등록번호 또는 정산 동의 정보가 완료되지 않았습니다.',
    account_missing: '지급 계좌가 등록되지 않았습니다.',
    account_unverified: '지급 계좌 확인이 완료되지 않았습니다.',
    tax_type_unknown: '원천징수 유형 확인이 필요합니다.',
    minimum_not_met: '최소 지급 기준에 도달하지 않아 다음 달로 이월됩니다.',
    manual_carryover: '관리자가 다음 달로 수동 이월했습니다.',
    admin_hold: '관리자 확인이 필요한 정산입니다.',
  };
  if (map[reason]) return map[reason];
  if (reason.startsWith('auto_merged_into_')) {
    return `다음 달(${reason.replace('auto_merged_into_', '')}) 정산에 자동 합산되었습니다.`;
  }
  return reason; // 알 수 없는 사유는 원문 (마스킹 불필요한 내부 코드)
}

/** 아티스트 화면용 — 내부 용어(PII 등) 없이 안내. */
export function artistStatusGuidance(model: SettlementDisplayModel): string {
  if (model.isPaid) return '지급 완료되었습니다.';
  if (model.isHeld) {
    switch (model.holdReason) {
      case 'pii_incomplete': return '정산 정보(주민등록번호·동의) 입력이 필요합니다.';
      case 'account_missing': return '지급 계좌 등록이 필요합니다.';
      case 'account_unverified': return '지급 계좌 확인이 필요합니다.';
      case 'tax_type_unknown': return '원천징수 유형 확인이 필요합니다.';
      default: return '지급 준비를 위해 확인이 필요합니다.';
    }
  }
  if (model.isCarried || (!model.meetsMinPayout && !model.isPayable)) {
    return '최소 지급 기준에 도달하지 않아 다음 달로 이월됩니다.';
  }
  if (model.isPayable || model.effectivePayableAmount > 0) return '지급 준비 중입니다.';
  return '정산이 확정되면 안내드립니다.';
}

const TAX_LABEL: Record<string, string> = {
  business_income_3_3: '사업소득 3.3%',
  other_income_8_8: '기타소득 8.8%',
  none: '원천징수 없음',
  policy_default: '정책 기본 원천징수',
};

/** 세율 유형 라벨 + 적용률 표시. */
export function humanizeTaxType(type: string | null | undefined, rate: number | null | undefined): string {
  if (!type) return '—';
  const label = TAX_LABEL[type] ?? type;
  if (rate != null && Number.isFinite(rate)) {
    return `${label} (${(rate * 100).toFixed(1)}%)`;
  }
  return label;
}
