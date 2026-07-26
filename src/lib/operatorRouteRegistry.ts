/**
 * operatorRouteRegistry.ts — Phase ADMIN-UX-IMPLEMENT-2
 *
 * 운영자 콘솔(/ops)의 **Canonical Route 단일 소스(SSOT)**.
 *   • 각 /ops 하위 라우트의 정체(경로·라벨·설명·breadcrumb·검색 키워드·권한·매핑 컴포넌트)를 한곳에 정의.
 *   • Sidebar / Breadcrumb / Command Palette / Route 매핑이 전부 이 레지스트리에서 파생된다
 *     (라우트/라벨이 여러 파일에 흩어지지 않게).
 *   • 순수 데이터 + 순수 함수만 — React/JSX 없음(유닛 테스트 용이).
 *   • 권한 판정 코어는 IMPLEMENT-1(operatorNavigation)의 것을 재사용한다 — 권한 모델 변경 없음.
 *     (allowedRoles/superOnly 는 UI 노출만 결정, 실제 접근은 서버 RPC/RequireAdmin/RLS 가 최종 판정.)
 *
 * componentKey 는 실제 컴포넌트를 직접 참조하지 않는다(순수 유지). 매핑은 operatorPanels.ts 에서.
 */
import {
  operatorRolesFromContext,
  type OperatorRole,
  type OperatorAccessContext,
} from './operatorNavigation';

// 편의 재-export — /ops 컴포넌트들이 레지스트리 한 곳에서 타입을 가져올 수 있게.
export type { OperatorRole, OperatorAccessContext } from './operatorNavigation';

export type OperatorCategory =
  | 'home' | 'stores' | 'enterprise' | 'music' | 'monitoring'
  | 'finance' | 'artist-content' | 'analytics' | 'ai' | 'system';

/** 카테고리 메타(사이드바 섹션 헤더). */
export interface OperatorCategoryMeta {
  id: OperatorCategory;
  label: string;
  icon: string;
}

export const OPERATOR_CATEGORIES: OperatorCategoryMeta[] = [
  { id: 'home',           label: '운영 홈',        icon: 'Home' },
  { id: 'stores',         label: '매장',           icon: 'Store' },
  { id: 'enterprise',     label: '본사·브랜드',    icon: 'Building2' },
  { id: 'music',          label: '음악',           icon: 'Music' },
  { id: 'monitoring',     label: '관제',           icon: 'Activity' },
  { id: 'finance',        label: '정산·청구',      icon: 'Wallet' },
  { id: 'artist-content', label: '아티스트·콘텐츠', icon: 'Mic2' },
  { id: 'analytics',      label: '분석',           icon: 'BarChart3' },
  { id: 'ai',             label: 'AI',             icon: 'Sparkles' },
  { id: 'system',         label: '시스템',         icon: 'Settings' },
];

export interface OperatorRouteEntry {
  id: string;
  label: string;
  description: string;
  /** Canonical /ops 경로. 동적 세그먼트는 :param 표기. */
  canonicalPath: string;
  /** 하위호환용 기존 AdminPage 탭 키(있으면). "새 화면에서 보기" 및 활성 매칭에 사용. */
  legacyTab?: string;
  /** operatorPanels.ts 의 매핑 키. 'home' 은 OperatorHomePage 특수 처리(별도 마운트). */
  componentKey: string;
  category: OperatorCategory;
  /** 한국어 검색 키워드. */
  keywords: string[];
  /** 영문/별칭 검색어. */
  aliases?: string[];
  /** 노출 허용 역할. superOnly=true 면 무시되고 super_admin 만. */
  roles: OperatorRole[];
  superOnly?: boolean;
  /** breadcrumb 조상 라벨(현재 항목 제외). 예: ['본사·브랜드']. */
  breadcrumb: string[];
  icon: string;
  /** 사이드바에서 숨김(동적/상세 라우트 등). */
  hiddenFromSidebar?: boolean;
  /** Command Palette 검색 대상 여부. */
  searchable: boolean;
  /** 구버전(검색 기본 제외). */
  deprecated?: boolean;
  /** 내부/Shadow 화면(검색 기본 제외). */
  internalOnly?: boolean;
}

const A: OperatorRole[] = ['super_admin', 'admin'];
const AH: OperatorRole[] = ['super_admin', 'admin', 'hq'];

/**
 * Canonical 라우트 목록. 실제 기능이 없는 가짜 화면은 만들지 않는다 —
 * 각 라우트는 기존 대표 패널/페이지를 componentKey 로 재사용한다.
 */
export const OPERATOR_ROUTES: OperatorRouteEntry[] = [
  // ── HOME ─────────────────────────────────────────────
  { id: 'home', label: '운영 홈', description: '핵심 지표·바로가기·온보딩', canonicalPath: '/ops', componentKey: 'home', category: 'home', keywords: ['홈', '운영', '대시보드'], aliases: ['home', 'ops'], roles: AH, breadcrumb: [], icon: 'Home', searchable: true },

  // ── STORES ───────────────────────────────────────────
  { id: 'stores', label: '매장', description: '매장 상태·연결 관제', canonicalPath: '/ops/stores', legacyTab: 'store-monitoring', componentKey: 'store-monitoring', category: 'stores', keywords: ['매장', '스토어', '지점'], aliases: ['stores', 'store'], roles: A, breadcrumb: ['매장'], icon: 'Store', searchable: true },
  { id: 'store-detail', label: '매장 상세', description: '매장별 상세·재생 설정', canonicalPath: '/ops/stores/:storeId', componentKey: 'store-detail', category: 'stores', keywords: ['매장 상세', '매장별 재생설정', 'store override'], aliases: ['store detail', 'store override'], roles: AH, breadcrumb: ['매장', '매장 상세'], icon: 'Store', hiddenFromSidebar: true, searchable: false },

  // ── ENTERPRISE (본사·브랜드) ──────────────────────────
  { id: 'enterprise', label: '본사·브랜드', description: '본사·브랜드 종합', canonicalPath: '/ops/enterprise', legacyTab: 'enterprise-overview', componentKey: 'enterprise-overview', category: 'enterprise', keywords: ['본사', '엔터프라이즈', '브랜드', '현황'], aliases: ['enterprise', 'hq'], roles: A, breadcrumb: ['본사·브랜드'], icon: 'Building2', searchable: true },
  { id: 'enterprise-accounts', label: '본사 계정', description: '본사 계정 관리', canonicalPath: '/ops/enterprise/accounts', legacyTab: 'enterprise-accounts', componentKey: 'enterprise-accounts', category: 'enterprise', keywords: ['본사 계정', '엔터프라이즈 계정'], aliases: ['accounts'], roles: A, breadcrumb: ['본사·브랜드', '본사 계정'], icon: 'Building2', searchable: true },
  { id: 'enterprise-franchises', label: '가맹점 관리', description: '프랜차이즈 매장·정책·매장별 재생설정 관리', canonicalPath: '/ops/enterprise/franchises', legacyTab: 'franchise', componentKey: 'franchise', category: 'enterprise', keywords: ['가맹점', '프랜차이즈', '매장 연결', '매장별 재생설정'], aliases: ['franchise', 'franchises', 'store override'], roles: A, breadcrumb: ['본사·브랜드', '가맹점 관리'], icon: 'Store', searchable: true },
  { id: 'enterprise-brands', label: '브랜드 자동가입', description: '브랜드 코드 기반 매장 자동 등록', canonicalPath: '/ops/enterprise/brands', legacyTab: 'brand-registry', componentKey: 'brand-registry', category: 'enterprise', keywords: ['브랜드', '브랜드 코드', '자동가입', '브랜드 관리'], aliases: ['brand', 'brand registry'], roles: ['super_admin'], superOnly: true, breadcrumb: ['본사·브랜드', '브랜드 자동가입'], icon: 'Building2', searchable: true },
  { id: 'invite-codes', label: '초대코드', description: '본사·매장 가입 초대코드(본사 계정에서 발급/회전)', canonicalPath: '/ops/enterprise/invite-codes', legacyTab: 'enterprise-accounts', componentKey: 'enterprise-accounts', category: 'enterprise', keywords: ['초대', '초대코드', '가입코드', '매장코드', '본사코드'], aliases: ['invite', 'invite code', 'invitation'], roles: A, breadcrumb: ['본사·브랜드', '초대코드'], icon: 'KeyRound', searchable: true },

  // ── MUSIC ────────────────────────────────────────────
  { id: 'music', label: '음악', description: '음악 배포·정책 관리', canonicalPath: '/ops/music', legacyTab: 'policy-deployment', componentKey: 'policy-deployment', category: 'music', keywords: ['음악', '뮤직'], aliases: ['music'], roles: A, breadcrumb: ['음악'], icon: 'Music', searchable: true },
  { id: 'music-playlists', label: '플레이리스트', description: '플레이리스트/콘텐츠 관리', canonicalPath: '/ops/music/playlists', legacyTab: 'content', componentKey: 'content', category: 'music', keywords: ['플레이리스트', '플리', '콘텐츠'], aliases: ['playlist', 'playlists'], roles: A, breadcrumb: ['음악', '플레이리스트'], icon: 'Music', searchable: true },
  { id: 'music-sets', label: '플레이리스트 세트', description: '가맹점 플레이리스트 세트(가맹점 관리)', canonicalPath: '/ops/music/sets', legacyTab: 'franchise', componentKey: 'franchise', category: 'music', keywords: ['플레이리스트 세트', '세트', '로테이션'], aliases: ['set', 'sets', 'playlist set'], roles: A, breadcrumb: ['음악', '플레이리스트 세트'], icon: 'Music', searchable: true },
  { id: 'music-schedules', label: '스케줄', description: '매장 음악 스케줄(가맹점 관리)', canonicalPath: '/ops/music/schedules', legacyTab: 'franchise', componentKey: 'franchise', category: 'music', keywords: ['스케줄', '시간표', '자동 스케줄'], aliases: ['schedule', 'schedules'], roles: A, breadcrumb: ['음악', '스케줄'], icon: 'Music', searchable: true },
  { id: 'music-breaks', label: '브레이크', description: '브레이크(무음) 슬롯 설정(가맹점 관리)', canonicalPath: '/ops/music/breaks', legacyTab: 'franchise', componentKey: 'franchise', category: 'music', keywords: ['브레이크', '무음', '휴식', 'break'], aliases: ['break', 'breaks'], roles: A, breadcrumb: ['음악', '브레이크'], icon: 'Music', searchable: true },
  { id: 'music-deployment', label: '배포 현황', description: '매장 음악 정책 배포 현황', canonicalPath: '/ops/music/deployment', legacyTab: 'policy-deployment', componentKey: 'policy-deployment', category: 'music', keywords: ['배포', '배포 현황', '정책 배포'], aliases: ['deployment', 'deploy'], roles: A, breadcrumb: ['음악', '배포 현황'], icon: 'Music', searchable: true },

  // ── MONITORING (관제) ─────────────────────────────────
  { id: 'monitoring', label: '관제', description: '통합 운영 관제', canonicalPath: '/ops/monitoring', legacyTab: 'enterprise-noc', componentKey: 'enterprise-noc', category: 'monitoring', keywords: ['관제', '모니터링', '운영센터', 'NOC'], aliases: ['monitoring', 'noc'], roles: A, breadcrumb: ['관제'], icon: 'Activity', searchable: true },
  { id: 'monitoring-live', label: '실시간 재생', description: '매장별 현재 재생 곡', canonicalPath: '/ops/monitoring/live', legacyTab: 'store-now-playing', componentKey: 'store-now-playing', category: 'monitoring', keywords: ['실시간 재생', '지금 재생', 'now playing'], aliases: ['live', 'now playing'], roles: A, breadcrumb: ['관제', '실시간 재생'], icon: 'Music', searchable: true },
  { id: 'monitoring-connectivity', label: '접속 상태', description: '매장 온라인/오프라인 상태', canonicalPath: '/ops/monitoring/connectivity', legacyTab: 'store-monitoring', componentKey: 'store-monitoring', category: 'monitoring', keywords: ['접속 상태', '온라인', '오프라인', '연결', '하트비트'], aliases: ['connectivity', 'heartbeat', 'online', 'offline'], roles: A, breadcrumb: ['관제', '접속 상태'], icon: 'Activity', searchable: true },
  { id: 'monitoring-quality', label: '재생 품질', description: '오디오 재생 품질 진단', canonicalPath: '/ops/monitoring/quality', legacyTab: 'audio-diagnostics', componentKey: 'audio-diagnostics', category: 'monitoring', keywords: ['재생 품질', '오디오 진단', '품질'], aliases: ['quality', 'audio', 'diagnostics'], roles: A, breadcrumb: ['관제', '재생 품질'], icon: 'Activity', searchable: true },
  { id: 'monitoring-incidents', label: '장애/NOC', description: '장애·운영 인시던트', canonicalPath: '/ops/monitoring/incidents', legacyTab: 'enterprise-noc', componentKey: 'enterprise-noc', category: 'monitoring', keywords: ['장애', '인시던트', 'NOC', '알림'], aliases: ['incidents', 'incident', 'noc'], roles: A, breadcrumb: ['관제', '장애/NOC'], icon: 'Activity', searchable: true },

  // ── FINANCE (정산·청구) ───────────────────────────────
  { id: 'finance', label: '정산·청구', description: '정산·청구 통합센터(카노니컬)', canonicalPath: '/ops/finance', legacyTab: 'enterprise-settlement-center', componentKey: 'enterprise-settlement-center', category: 'finance', keywords: ['정산', '청구', '정산청구', '통합센터'], aliases: ['finance', 'settlement center'], roles: ['super_admin'], superOnly: true, breadcrumb: ['정산·청구'], icon: 'Wallet', searchable: true },
  { id: 'finance-billing', label: '청구', description: '본사 청구서 관리', canonicalPath: '/ops/finance/billing', legacyTab: 'enterprise-billing', componentKey: 'enterprise-billing', category: 'finance', keywords: ['청구', '청구서', '빌링'], aliases: ['billing'], roles: A, breadcrumb: ['정산·청구', '청구'], icon: 'Wallet', searchable: true },
  { id: 'finance-settlements', label: '정산', description: '본사 월별 정산 내역', canonicalPath: '/ops/finance/settlements', legacyTab: 'enterprise-monthly-settlements', componentKey: 'enterprise-monthly-settlements', category: 'finance', keywords: ['정산', '월 정산', '정산 내역'], aliases: ['settlement', 'settlements'], roles: A, breadcrumb: ['정산·청구', '정산'], icon: 'Wallet', searchable: true },
  { id: 'finance-contracts', label: '계약', description: '본사 계약 관리', canonicalPath: '/ops/finance/contracts', legacyTab: 'enterprise-contracts', componentKey: 'enterprise-contracts', category: 'finance', keywords: ['계약', '컨트랙트'], aliases: ['contract', 'contracts'], roles: A, breadcrumb: ['정산·청구', '계약'], icon: 'Wallet', searchable: true },

  // ── REMAINING ────────────────────────────────────────
  { id: 'artists', label: '아티스트', description: '아티스트 승인·관리', canonicalPath: '/ops/artists', legacyTab: 'artists', componentKey: 'artists', category: 'artist-content', keywords: ['아티스트', '승인', '음원 검수'], aliases: ['artist', 'artists'], roles: A, breadcrumb: ['아티스트·콘텐츠', '아티스트'], icon: 'Mic2', searchable: true },
  { id: 'content', label: '콘텐츠', description: '플레이리스트·콘텐츠 관리', canonicalPath: '/ops/content', legacyTab: 'content', componentKey: 'content', category: 'artist-content', keywords: ['콘텐츠', '플레이리스트', '관리'], aliases: ['content'], roles: A, breadcrumb: ['아티스트·콘텐츠', '콘텐츠'], icon: 'Settings', searchable: true },
  { id: 'analytics', label: '분석', description: '전체 서비스 지표', canonicalPath: '/ops/analytics', legacyTab: 'dashboard', componentKey: 'dashboard', category: 'analytics', keywords: ['분석', '지표', '대시보드', '통계'], aliases: ['analytics', 'stats'], roles: A, breadcrumb: ['분석'], icon: 'BarChart3', searchable: true },
  { id: 'ai', label: 'AI', description: 'AI 큐레이션·분류', canonicalPath: '/ops/ai', legacyTab: 'ai-curation', componentKey: 'ai-curation', category: 'ai', keywords: ['AI', '큐레이션', '추천'], aliases: ['ai', 'curation'], roles: A, breadcrumb: ['AI'], icon: 'Sparkles', searchable: true },
  { id: 'system', label: '시스템', description: '사이트 설정·공지·관리자', canonicalPath: '/ops/system', legacyTab: 'site-settings', componentKey: 'site-settings', category: 'system', keywords: ['시스템', '설정', '공지', '관리자'], aliases: ['system', 'settings'], roles: A, breadcrumb: ['시스템'], icon: 'Settings', searchable: true },
];

/** App.tsx 라우트 등록용: '/ops'(홈) 을 제외한 모든 canonicalPath. :param 세그먼트 포함. */
export const OPERATOR_ROUTE_PATHS: string[] = OPERATOR_ROUTES
  .filter((r) => r.canonicalPath !== '/ops')
  .map((r) => r.canonicalPath);

// ── 조회/파생 헬퍼 (순수) ──────────────────────────────────────────────────────
type RoleGated = { roles: OperatorRole[]; superOnly?: boolean };

/** 항목이 컨텍스트 역할로 노출 가능한지. superOnly 는 super_admin 만. */
export function canAccessRoute(entry: RoleGated, ctx: OperatorAccessContext): boolean {
  if (entry.superOnly) return ctx.isSuperAdmin;
  const roles = operatorRolesFromContext(ctx);
  return entry.roles.some((r) => roles.has(r));
}

/** id 로 조회. */
export function getRouteById(id: string): OperatorRouteEntry | undefined {
  return OPERATOR_ROUTES.find((r) => r.id === id);
}

/** canonicalPath(정적) 로 조회. 동적(:param) 라우트는 matchOpsPath 사용. */
export function getRouteByPath(path: string): OperatorRouteEntry | undefined {
  return OPERATOR_ROUTES.find((r) => r.canonicalPath === path);
}

/** 현재 pathname 을 레지스트리 항목에 매칭(정적 우선, 동적 :param 지원). */
export function matchOpsRoute(pathname: string): OperatorRouteEntry | undefined {
  const exact = OPERATOR_ROUTES.find((r) => r.canonicalPath === pathname && !r.canonicalPath.includes(':'));
  if (exact) return exact;
  // 동적 매칭: 세그먼트 수 동일 + :param 위치 와일드카드
  const segs = pathname.split('/').filter(Boolean);
  return OPERATOR_ROUTES.find((r) => {
    if (!r.canonicalPath.includes(':')) return false;
    const rsegs = r.canonicalPath.split('/').filter(Boolean);
    if (rsegs.length !== segs.length) return false;
    return rsegs.every((s, i) => s.startsWith(':') || s === segs[i]);
  });
}

/** 사이드바용: 역할 필터 + 숨김 제외 후, 카테고리별로 묶는다(빈 카테고리 제외). */
export interface OperatorSidebarSection {
  id: OperatorCategory;
  label: string;
  icon: string;
  items: OperatorRouteEntry[];
}
export function sidebarSectionsForRole(ctx: OperatorAccessContext): OperatorSidebarSection[] {
  return OPERATOR_CATEGORIES
    .map((cat) => ({
      id: cat.id,
      label: cat.label,
      icon: cat.icon,
      items: OPERATOR_ROUTES.filter(
        (r) => r.category === cat.id && !r.hiddenFromSidebar && canAccessRoute(r, ctx),
      ),
    }))
    .filter((sec) => sec.items.length > 0);
}

/** 검색 후보: searchable 이고 deprecated/internalOnly 가 아니며 역할 접근 가능. */
function searchableForRole(ctx: OperatorAccessContext): OperatorRouteEntry[] {
  return OPERATOR_ROUTES.filter(
    (r) => r.searchable && !r.deprecated && !r.internalOnly && canAccessRoute(r, ctx),
  );
}

export interface OperatorSearchResult {
  entry: OperatorRouteEntry;
  score: number;
}

/**
 * Command Palette 검색. 정적 인덱스(레지스트리)만 사용 — 네트워크/컴포넌트 import 없음.
 * label > keywords > aliases > description 순 가중치. 대소문자·공백 무시. 권한 필터.
 */
export function searchOperatorRoutes(
  query: string,
  ctx: OperatorAccessContext,
  limit = 8,
): OperatorSearchResult[] {
  const candidates = searchableForRole(ctx);
  const q = query.trim().toLowerCase();
  if (!q) {
    // 빈 쿼리: 대표 항목(각 카테고리 허브 성격)을 순서대로.
    return candidates.slice(0, limit).map((entry) => ({ entry, score: 0 }));
  }
  const results: OperatorSearchResult[] = [];
  for (const entry of candidates) {
    const label = entry.label.toLowerCase();
    const kw = entry.keywords.map((k) => k.toLowerCase());
    const al = (entry.aliases ?? []).map((a) => a.toLowerCase());
    const desc = entry.description.toLowerCase();
    let score = 0;
    if (label === q) score = Math.max(score, 100);
    else if (label.startsWith(q)) score = Math.max(score, 80);
    else if (label.includes(q)) score = Math.max(score, 60);
    if (kw.some((k) => k === q)) score = Math.max(score, 70);
    else if (kw.some((k) => k.includes(q))) score = Math.max(score, 50);
    if (al.some((a) => a === q)) score = Math.max(score, 65);
    else if (al.some((a) => a.includes(q))) score = Math.max(score, 45);
    if (desc.includes(q)) score = Math.max(score, 20);
    if (score > 0) results.push({ entry, score });
  }
  results.sort((a, b) => (b.score - a.score) || a.entry.label.localeCompare(b.entry.label));
  return results.slice(0, limit);
}

/** breadcrumb 세그먼트 생성: 조상 라벨(레지스트리) + 현재 라벨. 동적 항목은 dynamicLabel 로 현재 라벨 대체. */
export interface OperatorBreadcrumbSegment {
  label: string;
  /** 클릭 이동 경로(마지막 현재 항목은 undefined). */
  href?: string;
}
export function breadcrumbFor(
  entry: OperatorRouteEntry | undefined,
  dynamicLabel?: string,
): OperatorBreadcrumbSegment[] {
  const segs: OperatorBreadcrumbSegment[] = [{ label: '운영 홈', href: '/ops' }];
  if (!entry || entry.id === 'home') {
    // 홈이면 마지막을 현재로.
    segs[segs.length - 1] = { label: '운영 홈' };
    return segs;
  }
  // 조상 라벨 → 해당 라벨을 가진 라우트로 링크(있으면).
  for (const ancestorLabel of entry.breadcrumb.slice(0, -1)) {
    const target = OPERATOR_ROUTES.find(
      (r) => r.label === ancestorLabel && !r.hiddenFromSidebar,
    );
    segs.push({ label: ancestorLabel, href: target?.canonicalPath });
  }
  // 현재 항목(동적이면 dynamicLabel 우선, 없으면 fallback 라벨 — 가짜 이름 금지).
  const currentLabel = entry.canonicalPath.includes(':')
    ? (dynamicLabel && dynamicLabel.trim() ? dynamicLabel : entry.breadcrumb[entry.breadcrumb.length - 1] ?? entry.label)
    : entry.label;
  segs.push({ label: currentLabel });
  return segs;
}
