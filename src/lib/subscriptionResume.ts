// Phase RESUME-PAUSED-SUBSCRIPTION-1 — 정지(해지 예약/해지)한 구독의 즉시 재개 판정.
//
// 배경: 구독을 취소하면 유예기간(current_period_end)까지 membership_tier 는 남지만
// 0467 게이트(artist_has_paid_access)가 cancel_requested_at 을 보고 유통/업로드를
// 즉시 막는다. 그동안 화면은 "이용 중" 으로 보여 재결제 버튼이 없었다 — 유예 종료일까지
// 아무것도 못 하는 교착. 이 모듈은 "정지 상태인가 / 남은 기간은 며칠인가 / 어떤 문구로
// 다시 시작을 안내할까" 를 순수 함수로 계산한다(서버 판정과 별개, 표시용).
//
// 재결제는 언제든 가능하며, 결제 시점부터 새 결제 주기(1개월)가 시작된다
// (migration 0495 / PayApp 정기결제는 등록일 기준 매월 청구).

/** 표시 판정에 필요한 최소 구독 스냅샷. subscriptions row 의 부분집합. */
export interface PausedSubscriptionSnapshot {
  status: string | null;
  plan_type?: string | null;
  current_period_end: string | null;
  cancel_requested_at?: string | null;
}

/** 사용자가 스스로 정지시킨 구독인지. (해지 예약 / 해지 완료 / 취소 요청 흔적) */
export function isPausedSubscription(sub: PausedSubscriptionSnapshot | null): boolean {
  if (!sub) return false;
  if (sub.cancel_requested_at) return true;
  return sub.status === 'cancel_scheduled' || sub.status === 'canceled';
}

/** 유예기간이 아직 남았는지 (period_end 가 미래). */
export function hasRemainingGrace(
  sub: PausedSubscriptionSnapshot | null,
  nowIso: string = new Date().toISOString(),
): boolean {
  return remainingGraceDays(sub, nowIso) > 0;
}

/** 남은 이용 일수(올림). 정지 상태가 아니거나 이미 지났으면 0. */
export function remainingGraceDays(
  sub: PausedSubscriptionSnapshot | null,
  nowIso: string = new Date().toISOString(),
): number {
  if (!isPausedSubscription(sub) || !sub?.current_period_end) return 0;
  const end = Date.parse(sub.current_period_end);
  const now = Date.parse(nowIso);
  if (Number.isNaN(end) || Number.isNaN(now) || end <= now) return 0;
  return Math.ceil((end - now) / 86_400_000);
}

export interface ResumeNotice {
  /** 배너 제목. */
  title: string;
  /** 안내 문구 — 남은 기간 이관 여부까지 설명. */
  body: string;
  /** 재결제 버튼 라벨. */
  ctaLabel: string;
  /** 남은 이용 일수(0 = 유예 없음). */
  remainingDays: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '결제 기간 종료일';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '결제 기간 종료일';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * 정지 상태 안내 + 즉시 재개 CTA. 정지 상태가 아니면 null.
 *
 * 핵심 정책: 유예기간이 남아 있어도 기다릴 필요 없이 지금 바로 다시 결제할 수 있고,
 * 남은 일수는 새 결제 주기에 더해진다(서버 0495).
 */
export function resumeNotice(
  sub: PausedSubscriptionSnapshot | null,
  nowIso: string = new Date().toISOString(),
): ResumeNotice | null {
  if (!isPausedSubscription(sub) || !sub) return null;
  const remainingDays = remainingGraceDays(sub, nowIso);

  if (remainingDays > 0) {
    return {
      title: '구독이 정지된 상태예요',
      body:
        `이전 요금제가 ${fmtDate(sub.current_period_end)}까지 남아 있어도, 정지 상태에서는 음원 등록·유통 신청이 제한돼요. ` +
        `종료일까지 기다릴 필요 없이 지금 바로 다시 결제하면 즉시 이어서 진행할 수 있어요. ` +
        `결제하는 시점부터 새 결제 주기(1개월)가 시작됩니다.`,
      ctaLabel: '지금 다시 결제하고 이어서 이용하기',
      remainingDays,
    };
  }

  return {
    title: '구독이 정지된 상태예요',
    body: '결제를 다시 시작하면 음원 등록·유통 신청을 바로 이어서 진행할 수 있어요.',
    ctaLabel: '지금 다시 결제하기',
    remainingDays: 0,
  };
}

/** 아티스트 전용 요금제(가격/한도가 다름) — 재결제는 아티스트 대시보드에서 진행한다. */
export type ResumeTarget =
  | { kind: 'plan'; plan: 'personal' | 'business' }
  | { kind: 'artist' };

/**
 * 재결제를 어디서 진행해야 하는지. artist_general / artist_student 는 /subscription 의
 * 일반·사업자 카드(4,900 / 6,900 individual·business)와 상품이 달라, 여기서 결제하면
 * 엉뚱한 요금제로 결제된다. 아티스트 대시보드의 결제 카드로 보낸다.
 */
export function resumeCheckoutTarget(planType: string | null | undefined): ResumeTarget {
  if (planType === 'artist_general' || planType === 'artist_student') return { kind: 'artist' };
  if (planType === 'business') return { kind: 'plan', plan: 'business' };
  return { kind: 'plan', plan: 'personal' };
}

/** 정지 상태면 요금제 카드를 '이용 중'(비활성)으로 잠그지 않는다 — 즉시 재결제 허용. */
export function planCardLocked(
  isCurrentPlan: boolean,
  sub: PausedSubscriptionSnapshot | null,
): boolean {
  return isCurrentPlan && !isPausedSubscription(sub);
}
