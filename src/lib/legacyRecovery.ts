// Phase LEGACY-BILLING-RECOVERY-BUILD-NOTIFY-1 — Legacy 단일 주기 복구 순수 로직.
//
// Scheduler 누락으로 미청구된 기존 고객을 "고객당 1회, 서버 플랜가(4,900원)만"
// 복구 결제하기 위한 판정/멱등/일정/문구 로직. DOM/네트워크/Deno 비의존.
// 실제 청구·발송은 별도 Kill Switch(fail-closed) + 운영자 승인 이후에만 발생한다.

import { resolvePlanAmount, resolveKillSwitch, maskEmail } from './billingRebill';
import { DEMO_PREMIUM_ACCOUNT_IDS } from './membership';

export const LEGACY_RECOVERY_OP = 'legacy_single_cycle_recovery' as const;
export const LEGACY_RECOVERY_PROVIDER = 'payapp' as const;

export type LegacyRecoveryClass =
  | 'RECOVERY_CHARGE_ELIGIBLE'
  | 'PAYMENT_METHOD_REQUIRED'
  | 'EXCLUDED'
  | 'OTHER';

export type RecoveryTemplateType = 'auto_recharge' | 'payment_method_required';

export interface LegacyRecoveryInput {
  subscriptionId: string;
  userId: string;
  role: string;
  membershipTier: string;
  status: string;
  autoRenew: boolean;
  rebillNo: string | null;
  currentPeriodEnd: string | null;
  amount: number | null;
  planType: string;
  cancelRequestedAt: string | null;
  priorAttempts: number;
  priorRecoveryOrders: number;
}

export interface LegacyRecoveryResult {
  classification: LegacyRecoveryClass;
  chargeable: boolean;
  reason: string;
}

/**
 * 대상 분류. 각 subscription 은 정확히 하나의 분류에 속한다.
 * RECOVERY_CHARGE_ELIGIBLE 만 실제 복구 결제 가능(그마저도 Kill Switch/승인 필요).
 */
export function classifyLegacyRecoveryTarget(
  c: LegacyRecoveryInput,
  cutoverTsIso: string,
  nowIso: string,
): LegacyRecoveryResult {
  const excluded = (reason: string): LegacyRecoveryResult => ({ classification: 'EXCLUDED', chargeable: false, reason });
  const pmr = (reason: string): LegacyRecoveryResult => ({ classification: 'PAYMENT_METHOD_REQUIRED', chargeable: false, reason });

  // 절대 청구·발송 금지: 관리자/데모/무료/비활성/취소/이미 복구 처리됨.
  if (c.status !== 'active') return excluded('not_active');
  if (c.cancelRequestedAt) return excluded('cancel_requested');
  if (c.role === 'admin') return excluded('admin_account');
  if (c.membershipTier === 'free') return excluded('free_account');
  if (DEMO_PREMIUM_ACCOUNT_IDS.has(c.userId)) return excluded('demo_account');
  if (c.priorAttempts > 0) return excluded('recovery_attempt_exists');
  if (c.priorRecoveryOrders > 0) return excluded('recovery_order_exists');

  // 결제수단 재등록 필요: rebill_no 없음 / 금액 불일치 / 플랜 이상.
  if (!c.rebillNo || c.rebillNo.trim().length === 0) return pmr('missing_rebill_no');
  const planPrice = resolvePlanAmount(c.planType);
  if (planPrice === null) return pmr('unknown_plan');
  if (c.amount !== planPrice) return pmr('amount_mismatch');

  if (!c.currentPeriodEnd) return excluded('no_period_end');
  const now = Date.parse(nowIso);
  const cutover = Date.parse(cutoverTsIso);
  const periodEnd = Date.parse(c.currentPeriodEnd);
  if (Number.isNaN(periodEnd)) return excluded('no_period_end');

  if (periodEnd >= now) return { classification: 'OTHER', chargeable: false, reason: 'not_due' };
  if (!c.autoRenew) return pmr('auto_renew_off');

  // Legacy(과거 누락) + 유효 → 복구 결제 가능(단일 주기).
  if (periodEnd < cutover) {
    return { classification: 'RECOVERY_CHARGE_ELIGIBLE', chargeable: true, reason: 'legacy_recoverable' };
  }
  // cutover 이후 도래분은 이 Phase 대상 아님(미래 Scheduler 소관).
  return { classification: 'OTHER', chargeable: false, reason: 'not_legacy' };
}

export function isRecoveryChargeable(cls: LegacyRecoveryClass): boolean {
  return cls === 'RECOVERY_CHARGE_ELIGIBLE';
}

/** 복구 결제 금액 — 서버 플랜 가격만. 요청 Body 금액 미사용. 과거 개월 합산 금지. */
export function recoveryChargeAmount(planType: string): number | null {
  return resolvePlanAmount(planType);
}

/** 복구 전용 멱등키. (provider, op, subscription, recovery_cutover_date). */
export function recoveryCycleKey(
  subscriptionId: string,
  recoveryCutoverDate: string,
): string {
  return `${LEGACY_RECOVERY_PROVIDER}:${LEGACY_RECOVERY_OP}:${subscriptionId}:${recoveryCutoverDate}`;
}

/** Legacy 복구 전용 Kill Switch(미래 Scheduler 스위치와 분리). fail-closed. */
export function resolveLegacyRecoveryKillSwitch(raw: string | undefined | null): boolean {
  return resolveKillSwitch(raw);
}

/**
 * 결제 예정일 = 안내 발송 시점 기준 최소 24시간 이후의 첫 15:00 KST(=06:00 UTC).
 * 고객이 결제 전 해지할 수 있는 충분한 시간을 보장한다.
 */
export function computeScheduledChargeAt(sendTimeIso: string): string {
  const send = new Date(sendTimeIso);
  if (Number.isNaN(send.getTime())) throw new Error('invalid send time');
  const min = new Date(send.getTime() + 24 * 3600_000);
  // 15:00 KST == 06:00 UTC
  let cand = new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), min.getUTCDate(), 6, 0, 0, 0));
  if (cand.getTime() < min.getTime()) cand = new Date(cand.getTime() + 24 * 3600_000);
  return cand.toISOString();
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

/** "YYYY년 MM월 DD일 HH시 이후" (KST). 확정 절대일시만 문구에 삽입. */
export function formatKstChargeNotice(scheduledIso: string): string {
  const d = new Date(scheduledIso);
  if (Number.isNaN(d.getTime())) throw new Error('invalid scheduled time');
  const k = new Date(d.getTime() + 9 * 3600_000);
  return `${k.getUTCFullYear()}년 ${pad2(k.getUTCMonth() + 1)}월 ${pad2(k.getUTCDate())}일 ${pad2(k.getUTCHours())}시 이후`;
}

export function recoveryNoticeSubject(t: RecoveryTemplateType): string {
  return t === 'auto_recharge' ? '[듣다] 정기결제 재개 안내' : '[듣다] 결제수단 재등록 요청';
}

/** 안내 본문(텍스트). HTML 래핑은 Edge Function 에서. 개인정보 미포함. */
export function recoveryNoticeBody(t: RecoveryTemplateType, opts: { manageUrl: string; scheduledNotice?: string; amount?: number }): string {
  if (t === 'auto_recharge') {
    return [
      '안녕하세요, 듣다입니다.',
      '',
      '시스템 오류로 회원님의 정기결제가 정상적으로 처리되지 않은 사실을 확인했습니다.',
      '누락된 과거 이용료를 여러 번 청구하지 않으며,',
      `현재 이용을 계속하기 위한 1개월 이용료 ${opts.amount ?? 4900}원만`,
      '기존에 등록하신 결제수단으로 결제할 예정입니다.',
      '',
      `결제 예정일: ${opts.scheduledNotice ?? ''}`,
      '',
      '결제를 원하지 않으시거나 구독 해지를 원하시는 경우,',
      `결제 예정 시각 전까지 듣다 구독 관리 페이지(${opts.manageUrl})에서 해지해 주세요.`,
      '',
      '불편을 드려 죄송합니다.',
      '듣다 드림',
    ].join('\n');
  }
  return [
    '안녕하세요, 듣다입니다.',
    '',
    '등록된 정기결제 정보로 다음 결제를 진행할 수 없어 안내드립니다.',
    '서비스 이용을 계속하시려면 아래 구독 관리 페이지에서',
    '결제수단을 다시 등록해 주세요.',
    '',
    `결제수단 등록: ${opts.manageUrl}`,
    '',
    '결제수단을 등록하기 전에는 자동결제가 진행되지 않습니다.',
    '구독을 원하지 않으시면 별도의 결제를 진행하지 않으셔도 됩니다.',
    '',
    '불편을 드려 죄송합니다.',
    '듣다 드림',
  ].join('\n');
}

export { maskEmail };
