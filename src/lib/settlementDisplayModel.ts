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
  // UX-2B — 화면 공용 파생값 (컴포넌트가 자체 분기하지 않도록)
  historicalCalculatedPayoutAmount: number;
  effectivePaidAmount: number;
  effectiveRemainingAmount: number;
  effectiveNextCarryoverAmount: number;
  displayAmountKind: DisplayAmountKind;
  statusLabel: string;
  statusDescription: string;
  requiredAction: RequiredAction;
}

export type DisplayAmountKind = 'payable' | 'paid' | 'held' | 'auto_carryover' | 'manual_carryover' | 'zero';
export type RequiredAction = 'none' | 'pay' | 'verify_identity' | 'verify_account' | 'set_tax' | 'review_carryover';

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
  const totalNextCarryover = effectiveNextUntaxed + effectiveNextTaxed;

  // 파생 표시값
  const displayAmountKind: DisplayAmountKind = isPaid
    ? 'paid'
    : isHeld
      ? 'held'
      : isCarried
        ? (row.is_manual_carryover ? 'manual_carryover' : 'auto_carryover')
        : effectivePayable > 0
          ? 'payable'
          : 'zero';

  const statusLabel =
    isPaid ? '지급 완료'
    : isPayable ? '지급 가능'
    : isHeld ? holdReasonToStatusLabel(row.held_reason)
    : isCarried ? (row.is_manual_carryover ? '수동 이월' : '자동 이월')
    : (status === 'pending' && meetsMin) ? '지급 가능'
    : status === 'pending' ? '기준 미달'
    : status === 'disputed' ? '분쟁'
    : '확인 필요';

  const requiredAction: RequiredAction =
    isPaid ? 'none'
    : isHeld ? holdReasonToAction(row.held_reason)
    : isCarried ? 'review_carryover'
    : (isPayable || (status === 'pending' && meetsMin)) ? 'pay'
    : 'none';

  const statusDescription = humanizeHoldReason(row.held_reason)
    ?? (isPaid ? '지급이 완료되었습니다.'
      : isCarried ? '다음 달 정산에 합산됩니다.'
      : (isPayable || (status === 'pending' && meetsMin)) ? '지급 처리 가능합니다.'
      : status === 'pending' ? '최소 지급 기준에 도달하지 않았습니다.'
      : '');

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
    historicalCalculatedPayoutAmount: calculatedFinal,
    effectivePaidAmount: paidAmount,
    effectiveRemainingAmount: remainingUnpaid,
    effectiveNextCarryoverAmount: totalNextCarryover,
    displayAmountKind,
    statusLabel,
    statusDescription,
    requiredAction,
  };
}

function holdReasonToStatusLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'pii_incomplete': return '정산정보 입력 필요';
    case 'account_missing': return '계좌 등록 필요';
    case 'account_unverified': return '계좌 확인 필요';
    case 'tax_type_unknown': return '세율 확인 필요';
    case 'minimum_not_met': return '기준 미달';
    default: return '지급 보류';
  }
}

function holdReasonToAction(reason: string | null | undefined): RequiredAction {
  switch (reason) {
    case 'pii_incomplete': return 'verify_identity';
    case 'account_missing':
    case 'account_unverified': return 'verify_account';
    case 'tax_type_unknown': return 'set_tax';
    default: return 'none';
  }
}

/** 필요 조치 라벨 (관리자). */
export function requiredActionLabel(action: RequiredAction): string {
  const map: Record<RequiredAction, string> = {
    none: '없음',
    pay: '지급 처리',
    verify_identity: '정산정보 확인',
    verify_account: '계좌 확인',
    set_tax: '세율 설정',
    review_carryover: '이월 내역 확인',
  };
  return map[action];
}

export interface SettlementSummary {
  count: number;
  totalCurrentNet: number;
  totalPreviousCarryover: number;
  totalWithholding: number;
  totalEffectivePayable: number;   // sum(effectivePayableAmount) — 중복 없음
  totalPaid: number;               // sum(effectivePaidAmount)
  totalRemainingUnpaid: number;
  totalNextCarryover: number;      // sum(effectiveNextCarryoverAmount)
  heldCount: number;
  identityIncompleteCount: number;
  accountIncompleteCount: number;
  taxReviewCount: number;
}

/**
 * 목록/필터 데이터셋의 status-aware 합계. 동일 금액을 지급/이월에 중복 포함하지 않는다.
 * (effectivePayable 과 effectiveNextCarryover 는 상태별로 상호배타적이므로 겹치지 않음.)
 */
export function summarizeSettlements(rows: AdminSettlementRow[]): SettlementSummary {
  const models = rows.map(buildSettlementDisplayModel);
  const sum = (f: (m: SettlementDisplayModel) => number) => models.reduce((a, m) => a + f(m), 0);
  return {
    count: models.length,
    totalCurrentNet: sum((m) => m.currentNetAmount),
    totalPreviousCarryover: sum((m) => m.totalPreviousCarryoverAmount),
    totalWithholding: sum((m) => m.withholdingTaxAmount),
    totalEffectivePayable: sum((m) => m.effectivePayableAmount),
    totalPaid: sum((m) => m.effectivePaidAmount),
    totalRemainingUnpaid: sum((m) => m.effectiveRemainingAmount),
    totalNextCarryover: sum((m) => m.effectiveNextCarryoverAmount),
    heldCount: models.filter((m) => m.isHeld).length,
    identityIncompleteCount: models.filter((m) => m.requiredAction === 'verify_identity').length,
    accountIncompleteCount: models.filter((m) => m.requiredAction === 'verify_account').length,
    taxReviewCount: models.filter((m) => m.requiredAction === 'set_tax').length,
  };
}

const CSV_HEADERS = [
  '정산월', '회원 ID', '회원명', '아티스트명', '당월 총 발생액', '회사 수수료', '영업 수수료',
  '당월 순정산액', '이전 미과세 이월', '이전 기과세 이월', '과세 대상액', '세율 유형', '적용 세율',
  '원천징수액', '계산된 최종 금액', '현재 지급 가능액', '지급 완료액', '잔여 미지급액',
  '다음 미과세 이월', '다음 기과세 이월', '현재 상태', '보류 사유', '지급 완료일',
];

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** SettlementDisplayModel 기반 CSV. 화면 합계와 반드시 일치. 민감정보(계좌/주민번호) 미포함. */
export function settlementRowsToCsv(rows: AdminSettlementRow[]): string {
  const lines = [CSV_HEADERS.map(csvCell).join(',')];
  for (const row of rows) {
    const m = buildSettlementDisplayModel(row);
    lines.push([
      row.settlement_month?.slice(0, 7) ?? '',
      row.artist_user_id ?? '',
      row.artist_nickname ?? '',
      (row as { artist_name?: string }).artist_name ?? '',
      m.currentGrossAmount, m.companyFeeAmount, m.salesAgentFeeAmount, m.currentNetAmount,
      m.previousUntaxedCarryoverAmount, m.previousTaxedCarryoverAmount, m.taxableBaseAmount,
      m.taxType ?? '', m.taxRate != null ? m.taxRate : '',
      m.withholdingTaxAmount, m.historicalCalculatedPayoutAmount,
      m.effectivePayableAmount, m.effectivePaidAmount, m.effectiveRemainingAmount,
      m.nextUntaxedCarryoverAmount, m.nextTaxedCarryoverAmount,
      m.statusLabel, humanizeHoldReason(m.holdReason) ?? '', row.paid_at?.slice(0, 10) ?? '',
    ].map(csvCell).join(','));
  }
  return lines.join('\n');
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
