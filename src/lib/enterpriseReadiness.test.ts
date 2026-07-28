// Phase ENT-WORKSPACE — 운영 준비 상태 순수 로직 단위 테스트.
import { describe, it, expect } from 'vitest';
import {
  computeEnterpriseReadiness, countIncomplete,
  brandReadiness, businessReadiness, settlementReadiness,
  inviteReadiness, regionReadiness, storeReadiness,
  getEnterpriseRequiredActions, splitForDisplay,
} from './enterpriseReadiness';
import type { EnterpriseDetail } from '@/lib/api/enterpriseDetailApi';

function base(): EnterpriseDetail {
  return {
    enterprise: {
      id: 'ent-1', enterprise_name: '쿠우쿠우', manager_name: null, manager_email: null,
      manager_phone: null, role: null, status: 'active', last_login_at: null,
      auth_user_id: null, notes: null, created_at: '2024-01-01T00:00:00Z',
      updated_at: null, deleted_at: null, onboarding_enabled: null,
      allow_self_register_region: null, auto_onboarded: null, brand_registry_id: null,
    },
    business_profile: null,
    invite: { hq_invite_code: null, store_invite_code: null, brand_code: null, invite_code_rotated_at: null, claims: [] },
    regions: [],
    store_summary: { total: 0, active: 0, inactive: 0, heartbeat_recent: 0, playing: 0, connected_24h: 0, offline_or_error: 0 } as EnterpriseDetail['store_summary'],
    stores: [],
    contract: null,
    contracts: [],
    settlements: [],
    music_policy: [],
    audit_logs: [],
  };
}

describe('brandReadiness', () => {
  it('ready when code + registry linked', () => {
    const d = base();
    d.invite.brand_code = 'KUU';
    d.enterprise.brand_registry_id = 'br-1';
    expect(brandReadiness(d).status).toBe('ready');
  });
  it('partial when code but no registry', () => {
    const d = base(); d.invite.brand_code = 'KUU';
    expect(brandReadiness(d).status).toBe('partial');
  });
  it('missing when no code', () => {
    expect(brandReadiness(base()).status).toBe('missing');
  });
});

describe('businessReadiness', () => {
  it('missing when no profile', () => {
    expect(businessReadiness(base()).status).toBe('missing');
  });
  it('ready when core fields filled', () => {
    const d = base();
    d.business_profile = {
      company_name: '쿠우쿠우(주)', business_number: '123-45-67890', representative_name: '홍길동',
      business_address: null, contact_phone: null, tax_invoice_email: null,
      settlement_contact_name: null, settlement_contact_phone: null, settlement_contact_email: null,
    };
    expect(businessReadiness(d).status).toBe('ready');
  });
  it('partial when some core fields missing', () => {
    const d = base();
    d.business_profile = {
      company_name: '쿠우쿠우(주)', business_number: null, representative_name: null,
      business_address: null, contact_phone: null, tax_invoice_email: null,
      settlement_contact_name: null, settlement_contact_phone: null, settlement_contact_email: null,
    };
    expect(businessReadiness(d).status).toBe('partial');
  });
});

describe('settlementReadiness', () => {
  it('missing when no contract', () => {
    expect(settlementReadiness(base()).status).toBe('missing');
  });
  it('partial when contract lacks terms', () => {
    const d = base();
    d.contract = { ...contractStub(), monthly_store_price: null, commission_rate: null, settlement_method: null };
    expect(settlementReadiness(d).status).toBe('partial');
  });
  it('ready when terms complete and no problem settlement', () => {
    const d = base();
    d.contract = contractStub();
    expect(settlementReadiness(d).status).toBe('ready');
  });
  it('attention when latest settlement held or below minimum', () => {
    const d = base();
    d.contract = contractStub();
    d.settlements = [{ ...settlementStub(), status: 'held' }];
    expect(settlementReadiness(d).status).toBe('attention');
    d.settlements = [{ ...settlementStub(), below_minimum: true }];
    expect(settlementReadiness(d).status).toBe('attention');
  });
});

describe('inviteReadiness', () => {
  it('missing when no codes', () => {
    expect(inviteReadiness(base()).status).toBe('missing');
  });
  it('ready when both codes + onboarding on', () => {
    const d = base();
    d.invite.hq_invite_code = 'HQ-1'; d.invite.store_invite_code = 'ST-1';
    d.enterprise.onboarding_enabled = true;
    expect(inviteReadiness(d).status).toBe('ready');
  });
  it('attention when onboarding off despite codes', () => {
    const d = base();
    d.invite.hq_invite_code = 'HQ-1'; d.invite.store_invite_code = 'ST-1';
    d.enterprise.onboarding_enabled = false;
    expect(inviteReadiness(d).status).toBe('attention');
  });
  it('partial when only one code and onboarding on', () => {
    const d = base();
    d.invite.hq_invite_code = 'HQ-1';
    d.enterprise.onboarding_enabled = true;
    expect(inviteReadiness(d).status).toBe('partial');
  });
});

describe('regionReadiness', () => {
  it('missing when none', () => {
    expect(regionReadiness(base()).status).toBe('missing');
  });
  it('ready with regions', () => {
    const d = base();
    d.regions = [{ id: 'r1', region_name: '서울', region_code: 'SE', status: 'active', store_count: 3, manager_name: null, last_policy_applied_at: null }];
    expect(regionReadiness(d).status).toBe('ready');
  });
});

describe('storeReadiness', () => {
  it('missing when total 0', () => {
    expect(storeReadiness(base()).status).toBe('missing');
    expect(storeReadiness(base()).actionKind).toBe('tab:stores');
  });
  it('attention when offline/error present', () => {
    const d = base();
    d.store_summary = { ...d.store_summary, total: 5, active: 4, offline_or_error: 1 };
    expect(storeReadiness(d).status).toBe('attention');
  });
  it('ready when all healthy', () => {
    const d = base();
    d.store_summary = { ...d.store_summary, total: 5, active: 5, playing: 3, offline_or_error: 0 };
    expect(storeReadiness(d).status).toBe('ready');
  });
});

describe('computeEnterpriseReadiness + countIncomplete', () => {
  it('returns 6 domains in fixed order', () => {
    const items = computeEnterpriseReadiness(base());
    expect(items.map((i) => i.domain)).toEqual(['brand', 'business', 'settlement', 'invite', 'region', 'store']);
  });
  it('maps each domain to its real supported action kind', () => {
    const byDomain = Object.fromEntries(computeEnterpriseReadiness(base()).map((i) => [i.domain, i.actionKind]));
    expect(byDomain).toEqual({
      brand: 'invite',
      business: 'settlement',
      settlement: 'settlement',
      invite: 'invite',
      region: 'regions',
      store: 'tab:stores',
    });
  });
  it('empty enterprise is fully incomplete', () => {
    expect(countIncomplete(computeEnterpriseReadiness(base()))).toBe(6);
  });
  it('fully-provisioned enterprise has zero incomplete', () => {
    const d = base();
    d.invite = { hq_invite_code: 'HQ-1', store_invite_code: 'ST-1', brand_code: 'KUU', invite_code_rotated_at: null, claims: [] };
    d.enterprise.brand_registry_id = 'br-1';
    d.enterprise.onboarding_enabled = true;
    d.business_profile = {
      company_name: '쿠우쿠우(주)', business_number: '123-45-67890', representative_name: '홍길동',
      business_address: null, contact_phone: null, tax_invoice_email: null,
      settlement_contact_name: null, settlement_contact_phone: null, settlement_contact_email: null,
    };
    d.contract = contractStub();
    d.regions = [{ id: 'r1', region_name: '서울', region_code: 'SE', status: 'active', store_count: 3, manager_name: null, last_policy_applied_at: null }];
    d.store_summary = { ...d.store_summary, total: 3, active: 3, playing: 2, offline_or_error: 0 };
    expect(countIncomplete(computeEnterpriseReadiness(d))).toBe(0);
  });
});

function provisioned(): EnterpriseDetail {
  const d = base();
  d.invite = { hq_invite_code: 'HQ-1', store_invite_code: 'ST-1', brand_code: 'KUU', invite_code_rotated_at: null, claims: [] };
  d.enterprise.brand_registry_id = 'br-1';
  d.enterprise.onboarding_enabled = true;
  d.business_profile = {
    company_name: '쿠우쿠우(주)', business_number: '123-45-67890', representative_name: '홍길동',
    business_address: null, contact_phone: null, tax_invoice_email: null,
    settlement_contact_name: null, settlement_contact_phone: null, settlement_contact_email: null,
  };
  d.contract = contractStub();
  d.regions = [{ id: 'r1', region_name: '서울', region_code: 'SE', status: 'active', store_count: 3, manager_name: null, last_policy_applied_at: null }];
  d.store_summary = { ...d.store_summary, total: 3, active: 3, playing: 2, offline_or_error: 0 };
  return d;
}

describe('getEnterpriseRequiredActions', () => {
  it('surfaces business review as a required action when business missing', () => {
    const a = getEnterpriseRequiredActions(base()).find((x) => x.id === 'business');
    expect(a).toBeDefined();
    expect(a!.priority).toBe('required');
    expect(a!.actionKind).toBe('settlement');
  });
  it('surfaces invite as required when no codes', () => {
    const a = getEnterpriseRequiredActions(base()).find((x) => x.id === 'invite');
    expect(a?.priority).toBe('required');
    expect(a?.actionKind).toBe('invite');
  });
  it('surfaces region as required when none', () => {
    const a = getEnterpriseRequiredActions(base()).find((x) => x.id === 'region');
    expect(a?.priority).toBe('required');
    expect(a?.actionKind).toBe('regions');
  });
  it('surfaces store as recommended when none', () => {
    const a = getEnterpriseRequiredActions(base()).find((x) => x.id === 'store');
    expect(a?.priority).toBe('recommended');
    expect(a?.actionKind).toBe('tab:stores');
  });
  it('surfaces settlement action when latest settlement needs attention', () => {
    const d = base();
    d.contract = contractStub();
    d.settlements = [{ ...settlementStub(), status: 'held' }];
    const a = getEnterpriseRequiredActions(d).find((x) => x.id === 'settlement');
    expect(a?.title).toBe('정산 확인 필요');
    expect(a?.actionKind).toBe('settlement');
  });
  it('returns empty when fully provisioned (완료 메시지 조건)', () => {
    expect(getEnterpriseRequiredActions(provisioned())).toEqual([]);
  });
  it('excludes completed (ready) domains from the task list', () => {
    const d = base();
    d.regions = [{ id: 'r1', region_name: '서울', region_code: null, status: 'active', store_count: 1, manager_name: null, last_policy_applied_at: null }];
    const ids = getEnterpriseRequiredActions(d).map((x) => x.id);
    expect(ids).not.toContain('region');
  });
  it('orders required before recommended', () => {
    const priorities = getEnterpriseRequiredActions(base()).map((x) => x.priority);
    const firstRecommended = priorities.indexOf('recommended');
    const lastRequired = priorities.lastIndexOf('required');
    expect(lastRequired).toBeLessThan(firstRecommended);
  });
  it('produces no duplicate action ids (one per domain)', () => {
    const ids = getEnterpriseRequiredActions(base()).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('splitForDisplay', () => {
  it('shows up to limit and reports the rest', () => {
    const r = splitForDisplay([1, 2, 3, 4, 5], 3);
    expect(r.shown).toEqual([1, 2, 3]);
    expect(r.hiddenCount).toBe(2);
  });
  it('no hidden when within limit', () => {
    expect(splitForDisplay([1, 2], 3)).toEqual({ shown: [1, 2], hiddenCount: 0 });
  });
});

function contractStub(): NonNullable<EnterpriseDetail['contract']> {
  return {
    id: 'c1', contract_no: 'C-001', contract_name: '표준', contract_type: 'standard',
    start_date: '2024-01-01', end_date: null, auto_renew: true, renewal_period_month: 12,
    status: 'active', monthly_store_price: 4900, commission_rate: 20, minimum_payout: 0,
    settlement_method: 'monthly', signed_at: null, memo: null,
    created_at: '2024-01-01T00:00:00Z', updated_at: null,
  };
}

function settlementStub(): EnterpriseDetail['settlements'][number] {
  return {
    id: 's1', settlement_month: '2024-05', status: 'generated', active_store_count: 3,
    monthly_store_price: 4900, commission_rate: 20, per_store_commission: 980, total_commission: 2940,
    minimum_payout: 0, below_minimum: false, settlement_method: 'monthly', contract_no: 'C-001',
    generated_at: null, approved_at: null, paid_at: null, payment_reference: null,
  };
}
