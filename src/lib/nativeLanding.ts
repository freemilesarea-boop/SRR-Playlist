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
