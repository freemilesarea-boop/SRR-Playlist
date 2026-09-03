// Phase ARTIST-BILLING-ACCESS-ENFORCEMENT-1 — 아티스트 유료 접근 중앙 판정(클라이언트).
//
// 서버(SQL artist_has_paid_access / get_artist_billing_access)가 최종 권한을 결정한다.
// 이 모듈은 (1) 서버 판정과 동일한 순수 분류 로직(테스트·낙관적 UI용)과
// (2) 실시간 서버 판정 RPC 래퍼, (3) capability 별 assert 를 제공한다.
//
// 원칙:
//   • 서버 상태 기준. 클라이언트 membership_tier / 요청 body 의 role·paid 를 신뢰하지 않음.
//   • 상태 확인 실패 시 Fail-Closed(제한).
//   • 개인정보 미포함. 익명 UUID/상태만 다룸.

import { supabase } from './supabase';
import { DEMO_PREMIUM_ACCOUNT_IDS } from './membership';

export const ARTIST_BILLING_ERROR_CODE = 'ARTIST_BILLING_REQUIRED' as const;

/** 유효 유료 플랜(구독 plan_type). 서버 SQL 과 동일 집합. */
export const VALID_ARTIST_PLAN_TYPES: ReadonlySet<string> = new Set([
  'individual', 'business', 'artist_general', 'artist_student',
]);

export type ArtistBillingRestrictionReason = 'cancelled' | 'unpaid' | 'expired' | 'invalid';

export type ArtistBillingStatus = 'active' | 'exempt' | ArtistBillingRestrictionReason;

/** 결제 제한이 걸리는 아티스트 유료 Capability. 서버 조사로 확정한 전체 목록. */
export type ArtistPaidCapability =
  | 'track.create'
  | 'track.upload'
  | 'track.edit'
  | 'track.submit_distribution'
  | 'track.resubmit_distribution'
  | 'release.create'
  | 'release.edit'
  | 'artist_profile.edit'
  | 'audio_qc.run'
  | 'ai_analysis.run'
  | 'program.download'
  | 'premium_tool.use';

export type ArtistBillingAccess =
  | { allowed: true; status: 'active' | 'exempt'; reason: null; restrictedAt: null }
  | {
      allowed: false;
      status: ArtistBillingRestrictionReason;
      reason: ArtistBillingRestrictionReason;
      restrictedAt: string;
    };

export interface ArtistSubscriptionSnapshot {
  status: string | null;
  planType: string | null;
  cancelRequestedAt: string | null;
  canceledAt: string | null;
  currentPeriodEnd: string | null;
  createdAt?: string | null;
  /** 환불 시각. 환불건은 기간이 남아 있어도 이용권 회수(0496). */
  refundedAt?: string | null;
}

export interface ArtistBillingAccessInput {
  userId: string | null;
  isArtist: boolean;
  role: string | null;
  /** user 가 소유한 구독들(없으면 빈 배열). 최초 결제 미완료 판정에 사용. */
  subscriptions: ArtistSubscriptionSnapshot[];
  everPaid: boolean;
}

function allow(status: 'active' | 'exempt'): ArtistBillingAccess {
  return { allowed: true, status, reason: null, restrictedAt: null };
}
function deny(reason: ArtistBillingRestrictionReason, restrictedAt: string): ArtistBillingAccess {
  return { allowed: false, status: reason, reason, restrictedAt };
}

/**
 * 순수 분류 — 서버 SQL(artist_billing_access_detail)과 동치.
 * 각 아티스트는 정확히 하나의 상태에 속한다. Fail-Closed.
 */
export function classifyArtistBillingAccess(
  input: ArtistBillingAccessInput,
  nowIso: string,
): ArtistBillingAccess {
  const now = Date.parse(nowIso);

  // 대상 불명 → 제한(Fail-Closed)
  if (!input.userId) return deny('unpaid', nowIso);

  // 예외: 관리자 / 정확한 데모 UUID 4개
  if (input.role === 'admin') return allow('exempt');
  if (DEMO_PREMIUM_ACCOUNT_IDS.has(input.userId)) return allow('exempt');

  // 유효 결제 접근 존재?
  // 0496 — 결제한 이용기간(current_period_end)이 남아 있으면 해지 예약(유예) 상태여도
  // 전부 허용한다. 환불건은 기간과 무관하게 제외.
  const hasActive = input.subscriptions.some((s) => {
    if (s.status !== 'active' && s.status !== 'cancel_scheduled') return false;
    if (s.refundedAt) return false;
    if (!s.currentPeriodEnd) return false;
    const end = Date.parse(s.currentPeriodEnd);
    if (Number.isNaN(end) || end <= now) return false;
    return !!s.planType && VALID_ARTIST_PLAN_TYPES.has(s.planType);
  });
  if (hasActive) return allow('active');

  // 제한 사유 — 최신 구독 기준
  const latest = [...input.subscriptions].sort(
    (a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''),
  )[0];

  if (!latest) return deny('unpaid', nowIso); // 구독 이력 없음 = 최초 결제 미완료

  if (latest.cancelRequestedAt || latest.status === 'canceled' || latest.status === 'cancel_scheduled') {
    return deny('cancelled', latest.cancelRequestedAt ?? latest.canceledAt ?? nowIso);
  }
  if (!input.everPaid || latest.status === 'pending' || latest.status === 'payment_waiting' || latest.status === 'failed') {
    return deny('unpaid', latest.createdAt ?? nowIso);
  }
  const end = latest.currentPeriodEnd ? Date.parse(latest.currentPeriodEnd) : NaN;
  if (latest.status === 'expired' || (!Number.isNaN(end) && end <= now)) {
    return deny('expired', latest.currentPeriodEnd ?? nowIso);
  }
  // status='active' 인데 접근 게이트 미통과(기간 null 등) → 상태 확정 불가 → Fail-Closed
  return deny('invalid', nowIso);
}

// ----------------------------------------------------------------------------
// 사용자 안내 문구 / 에러 페이로드
// ----------------------------------------------------------------------------

const RESTRICTION_MESSAGE: Record<ArtistBillingRestrictionReason, string> = {
  cancelled: '구독 기간이 끝나 아티스트 기능이 제한되었습니다. 구독을 다시 시작하면 이용할 수 있습니다.',
  unpaid: '결제가 확인되지 않아 아티스트 기능이 제한되었습니다. 결제수단을 등록하거나 구독을 시작해 주세요.',
  expired: '구독이 만료되어 아티스트 기능이 제한되었습니다. 구독을 갱신하면 다시 이용할 수 있습니다.',
  invalid: '결제 상태를 확인할 수 없어 아티스트 기능이 제한되었습니다. 고객지원에 문의해 주세요.',
};

const CAPABILITY_MESSAGE: Partial<Record<ArtistPaidCapability, string>> = {
  'track.submit_distribution': '정기결제 후 음원 유통 신청 기능을 이용할 수 있습니다.',
  'track.resubmit_distribution': '정기결제 후 음원 유통 재신청 기능을 이용할 수 있습니다.',
  'track.create': '정기결제 후 신규 음원 등록 기능을 이용할 수 있습니다.',
  'track.upload': '정기결제 후 음원 업로드 기능을 이용할 수 있습니다.',
};

export function restrictionMessage(access: Extract<ArtistBillingAccess, { allowed: false }>): string {
  return RESTRICTION_MESSAGE[access.reason];
}

export interface ArtistBillingRequiredPayload {
  error: typeof ARTIST_BILLING_ERROR_CODE;
  status: ArtistBillingRestrictionReason;
  message: string;
  redirect: '/subscription';
}

export function billingRequiredPayload(
  access: Extract<ArtistBillingAccess, { allowed: false }>,
  capability?: ArtistPaidCapability,
): ArtistBillingRequiredPayload {
  return {
    error: ARTIST_BILLING_ERROR_CODE,
    status: access.reason,
    message: (capability && CAPABILITY_MESSAGE[capability]) || restrictionMessage(access),
    redirect: '/subscription',
  };
}

/** 서버(DB Trigger/RPC)에서 올라온 오류가 결제 제한 오류인지 판별. */
export function isArtistBillingRequiredError(err: unknown): boolean {
  const msg =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
          ? String((err as { message?: unknown }).message ?? '')
          : '';
  return typeof msg === 'string' && msg.includes(ARTIST_BILLING_ERROR_CODE);
}

// ----------------------------------------------------------------------------
// 제한 배너 컨텐츠 (순수 · 테스트 가능) — 컴포넌트는 이 값을 렌더만 한다.
// ----------------------------------------------------------------------------
export interface BillingBannerCta {
  label: string;
  to: '/subscription' | '/artist' | '/artist/settlements' | '/support';
}
export interface BillingBannerContent {
  reason: ArtistBillingRestrictionReason;
  title: string;
  body: string;
  /** 첫 항목이 primary CTA. */
  ctas: BillingBannerCta[];
}

/** 제한 아티스트에게만 배너 컨텐츠 반환. active/exempt/비아티스트/미조회 → null. */
export function artistBillingBannerContent(
  access: ArtistBillingAccessResult | null,
): BillingBannerContent | null {
  if (!access || !access.isArtist || access.allowed) return null;
  if (access.reason === 'cancelled') {
    return {
      reason: 'cancelled',
      // 0496 — 결제한 이용기간이 남아 있으면 제한하지 않으므로, 이 배너는 기간까지
      // 모두 끝난 뒤에만 뜬다.
      title: '구독 기간이 끝나 아티스트 기능이 제한되었습니다.',
      body: '음원 등록, 기존 음원 수정, 유통 신청 및 아티스트 유료 기능을 이용하려면 구독을 다시 시작해 주세요.',
      ctas: [
        { label: '구독 다시 시작', to: '/subscription' },
        { label: '기존 음원 보기', to: '/artist' },
        { label: '정산 내역 보기', to: '/artist/settlements' },
      ],
    };
  }
  // unpaid / expired / invalid
  return {
    reason: access.reason,
    title: '결제가 확인되지 않아 아티스트 기능이 제한되었습니다.',
    body: '결제수단을 등록하거나 구독을 갱신하면 음원 등록, 기존 음원 수정 및 유통 신청 기능을 다시 이용할 수 있습니다.',
    ctas: [
      { label: '결제수단 등록', to: '/subscription' },
      { label: '구독 확인', to: '/subscription' },
      { label: '고객지원', to: '/support' },
    ],
  };
}

export class ArtistBillingRequiredError extends Error {
  readonly code = ARTIST_BILLING_ERROR_CODE;
  readonly payload: ArtistBillingRequiredPayload;
  constructor(payload: ArtistBillingRequiredPayload) {
    super(payload.message);
    this.name = 'ArtistBillingRequiredError';
    this.payload = payload;
  }
}

// ----------------------------------------------------------------------------
// 서버 실시간 판정 (RPC) — 최종 권한 소스
// ----------------------------------------------------------------------------

interface ServerAccessRow {
  allowed: boolean;
  status: ArtistBillingStatus;
  reason: ArtistBillingRestrictionReason | null;
  restricted_at: string | null;
  is_artist: boolean;
}

export type ArtistBillingAccessResult = ArtistBillingAccess & { isArtist: boolean };

/** 서버 판정 조회. 실패 시 Fail-Closed(제한된 invalid). */
export async function getArtistBillingAccess(): Promise<ArtistBillingAccessResult> {
  try {
    const { data, error } = await supabase.rpc('get_artist_billing_access');
    if (error || !data) {
      return { allowed: false, status: 'invalid', reason: 'invalid', restrictedAt: new Date().toISOString(), isArtist: false };
    }
    const row = (Array.isArray(data) ? data[0] : data) as ServerAccessRow | undefined;
    if (!row) {
      return { allowed: false, status: 'invalid', reason: 'invalid', restrictedAt: new Date().toISOString(), isArtist: false };
    }
    if (row.allowed) {
      return { allowed: true, status: row.status === 'exempt' ? 'exempt' : 'active', reason: null, restrictedAt: null, isArtist: row.is_artist };
    }
    const reason = (row.reason ?? 'invalid') as ArtistBillingRestrictionReason;
    return { allowed: false, status: reason, reason, restrictedAt: row.restricted_at ?? new Date().toISOString(), isArtist: row.is_artist };
  } catch {
    return { allowed: false, status: 'invalid', reason: 'invalid', restrictedAt: new Date().toISOString(), isArtist: false };
  }
}

/** 차단 이벤트 감사 기록(best-effort, 개인정보 미포함). */
export async function recordArtistBillingDenial(capability: ArtistPaidCapability, source = 'app'): Promise<void> {
  try {
    await supabase.rpc('record_artist_billing_denial', { p_capability: capability, p_source: source });
  } catch {
    /* best-effort — 감사 실패가 사용자 흐름을 막지 않는다 */
  }
}

/**
 * Capability 별 유료 접근 강제. 제한 시 감사 기록 후 ArtistBillingRequiredError throw.
 * 서버 mutation(RPC/RLS)이 최종 방어선이며, 이 함수는 클라이언트 선제 차단 + 감사용.
 */
export async function assertArtistPaidAccess(
  capability: ArtistPaidCapability,
  source = 'client',
): Promise<ArtistBillingAccessResult> {
  const access = await getArtistBillingAccess();
  // 비아티스트는 이 게이트 대상이 아님(매장/브랜드 정책 불변) — 통과시키되 allowed 반환.
  if (!access.isArtist) return access;
  if (access.allowed) return access;
  await recordArtistBillingDenial(capability, source);
  throw new ArtistBillingRequiredError(billingRequiredPayload(access, capability));
}
