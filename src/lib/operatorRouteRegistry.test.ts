import { describe, it, expect } from 'vitest';
import {
  OPERATOR_ROUTES, OPERATOR_CATEGORIES, OPERATOR_ROUTE_PATHS,
  canAccessRoute, getRouteById, getRouteByPath, matchOpsRoute,
  sidebarSectionsForRole, searchOperatorRoutes, breadcrumbFor,
  type OperatorAccessContext,
} from './operatorRouteRegistry';

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
