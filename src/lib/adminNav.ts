/**
 * adminNav — Phase ADMIN-IA-SIMPLIFICATION-1
 *
 * 관리자 정보구조(IA) 단일 정의. 업무 중심 1차 메뉴(8) → 2차(subgroup) → 페이지(tab).
 *
 * 원칙:
 *   - 기능 삭제/추가 없음. 기존 탭 key 를 그대로 재배치(리네이밍은 label 만).
 *   - 탭 key 불변 → 기존 딥링크 ?tab=<key> 전부 보존(회귀 없음).
 *   - 기술 명칭은 업무 명칭으로(라벨만). 원 기술어는 tooltip/문서에서만.
 *   - 고급/기술 탭은 기본 숨김(Progressive Disclosure) — key/route 는 유지.
 * 순수 로직만(아이콘/JSX 없음) — 유닛 테스트 대상.
 */

/** 업무 중심 1차 메뉴(≤9). */
export type AdminGroup =
  | '홈'
  | '회원'
  | '음원'
  | '플레이리스트'
  | '매장'
  | '본사·브랜드'
  | '정산'
  | '운영·설정';

export interface NavSubgroup {
  name: string;
  tabs: string[];
}
export interface NavGroupNode {
  group: AdminGroup;
  /** 한 줄 설명(페이지 헤더/온보딩용). */
  hint: string;
  subgroups: NavSubgroup[];
}

/**
 * IA 트리 — 모든 기존 탭 key 를 업무 중심 그룹/서브그룹으로 재배치한 단일 소스.
 * (기존 AdminPage 의 GROUPS + ENTERPRISE_SUBGROUPS 를 8개 업무 그룹으로 통합)
 */
export const GROUP_TREE: NavGroupNode[] = [
  {
    group: '홈',
    hint: '오늘 처리할 업무 시작점',
    subgroups: [{ name: '홈', tabs: ['dashboard'] }],
  },
  {
    group: '회원',
    hint: '회원·아티스트·영업 계정 관리',
    subgroups: [
      { name: '회원·큐레이터', tabs: ['members', 'member-broadcast', 'curators'] },
      { name: '수강신청', tabs: ['course-products'] },
      { name: '아티스트', tabs: ['artists', 'artist-contracts'] },
      { name: '영업·체험', tabs: ['sales-agents', 'sales-partners', 'free-trials'] },
    ],
  },
  {
    group: '음원',
    hint: '음원 검수·목록·분석·오디오 점검',
    subgroups: [
      { name: '검수·QC', tabs: ['track-review', 'qc-review', 'metadata-violations'] },
      { name: '음원 목록', tabs: ['artist-tracks', 'deleted-tracks'] },
      { name: '분석·메타', tabs: ['ai-metadata', 'ai-genre', 'ai-mood', 'ai-storetype', 'ai-taxonomy'] },
      { name: '오디오 점검', tabs: ['audio-reencode', 'audio-diagnostics', 'audio-engine-diagnostics', 'upload-audit', 'upload-integrity'] },
    ],
  },
  {
    group: '플레이리스트',
    hint: '플레이리스트 제작·편집·추천 도구',
    subgroups: [
      { name: '제작·편집', tabs: ['playlist-builder', 'content', 'auto-playlists'] },
      { name: '추천·품질', tabs: ['ai-curation', 'clap-curation', 'recommendation', 'placement-audit'] },
    ],
  },
  {
    group: '매장',
    hint: '매장 상태·재생·정책·관제',
    subgroups: [
      { name: '상태·장애', tabs: ['business-live', 'store-monitoring', 'store-now-playing'] },
      { name: '재생·정책', tabs: ['policy-deployment', 'policy-automation', 'enterprise-announcements', 'enterprise-emergency'] },
      { name: '관제', tabs: ['enterprise-noc', 'enterprise-operations', 'brand-player'] },
    ],
  },
  {
    group: '본사·브랜드',
    hint: '본사·브랜드·프랜차이즈·지역',
    subgroups: [
      { name: '전체 현황', tabs: ['enterprise-overview', 'enterprise-command-center'] },
      { name: '본사·브랜드', tabs: ['enterprise-accounts', 'brand-registry', 'enterprise-regions'] },
      { name: '프랜차이즈·계약', tabs: ['franchise', 'enterprise-contracts'] },
    ],
  },
  {
    group: '정산',
    hint: '아티스트 정산·본사 청구·결제',
    subgroups: [
      { name: '아티스트 정산', tabs: ['artist-settlements', 'payout-intake', 'payout-verification'] },
      { name: '본사·매장 청구', tabs: ['enterprise-billing', 'enterprise-monthly-settlements', 'enterprise-settlement-center'] },
      { name: '결제·매출', tabs: ['streaming', 'revenue', 'subscriptions', 'promotions', 'payment-sync', 'streaming-v2', 'settlement-v2'] },
    ],
  },
  {
    group: '운영·설정',
    hint: '문의·로그·서비스 설정·권한',
    subgroups: [
      { name: '운영', tabs: ['support-inquiries', 'operation-logs'] },
      { name: '설정', tabs: ['site-settings', 'site-notices', 'brand', 'admins'] },
    ],
  },
];

/** 1차 메뉴 순서. */
export const ADMIN_GROUPS: AdminGroup[] = GROUP_TREE.map((g) => g.group);

/** IA 트리에 배치된 전체 탭 key(중복 배치 검증용). */
export const ALL_NAV_TAB_KEYS: string[] = GROUP_TREE.flatMap((g) => g.subgroups.flatMap((s) => s.tabs));

/**
 * 기본 숨김(고급/기술) 탭 — Progressive Disclosure. key/route 유지, 기본 노출만 축소.
 * 일반 관리 업무에 필수가 아닌 진단/기술/그림자 화면.
 */
export const ADVANCED_TABS: ReadonlySet<string> = new Set<string>([
  'audio-reencode',
  'audio-diagnostics',
  'audio-engine-diagnostics',
  'upload-audit',
  'upload-integrity',
  'ai-taxonomy',
  'placement-audit',
  'recommendation',
  'enterprise-noc',
  'enterprise-operations',
  'brand-player',
  'enterprise-command-center',
  'streaming-v2',
  'settlement-v2',
]);

export function isAdvancedTab(tabKey: string): boolean {
  return ADVANCED_TABS.has(tabKey);
}

/**
 * 업무 중심 라벨 override — 기술 명칭을 업무 명칭으로(label 만 변경, key 불변).
 * 여기 없는 key 는 기존 라벨을 그대로 사용한다.
 */
export const TAB_LABEL_OVERRIDE: Record<string, string> = {
  'enterprise-command-center': '통합 관제',
  'enterprise-overview': '전체 현황',
  'enterprise-noc': '관제 센터',
  'enterprise-operations': '운영 관제',
  'ai-curation': '추천 후보',
  'clap-curation': '유사곡 추천',
  'streaming-v2': '스트리밍(신규)',
  'settlement-v2': '정산(신규)',
  'placement-audit': '배치 점검',
};

export function labelForTab(tabKey: string, fallback: string): string {
  return TAB_LABEL_OVERRIDE[tabKey] ?? fallback;
}

/**
 * 기술어 → 업무어 변환(문서/tooltip/설명용). 화면 라벨 외 참고용.
 * Command Center / Candidate Pool / Learning Dashboard / Adaptive Score / Runtime / Fleet 등.
 */
export const TECHNICAL_LABEL_MAP: Record<string, string> = {
  'command center': '통합 관제',
  'candidate pool': '추천 후보',
  'learning dashboard': '매장 반응',
  'adaptive score': '실제 반응 점수',
  'runtime settings': '재생 설정',
  runtime: '재생 설정',
  fleet: '매장 현황',
  noc: '관제 센터',
  intelligence: '분석',
  governance: '정책',
  orchestration: '자동화',
};

/** 기술어가 포함된 문자열을 업무어로 치환(대소문자 무시, 긴 키 우선). */
export function businessLabel(input: string): string {
  let out = input;
  const keys = Object.keys(TECHNICAL_LABEL_MAP).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig');
    out = out.replace(re, TECHNICAL_LABEL_MAP[k]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 매핑 helpers
// ---------------------------------------------------------------------------
const _groupOf = new Map<string, AdminGroup>();
const _subOf = new Map<string, string>();
for (const g of GROUP_TREE) {
  for (const s of g.subgroups) {
    for (const t of s.tabs) {
      _groupOf.set(t, g.group);
      _subOf.set(t, s.name);
    }
  }
}

/** 탭 key 의 1차 그룹. 미배치 key 는 '운영·설정'로 폴백(무손실). */
export function groupOfTab(tabKey: string): AdminGroup {
  return _groupOf.get(tabKey) ?? '운영·설정';
}

/** 탭 key 의 2차 서브그룹 이름(그룹 내). 미배치는 그룹 첫 서브그룹. */
export function subgroupOfTab(tabKey: string): string {
  const found = _subOf.get(tabKey);
  if (found) return found;
  const g = groupOfTab(tabKey);
  return GROUP_TREE.find((n) => n.group === g)?.subgroups[0]?.name ?? '';
}

export function groupNode(group: AdminGroup): NavGroupNode | undefined {
  return GROUP_TREE.find((n) => n.group === group);
}

export function subgroupsOf(group: AdminGroup): NavSubgroup[] {
  return groupNode(group)?.subgroups ?? [];
}

/** 그룹 한 줄 설명. */
export function groupHint(group: AdminGroup): string {
  return groupNode(group)?.hint ?? '';
}

// ---------------------------------------------------------------------------
// Breadcrumb
// ---------------------------------------------------------------------------
export interface Crumb {
  label: string;
  /** 탭 이동 대상 key(그룹/서브그룹 크럼은 대표 탭). */
  tab?: string;
}

/** 현재 탭의 위치 경로: 그룹 > 서브그룹 > 페이지. */
export function breadcrumbFor(tabKey: string, pageLabel: string): Crumb[] {
  const group = groupOfTab(tabKey);
  const sub = subgroupOfTab(tabKey);
  const node = groupNode(group);
  const crumbs: Crumb[] = [{ label: group, tab: node?.subgroups[0]?.tabs[0] }];
  const subNode = node?.subgroups.find((s) => s.name === sub);
  if (subNode && node && node.subgroups.length > 1) {
    crumbs.push({ label: sub, tab: subNode.tabs[0] });
  }
  crumbs.push({ label: labelForTab(tabKey, pageLabel) });
  return crumbs;
}

// ---------------------------------------------------------------------------
// Home Quick Tasks — 기술 대시보드가 아니라 실제 업무 바로가기
// ---------------------------------------------------------------------------
export interface QuickTask {
  label: string;
  tab: string;
  hint: string;
}
export const QUICK_TASKS: QuickTask[] = [
  { label: '회원 찾기', tab: 'members', hint: '회원·계정 상태 확인' },
  { label: '음원 검수', tab: 'track-review', hint: '검수 대기 음원 처리' },
  { label: '플레이리스트 만들기', tab: 'playlist-builder', hint: '제작·편집' },
  { label: '매장 장애 확인', tab: 'store-monitoring', hint: '점검 필요 매장' },
  { label: '본사 계정 관리', tab: 'enterprise-accounts', hint: '본사·담당자' },
  { label: '정산 처리', tab: 'artist-settlements', hint: '지급 대기 확인' },
];
