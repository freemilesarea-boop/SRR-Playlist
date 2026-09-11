/**
 * appNav.ts — 사이드바 · 하단탭 · 전체메뉴에 무엇을 보여줄지 한 곳에서 결정한다.
 *
 * 웹과 앱의 사용자가 다르다.
 *   웹  : 개인 감상자 · 큐레이터 · 아티스트 · 관리자가 섞여 들어온다 → 지금 메뉴 그대로.
 *   앱  : 거의 전부 매장 점주 / 브랜드 담당자다. 태블릿을 매장에 걸어두고 쓰기 때문에
 *         "매장" 이 앞 칸이어야 한다.
 *
 * 앱에는 사이드바가 없다(손가락으로 쓰는 기기에 맞지 않는다). 그래서 하단탭 5칸만으로는
 * 모든 화면에 닿을 수 없는데, 기능을 빼는 건 안 된다 — 그래서 마지막 칸을 "더보기" 로
 * 두고 거기서 전체 메뉴를 연다. 하단탭은 자주 쓰는 것, 더보기는 나머지 전부.
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
  | 'subscription'
  | 'store'
  | 'brand'
  | 'profile'
  | 'studio'
  | 'admin'
  | 'artist'
  | 'sales'
  | 'hq'
  | 'support'
  | 'notice'
  | 'legal'
  | 'more';

export interface NavItem {
  /** 라우터 경로. action 이 있는 항목은 이동하지 않는다. */
  to: string;
  label: string;
  icon: NavIconKey;
  /** react-router NavLink 의 end (정확히 이 경로일 때만 활성) */
  end: boolean;
  /** 이동 대신 수행할 동작. 'more' = 전체 메뉴 열기. */
  action?: 'more';
  /** 전체 메뉴에서 항목 아래 보여줄 한 줄 설명. */
  desc?: string;
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

/** 전체 메뉴는 역할까지 봐야 한다 — 있는 사람에게만 보여준다. */
export interface MenuContext extends NavContext {
  signedIn: boolean;
  isAdmin: boolean;
  /** 승인된 아티스트 */
  isArtist: boolean;
  isSalesAgent: boolean;
  /** 엔터프라이즈 본사 계정 */
  isEnterpriseHq: boolean;
}

export interface MenuSection {
  title: string;
  items: NavItem[];
}

const HOME: NavItem = { to: '/', label: '홈', icon: 'home', end: true };
const SEARCH: NavItem = { to: '/search', label: '검색', icon: 'search', end: false };
const CHARTS: NavItem = { to: '/charts', label: '차트', icon: 'chart', end: false };
const LIBRARY: NavItem = { to: '/library', label: '보관함', icon: 'library', end: false };
const PLAYLISTS: NavItem = { to: '/my/playlists', label: '내 플레이리스트', icon: 'playlists', end: false };
const PRICING: NavItem = { to: '/pricing', label: '요금제', icon: 'pricing', end: false };
const SUBSCRIPTION: NavItem = { to: '/subscription', label: '구독 관리', icon: 'subscription', end: false };
const STORE: NavItem = { to: '/business', label: '매장', icon: 'store', end: false };
const BRAND: NavItem = { to: '/brand', label: '브랜드', icon: 'brand', end: false };
const PROFILE: NavItem = { to: '/profile', label: '내 정보', icon: 'profile', end: false };
const STUDIO: NavItem = { to: '/curator/studio', label: '스튜디오', icon: 'studio', end: false };
const MORE: NavItem = { to: '#more', label: '더보기', icon: 'more', end: false, action: 'more' };

/** 사이드바(웹 lg+)용 전체 메뉴. */
export function sidebarNavItems(ctx: NavContext): NavItem[] {
  const items = [HOME, SEARCH, CHARTS, LIBRARY, PLAYLISTS, PRICING, STORE, BRAND, PROFILE];
  return ctx.isCurator ? [...items, STUDIO] : items;
}

/**
 * 하단탭. 항상 5칸.
 * 앱에서는 마지막 칸이 "더보기" — 나머지 전부가 거기 들어간다.
 */
export function bottomNavItems(ctx: NavContext): NavItem[] {
  if (!ctx.native) {
    // 웹 모바일 — 기존 그대로(회귀 0).
    return [HOME, CHARTS, LIBRARY, STORE, PROFILE];
  }

  // 매장/브랜드 계정: 음악을 트는 화면이 앞. 홈(추천)은 더보기로 밀린다.
  if (ctx.storeAccount || ctx.hasBrand) {
    const first: NavItem = ctx.hasBrand && !ctx.storeAccount ? BRAND : STORE;
    return [first, SEARCH, LIBRARY, PROFILE, MORE];
  }

  // 로그인 전이거나 개인 감상용 — 홈이 앞이되, 매장은 반드시 남긴다.
  // (앱을 깐 이유가 매장인 사람이 로그인 전에 들어오면 가입 동선을 못 찾는다.)
  return [HOME, STORE, SEARCH, LIBRARY, MORE];
}

/**
 * 앱 전체 메뉴("더보기" 시트).
 *
 * 앱에는 사이드바가 없으므로 이 시트가 유일한 전체 목록이다.
 * 여기 없는 화면은 앱에서 사실상 닿을 수 없다 — 새 화면을 만들면 여기에도 넣어야 한다.
 */
export function nativeMenuSections(ctx: MenuContext): MenuSection[] {
  const sections: MenuSection[] = [];

  sections.push({
    title: '음악 틀기',
    items: [
      { ...STORE, desc: '매장 배경음악 · 자동 스케줄' },
      { ...BRAND, desc: '브랜드 전용 플레이어 · 사이니지' },
      HOME,
      CHARTS,
      SEARCH,
    ],
  });

  if (ctx.signedIn) {
    const mine: NavItem[] = [LIBRARY, PLAYLISTS];
    if (ctx.isCurator) mine.push({ ...STUDIO, desc: '큐레이터 스튜디오' });
    sections.push({ title: '내 음악', items: mine });

    sections.push({
      title: '결제',
      items: [
        { ...PRICING, desc: '매장 · 엔터프라이즈 가입' },
        SUBSCRIPTION,
      ],
    });

    const ops: NavItem[] = [];
    if (ctx.isEnterpriseHq) {
      ops.push({ to: '/enterprise/hq', label: '본사 대시보드', icon: 'hq', end: false, desc: '가맹점 관제 · 정산' });
    }
    if (ctx.isSalesAgent) {
      ops.push({ to: '/sales', label: '영업 매장 관리', icon: 'sales', end: false, desc: '내 코드로 등록된 매장' });
    }
    if (ctx.isArtist) {
      ops.push({ to: '/artist', label: '아티스트 스튜디오', icon: 'artist', end: false, desc: '음원 업로드 · 정산' });
    }
    if (ctx.isAdmin) {
      ops.push({ to: '/admin', label: '관리자', icon: 'admin', end: false });
    }
    if (ops.length) sections.push({ title: '운영', items: ops });
  }

  sections.push({
    title: '계정 · 안내',
    items: [
      PROFILE,
      { to: '/support', label: '고객지원', icon: 'support', end: false },
      { to: '/notice', label: '공지사항', icon: 'notice', end: false },
      { to: '/terms', label: '이용약관', icon: 'legal', end: false },
      { to: '/privacy', label: '개인정보 처리방침', icon: 'legal', end: false },
    ],
  });

  return sections;
}
