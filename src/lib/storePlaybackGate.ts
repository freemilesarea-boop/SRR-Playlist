/**
 * storePlaybackGate.ts — 매장/브랜드 플레이어의 구독 게이트 판정.
 *
 * 배경: 무료 등급 계정으로 브랜드 플레이어를 돌리면 곡당 25초만 재생되고 멈춘다
 *   (PREVIEW_LIMIT_SECONDS → pause() + 업셀 모달). 무인 매장에서 이 증상은
 *   "음악이 중간에 끊긴다" 와 구분이 안 되고, 점주도 운영자도 원인을 알 수 없다.
 *   실제로 결제가 중단된 회원이 존재한다.
 *
 * 정책: 매장 모드에서는 **미리듣기를 주지 않는다.** 재생을 시작하지 않고
 *   "구독이 만료되어 매장 재생이 중단되었습니다" 를 전체화면으로 명시한다.
 *   끊기는 음악보다 멈춘 이유를 아는 편이 매장 운영에 낫다.
 *
 * 데모 계정(DEMO_PREMIUM_ACCOUNT_IDS)은 membership 이 'premium' 으로 해석되므로
 * 이 게이트에 걸리지 않는다 — 시연용 무제한 청취는 의도된 동작이다.
 */
import type { Membership } from '@/lib/membership';

export type StoreGateDecision =
  | 'allow'                 // 재생 가능
  | 'login_required'        // 비로그인
  | 'subscription_required' // 매장 모드인데 무료 등급 → 전체화면 차단
  | 'preview';              // 일반 사용자 무료 등급 → 기존 25초 미리듣기

export interface StoreGateInput {
  membership: Membership;
  /** 매장/브랜드 플레이어 모드인가. localStorage 에 남는 끈적한 플래그다. */
  businessMode: boolean;
  /**
   * 지금 보고 있는 화면이 매장 플레이어 화면인가 (/business/player, /brand/player/:id).
   *
   * businessMode 만으로는 "무인 매장"을 판정할 수 없다. 그 값은 한 번 켜지면 localStorage 에
   * 남아서, 점주가 홈·차트·플레이리스트를 둘러보는 동안에도 계속 true 다. 예전에는 그 상태로
   * subscription_required 를 내서 일반 페이지의 재생까지 막았고, 설명 화면은 매장 플레이어
   * 페이지에만 있어서 사용자는 이유도 모른 채 25초조차 듣지 못했다 (2026-10-01 회원 신고).
   */
  onStorePlayerSurface: boolean;
}

/** 현재 경로가 매장 플레이어 화면인가. */
export function isStorePlayerSurface(pathname: string): boolean {
  return pathname === '/business/player' || pathname.startsWith('/brand/player/');
}

/**
 * 재생 게이트 판정.
 *
 * 매장 모드에서만 무료 등급을 전체화면 차단으로 올린다. 일반 사용자 경험은 그대로
 * (25초 미리듣기 + 업셀) — 결제 유도 흐름을 바꾸지 않는다.
 */
export function resolveStoreGate(i: StoreGateInput): StoreGateDecision {
  if (i.membership === 'anonymous') return 'login_required';
  if (i.membership === 'premium') return 'allow';
  // 전체화면 차단은 무인 매장을 위한 것이다 — 실제로 매장 플레이어 화면을 보고 있을 때만 건다.
  // 일반 페이지에서는 businessMode 가 켜져 있어도 기존 25초 미리듣기 + 업셀 그대로다.
  return i.businessMode && i.onStorePlayerSurface ? 'subscription_required' : 'preview';
}

/** 전체화면 차단 화면을 띄워야 하는가. */
export function isStorePlaybackBlocked(i: StoreGateInput): boolean {
  return resolveStoreGate(i) === 'subscription_required';
}

export type BusinessToggleAction = 'stop' | 'start' | 'need_schedule';

/**
 * 매장 화면의 ON AIR/OFF 토글이 할 일.
 *
 * 켜짐 판정의 기준은 **businessMode 지, 재생 중인지가 아니다.** 예전에는 재생 중일 때만
 * 끄도록 되어 있었는데, 무료 등급은 subscription_required 로 재생이 막혀 playing 이 영원히
 * false 였다. 그래서 토글이 종료가 아니라 start 로 가서 매장 모드를 다시 켰고, 사용자는
 * 재생도 안 되고 매장 모드를 끄지도 못하는 상태에 갇혔다(2026-10-01 회원 신고).
 */
export function resolveBusinessToggleAction(i: {
  businessMode: boolean;
  hasSchedules: boolean;
}): BusinessToggleAction {
  if (i.businessMode) return 'stop';
  return i.hasSchedules ? 'start' : 'need_schedule';
}

export type StoreAutoStartAction =
  | 'none'
  | 'resume_queue'     // 복원된 큐가 있다 → 이어서 재생
  | 'start_schedule';  // 큐가 없다 → 현재 시간대 스케줄로 새로 구성

/**
 * 매장 플레이어 화면에 들어왔을 때 사람이 버튼을 누르지 않아도 재생을 시작할지.
 *
 * 매장은 아침마다 점주가 재생 버튼을 누르는 구조였다. 그 조작을 없애려는 것이다.
 * 자동재생 자체는 브라우저 정책이 결정하므로 여기서 보장하지 못한다 — 막히면
 * autoplayBlocked 가 서고 PlaybackBlockedOverlay 가 "화면을 눌러주세요" 를 띄운다.
 *
 * 무료 등급은 매장 화면에서 subscription_required 로 막히므로 자동 시작하지 않는다.
 * 재생도 안 되는데 시도만 반복하면 진단 기록만 더럽힌다.
 *
 * alreadyTried 는 화면 진입당 1회를 보장한다. 사람이 일부러 멈춘 것을 다시 켜지 않기 위해서다
 * (진입 직후에는 사람이 멈출 시간이 없었으므로 그때 한 번만 시도한다).
 */
export function resolveStoreAutoStart(i: {
  membership: Membership;
  schedulesLoading: boolean;
  hasSchedules: boolean;
  hasQueue: boolean;
  playing: boolean;
  alreadyTried: boolean;
}): StoreAutoStartAction {
  if (i.alreadyTried || i.playing) return 'none';
  if (i.membership !== 'premium') return 'none';
  if (i.hasQueue) return 'resume_queue';
  if (i.schedulesLoading) return 'none'; // 아직 판단 불가 — 로드되면 다시 평가된다
  if (!i.hasSchedules) return 'none';
  return 'start_schedule';
}

/**
 * 앱을 켰을 때 매장 플레이어 화면으로 되돌아갈지.
 *
 * PC 전원을 켜면 음악이 나오게 하려면 (1) OS 가 앱을 띄우고 (2) 앱이 매장 화면으로 가고
 * (3) 재생이 시작돼야 한다. (1)은 웹이 할 수 없어 점주가 1회 설정한다(PWA 설치 + 시작 시 열기).
 * 이 함수는 (2)를 맡는다.
 *
 * 조건을 좁게 잡는다. businessMode 는 localStorage 에 남는 끈적한 플래그라, 넓게 잡으면
 * 둘러보려던 사람을 매장 화면으로 끌고 간다 (2026-10-01 회원 신고가 같은 뿌리였다):
 *  - 설치형 PWA 로 실행했을 때만. 브라우저 탭으로 접속한 사람은 건드리지 않는다.
 *  - start_url('/') 로 들어왔을 때만. 특정 페이지를 겨냥한 진입은 존중한다.
 *  - 재생 가능한 등급일 때만. 무료 등급을 보내면 전체화면 차단 화면만 보게 된다.
 *  - 앱 실행당 1회만. 사용자가 홈으로 나오면 다시 끌고 가지 않는다.
 */
export function shouldResumeStorePlayerOnLaunch(i: {
  pathname: string;
  businessMode: boolean;
  membership: Membership;
  standalone: boolean;
  alreadyResumed: boolean;
}): boolean {
  if (i.alreadyResumed) return false;
  if (!i.standalone) return false;
  if (i.pathname !== '/') return false;
  if (!i.businessMode) return false;
  return i.membership === 'premium';
}

/**
 * 설치형 앱을 '/' 로 켰을 때 갈 플레이어 화면 — 앱 실행 목적지의 **단일 판정**.
 *
 * 우선순위: 저장된 브랜드 연결 → 매장 플레이어 복귀 → 그대로(null).
 * VALID BRAND BINDING ALWAYS WINS OVER STORE RESUME.
 *
 * 2026-10-06 숙대점: 브랜드 이동과 매장 복귀가 서로 다른 effect 에서 따로 돌았고,
 * 먼저 실행된 매장 복귀(businessMode=true · premium)가 '/' 를 '/business/player' 로
 * 바꿔버려 브랜드 이동은 매번 실행되지 못했다. 한 함수가 한 번에 정하므로 effect
 * 실행 순서와 무관하다.
 *
 * brandPlayerPath 는 기기에 저장된 binding 의 플레이어 경로일 뿐 승인이 아니다.
 * BrandPlayerPage 가 verify_brand_device_binding 으로 서버 재검증하고, 실패하면
 * binding 을 지우고 /brand 로 돌려보낸다.
 */
export function resolveLaunchDestination(i: {
  pathname: string;
  businessMode: boolean;
  membership: Membership;
  standalone: boolean;
  alreadyHandled: boolean;
  brandPlayerPath: string | null;
}): string | null {
  if (i.alreadyHandled) return null;
  if (!i.standalone) return null;
  if (i.pathname !== '/') return null;
  // 브랜드 플레이어는 로그인 필요(RequireAuth). 비로그인이면 보내지 않는다.
  if (i.brandPlayerPath) return i.membership === 'anonymous' ? null : i.brandPlayerPath;
  return shouldResumeStorePlayerOnLaunch({ ...i, alreadyResumed: false }) ? '/business/player' : null;
}
