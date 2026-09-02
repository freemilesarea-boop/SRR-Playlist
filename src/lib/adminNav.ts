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
      // ai-mood / ai-storetype 는 ai-genre('AI 분류')로 병합 — MERGED_TABS 참조.
      { name: '분석·메타', tabs: ['ai-metadata', 'ai-genre', 'ai-taxonomy'] },
      // upload-integrity 는 upload-audit('업로드 점검')으로 병합.
      { name: '오디오 점검', tabs: ['audio-reencode', 'audio-diagnostics', 'audio-engine-diagnostics', 'upload-audit'] },
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
      // brand-player 는 매장 재생 화면이라 상태·장애와 같은 성격. 관제 서브그룹은
      // 4개 관제 화면이 '통합 관제' 한 탭으로 합쳐지면서 없어졌다(MERGED_TABS 참조).
      // business-live / store-now-playing 는 store-monitoring('매장 상태')으로 병합.
      { name: '상태·장애', tabs: ['store-monitoring', 'brand-player'] },
      { name: '재생·정책', tabs: ['policy-deployment', 'policy-automation', 'enterprise-announcements', 'enterprise-emergency'] },
    ],
  },
  {
    group: '본사·브랜드',
    hint: '본사·브랜드·프랜차이즈·지역',
    subgroups: [
      // 프랜차이즈 현황 · 매장 관제 · 시스템 운영 · 사업 현황을 한 탭 네 뷰로.
      { name: '전체 현황', tabs: ['enterprise-overview'] },
      { name: '본사·브랜드', tabs: ['enterprise-accounts', 'brand-registry', 'enterprise-regions'] },
      { name: '프랜차이즈·계약', tabs: ['franchise', 'enterprise-contracts'] },
    ],
  },
  {
    group: '정산',
    hint: '아티스트 정산·본사 청구·결제',
    subgroups: [
      // payout-verification 은 payout-intake('정산 계좌')로 병합 — MERGED_TABS 참조.
      { name: '아티스트 정산', tabs: ['artist-settlements', 'payout-intake'] },
      { name: '본사·매장 청구', tabs: ['enterprise-billing', 'enterprise-monthly-settlements', 'enterprise-settlement-center'] },
      // settlement-v2 는 streaming-v2('v2 관측')로 병합.
      { name: '결제·매출', tabs: ['streaming', 'revenue', 'subscriptions', 'promotions', 'payment-sync', 'streaming-v2'] },
    ],
  },
  {
    group: '운영·설정',
    hint: '문의·로그·서비스 설정·권한',
    subgroups: [
      { name: '운영', tabs: ['support-inquiries', 'operation-logs'] },
      // brand(로고)는 site-settings('사이트 설정')로 병합.
      { name: '설정', tabs: ['site-settings', 'site-notices', 'admins'] },
    ],
  },
];

/** 1차 메뉴 순서. */
export const ADMIN_GROUPS: AdminGroup[] = GROUP_TREE.map((g) => g.group);

/** IA 트리에 배치된 전체 탭 key(중복 배치 검증용). */
export const ALL_NAV_TAB_KEYS: string[] = GROUP_TREE.flatMap((g) => g.subgroups.flatMap((s) => s.tabs));

// ---------------------------------------------------------------------------
// 병합된 탭 (Consolidation)
// ---------------------------------------------------------------------------
/**
 * 두 화면을 하나로 합칠 때, 없어진 쪽 탭 key 가 가리킬 곳.
 *
 * IA 원칙상 기존 딥링크 `?tab=<key>` 는 절대 깨지면 안 되므로, 구 key 를 지우는 대신
 * "통합 탭 + 통합 화면 안의 어느 뷰로 열지" 를 여기에 남긴다. nav 에는 통합 탭 하나만
 * 보이고(구 key 는 GROUP_TREE 에서 빠짐), 구 링크로 들어오면 통합 화면의 해당 뷰가 열린다.
 */
export interface MergedTabTarget {
  /** 통합된 탭 key */
  tab: string;
  /** 통합 화면 안에서 처음 보여줄 뷰 */
  view: string;
}

export const MERGED_TABS: Record<string, MergedTabTarget> = {
  // '계좌 확인' + '정산 정보 신청' → '정산 계좌' 한 화면.
  // 계좌 인증(verified)과 지급 요건(PII 완비)이 별개인데 화면이 갈라져 있어,
  // "verified 인데 지급 보류" 상태가 어느 쪽에서도 안 보이던 문제(8/31 #525)를 없앤다.
  'payout-verification': { tab: 'payout-intake', view: 'accounts' },

  // 관제 4화면 → '통합 관제'(enterprise-overview) 한 탭.
  // 넷은 겹치는 KPI 때문에 비슷해 보이지만 실제 축이 다르다 — 프랜차이즈 현황 /
  // 매장 실시간 / 시스템 자동화 / 사업 지표. 그래서 지우지 않고 뷰로 묶는다.
  // 1차 메뉴에 관제 항목이 두 그룹에 흩어져 넷이나 있던 것을 하나로 줄이는 게 목적.
  'enterprise-noc': { tab: 'enterprise-overview', view: 'stores' },
  'enterprise-operations': { tab: 'enterprise-overview', view: 'system' },
  'enterprise-command-center': { tab: 'enterprise-overview', view: 'business' },

  // AI 예측 3화면 → 'AI 분류' 한 탭. 같은 일을 필드만 바꿔 하는 화면이라
  // 메뉴에서 셋을 구분해 기억할 이유가 없다(적용 로직은 필드별로 그대로 유지).
  'ai-mood': { tab: 'ai-genre', view: 'mood' },
  'ai-storetype': { tab: 'ai-genre', view: 'storetype' },

  // 매장 실시간 3화면 → '매장 상태' 한 탭. 셋 다 "지금 매장이 어떤가"를 본다.
  'business-live': { tab: 'store-monitoring', view: 'live' },
  'store-now-playing': { tab: 'store-monitoring', view: 'now-playing' },

  // shadow 관측 2화면 → 'v2 관측' 한 탭 (둘 다 flag OFF · 실서비스 무관).
  'settlement-v2': { tab: 'streaming-v2', view: 'settlement' },

  // 업로드 점검 2화면 → '업로드 점검' 한 탭.
  'upload-integrity': { tab: 'upload-audit', view: 'integrity' },

  // 브랜드 로고 → 사이트 설정 안으로(로고 하나 올리는 화면이 1차 메뉴를 차지했었다).
  'brand': { tab: 'site-settings', view: 'brand' },
};

/** 병합으로 없어진 탭이면 이동할 곳, 아니면 null. */
export function resolveMergedTab(tabKey: string): MergedTabTarget | null {
  return MERGED_TABS[tabKey] ?? null;
}

/**
 * 기본 숨김(고급/기술) 탭 — Progressive Disclosure. key/route 유지, 기본 노출만 축소.
 * 일반 관리 업무에 필수가 아닌 진단/기술/그림자 화면.
 */
export const ADVANCED_TABS: ReadonlySet<string> = new Set<string>([
  'audio-reencode',
  'audio-diagnostics',
  'audio-engine-diagnostics',
  'upload-audit',
  'ai-taxonomy',
  'placement-audit',
  'recommendation',
  'brand-player',
  'streaming-v2',
]);

export function isAdvancedTab(tabKey: string): boolean {
  return ADVANCED_TABS.has(tabKey);
}

/**
 * 업무 중심 라벨 override — 기술 명칭을 업무 명칭으로(label 만 변경, key 불변).
 * 여기 없는 key 는 기존 라벨을 그대로 사용한다.
 */
export const TAB_LABEL_OVERRIDE: Record<string, string> = {
  // 신청·확인·미완비를 한 화면에서 다루므로 '정산 정보 신청' 보다 넓은 이름으로.
  'payout-intake': '정산 계좌',
  // 프랜차이즈·매장·시스템·사업 네 뷰를 담은 통합 화면.
  'enterprise-overview': '통합 관제',
  'ai-curation': '추천 후보',
  'clap-curation': '유사곡 추천',
  'streaming-v2': 'v2 관측(Shadow)',
  'placement-audit': '배치 점검',
  // 병합 통합 탭 — 안에서 뷰로 나뉜다.
  'ai-genre': 'AI 분류',
  'store-monitoring': '매장 상태',
  'upload-audit': '업로드 점검',
  'site-settings': '사이트 설정',
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

/** 병합된 구 key 는 통합 탭 기준으로 본다. 그 외는 그대로. */
function canonicalTab(tabKey: string): string {
  return MERGED_TABS[tabKey]?.tab ?? tabKey;
}

/** 탭 key 의 1차 그룹. 미배치 key 는 '운영·설정'로 폴백(무손실). */
export function groupOfTab(tabKey: string): AdminGroup {
  return _groupOf.get(canonicalTab(tabKey)) ?? '운영·설정';
}

/** 탭 key 의 2차 서브그룹 이름(그룹 내). 미배치는 그룹 첫 서브그룹. */
export function subgroupOfTab(tabKey: string): string {
  const found = _subOf.get(canonicalTab(tabKey));
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
export function breadcrumbFor(rawTabKey: string, pageLabel: string): Crumb[] {
  // 구 딥링크로 들어와도 통합 탭 기준의 경로를 보여준다.
  const tabKey = canonicalTab(rawTabKey);
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
// Home Work Queue — 홈 '처리 대기' 카드가 보내는 탭
// ---------------------------------------------------------------------------
/**
 * 홈 상단 처리 대기 카드의 이동 대상. 라벨/아이콘/건수는 AdminWorkQueueBar 가 갖고,
 * 여기에는 탭 key 만 둔다(이 파일은 순수 로직 — 유닛 테스트가 "실제 존재하는 탭이고
 * 고급(기본 숨김) 탭이 아님" 을 잠근다).
 *
 * 이전의 정적 QUICK_TASKS 를 대체한다 — 같은 업무 진입점이면서 대기 건수까지 보여준다.
 */
export const WORK_QUEUE_TABS = {
  trackReview: 'track-review',
  artistApproval: 'artists',
  payout: 'payout-intake',
  /** 정산 계좌 화면의 '계좌 목록' 뷰로 바로 여는 구 key(MERGED_TABS 경유). */
  payoutAccounts: 'payout-verification',
  settlements: 'artist-settlements',
  inquiries: 'support-inquiries',
  stores: 'store-monitoring',
} as const;

export type WorkQueueTabKey = (typeof WORK_QUEUE_TABS)[keyof typeof WORK_QUEUE_TABS];
