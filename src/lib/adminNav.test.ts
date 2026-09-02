import { describe, it, expect } from 'vitest';
import {
  ADMIN_GROUPS,
  GROUP_TREE,
  ALL_NAV_TAB_KEYS,
  groupOfTab,
  subgroupOfTab,
  subgroupsOf,
  isAdvancedTab,
  labelForTab,
  businessLabel,
  breadcrumbFor,
  WORK_QUEUE_TABS,
  MERGED_TABS,
  resolveMergedTab,
  TAB_LABEL_OVERRIDE,
} from './adminNav';

// 관리자에 존재하는 전체 탭 key(회귀 방지 — 무손실 재배치/병합 검증용).
// = AdminPage TABS 의 key + 병합으로 nav 에서 빠졌지만 딥링크로 살아 있는 구 key.
const EXISTING_TAB_KEYS = [
  'dashboard', 'business-live', 'brand-player', 'support-inquiries', 'members', 'member-broadcast', 'curators',
  'enterprise-overview', 'enterprise-accounts', 'enterprise-regions', 'enterprise-monthly-settlements',
  'store-monitoring', 'store-now-playing', 'policy-deployment', 'policy-automation',
  'enterprise-announcements', 'enterprise-emergency', 'enterprise-noc', 'enterprise-command-center',
  'enterprise-operations', 'enterprise-settlement-center', 'brand-registry', 'enterprise-billing',
  'enterprise-contracts', 'franchise', 'sales-agents', 'sales-partners', 'free-trials', 'streaming',
  'streaming-v2', 'settlement-v2', 'revenue', 'subscriptions', 'promotions', 'payment-sync',
  'operation-logs', 'content', 'auto-playlists', 'playlist-builder', 'artists', 'artist-contracts',
  'payout-verification', 'payout-intake', 'track-review', 'qc-review', 'artist-tracks', 'deleted-tracks',
  'audio-reencode', 'audio-diagnostics', 'audio-engine-diagnostics', 'metadata-violations', 'upload-audit',
  'ai-curation', 'clap-curation', 'ai-metadata', 'ai-taxonomy', 'ai-genre', 'ai-mood', 'ai-storetype',
  'placement-audit', 'site-settings', 'site-notices', 'artist-settlements', 'recommendation',
  'upload-integrity', 'brand', 'admins',
];

describe('IA structure', () => {
  it('has at most 9 top-level groups', () => {
    expect(ADMIN_GROUPS.length).toBeLessThanOrEqual(9);
    expect(ADMIN_GROUPS.length).toBe(8);
  });
  it('every existing tab is either placed or merged — exactly once (no feature loss)', () => {
    // 화면을 합치면 구 탭 key 는 nav 에서 빠지지만 딥링크는 살아 있어야 한다.
    // 따라서 불변식은 "트리에 배치" 또는 "MERGED_TABS 로 연결" 둘 중 하나.
    const reachable = [...ALL_NAV_TAB_KEYS, ...Object.keys(MERGED_TABS)].sort();
    const existing = [...EXISTING_TAB_KEYS].sort();
    expect(reachable).toEqual(existing);
    // no duplicates — 배치와 병합에 동시에 들어가면 안 됨
    expect(new Set(reachable).size).toBe(reachable.length);
  });
  it('merged tabs point at a tab that is actually placed in the tree', () => {
    for (const [from, target] of Object.entries(MERGED_TABS)) {
      expect(ALL_NAV_TAB_KEYS).toContain(target.tab);
      expect(ALL_NAV_TAB_KEYS).not.toContain(from);
      expect(target.view.length).toBeGreaterThan(0);
      // 병합 대상이 또 병합되어 있으면 안 됨(체인 금지)
      expect(resolveMergedTab(target.tab)).toBeNull();
    }
  });
  it('no subgroup nesting beyond one level (group → subgroup → tab)', () => {
    for (const g of GROUP_TREE) {
      for (const s of g.subgroups) {
        expect(Array.isArray(s.tabs)).toBe(true);
        expect(s.tabs.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('groupOfTab / subgroupOfTab', () => {
  it('maps known tabs to job-based groups', () => {
    expect(groupOfTab('track-review')).toBe('음원');
    expect(groupOfTab('playlist-builder')).toBe('플레이리스트');
    expect(groupOfTab('store-monitoring')).toBe('매장');
    expect(groupOfTab('enterprise-accounts')).toBe('본사·브랜드');
    expect(groupOfTab('artist-settlements')).toBe('정산');
    expect(groupOfTab('dashboard')).toBe('홈');
    expect(groupOfTab('members')).toBe('회원');
    expect(groupOfTab('site-settings')).toBe('운영·설정');
  });
  it('subgroupOfTab returns the containing subgroup', () => {
    expect(subgroupOfTab('track-review')).toBe('검수·QC');
    expect(subgroupOfTab('enterprise-command-center')).toBe('전체 현황');
  });
  it('falls back safely for unknown tab (no loss)', () => {
    expect(groupOfTab('some-new-tab')).toBe('운영·설정');
    expect(typeof subgroupOfTab('some-new-tab')).toBe('string');
  });
  it('subgroupsOf returns ordered subgroups', () => {
    expect(subgroupsOf('음원').map((s) => s.name)).toEqual(['검수·QC', '음원 목록', '분석·메타', '오디오 점검']);
    expect(subgroupsOf('홈').length).toBe(1);
  });
});

describe('progressive disclosure (advanced tabs)', () => {
  it('flags technical/diagnostic tabs as advanced', () => {
    expect(isAdvancedTab('audio-engine-diagnostics')).toBe(true);
    expect(isAdvancedTab('streaming-v2')).toBe(true);
    expect(isAdvancedTab('placement-audit')).toBe(true);
  });
  it('does not keep merged-away keys in the advanced list', () => {
    // 병합된 구 key 는 더 이상 탭이 아니므로 '고급' 토글 대상도 아니다.
    for (const from of Object.keys(MERGED_TABS)) expect(isAdvancedTab(from)).toBe(false);
  });
  it('keeps everyday tabs visible', () => {
    expect(isAdvancedTab('members')).toBe(false);
    expect(isAdvancedTab('track-review')).toBe(false);
    expect(isAdvancedTab('store-monitoring')).toBe(false);
  });
});

describe('label rename (technical → business)', () => {
  it('overrides technical tab labels', () => {
    expect(labelForTab('enterprise-overview', '엔터프라이즈 현황')).toBe('통합 관제');
    expect(labelForTab('ai-curation', 'AI 큐레이션')).toBe('추천 후보');
  });
  it('keeps original label when no override', () => {
    expect(labelForTab('members', '회원관리')).toBe('회원관리');
  });
  it('override keys are all real tab keys', () => {
    for (const k of Object.keys(TAB_LABEL_OVERRIDE)) {
      expect(EXISTING_TAB_KEYS).toContain(k);
    }
  });
  it('businessLabel replaces technical terms in free text', () => {
    expect(businessLabel('Command Center')).toBe('통합 관제');
    expect(businessLabel('Candidate Pool preview')).toContain('추천 후보');
    expect(businessLabel('Adaptive Score')).toBe('실제 반응 점수');
  });
});

describe('home work queue', () => {
  it('points to real, everyday tabs', () => {
    const tabs = Object.values(WORK_QUEUE_TABS);
    expect(tabs.length).toBeGreaterThanOrEqual(4);
    for (const t of tabs) {
      expect(EXISTING_TAB_KEYS).toContain(t);
      // 병합된 구 key 를 가리킬 수 있다 — 그 경우 통합 탭 기준으로 판정한다.
      const canonical = resolveMergedTab(t)?.tab ?? t;
      expect(ALL_NAV_TAB_KEYS).toContain(canonical);
      // 처리 대기는 기본 화면이어야 한다 — '고급' 토글 뒤에 숨은 탭으로 보내면 안 됨.
      expect(isAdvancedTab(canonical)).toBe(false);
    }
  });
});

describe('deep-link keys resolve to a job group (regression)', () => {
  // 실제 repo tab key(문서의 users/content-management/franchise-management/settlement-center/
  // settings 는 존재하지 않음 → 실제 키로 대체) 가 올바른 그룹으로 해석되는지 잠금.
  const DEEP_LINKS: Array<[string, string]> = [
    ['dashboard', '홈'],
    ['members', '회원'],
    ['track-review', '음원'],
    ['content', '플레이리스트'],
    ['playlist-builder', '플레이리스트'],
    ['store-monitoring', '매장'],
    ['enterprise-overview', '본사·브랜드'],
    ['enterprise-command-center', '본사·브랜드'],
    ['enterprise-accounts', '본사·브랜드'],
    ['franchise', '본사·브랜드'],
    ['artist-settlements', '정산'],
    ['enterprise-settlement-center', '정산'],
    ['site-settings', '운영·설정'],
  ];
  it('each existing deep-link tab maps to its job group', () => {
    for (const [key, expected] of DEEP_LINKS) {
      expect(EXISTING_TAB_KEYS).toContain(key); // 실제 존재하는 키만 검증
      expect(groupOfTab(key)).toBe(expected);
    }
  });
  it('advanced deep-link tabs are still placed (reachable via ?tab=)', () => {
    // 고급(기본 숨김) 탭도 그룹에 배치되어 딥링크 접근이 가능해야 한다.
    expect(isAdvancedTab('placement-audit')).toBe(true);
    expect(ALL_NAV_TAB_KEYS).toContain('placement-audit');
    expect(groupOfTab('placement-audit')).toBe('플레이리스트');
  });
  it('merged-away deep links resolve to the merged tab position', () => {
    // 화면이 합쳐져도 구 링크는 통합 탭의 자리를 가리켜야 한다.
    // '폴백으로 빠지지 않았다'는 것은 통합 탭이 실제로 트리에 배치돼 있다는 사실로 확인한다
    // (그룹 이름으로 판정하면 통합 탭이 정말 그 그룹인 경우와 구분되지 않는다).
    for (const [from, target] of Object.entries(MERGED_TABS)) {
      expect(ALL_NAV_TAB_KEYS).toContain(target.tab);
      expect(groupOfTab(from)).toBe(groupOfTab(target.tab));
      expect(subgroupOfTab(from)).toBe(subgroupOfTab(target.tab));
    }
  });
});

describe('breadcrumb', () => {
  it('builds group > subgroup > page for a deep tab', () => {
    const crumbs = breadcrumbFor('track-review', '음원 검수');
    expect(crumbs.map((c) => c.label)).toEqual(['음원', '검수·QC', '음원 검수']);
  });
  it('omits subgroup crumb when group has a single subgroup (홈)', () => {
    const crumbs = breadcrumbFor('dashboard', '대시보드');
    expect(crumbs.map((c) => c.label)).toEqual(['홈', '대시보드']);
  });
  it('applies label override in the page crumb', () => {
    const crumbs = breadcrumbFor('enterprise-command-center', '엔터프라이즈 Command Center');
    expect(crumbs[crumbs.length - 1].label).toBe('통합 관제');
  });
});
