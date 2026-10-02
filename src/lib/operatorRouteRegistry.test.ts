import { describe, it, expect } from 'vitest';
import {
  OPERATOR_ROUTES, OPERATOR_CATEGORIES, OPERATOR_ROUTE_PATHS,
  canAccessRoute, getRouteById, getRouteByPath, matchOpsRoute,
  sidebarSectionsForRole, searchOperatorRoutes, breadcrumbFor,
  opsPathForLegacyTab,
  type OperatorAccessContext,
} from './operatorRouteRegistry';
import { OPERATOR_PANELS } from '@/components/operator/operatorPanels';
import { ALL_NAV_TAB_KEYS, MERGED_TABS, WORK_QUEUE_TABS, resolveMergedTab } from './adminNav';

const SUPER: OperatorAccessContext = { isSuperAdmin: true, isPlatformAdmin: false, isHq: false };
const ADMIN: OperatorAccessContext = { isSuperAdmin: false, isPlatformAdmin: true, isHq: false };
const HQ: OperatorAccessContext = { isSuperAdmin: false, isPlatformAdmin: false, isHq: true };
const NONE: OperatorAccessContext = { isSuperAdmin: false, isPlatformAdmin: false, isHq: false };

// IMPLEMENT-1 에서 AdminPage TABS 와 대조 검증된 키들. legacyTab 오타 방지용 allow-list.
const KNOWN_ADMIN_TABS = new Set([
  'store-monitoring', 'store-now-playing', 'enterprise-overview', 'enterprise-accounts',
  'franchise', 'brand-registry', 'policy-deployment', 'content', 'enterprise-noc',
  'audio-diagnostics', 'enterprise-settlement-center', 'enterprise-billing',
  'enterprise-monthly-settlements', 'enterprise-contracts', 'artists', 'dashboard',
  'ai-curation', 'site-settings',
  // PHASE 1-B 추가 — AdminPage TABS 의 실제 key (아래 'legacyTab 은 실제 AdminPage 탭' 테스트가
  // adminNav.ALL_NAV_TAB_KEYS 와 교차 검증한다).
  'artist-tracks', 'track-review', 'qc-review', 'metadata-violations', 'deleted-tracks',
  'artist-contracts', 'artist-settlements', 'payout-intake', 'members', 'subscriptions',
  'payment-sync', 'revenue', 'support-inquiries', 'operation-logs', 'site-notices',
]);

describe('registry integrity', () => {
  it('no duplicate ids', () => {
    const ids = OPERATOR_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('no duplicate canonical paths', () => {
    const paths = OPERATOR_ROUTES.map((r) => r.canonicalPath);
    expect(new Set(paths).size).toBe(paths.length);
  });
  it('every searchable entry has keywords', () => {
    for (const r of OPERATOR_ROUTES) {
      if (r.searchable) expect(r.keywords.length, r.id).toBeGreaterThan(0);
    }
  });
  it('every legacyTab is a real AdminPage tab key', () => {
    for (const r of OPERATOR_ROUTES) {
      if (r.legacyTab) expect(KNOWN_ADMIN_TABS.has(r.legacyTab), `${r.id}:${r.legacyTab}`).toBe(true);
    }
  });
  it('hidden/dynamic detail route is not searchable', () => {
    const detail = getRouteById('store-detail')!;
    expect(detail.hiddenFromSidebar).toBe(true);
    expect(detail.searchable).toBe(false);
  });
  it('every category has a meta entry', () => {
    const catIds = new Set(OPERATOR_CATEGORIES.map((c) => c.id));
    for (const r of OPERATOR_ROUTES) expect(catIds.has(r.category), r.id).toBe(true);
  });
  it('OPERATOR_ROUTE_PATHS excludes /ops home and covers the rest', () => {
    expect(OPERATOR_ROUTE_PATHS).not.toContain('/ops');
    expect(OPERATOR_ROUTE_PATHS.length).toBe(OPERATOR_ROUTES.length - 1);
  });
  it('required canonical routes exist', () => {
    for (const p of [
      '/ops/stores', '/ops/stores/:storeId', '/ops/enterprise/accounts', '/ops/enterprise/invite-codes',
      '/ops/music/schedules', '/ops/music/breaks', '/ops/monitoring/connectivity',
      '/ops/finance/settlements', '/ops/system',
    ]) {
      expect(OPERATOR_ROUTES.some((r) => r.canonicalPath === p), p).toBe(true);
    }
  });
});

describe('permission filtering', () => {
  it('superOnly routes hidden from admin and hq', () => {
    const superOnly = OPERATOR_ROUTES.filter((r) => r.superOnly);
    expect(superOnly.length).toBeGreaterThan(0);
    for (const r of superOnly) {
      expect(canAccessRoute(r, SUPER)).toBe(true);
      expect(canAccessRoute(r, ADMIN)).toBe(false);
      expect(canAccessRoute(r, HQ)).toBe(false);
    }
  });
  it('sidebar sections drop empty and never leak superOnly to admin', () => {
    const adminSecs = sidebarSectionsForRole(ADMIN);
    for (const s of adminSecs) expect(s.items.length).toBeGreaterThan(0);
    const leaked = adminSecs.flatMap((s) => s.items).filter((i) => i.superOnly);
    expect(leaked).toHaveLength(0);
  });
  it('super sees at least as many sidebar items as admin', () => {
    const s = sidebarSectionsForRole(SUPER).flatMap((x) => x.items).length;
    const a = sidebarSectionsForRole(ADMIN).flatMap((x) => x.items).length;
    expect(s).toBeGreaterThanOrEqual(a);
    expect(s).toBeGreaterThan(0);
  });
  it('hq-only user sees only hq-scoped items (home + hq entries), no admin-only', () => {
    const hqItems = sidebarSectionsForRole(HQ).flatMap((s) => s.items);
    for (const it of hqItems) expect(it.roles.includes('hq')).toBe(true);
  });
  it('non-operator sees no sidebar sections', () => {
    expect(sidebarSectionsForRole(NONE)).toHaveLength(0);
  });
});

describe('search — permission-filtered, ranked', () => {
  it('일반 사용자(no role) → 결과 없음', () => {
    expect(searchOperatorRoutes('매장', NONE)).toHaveLength(0);
  });
  it('한국어 라벨: "초대" → 초대코드', () => {
    expect(searchOperatorRoutes('초대', SUPER)[0].entry.id).toBe('invite-codes');
  });
  it('영문 alias: "heartbeat" → 접속 상태', () => {
    expect(searchOperatorRoutes('heartbeat', ADMIN)[0].entry.id).toBe('monitoring-connectivity');
  });
  it('영문 alias: "settlement" → 정산', () => {
    expect(searchOperatorRoutes('settlement', SUPER)[0].entry.id).toBe('finance-settlements');
  });
  it('alias: "store override" → 매장별 재생 설정 (라벨이 기대와 일치)', () => {
    const top = searchOperatorRoutes('store override', ADMIN)[0].entry;
    expect(top.id).toBe('store-playback-settings');
    expect(top.label).toBe('매장별 재생 설정');
  });
  it('한국어: "매장별 재생설정" → 매장별 재생 설정', () => {
    expect(searchOperatorRoutes('매장별 재생설정', ADMIN)[0].entry.id).toBe('store-playback-settings');
  });
  it('한국어 키워드: "브레이크" → 음악 > 브레이크', () => {
    expect(searchOperatorRoutes('브레이크', ADMIN)[0].entry.id).toBe('music-breaks');
  });
  it('대소문자 무시', () => {
    expect(searchOperatorRoutes('SETTLEMENT', SUPER)[0].entry.id).toBe('finance-settlements');
  });
  it('"playlist" → 플레이리스트 + 플레이리스트 세트', () => {
    const ids = searchOperatorRoutes('playlist', ADMIN).map((r) => r.entry.id);
    expect(ids[0]).toBe('music-playlists');
    expect(ids).toContain('music-sets');
  });
  it('"billing" → 청구', () => {
    expect(searchOperatorRoutes('billing', ADMIN)[0].entry.id).toBe('finance-billing');
  });
  it('"contract" → 계약', () => {
    expect(searchOperatorRoutes('contract', ADMIN)[0].entry.id).toBe('finance-contracts');
  });
  it('"store" → 매장 관련 결과', () => {
    expect(searchOperatorRoutes('store', ADMIN)[0].entry.category).toBe('stores');
  });
  it('공백 trim', () => {
    expect(searchOperatorRoutes('   초대   ', SUPER)[0].entry.id).toBe('invite-codes');
  });
  it('빈 쿼리 → 대표 항목(권한 내), 개수 제한', () => {
    const res = searchOperatorRoutes('', ADMIN, 5);
    expect(res.length).toBeLessThanOrEqual(5);
    expect(res.length).toBeGreaterThan(0);
  });
  it('결과 개수 제한(limit)', () => {
    expect(searchOperatorRoutes('매장', SUPER, 2).length).toBeLessThanOrEqual(2);
  });
  it('superOnly 항목은 admin 검색 결과에서 제외', () => {
    const ids = searchOperatorRoutes('정산', ADMIN).map((r) => r.entry.id);
    expect(ids).not.toContain('finance'); // finance hub = superOnly
  });
});

describe('matchOpsRoute', () => {
  it('static path', () => {
    expect(matchOpsRoute('/ops/stores')?.id).toBe('stores');
  });
  it('dynamic :storeId', () => {
    expect(matchOpsRoute('/ops/stores/abc-123')?.id).toBe('store-detail');
  });
  it('unknown /ops path → undefined', () => {
    expect(matchOpsRoute('/ops/nope/nope')).toBeUndefined();
  });
  it('getRouteByPath is exact only', () => {
    expect(getRouteByPath('/ops/finance/billing')?.id).toBe('finance-billing');
    expect(getRouteByPath('/ops/stores/abc')).toBeUndefined();
  });
});

describe('breadcrumb', () => {
  it('home → single current segment', () => {
    const segs = breadcrumbFor(getRouteById('home'));
    expect(segs).toHaveLength(1);
    expect(segs[0].href).toBeUndefined();
    expect(segs[0].label).toBe('운영 홈');
  });
  it('nested route → ancestor linked, current not linked', () => {
    const segs = breadcrumbFor(getRouteById('enterprise-accounts'));
    expect(segs.map((s) => s.label)).toEqual(['운영 홈', '본사·브랜드', '본사 계정']);
    expect(segs[0].href).toBe('/ops');
    expect(segs[1].href).toBe('/ops/enterprise'); // ancestor links to hub
    expect(segs[segs.length - 1].href).toBeUndefined();
  });
  it('dynamic store route uses fallback label when no name (no fabricated name)', () => {
    const segs = breadcrumbFor(getRouteById('store-detail'));
    expect(segs[segs.length - 1].label).toBe('매장 상세');
  });
  it('dynamic store route uses provided store name when available', () => {
    const segs = breadcrumbFor(getRouteById('store-detail'), '강남점');
    expect(segs[segs.length - 1].label).toBe('강남점');
  });
  it('aria: last segment is current (no href)', () => {
    const segs = breadcrumbFor(getRouteById('music-schedules'));
    expect(segs[segs.length - 1].href).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — /ops 핵심 화면 진입점 복구
// ─────────────────────────────────────────────────────────────────────────────

/** PHASE 1-B 로 등록한 화면 (canonicalPath, legacyTab). */
const PHASE1_ROUTES: Array<[string, string]> = [
  ['/ops/tracks', 'artist-tracks'],
  ['/ops/tracks/review', 'track-review'],
  ['/ops/tracks/qc', 'qc-review'],
  ['/ops/tracks/violations', 'metadata-violations'],
  ['/ops/tracks/deleted', 'deleted-tracks'],
  ['/ops/artists/contracts', 'artist-contracts'],
  ['/ops/finance/artist-settlements', 'artist-settlements'],
  ['/ops/finance/payout-accounts', 'payout-intake'],
  ['/ops/members', 'members'],
  ['/ops/members/subscriptions', 'subscriptions'],
  ['/ops/members/payments', 'payment-sync'],
  ['/ops/members/revenue', 'revenue'],
  ['/ops/system/inquiries', 'support-inquiries'],
  ['/ops/system/logs', 'operation-logs'],
  ['/ops/system/notices', 'site-notices'],
];

/** PHASE 1 이전에 존재했던 /ops 경로 — 하나도 사라지면 안 된다. */
const PRE_PHASE1_PATHS = [
  '/ops', '/ops/stores', '/ops/stores/:storeId', '/ops/stores/playback-settings',
  '/ops/enterprise', '/ops/enterprise/accounts', '/ops/enterprise/franchises',
  '/ops/enterprise/brands', '/ops/enterprise/invite-codes',
  '/ops/music', '/ops/music/playlists', '/ops/music/sets', '/ops/music/schedules',
  '/ops/music/breaks', '/ops/music/deployment',
  '/ops/monitoring', '/ops/monitoring/live', '/ops/monitoring/connectivity',
  '/ops/monitoring/quality', '/ops/monitoring/incidents',
  '/ops/finance', '/ops/finance/billing', '/ops/finance/settlements', '/ops/finance/contracts',
  '/ops/artists', '/ops/content', '/ops/analytics', '/ops/ai', '/ops/system',
];

describe('PHASE 1 — route resolution', () => {
  it('신규 /ops 경로가 전부 레지스트리에 있고 실제 패널로 resolve 된다', () => {
    for (const [path] of PHASE1_ROUTES) {
      const entry = matchOpsRoute(path);
      expect(entry, `${path} 미등록`).toBeTruthy();
      expect(OPERATOR_PANELS[entry!.componentKey], `${path} → 패널 미매핑`).toBeTruthy();
    }
  });

  it('레지스트리의 모든 componentKey 가 패널에 매핑돼 있다 (home 제외)', () => {
    for (const r of OPERATOR_ROUTES) {
      if (r.componentKey === 'home') continue;
      expect(OPERATOR_PANELS[r.componentKey], `${r.id} → ${r.componentKey} 미매핑`).toBeTruthy();
    }
  });

  it('PHASE 1 이전 /ops 경로가 전부 유지된다', () => {
    const paths = new Set(OPERATOR_ROUTES.map((r) => r.canonicalPath));
    for (const p of PRE_PHASE1_PATHS) expect(paths.has(p), `${p} 사라짐`).toBe(true);
  });

  it('App 라우트 등록 목록(OPERATOR_ROUTE_PATHS)에 신규 경로가 포함된다', () => {
    for (const [path] of PHASE1_ROUTES) expect(OPERATOR_ROUTE_PATHS).toContain(path);
  });
});

describe('PHASE 1 — legacy deep link 보존', () => {
  it('모든 legacyTab 이 adminNav 의 실제 탭 key 다 (딥링크 ?tab= 유효)', () => {
    const real = new Set<string>([...ALL_NAV_TAB_KEYS, ...Object.keys(MERGED_TABS)]);
    for (const r of OPERATOR_ROUTES) {
      if (!r.legacyTab) continue;
      expect(real.has(r.legacyTab), `${r.id}: '${r.legacyTab}' 는 AdminPage 탭이 아니다`).toBe(true);
    }
  });

  it('작업 대기열 6종이 전부 /ops 안에서 열린다 (병합 key 해석 포함)', () => {
    for (const tab of Object.values(WORK_QUEUE_TABS)) {
      const resolved = resolveMergedTab(tab)?.tab ?? tab;
      expect(opsPathForLegacyTab(resolved, ADMIN), `${tab} → /ops 경로 없음`).toBeTruthy();
    }
  });

  it('opsPathForLegacyTab 은 권한 없는 사용자에게 경로를 주지 않는다', () => {
    expect(opsPathForLegacyTab('track-review', ADMIN)).toBe('/ops/tracks/review');
    expect(opsPathForLegacyTab('track-review', HQ)).toBeUndefined();
    expect(opsPathForLegacyTab('track-review', NONE)).toBeUndefined();
  });

  it('opsPathForLegacyTab 은 사이드바에 보이는 경로를 우선한다', () => {
    // franchise 는 5개 라우트가 공유한다 — 숨김이 아닌 '가맹점 관리'가 나와야 한다.
    expect(opsPathForLegacyTab('franchise', ADMIN)).toBe('/ops/enterprise/franchises');
  });
});

describe('PHASE 1 — 권한이 기존보다 넓어지지 않는다', () => {
  it('신규 route 는 전부 플랫폼 관리자 전용 — hq 단독 사용자는 접근 불가', () => {
    for (const [path] of PHASE1_ROUTES) {
      const entry = matchOpsRoute(path)!;
      expect(canAccessRoute(entry, HQ), `${path} 가 hq 에게 열렸다`).toBe(false);
      expect(canAccessRoute(entry, NONE), `${path} 가 비운영자에게 열렸다`).toBe(false);
      expect(canAccessRoute(entry, ADMIN), `${path} 가 admin 에게 막혔다`).toBe(true);
      expect(canAccessRoute(entry, SUPER)).toBe(true);
    }
  });

  it('신규 route 에 hq 역할이 들어가 있지 않다', () => {
    for (const [path] of PHASE1_ROUTES) {
      const entry = matchOpsRoute(path)!;
      expect(entry.roles).not.toContain('hq');
    }
  });

  it('superOnly 였던 /admin 탭을 non-super 에게 열지 않았다', () => {
    // /admin 의 superOnly 탭 목록(AdminPage TABS 기준). 이 탭을 legacyTab 으로 쓰는
    // /ops 라우트는 반드시 superOnly 여야 한다.
    const ADMIN_SUPER_ONLY = new Set([
      'brand-player', 'enterprise-settlement-center', 'brand-registry',
      'streaming-v2', 'audio-engine-diagnostics', 'admins',
    ]);
    for (const r of OPERATOR_ROUTES) {
      if (r.legacyTab && ADMIN_SUPER_ONLY.has(r.legacyTab)) {
        expect(r.superOnly, `${r.id}: /admin 에서 superOnly 인데 /ops 는 아니다`).toBe(true);
      }
    }
  });

  it('hq 단독 사용자의 사이드바가 PHASE 1 으로 늘어나지 않았다 (홈만)', () => {
    const items = sidebarSectionsForRole(HQ).flatMap((s) => s.items);
    expect(items.every((i) => i.roles.includes('hq'))).toBe(true);
  });
});

describe('PHASE 1 — 사이드바 중복 정리', () => {
  it('같은 패널이 사이드바에 두 번 나오지 않는다', () => {
    const keys = sidebarSectionsForRole(SUPER).flatMap((s) => s.items).map((i) => i.componentKey);
    const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dup, `사이드바 중복 패널: ${dup.join(', ')}`).toHaveLength(0);
  });

  it('숨긴 항목도 route 와 검색은 유지된다', () => {
    for (const id of ['music-sets', 'music-schedules', 'music-breaks', 'music-deployment',
                      'monitoring-connectivity', 'monitoring-incidents', 'invite-codes', 'content']) {
      const e = getRouteById(id);
      expect(e, `${id} 사라짐`).toBeTruthy();
      expect(e!.hiddenFromSidebar).toBe(true);
      expect(e!.searchable).toBe(true);
    }
  });

  it('신규 항목은 사이드바에 보인다', () => {
    const paths = new Set(
      sidebarSectionsForRole(ADMIN).flatMap((s) => s.items).map((i) => i.canonicalPath),
    );
    for (const [path] of PHASE1_ROUTES) expect(paths.has(path), `${path} 사이드바 누락`).toBe(true);
  });

  it('회원·결제 섹션이 생겼고 아티스트·음원에 검수 화면이 들어있다', () => {
    const sections = sidebarSectionsForRole(ADMIN);
    const members = sections.find((s) => s.id === 'members');
    expect(members, '회원·결제 섹션 없음').toBeTruthy();
    expect(members!.label).toBe('회원·결제');
    const art = sections.find((s) => s.id === 'artist-content')!;
    expect(art.label).toBe('아티스트·음원');
    expect(art.items.map((i) => i.id)).toContain('tracks-review');
  });
});

describe('PHASE 1 — 검색', () => {
  it('"음원 검수" → 음원 검수', () => {
    expect(searchOperatorRoutes('음원 검수', ADMIN)[0]?.entry.label).toBe('음원 검수');
  });
  it('"회원" → 회원', () => {
    expect(searchOperatorRoutes('회원', ADMIN)[0]?.entry.label).toBe('회원');
  });
  it('"정산 계좌" → 정산 계좌', () => {
    expect(searchOperatorRoutes('정산 계좌', ADMIN)[0]?.entry.label).toBe('정산 계좌');
  });
  it('alias "inquiries" → 문의관리', () => {
    expect(searchOperatorRoutes('inquiries', ADMIN).map((r) => r.entry.label)).toContain('문의관리');
  });
  it('hq 단독 사용자는 신규 화면을 검색할 수 없다', () => {
    expect(searchOperatorRoutes('음원 검수', HQ)).toHaveLength(0);
    expect(searchOperatorRoutes('회원', HQ)).toHaveLength(0);
  });
});
