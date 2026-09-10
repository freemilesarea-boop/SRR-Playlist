/**
 * appNav.ts — 사이드바/하단탭에 무엇을 보여줄지 한 곳에서 결정한다.
 *
 * 웹과 앱의 사용자가 다르다.
 *   웹  : 개인 감상자 · 큐레이터 · 아티스트 · 관리자가 섞여 들어온다 → 지금 메뉴 그대로.
 *   앱  : 거의 전부 매장 점주 / 브랜드 담당자다. 태블릿을 매장에 걸어두고 쓰기 때문에
 *         "매장" 이 첫 칸이어야 하고, 개인 감상용 메뉴(차트 · 내 플레이리스트 · 요금제)는
 *         뒤로 밀린다. 기능을 없애는 게 아니라 순서를 매장 동선에 맞추는 것 — 경로는
 *         전부 살아 있어서 주소로 들어가면 그대로 열린다.
 *
 * 아이콘은 여기서 들지 않는다(키만 넘긴다). 이 파일을 DOM/아이콘 의존 없이 테스트하기 위해서.
 */

export type NavIconKey =
  | 'home'
  | 'search'
  | 'chart'
  | 'library'
  | 'playlists'
  | 'pricing'
  | 'store'
  | 'brand'
  | 'profile'
  | 'studio';

export interface NavItem {
  to: string;
  label: string;
  icon: NavIconKey;
  /** react-router NavLink 의 end (정확히 이 경로일 때만 활성) */
  end: boolean;
}

export interface NavContext {
  /** Capacitor 네이티브 쉘 안인가 */
  native: boolean;
  isCurator: boolean;
  /** 매장(business) 플랜 계정인가 */
  storeAccount: boolean;
  /** 이 기기에 연결된 브랜드가 있는가 */
  hasBrand: boolean;
}

const HOME: NavItem = { to: '/', label: '홈', icon: 'home', end: true };
const SEARCH: NavItem = { to: '/search', label: '검색', icon: 'search', end: false };
const CHARTS: NavItem = { to: '/charts', label: '차트', icon: 'chart', end: false };
const LIBRARY: NavItem = { to: '/library', label: '보관함', icon: 'library', end: false };
const PLAYLISTS: NavItem = { to: '/my/playlists', label: '내 플레이리스트', icon: 'playlists', end: false };
const PRICING: NavItem = { to: '/pricing', label: '요금제', icon: 'pricing', end: false };
const STORE: NavItem = { to: '/business', label: '매장', icon: 'store', end: false };
const BRAND: NavItem = { to: '/brand', label: '브랜드', icon: 'brand', end: false };
const PROFILE: NavItem = { to: '/profile', label: '내 정보', icon: 'profile', end: false };
const STUDIO: NavItem = { to: '/curator/studio', label: '스튜디오', icon: 'studio', end: false };

/** 사이드바(웹 lg+)용 전체 메뉴. */
export function sidebarNavItems(ctx: NavContext): NavItem[] {
  const items = [HOME, SEARCH, CHARTS, LIBRARY, PLAYLISTS, PRICING, STORE, BRAND, PROFILE];
  return ctx.isCurator ? [...items, STUDIO] : items;
}

/**
 * 하단탭용 메뉴. 칸이 좁으니 최대 5개까지만.
 * 앱에서는 매장이 첫 칸 — 태블릿을 켠 사람이 가장 먼저 누를 것이기 때문.
 */
export function bottomNavItems(ctx: NavContext): NavItem[] {
  if (!ctx.native) {
    // 웹 모바일 — 기존 그대로(회귀 0).
    return [HOME, CHARTS, LIBRARY, STORE, PROFILE];
  }

  // 아직 로그인 전이거나 개인 감상용으로 앱을 깐 사람 — 홈을 앞에 두되
  // 매장은 반드시 남긴다. 앱을 깐 이유가 매장인 사람이 로그인 전에 들어오면
  // 매장 탭이 없어서 가입 동선을 못 찾는다.
  if (!ctx.storeAccount && !ctx.hasBrand) {
    return [HOME, STORE, SEARCH, LIBRARY, PROFILE];
  }

  const items: NavItem[] = [STORE];
  if (ctx.hasBrand) items.push(BRAND);
  items.push(SEARCH, LIBRARY, PROFILE);
  return items.slice(0, 5);
}
