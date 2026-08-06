// Phase BILLING-SCHEDULER-RECOVERY-1 — 정기결제(rebill) 재개 순수 로직.
//
// DOM / 네트워크 / Deno 비의존 순수 모듈. Edge Function
// (supabase/functions/dispatch-subscription-rebill)과 SQL RPC
// (admin_list_rebill_due_v2)의 "청구 대상 판정" 규칙을 테스트 가능한 형태로
// 미러링한 단일 참조 구현이다.
//
// ⚠️ 권위(authoritative) 게이트는 어디까지나
//    (1) SQL RPC 가 반환하는 chargeable 플래그(서버측 재검증)
//    (2) BILLING_REBILL_ENABLED Kill Switch (fail-closed)
//    두 가지다. 이 모듈은 그 규칙을 재현·검증하기 위한 것이며, 이 모듈만으로
//    실제 청구가 일어나지 않는다.

import { DEMO_PREMIUM_ACCOUNT_IDS } from './membership';

export const REBILL_PROVIDER = 'payapp' as const;
export const REBILL_OPERATION = 'rebill' as const;

/**
 * 서버 플랜 가격(원). 요청 Body 의 임의 금액을 신뢰하지 않고, 반드시 이 표를
 * 기준으로 검증/계산한다. subscription_plans 테이블과 동일 값(감사 시점 확인).
 */
export const PLAN_PRICES_KRW: Readonly<Record<string, number>> = {
  individual: 4900,
  artist_student: 4900,
  business: 6900,
  artist_general: 6900,
};

/** 정기결제(재청구) 가능한 membership tier. 그 외(free/admin 등)는 청구 대상 아님. */
export const CHARGEABLE_MEMBERSHIP_TIERS: ReadonlySet<string> = new Set<string>([
  'individual', 'business', 'artist_general', 'artist_student',
]);

export const REBILL_LIMIT_DEFAULT = 20;
export const REBILL_LIMIT_MAX = 100;

/** 청구 대상 분류. FUTURE_DUE 만 실제 청구 가능. */
export type RebillClassification =
  | 'FUTURE_DUE'
  | 'LEGACY_OVERDUE'
  | 'INVALID_REBILL'
  | 'DUPLICATE_BLOCKED';

export type RebillMode = 'future_due' | 'legacy_review';

export interface RebillDispatchRequest {
  dry_run?: boolean;
  limit?: number;
  subscription_ids?: string[];
  execution_id?: string;
  mode?: RebillMode;
}

export interface NormalizedDispatchRequest {
  limit: number;
  subscriptionIds: string[] | null;
  executionId: string;
  mode: RebillMode;
}

export interface RebillCandidateInput {
  subscriptionId: string;
  userId: string;
  planType: string;
  membershipTier: string;
  status: string;
  autoRenew: boolean;
  rebillNo: string | null;
  /** 현재 청구 주기 종료일(= 청구 대상 cycle). ISO 문자열. */
  currentPeriodEnd: string | null;
  /** subscription 에 저장된 금액(원). 서버 플랜 가격과 대조한다. */
  amount: number | null;
  cancelRequestedAt: string | null;
  /** 동일 (subscription, cycle) 에 대해 진행/성공 이력이 이미 있는가. */
  hasExistingCharge: boolean;
}

export interface RebillClassificationResult {
  classification: RebillClassification;
  chargeable: boolean;
  reason: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Kill Switch — fail-closed. 값이 명확히 참("true"/"1", 대소문자 무시)이 아니면
 * 항상 false → 실제 청구 금지. 환경변수 미설정(undefined/null)도 false.
 */
export function resolveKillSwitch(raw: string | undefined | null): boolean {
  if (typeof raw !== 'string') return false;
  const v = raw.trim().toLowerCase();
  return v === 'true' || v === '1';
}

/**
 * 실제 청구 여부 결정. dry_run 기본값은 true.
 *  - Kill Switch 가 꺼져 있으면 요청과 무관하게 항상 dry run(true) 로 강제.
 *  - Kill Switch 가 켜져 있을 때만 dry_run=false 요청이 실청구로 이어질 수 있다.
 */
export function resolveDryRun(
  body: { dry_run?: boolean } | null | undefined,
  killSwitchEnabled: boolean,
): boolean {
  if (!killSwitchEnabled) return true;
  return body?.dry_run !== false;
}

export function resolveMode(raw: unknown): RebillMode {
  return raw === 'legacy_review' ? 'legacy_review' : 'future_due';
}

/**
 * 요청 정규화. limit 는 [1, MAX] 로 clamp, subscription_ids 는 UUID 만 통과,
 * execution_id 는 요청값 또는 호출측이 생성한 fallback 을 사용.
 */
export function normalizeDispatchRequest(
  body: RebillDispatchRequest | null | undefined,
  fallbackExecutionId: string,
): NormalizedDispatchRequest {
  const rawLimit = typeof body?.limit === 'number' && Number.isFinite(body.limit)
    ? Math.floor(body.limit)
    : REBILL_LIMIT_DEFAULT;
  const limit = Math.min(Math.max(1, rawLimit), REBILL_LIMIT_MAX);

  const ids = Array.isArray(body?.subscription_ids)
    ? body.subscription_ids.filter(isValidUuid)
    : null;

  const executionId =
    typeof body?.execution_id === 'string' && body.execution_id.trim().length > 0
      ? body.execution_id.trim().slice(0, 80)
      : fallbackExecutionId;

  return {
    limit,
    subscriptionIds: ids && ids.length > 0 ? ids : null,
    executionId,
    mode: resolveMode(body?.mode),
  };
}

export function resolvePlanAmount(planType: string | null | undefined): number | null {
  if (!planType) return null;
  const p = PLAN_PRICES_KRW[planType];
  return typeof p === 'number' ? p : null;
}

/** 요청/저장 금액이 서버 플랜 가격과 정확히 일치하는지. */
export function isAmountValid(planType: string, amount: number | null | undefined): boolean {
  const expected = resolvePlanAmount(planType);
  return expected !== null && amount === expected && expected > 0;
}

/** 멱등성 키. (provider, operation, subscription, cycle) 조합으로 유일. */
export function rebillCycleKey(
  subscriptionId: string,
  cyclePeriodEndIso: string,
  provider: string = REBILL_PROVIDER,
  operation: string = REBILL_OPERATION,
): string {
  return `${provider}:${operation}:${subscriptionId}:${cyclePeriodEndIso}`;
}

/**
 * 청구 대상 단건 분류. SQL RPC 판정과 동일한 규칙의 참조 구현.
 * cutoverTs 이전에 종료된 주기는 LEGACY_OVERDUE 로 격리(자동 청구 금지).
 */
export function classifyRebillCandidate(
  c: RebillCandidateInput,
  cutoverTsIso: string,
  nowIso: string,
): RebillClassificationResult {
  const invalid = (reason: string): RebillClassificationResult => ({
    classification: 'INVALID_REBILL', chargeable: false, reason,
  });

  // 데모 계정(정확 UUID 일치)은 청구 대상에서 영구 제외.
  if (DEMO_PREMIUM_ACCOUNT_IDS.has(c.userId)) return invalid('demo_account_excluded');

  if (!c.autoRenew) return invalid('auto_renew_off');
  if (c.status !== 'active') return invalid('not_active');
  if (c.cancelRequestedAt) return invalid('cancel_requested');
  if (!c.rebillNo || c.rebillNo.trim().length === 0) return invalid('missing_rebill_no');
  if (!CHARGEABLE_MEMBERSHIP_TIERS.has(c.membershipTier)) return invalid('non_chargeable_tier');
  if (!c.currentPeriodEnd) return invalid('no_period_end');
  if (resolvePlanAmount(c.planType) === null) return invalid('unknown_plan');
  if (!isAmountValid(c.planType, c.amount)) return invalid('amount_mismatch');

  const cutover = Date.parse(cutoverTsIso);
  const now = Date.parse(nowIso);
  const periodEnd = Date.parse(c.currentPeriodEnd);
  if (Number.isNaN(periodEnd)) return invalid('no_period_end');

  // 아직 결제일이 도래하지 않음 → 이번 실행 대상 아님.
  if (periodEnd > now) return invalid('not_yet_due');

  // 이미 처리(진행/성공) 이력이 있는 주기 → 중복 차단.
  if (c.hasExistingCharge) {
    return { classification: 'DUPLICATE_BLOCKED', chargeable: false, reason: 'cycle_already_processed' };
  }

  // Cutover 이전 종료분 = 기존 장애로 누락된 과거분. 자동 청구하지 않는다.
  if (periodEnd < cutover) {
    return {
      classification: 'LEGACY_OVERDUE', chargeable: false,
      reason: 'legacy_overdue_requires_manual_policy',
    };
  }

  return { classification: 'FUTURE_DUE', chargeable: true, reason: 'due' };
}

export function isChargeable(classification: RebillClassification): boolean {
  return classification === 'FUTURE_DUE';
}

export interface ClassificationSummaryRow {
  classification: RebillClassification;
  count: number;
  amount: number;
}

/** dry-run 집계용. 분류별 건수/금액 합계(개인정보 없음). */
export function summarizeClassification(
  rows: Array<{ classification: RebillClassification; amount: number | null }>,
): ClassificationSummaryRow[] {
  const order: RebillClassification[] = ['FUTURE_DUE', 'LEGACY_OVERDUE', 'INVALID_REBILL', 'DUPLICATE_BLOCKED'];
  return order.map((cls) => {
    const bucket = rows.filter((r) => r.classification === cls);
    return {
      classification: cls,
      count: bucket.length,
      amount: bucket.reduce((s, r) => s + (typeof r.amount === 'number' ? r.amount : 0), 0),
    };
  });
}

/**
 * 다음 청구 주기 종료일(참고용). Postgres `+ interval '1 month'` 과 동일하게
 * 월말 일자를 clamp 한다(예: 1/31 + 1개월 = 2/28|29). UTC 기준.
 */
export function addMonthsClamped(iso: string, months = 1): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error('invalid date');
  const day = d.getUTCDate();
  const firstOfTarget = new Date(Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth() + months, 1,
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds(),
  ));
  const daysInTarget = new Date(Date.UTC(
    firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0,
  )).getUTCDate();
  firstOfTarget.setUTCDate(Math.min(day, daysInTarget));
  return firstOfTarget.toISOString();
}

/** 로그/알림용 마스킹. 원문 이메일/전화번호를 출력하지 않는다. */
export function maskEmail(email: string | null | undefined): string {
  if (!email || !email.includes('@')) return '***';
  const [local, domain] = email.split('@');
  const l = local.length <= 2 ? local[0] ?? '' : local.slice(0, 2);
  return `${l}***@${(domain[0] ?? '')}***`;
}

export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '***';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '***';
  return `***${digits.slice(-2)}`;
}

export function secretPresence(raw: string | undefined | null): 'PRESENT' | 'MISSING' {
  return typeof raw === 'string' && raw.trim().length > 0 ? 'PRESENT' : 'MISSING';
}
