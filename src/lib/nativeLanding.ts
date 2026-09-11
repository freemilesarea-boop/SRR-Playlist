/**
 * nativeLanding.ts — 앱을 켰을 때 어느 화면으로 들어갈지 정한다.
 *
 * 웹은 홈(마케팅/추천)이 첫 화면인 게 맞다. 앱은 다르다 — 매장에 걸어둔 태블릿을
 * 켜는 사람은 음악을 틀려는 것이지 추천을 보려는 게 아니다. 한 단계라도 더 누르게
 * 하면 그만큼 무음 시간이 길어진다(숙대점처럼 재부팅 후 아무도 안 눌러서 멈춘 사례).
 *
 * 규칙은 좁게 잡는다. 잘못 튀면 딥링크와 뒤로가기가 망가지기 때문이다:
 *   - 루트('/')로 들어왔을 때만 판단한다. 푸시 알림·딥링크로 특정 화면에 진입한 경우는 건드리지 않는다.
 *   - 앱 실행당 한 번만 (호출부가 보장).
 *   - 큐가 없으면 플레이어 대신 매장 대시보드로 — 빈 플레이어를 띄우면 오히려 막힌다.
 */

export interface NativeLandingInput {
  /** 현재 라우터 경로 */
  currentPath: string;
  signedIn: boolean;
  accountType?: 'individual' | 'business' | 'artist' | null;
  membershipTier?: 'free' | 'individual' | 'business' | null;
  subscriptionType?: string | null;
  /** 이 기기에 연결된 브랜드 id (브랜드 플레이어 전용 태블릿) */
  boundBrandId?: string | null;
  /** localStorage 에 복원 가능한 재생 큐가 남아 있는가 */
  hasPlayerSession: boolean;
}

/** 매장(business) 플랜 계정인지. 셋 중 하나만 business 여도 매장으로 본다. */
export function isStoreAccount(
  input: Pick<NativeLandingInput, 'accountType' | 'membershipTier' | 'subscriptionType'>,
): boolean {
  return (
    input.accountType === 'business' ||
    input.membershipTier === 'business' ||
    input.subscriptionType === 'business'
  );
}

/**
 * 이동할 경로. null 이면 그대로 둔다(기존 동작 유지).
 */
export function nativeLandingPath(input: NativeLandingInput): string | null {
  // 딥링크/푸시로 들어온 화면은 절대 가로채지 않는다.
  if (input.currentPath !== '/') return null;
  // 로그인 전에는 기존 게이트(RequireAuth/LoginPage)가 처리한다.
  if (!input.signedIn) return null;

  // 브랜드 전용 태블릿이 우선 — 기기에 브랜드가 묶여 있으면 그 브랜드 플레이어가 이 기기의 용도다.
  if (input.boundBrandId) return `/brand/player/${input.boundBrandId}`;

  if (isStoreAccount(input)) {
    // 큐가 있으면 = 이미 영업 중이던 태블릿. 바로 플레이어로 복귀한다.
    // 큐가 없으면 = 첫 설정. 플레이어를 띄워봐야 틀 곡이 없으니 대시보드로 보낸다.
    return input.hasPlayerSession ? '/business/player' : '/business';
  }

  return null;
}

/**
 * 이번 렌더에서 착륙 판단을 할 차례인가.
 *
 * 로그인 전에는 판단하지 않는다. 예전에는 로그인 전에도 한 번 보고 "끝냈다" 로
 * 표시해버려서, 앱에서 로그인한 직후에는 역할별 진입이 아예 동작하지 않았다
 * (로그인 화면이 홈으로 보내면 그대로 홈에 머물렀다).
 * 사용자별로 한 번씩 판단하고, 로그아웃하면 다시 판단할 수 있게 푼다.
 */
export interface LandingGateInput {
  native: boolean;
  /** 프로필 로드가 끝났는가 — 끝나기 전에 보면 매장 계정을 개인으로 오인한다 */
  profileReady: boolean;
  /** 로그인한 사용자 id. 비로그인이면 null */
  userId: string | null;
  /** 이미 판단을 마친 사용자 id */
  landedForUser: string | null;
}

export type LandingGate = 'evaluate' | 'skip' | 'reset';

export function landingGate(input: LandingGateInput): LandingGate {
  if (!input.native) return 'skip';
  if (!input.profileReady) return 'skip';
  // 비로그인 — 판단을 쓰지 않고 다음 로그인을 위해 풀어둔다.
  if (!input.userId) return 'reset';
  if (input.landedForUser === input.userId) return 'skip';
  return 'evaluate';
}
