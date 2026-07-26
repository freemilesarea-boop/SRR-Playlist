/**
 * operatorNavigation.ts — Phase ADMIN-UX-IMPLEMENT-1
 *
 * 통합 운영자 셸(Operator Shell)의 단일 네비게이션 설정(Single Source of Truth).
 *
 * 목적
 *   • 신규 입사자도 핵심 운영 화면을 직관적으로 찾을 수 있도록, 흩어진 관리자/엔터프라이즈
 *     화면들을 역할 기반 10개 섹션으로 재구성한다.
 *   • 이 파일은 순수(pure) 설정/로직만 담는다. React/JSX 를 포함하지 않으므로 유닛 테스트가 쉽다.
 *     (아이콘은 lucide-react 컴포넌트 이름 문자열로만 보관하고, 실제 매핑은 Sidebar 에서 수행.)
 *
 * 절대 원칙 (이 파일이 지키는 계약)
 *   • 기존 /admin?tab=X 딥링크를 "재사용"한다. 새 라우트를 만들지 않고, 기존 URL 규약을 그대로 가리킨다.
 *   • 권한을 UI 상태만으로 확대하지 않는다. allowedRoles/superOnly 는 "보여줄지" 만 결정하고,
 *     실제 접근 권한은 대상 라우트의 서버 RPC / RequireAdmin / RLS 가 최종 판정한다.
 *   • /admin?tab= 대상은 RequireAdmin(profile.role==='admin') 뒤에 있으므로, 플랫폼 관리자
 *     (super_admin/admin)만 노출한다. /enterprise/* 대상은 본사(hq) 역할에도 노출한다.
 */

// ── 역할 모델 ────────────────────────────────────────────────────────────────
export type OperatorRole = 'super_admin' | 'admin' | 'hq';

/** 로그인 사용자의 운영 역할 신호. 각 신호의 판정은 기존 훅/ RPC 를 그대로 사용한다. */
export interface OperatorAccessContext {
  /** admin_my_permissions.is_super_admin */
  isSuperAdmin: boolean;
  /** profile.role === 'admin' (플랫폼 스태프 관리자) */
  isPlatformAdmin: boolean;
  /** useEnterpriseSelfRole.role.is_hq || getMyFranchiseAdmin.is_franchise_admin */
  isHq: boolean;
}

/** 컨텍스트를 역할 집합으로 정규화. super_admin 은 admin 권한도 포함한다. */
export function operatorRolesFromContext(ctx: OperatorAccessContext): Set<OperatorRole> {
  const roles = new Set<OperatorRole>();
  if (ctx.isSuperAdmin) {
    roles.add('super_admin');
    roles.add('admin'); // super 는 플랫폼 admin 화면 전부 접근 가능
  }
  if (ctx.isPlatformAdmin) roles.add('admin');
  if (ctx.isHq) roles.add('hq');
  return roles;
}

/** /ops 셸 진입 자격 = 플랫폼 관리자 이거나 본사(hq) 이면 운영자. */
export function isOperator(ctx: OperatorAccessContext): boolean {
  return ctx.isSuperAdmin || ctx.isPlatformAdmin || ctx.isHq;
}

// ── 네비게이션 아이템 / 섹션 타입 ─────────────────────────────────────────────
export interface OperatorNavItem {
  id: string;
  label: string;
  /** 한 줄 설명 — 운영자가 무엇을 하는 화면인지 즉시 알 수 있도록. */
  description: string;
  /** 카노니컬 이동 경로. 대부분 기존 /admin?tab=X 딥링크 또는 /enterprise/* 라우트. */
  href: string;
  /** 이 아이템이 가리키는 AdminPage 탭 키 (문서화 + 하위호환 추적용). */
  legacyTab?: string;
  /** 이 역할 집합 중 하나라도 있으면 노출. superOnly 가 true 면 이 필드는 무시되고 super 만 노출. */
  allowedRoles: OperatorRole[];
  /** 슈퍼 관리자 전용 화면 (AdminPage TABS 의 superOnly 와 1:1). */
  superOnly?: boolean;
  /** 온보딩/툴팁용 도움말. */
  helpText?: string;
  /** 향후 배지(미확인 건수 등) 연결 키 — 현재는 예약만. 가짜 수치를 만들지 않는다. */
  badgeKey?: string;
}

export interface OperatorNavSection {
  id: string;
  label: string;
  /** lucide-react 아이콘 이름 (Sidebar 에서 컴포넌트로 매핑). */
  icon: string;
  description: string;
  items: OperatorNavItem[];
}

// ── 딥링크 헬퍼 ──────────────────────────────────────────────────────────────
const tab = (key: string) => `/admin?tab=${key}`;

// ── 10개 운영 섹션 (단일 설정 객체) ───────────────────────────────────────────
export const OPERATOR_NAV_SECTIONS: OperatorNavSection[] = [
  {
    id: 'home',
    label: '운영 홈',
    icon: 'Home',
    description: '오늘의 운영 현황과 빠른 작업',
    items: [
      { id: 'ops-home', label: '운영 홈', description: '핵심 지표·바로가기·온보딩', href: '/ops', allowedRoles: ['super_admin', 'admin', 'hq'] },
      { id: 'admin-dashboard', label: '관리자 대시보드', description: '전체 서비스 현황판', href: tab('dashboard'), legacyTab: 'dashboard', allowedRoles: ['super_admin', 'admin'] },
      { id: 'business-live', label: '매장 실시간', description: '영업 중 매장의 실시간 상태', href: tab('business-live'), legacyTab: 'business-live', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'stores',
    label: '매장',
    icon: 'Store',
    description: '매장 연결·상태·재생 관리',
    items: [
      { id: 'store-monitoring', label: '매장 상태', description: '매장 온라인/오프라인 모니터링', href: tab('store-monitoring'), legacyTab: 'store-monitoring', allowedRoles: ['super_admin', 'admin'] },
      { id: 'store-now-playing', label: '실시간 재생', description: '매장별 현재 재생 곡', href: tab('store-now-playing'), legacyTab: 'store-now-playing', allowedRoles: ['super_admin', 'admin'] },
      { id: 'franchise', label: '매장 만들기·연결', description: '프랜차이즈 매장 생성·연결·재생설정', href: tab('franchise'), legacyTab: 'franchise', allowedRoles: ['super_admin', 'admin'], helpText: '프랜차이즈 관리 화면에서 매장 등록과 정책 연결을 한 번에.' },
      { id: 'hq-dashboard', label: '본사 대시보드', description: '본사(HQ) 관점 매장 종합 현황', href: '/enterprise/me', allowedRoles: ['hq', 'super_admin', 'admin'], helpText: '본사 계정의 매장·정책·동기화 현황.' },
    ],
  },
  {
    id: 'hq-brand',
    label: '본사·브랜드',
    icon: 'Building2',
    description: '본사 계정·초대코드·브랜드',
    items: [
      { id: 'enterprise-overview', label: '엔터프라이즈 현황', description: '본사·브랜드·매장 종합 현황', href: tab('enterprise-overview'), legacyTab: 'enterprise-overview', allowedRoles: ['super_admin', 'admin'] },
      { id: 'enterprise-accounts', label: '초대코드 관리', description: '본사 계정·가입 초대코드 발급/회전', href: tab('enterprise-accounts'), legacyTab: 'enterprise-accounts', allowedRoles: ['super_admin', 'admin'], helpText: '본사 계정을 만들고 매장 가입용 초대코드를 발급·회전합니다.' },
      { id: 'enterprise-regions', label: '지역 관리', description: '본사 하위 지역(region) 구성', href: tab('enterprise-regions'), legacyTab: 'enterprise-regions', allowedRoles: ['super_admin', 'admin'] },
      { id: 'enterprise-contracts', label: '계약 관리', description: '본사 계약 등록·상태 관리', href: tab('enterprise-contracts'), legacyTab: 'enterprise-contracts', allowedRoles: ['super_admin', 'admin'] },
      { id: 'brand-registry', label: '브랜드 자동가입', description: '브랜드 코드 기반 매장 자동 등록(brand_registry)', href: tab('brand-registry'), legacyTab: 'brand-registry', allowedRoles: ['super_admin'], superOnly: true, helpText: '브랜드 코드로 신규 매장이 자동 가입되도록 관리하는 화면.' },
      { id: 'brand-player', label: '브랜드 플레이어', description: '브랜드 단위 플레이어 구성(brands)', href: tab('brand-player'), legacyTab: 'brand-player', allowedRoles: ['super_admin'], superOnly: true },
      { id: 'brand-logo', label: '브랜드 로고', description: '서비스 브랜드 로고/이미지', href: tab('brand'), legacyTab: 'brand', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'music',
    label: '음악',
    icon: 'Music',
    description: '음악 배포·스케줄·방송',
    items: [
      { id: 'policy-deployment', label: '음악 배포 현황', description: '매장 음악 정책 배포 상태', href: tab('policy-deployment'), legacyTab: 'policy-deployment', allowedRoles: ['super_admin', 'admin'] },
      { id: 'policy-automation', label: '자동 음악 스케줄', description: '시간대별 자동 음악 스케줄', href: tab('policy-automation'), legacyTab: 'policy-automation', allowedRoles: ['super_admin', 'admin'] },
      { id: 'enterprise-announcements', label: '안내/광고 음원', description: '매장 안내·광고 음원 관리', href: tab('enterprise-announcements'), legacyTab: 'enterprise-announcements', allowedRoles: ['super_admin', 'admin'] },
      { id: 'enterprise-emergency', label: '긴급 방송', description: '긴급 방송 발화 관리', href: tab('enterprise-emergency'), legacyTab: 'enterprise-emergency', allowedRoles: ['super_admin', 'admin'] },
      { id: 'streaming', label: '스트리밍', description: '스트리밍 재생/집계', href: tab('streaming'), legacyTab: 'streaming', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'monitoring',
    label: '관제',
    icon: 'Activity',
    description: '운영센터·관제·로그',
    items: [
      { id: 'enterprise-noc', label: '운영센터(NOC)', description: '통합 운영 관제 센터', href: tab('enterprise-noc'), legacyTab: 'enterprise-noc', allowedRoles: ['super_admin', 'admin'] },
      { id: 'enterprise-operations', label: '운영 관제', description: '엔터프라이즈 운영 관제', href: tab('enterprise-operations'), legacyTab: 'enterprise-operations', allowedRoles: ['super_admin'], superOnly: true },
      { id: 'enterprise-command-center', label: 'Command Center', description: '엔터프라이즈 통합 커맨드 센터', href: tab('enterprise-command-center'), legacyTab: 'enterprise-command-center', allowedRoles: ['super_admin'], superOnly: true },
      { id: 'operation-logs', label: '운영 로그', description: '운영/감사 로그 조회', href: tab('operation-logs'), legacyTab: 'operation-logs', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'finance',
    label: '정산·청구',
    icon: 'Wallet',
    description: '정산·청구 통합 관리',
    items: [
      { id: 'enterprise-settlement-center', label: '정산·청구 통합센터', description: '본사 정산·청구 통합 화면(카노니컬)', href: tab('enterprise-settlement-center'), legacyTab: 'enterprise-settlement-center', allowedRoles: ['super_admin'], superOnly: true, helpText: '정산·청구를 한곳에서 관리하는 통합 센터.' },
      { id: 'enterprise-monthly-settlements', label: '본사 월 정산', description: '본사 월별 정산 내역', href: tab('enterprise-monthly-settlements'), legacyTab: 'enterprise-monthly-settlements', allowedRoles: ['super_admin', 'admin'] },
      { id: 'enterprise-billing', label: '본사 청구', description: '본사 청구서 관리', href: tab('enterprise-billing'), legacyTab: 'enterprise-billing', allowedRoles: ['super_admin', 'admin'] },
      { id: 'revenue', label: '매출', description: '서비스 매출 집계', href: tab('revenue'), legacyTab: 'revenue', allowedRoles: ['super_admin', 'admin'] },
      { id: 'subscriptions', label: '구독신청', description: '구독 신청·상태 관리', href: tab('subscriptions'), legacyTab: 'subscriptions', allowedRoles: ['super_admin', 'admin'] },
      { id: 'artist-settlements', label: '아티스트 정산', description: '아티스트 정산 내역', href: tab('artist-settlements'), legacyTab: 'artist-settlements', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'artist-content',
    label: '아티스트·콘텐츠',
    icon: 'Mic2',
    description: '아티스트 승인·음원 검수·콘텐츠',
    items: [
      { id: 'artists', label: '아티스트 승인', description: '아티스트 가입 승인', href: tab('artists'), legacyTab: 'artists', allowedRoles: ['super_admin', 'admin'] },
      { id: 'track-review', label: '음원 검수', description: '업로드 음원 검수', href: tab('track-review'), legacyTab: 'track-review', allowedRoles: ['super_admin', 'admin'] },
      { id: 'qc-review', label: 'AI QC 검수', description: 'AI 품질 검수 큐', href: tab('qc-review'), legacyTab: 'qc-review', allowedRoles: ['super_admin', 'admin'] },
      { id: 'artist-tracks', label: '음원 관리', description: '아티스트 음원 관리', href: tab('artist-tracks'), legacyTab: 'artist-tracks', allowedRoles: ['super_admin', 'admin'] },
      { id: 'content', label: '콘텐츠 관리', description: '플레이리스트·콘텐츠 관리', href: tab('content'), legacyTab: 'content', allowedRoles: ['super_admin', 'admin'] },
      { id: 'auto-playlists', label: '자동 플리/배치', description: '자동 플레이리스트/배치', href: tab('auto-playlists'), legacyTab: 'auto-playlists', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'analytics',
    label: '분석',
    icon: 'BarChart3',
    description: '지표·매출·현황 분석',
    items: [
      { id: 'analytics-dashboard', label: '대시보드', description: '전체 서비스 지표', href: tab('dashboard'), legacyTab: 'dashboard', allowedRoles: ['super_admin', 'admin'] },
      { id: 'analytics-revenue', label: '매출 분석', description: '매출 추이·집계', href: tab('revenue'), legacyTab: 'revenue', allowedRoles: ['super_admin', 'admin'] },
      { id: 'analytics-enterprise', label: '엔터프라이즈 현황', description: '본사·매장 지표', href: tab('enterprise-overview'), legacyTab: 'enterprise-overview', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: 'Sparkles',
    description: 'AI 큐레이션·분류',
    items: [
      { id: 'ai-curation', label: 'AI 큐레이션', description: 'AI 기반 큐레이션', href: tab('ai-curation'), legacyTab: 'ai-curation', allowedRoles: ['super_admin', 'admin'] },
      { id: 'clap-curation', label: 'CLAP 추천', description: 'CLAP 임베딩 추천', href: tab('clap-curation'), legacyTab: 'clap-curation', allowedRoles: ['super_admin', 'admin'] },
      { id: 'ai-metadata', label: 'AI 메타데이터', description: 'AI 메타데이터 보정', href: tab('ai-metadata'), legacyTab: 'ai-metadata', allowedRoles: ['super_admin', 'admin'] },
      { id: 'ai-genre', label: 'AI 장르 분류', description: 'AI 장르 자동 분류', href: tab('ai-genre'), legacyTab: 'ai-genre', allowedRoles: ['super_admin', 'admin'] },
      { id: 'ai-mood', label: 'AI 무드 분류', description: 'AI 무드 자동 분류', href: tab('ai-mood'), legacyTab: 'ai-mood', allowedRoles: ['super_admin', 'admin'] },
      { id: 'ai-storetype', label: 'AI 매장 유형', description: 'AI 매장 유형 분류', href: tab('ai-storetype'), legacyTab: 'ai-storetype', allowedRoles: ['super_admin', 'admin'] },
    ],
  },
  {
    id: 'system',
    label: '시스템',
    icon: 'Settings',
    description: '설정·공지·진단·관리자',
    items: [
      { id: 'site-settings', label: '사이트 설정', description: '전역 사이트 설정', href: tab('site-settings'), legacyTab: 'site-settings', allowedRoles: ['super_admin', 'admin'] },
      { id: 'site-notices', label: '공지/팝업', description: '공지·팝업 관리', href: tab('site-notices'), legacyTab: 'site-notices', allowedRoles: ['super_admin', 'admin'] },
      { id: 'audio-diagnostics', label: '오디오 진단', description: '오디오 재생 진단', href: tab('audio-diagnostics'), legacyTab: 'audio-diagnostics', allowedRoles: ['super_admin', 'admin'] },
      { id: 'upload-audit', label: '업로드/스토리지 점검', description: '업로드·스토리지 무결성 점검', href: tab('upload-audit'), legacyTab: 'upload-audit', allowedRoles: ['super_admin', 'admin'] },
      { id: 'admins', label: '관리자 설정', description: '관리자 계정·권한 관리', href: tab('admins'), legacyTab: 'admins', allowedRoles: ['super_admin'], superOnly: true },
    ],
  },
];

// ── 운영 홈 빠른 작업 (딥링크) ─────────────────────────────────────────────────
export interface OperatorQuickAction {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: string;
  allowedRoles: OperatorRole[];
  superOnly?: boolean;
}

export const OPERATOR_QUICK_ACTIONS: OperatorQuickAction[] = [
  { id: 'qa-invite', label: '초대코드 발급', description: '본사·매장 가입 초대코드', href: tab('enterprise-accounts'), icon: 'KeyRound', allowedRoles: ['super_admin', 'admin'] },
  { id: 'qa-franchise', label: '매장 만들기·연결', description: '프랜차이즈 매장 등록', href: tab('franchise'), icon: 'Store', allowedRoles: ['super_admin', 'admin'] },
  { id: 'qa-store-status', label: '매장 상태 보기', description: '매장 온/오프라인', href: tab('store-monitoring'), icon: 'Activity', allowedRoles: ['super_admin', 'admin'] },
  { id: 'qa-music-deploy', label: '음악 배포 현황', description: '음악 정책 배포', href: tab('policy-deployment'), icon: 'Music', allowedRoles: ['super_admin', 'admin'] },
  { id: 'qa-settlement', label: '정산·청구 통합센터', description: '정산·청구 통합', href: tab('enterprise-settlement-center'), icon: 'Wallet', allowedRoles: ['super_admin'], superOnly: true },
  { id: 'qa-monthly-settlement', label: '본사 월 정산', description: '본사 월별 정산', href: tab('enterprise-monthly-settlements'), icon: 'Wallet', allowedRoles: ['admin'] },
  { id: 'qa-noc', label: '운영센터(NOC)', description: '통합 관제', href: tab('enterprise-noc'), icon: 'Activity', allowedRoles: ['super_admin', 'admin'] },
  { id: 'qa-hq-home', label: '본사 대시보드', description: '본사 종합 현황', href: '/enterprise/me', icon: 'Building2', allowedRoles: ['hq', 'super_admin', 'admin'] },
];

// ── 권한 필터링 (순수 함수) ────────────────────────────────────────────────────
type RoleGated = { allowedRoles: OperatorRole[]; superOnly?: boolean };

/** 아이템이 컨텍스트 역할로 노출 가능한지. superOnly 는 super_admin 만. */
export function canAccess(item: RoleGated, ctx: OperatorAccessContext): boolean {
  if (item.superOnly) return ctx.isSuperAdmin;
  const roles = operatorRolesFromContext(ctx);
  return item.allowedRoles.some((r) => roles.has(r));
}

/** 역할에 맞는 섹션만, 그리고 각 섹션 내 노출 가능한 아이템만 남긴다. 빈 섹션은 제거. */
export function filterNavSections(ctx: OperatorAccessContext): OperatorNavSection[] {
  return OPERATOR_NAV_SECTIONS
    .map((section) => ({ ...section, items: section.items.filter((it) => canAccess(it, ctx)) }))
    .filter((section) => section.items.length > 0);
}

/** 역할에 맞는 빠른 작업만. */
export function filterQuickActions(ctx: OperatorAccessContext): OperatorQuickAction[] {
  return OPERATOR_QUICK_ACTIONS.filter((qa) => canAccess(qa, ctx));
}

/** 현재 경로(예: /admin?tab=store-monitoring, /ops)와 일치하는 nav 아이템 id 를 찾는다. */
export function activeNavItemId(pathname: string, search: string): string | null {
  const currentTab = new URLSearchParams(search).get('tab');
  for (const section of OPERATOR_NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.href === '/ops' && pathname === '/ops') return item.id;
      if (item.legacyTab && pathname === '/admin' && item.legacyTab === currentTab) return item.id;
      if (!item.legacyTab && item.href !== '/ops' && item.href === pathname) return item.id;
    }
  }
  return null;
}
