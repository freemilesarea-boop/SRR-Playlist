import { describe, it, expect } from 'vitest';
import {
  OPERATOR_NAV_SECTIONS,
  OPERATOR_QUICK_ACTIONS,
  operatorRolesFromContext,
  isOperator,
  canAccess,
  filterNavSections,
  filterQuickActions,
  activeNavItemId,
  type OperatorAccessContext,
  type OperatorRole,
} from './operatorNavigation';

const SUPER: OperatorAccessContext = { isSuperAdmin: true, isPlatformAdmin: false, isHq: false };
const ADMIN: OperatorAccessContext = { isSuperAdmin: false, isPlatformAdmin: true, isHq: false };
const HQ: OperatorAccessContext = { isSuperAdmin: false, isPlatformAdmin: false, isHq: true };
const NONE: OperatorAccessContext = { isSuperAdmin: false, isPlatformAdmin: false, isHq: false };

describe('operatorRolesFromContext', () => {
  it('super_admin implies admin (can access platform admin screens)', () => {
    const roles = operatorRolesFromContext(SUPER);
    expect(roles.has('super_admin')).toBe(true);
    expect(roles.has('admin')).toBe(true);
  });
  it('platform admin gets admin only', () => {
    const roles = operatorRolesFromContext(ADMIN);
    expect([...roles]).toEqual(['admin']);
  });
  it('hq gets hq only', () => {
    expect([...operatorRolesFromContext(HQ)]).toEqual(['hq']);
  });
  it('no signals → empty', () => {
    expect(operatorRolesFromContext(NONE).size).toBe(0);
  });
});

describe('isOperator gate', () => {
  it('super/admin/hq are operators', () => {
    expect(isOperator(SUPER)).toBe(true);
    expect(isOperator(ADMIN)).toBe(true);
    expect(isOperator(HQ)).toBe(true);
  });
  it('a user with no operator signal is not an operator', () => {
    expect(isOperator(NONE)).toBe(false);
  });
});

describe('canAccess', () => {
  it('superOnly item is visible ONLY to super_admin (not admin, not hq)', () => {
    const item = { allowedRoles: ['super_admin', 'admin'] as OperatorRole[], superOnly: true };
    expect(canAccess(item, SUPER)).toBe(true);
    expect(canAccess(item, ADMIN)).toBe(false);
    expect(canAccess(item, HQ)).toBe(false);
  });
  it('admin-scoped item is hidden from hq-only user', () => {
    const item = { allowedRoles: ['super_admin', 'admin'] as OperatorRole[] };
    expect(canAccess(item, ADMIN)).toBe(true);
    expect(canAccess(item, HQ)).toBe(false);
  });
  it('hq item is visible to hq, and to super/admin when listed', () => {
    const item = { allowedRoles: ['hq', 'super_admin', 'admin'] as OperatorRole[] };
    expect(canAccess(item, HQ)).toBe(true);
    expect(canAccess(item, SUPER)).toBe(true);
    expect(canAccess(item, ADMIN)).toBe(true);
  });
});

describe('filterNavSections — role-aware filtering', () => {
  it('drops empty sections and never exposes superOnly items to non-super', () => {
    const adminSections = filterNavSections(ADMIN);
    const superOnlyLeaked = adminSections
      .flatMap((s) => s.items)
      .filter((it) => it.superOnly);
    expect(superOnlyLeaked).toHaveLength(0);
    for (const s of adminSections) expect(s.items.length).toBeGreaterThan(0);
  });

  it('super_admin sees strictly more (or equal) items than admin', () => {
    const superCount = filterNavSections(SUPER).flatMap((s) => s.items).length;
    const adminCount = filterNavSections(ADMIN).flatMap((s) => s.items).length;
    expect(superCount).toBeGreaterThan(adminCount);
  });

  it('hq-only user sees only hq-scoped items (no /admin deep-links)', () => {
    const hqItems = filterNavSections(HQ).flatMap((s) => s.items);
    expect(hqItems.length).toBeGreaterThan(0);
    for (const it of hqItems) {
      expect(it.href.startsWith('/admin')).toBe(false);
    }
  });

  it('non-operator sees no sections', () => {
    expect(filterNavSections(NONE)).toHaveLength(0);
  });

  it('home section always present for operators', () => {
    for (const ctx of [SUPER, ADMIN, HQ]) {
      const ids = filterNavSections(ctx).map((s) => s.id);
      expect(ids).toContain('home');
    }
  });
});

describe('filterQuickActions', () => {
  it('super gets the settlement-center action; plain admin gets the monthly-settlement fallback instead', () => {
    const superIds = filterQuickActions(SUPER).map((q) => q.id);
    const adminIds = filterQuickActions(ADMIN).map((q) => q.id);
    expect(superIds).toContain('qa-settlement');
    expect(adminIds).not.toContain('qa-settlement');
    expect(adminIds).toContain('qa-monthly-settlement');
  });
  it('hq user gets the hq dashboard quick action', () => {
    expect(filterQuickActions(HQ).map((q) => q.id)).toContain('qa-hq-home');
  });
});

describe('config integrity', () => {
  it('exactly 10 top-level sections', () => {
    expect(OPERATOR_NAV_SECTIONS).toHaveLength(10);
  });
  it('all nav item ids are unique', () => {
    const ids = OPERATOR_NAV_SECTIONS.flatMap((s) => s.items).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('every /admin deep-link carries a legacyTab and is admin-gated (never hq-only)', () => {
    for (const section of OPERATOR_NAV_SECTIONS) {
      for (const item of section.items) {
        if (item.href.startsWith('/admin?tab=')) {
          expect(item.legacyTab, `${item.id} needs legacyTab`).toBeTruthy();
          expect(item.href).toBe(`/admin?tab=${item.legacyTab}`);
          // /admin is behind RequireAdmin — hq-only users must not be offered it.
          const roles = item.allowedRoles;
          expect(roles.includes('super_admin') || roles.includes('admin')).toBe(true);
        }
      }
    }
  });
  it('quick actions all have unique ids', () => {
    const ids = OPERATOR_QUICK_ACTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('activeNavItemId', () => {
  it('matches /ops home', () => {
    expect(activeNavItemId('/ops', '')).toBe('ops-home');
  });
  it('matches a legacy admin tab deep-link by ?tab=', () => {
    expect(activeNavItemId('/admin', '?tab=store-monitoring')).toBe('store-monitoring');
  });
  it('matches the /enterprise/me hq route', () => {
    expect(activeNavItemId('/enterprise/me', '')).toBe('hq-dashboard');
  });
  it('returns null for an unknown location', () => {
    expect(activeNavItemId('/search', '')).toBeNull();
  });
});
