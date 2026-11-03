/**
 * 관리자 회원 상세의 해지 신호 판정.
 *
 * 화면에서 바로 계산하지 않고 여기로 뺀 이유는 두 가지다.
 *  - 진행 중인 달은 아직 데이터가 덜 쌓여서 전월과 비교하면 무조건 급감으로 보인다.
 *    비교 대상은 "끝난 달" 둘이어야 한다.
 *  - 결제 실패로 볼 status 목록이 화면 여기저기 흩어지면 기준이 금방 달라진다.
 */

/**
 * 청구 시도가 결제로 이어지지 않은 status.
 *
 * skipped 도 실패로 센다 — rebill_no 가 없어서 아예 시도조차 못 한 경우이고,
 * 회원 입장에서는 "결제가 안 된" 것과 같다(카드 재등록을 받아야 한다).
 */
export const BILLING_FAILURE_STATUSES = [
  'failed',
  'provider_rejected',
  'unknown',
  'skipped',
] as const;

export function isBillingFailure(status: string | null | undefined): boolean {
  if (!status) return false;
  return (BILLING_FAILURE_STATUSES as readonly string[]).includes(status);
}

export interface PlaybackTrendPoint {
  month: string;
  plays: number;
  listened_seconds: number;
}

/** KST 기준 현재 달(YYYY-MM). KST 는 DST 가 없어서 고정 +9 로 충분하다. */
export function currentKstMonth(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 전월 청취가 이 값보다 적으면 비율 변화가 요란하게 튀어서 신호로 쓰지 않는다. */
export const DROP_BASELINE_SECONDS = 600;
/** 이 비율 이상 줄면 화면에서 경고로 띄운다. */
export const SEVERE_DROP_PERCENT = 50;

export interface PlaybackDrop {
  /** 비교 기준이 된 끝난 달 두 개. latest 가 더 최근이다. */
  previous: PlaybackTrendPoint;
  latest: PlaybackTrendPoint;
  /** 감소 비율(%). 늘었으면 0. */
  dropPercent: number;
  severe: boolean;
}

/**
 * 끝난 달 중 가장 최근 두 달을 비교한다. 진행 중인 달은 제외한다.
 * 비교할 달이 부족하거나 전월 청취가 너무 적으면 null — 신호로 쓰지 않는다.
 */
export function playbackDrop(
  trend: PlaybackTrendPoint[] | null | undefined,
  now: Date = new Date(),
): PlaybackDrop | null {
  if (!trend || trend.length < 2) return null;
  const thisMonth = currentKstMonth(now);
  const closed = trend
    .filter((p) => p.month < thisMonth)
    .slice()
    .sort((a, b) => a.month.localeCompare(b.month));
  if (closed.length < 2) return null;

  const previous = closed[closed.length - 2];
  const latest = closed[closed.length - 1];
  if (previous.listened_seconds < DROP_BASELINE_SECONDS) return null;

  const delta = previous.listened_seconds - latest.listened_seconds;
  const dropPercent = delta <= 0 ? 0 : Math.round((delta / previous.listened_seconds) * 100);
  return { previous, latest, dropPercent, severe: dropPercent >= SEVERE_DROP_PERCENT };
}
