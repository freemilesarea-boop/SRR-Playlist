// Phase BRAND-HQ-RUNTIME-TRUTH-1 — 운영 준비 상태 순수 로직 단위 테스트.
// brand_player(런타임 바인딩) vs brand_registry(자동가입) 분리 + 로그인/required 규칙.
import { describe, it, expect } from 'vitest';
import {
  computeEnterpriseReadiness, countIncomplete,
  brandPlayerReadiness, brandRegistryReadiness, businessReadiness, settlementReadiness,
  inviteReadiness, regionReadiness, storeReadiness,
  getEnterpriseRequiredActions, splitForDisplay,
} from './enterpriseReadiness';
import type { EnterpriseDetail, EntDetailPlayerBinding } from '@/lib/api/enterpriseDetailApi';

function base(): EnterpriseDetail {
  return {
    enterprise: {
      id: 'ent-1', enterprise_name: '쿠우쿠우', manager_name: null, manager_email: null,
      manager_phone: null, role: null, status: 'active', last_login_at: null,
      auth_user_id: null, notes: null, created_at: '2024-01-01T00:00:00Z',
      updated_at: null, deleted_at: null, onboarding_enabled: null,
      allow_self_register_region: null, auto_onboarded: null, brand_registry_id: null,
    },
    player_binding: null,
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

function binding(over: Partial<EntDetailPlayerBinding>): EntDetailPlayerBinding {
  return {
    brand_account_id: 'ba-1', brand_account_name: '데모', brand_account_status: 'active',
    brand_account_deleted_at: null, enterprise_account_id: 'ent-1',
    is_active_binding: true, binding_count: 1, ...over,
  };
}

describe('brandPlayerReadiness (runtime-truth)', () => {
  it('missing when no binding row', () => {
    expect(brandPlayerReadiness(base()).status).toBe('missing');
    expect(brandPlayerReadiness(base()).actionKind).toBe('brand-player');
  });
  it('ready when active + not deleted', () => {
    const d = base(); d.player_binding = binding({});
    expect(brandPlayerReadiness(d).status).toBe('ready');
  });
  it('attention when inactive', () => {
    const d = base(); d.player_binding = binding({ brand_account_status: 'inactive', is_active_binding: false });
    expect(brandPlayerReadiness(d).status).toBe('attention');
    expect(brandPlayerReadiness(d).headline).toBe('비활성');
  });
  it('attention (복구 필요) when soft-deleted', () => {
    const d = base(); d.player_binding = binding({ brand_account_deleted_at: '2024-06-01T00:00:00Z', is_active_binding: false });
    expect(brandPlayerReadiness(d).status).toBe('attention');
    expect(brandPlayerReadiness(d).headline).toBe('복구 필요');
  });
  it('does NOT go ready from brand_code / registry alone', () => {
    const d = base();
    d.invite.brand_code = 'DEMO';
    d.enterprise.brand_registry_id = 'reg-1';
    d.player_binding = null; // 실제 Player 바인딩 없음
    expect(brandPlayerReadiness(d).status).toBe('missing');
  });
  it('warns when binding_count > 1', () => {
    const d = base(); d.player_binding = binding({ binding_count: 2 });
    expect(brandPlayerReadiness(d).detail).toContain('2건');
  });
});

describe('brandRegistryReadiness (separate, not a player failure)', () => {
  it('missing when no brand_code', () => {
    expect(brandRegistryReadiness(base()).status).toBe('missing');
    expect(brandRegistryReadiness(base()).actionKind).toBe('brand-registry');
  });
  it('partial when code but no registry link', () => {
    const d = base(); d.invite.brand_code = 'DEMO';
    expect(brandRegistryReadiness(d).status).toBe('partial');
  });
  it('ready when code + registry linked', () => {
    const d = base(); d.invite.brand_code = 'DEMO'; d.enterprise.brand_registry_id = 'reg-1';
    expect(brandRegistryReadiness(d).status).toBe('ready');
  });
});

describe('businessReadiness', () => {
  it('missing when no profile', () => { expect(businessReadiness(base()).status).toBe('missing'); });
  it('ready when core fields filled', () => {
    const d = base();
    d.business_profile = {
      company_name: '쿠우쿠우(주)', business_number: '123-45-67890', representative_name: '홍길동',
      business_address: null, contact_phone: null, tax_invoice_email: null,
      settlement_contact_name: null, settlement_contact_phone: null, settlement_contact_email: null,
    };
    expect(businessReadiness(d).status).toBe('ready');
  });
});

describe('settlementReadiness', () => {
  it('missing when no contract', () => { expect(settlementReadiness(base()).status).toBe('missing'); });
  it('ready when terms complete', () => { const d = base(); d.contract = contractStub(); expect(settlementReadiness(d).status).toBe('ready'); });
  it('attention when latest settlement held', () => {
    const d = base(); d.contract = contractStub(); d.settlements = [{ ...settlementStub(), status: 'held' }];
    expect(settlementReadiness(d).status).toBe('attention');
  });
});

describe('inviteReadiness / regionReadiness / storeReadiness', () => {
  it('invite missing when no codes', () => { expect(inviteReadiness(base()).status).toBe('missing'); });
  it('region missing when none', () => { expect(regionReadiness(base()).status).toBe('missing'); });
  it('store missing when total 0', () => {
    expect(storeReadiness(base()).status).toBe('missing');
    expect(storeReadiness(base()).actionKind).toBe('tab:stores');
  });
  it('store attention when offline/error', () => {
    const d = base(); d.store_summary = { ...d.store_summary, total: 5, active: 4, offline_or_error: 1 };
    expect(storeReadiness(d).status).toBe('attention');
  });
});

describe('computeEnterpriseReadiness + countIncomplete', () => {
  it('returns domains in fixed order (brand_player first, brand_registry last)', () => {
    expect(computeEnterpriseReadiness(base()).map((i) => i.domain)).toEqual([
      'brand_player', 'business', 'settlement', 'invite', 'region', 'store', 'brand_registry',
    ]);
  });
  it('maps each domain to its supported action kind', () => {
    const byDomain = Object.fromEntries(computeEnterpriseReadiness(base()).map((i) => [i.domain, i.actionKind]));
    expect(byDomain).toEqual({
      brand_player: 'brand-player',
      brand_registry: 'brand-registry',
      business: 'settlement',
      settlement: 'settlement',
      invite: 'invite',
      region: 'regions',
      store: 'tab:stores',
    });
  });
  it('empty enterprise is fully incomplete (7 domains)', () => {
    expect(countIncomplete(computeEnterpriseReadiness(base()))).toBe(7);
  });
  it('fully-provisioned enterprise has zero incomplete', () => {
    expect(countIncomplete(computeEnterpriseReadiness(provisioned()))).toBe(0);
  });
});

describe('getEnterpriseRequiredActions', () => {
  it('brand_player (no binding) is REQUIRED with brand-player action', () => {
    const a = getEnterpriseRequiredActions(base()).find((x) => x.id === 'brand_player');
    expect(a?.priority).toBe('required');
    expect(a?.actionKind).toBe('brand-player');
  });
  it('brand_player inactive is required', () => {
    const d = base(); d.player_binding = binding({ brand_account_status: 'inactive', is_active_binding: false });
    expect(getEnterpriseRequiredActions(d).find((x) => x.id === 'brand_player')?.priority).toBe('required');
  });
  it('brand_player soft-deleted is required', () => {
    const d = base(); d.player_binding = binding({ brand_account_deleted_at: '2024-06-01T00:00:00Z', is_active_binding: false });
    expect(getEnterpriseRequiredActions(d).find((x) => x.id === 'brand_player')?.priority).toBe('required');
  });
  it('registry-not-linked but active player binding → registry is RECOMMENDED (brand-registry), not required', () => {
    const d = base();
    d.player_binding = binding({}); // active
    d.invite.brand_code = 'DEMO'; d.enterprise.brand_registry_id = null; // registry not linked
    const acts = getEnterpriseRequiredActions(d);
    expect(acts.find((x) => x.id === 'brand_player')).toBeUndefined(); // player ok → excluded
    const reg = acts.find((x) => x.id === 'brand_registry');
    expect(reg?.priority).toBe('recommended');
    expect(reg?.actionKind).toBe('brand-registry');
  });
  it('does NOT mark ready from brand_code+registry when player binding missing', () => {
    const d = base();
    d.invite.brand_code = 'DEMO'; d.enterprise.brand_registry_id = 'reg-1'; d.player_binding = null;
    expect(getEnterpriseRequiredActions(d).some((x) => x.id === 'brand_player' && x.priority === 'required')).toBe(true);
  });
  it('returns empty when fully provisioned', () => { expect(getEnterpriseRequiredActions(provisioned())).toEqual([]); });
  it('orders required before recommended', () => {
    const p = getEnterpriseRequiredActions(base()).map((x) => x.priority);
    expect(p.lastIndexOf('required')).toBeLessThan(p.indexOf('recommended'));
  });
  it('no duplicate ids', () => {
    const ids = getEnterpriseRequiredActions(base()).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('splitForDisplay', () => {
  it('shows up to limit and reports the rest', () => {
    expect(splitForDisplay([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2, 3], hiddenCount: 2 });
  });
  it('no hidden when within limit', () => {
    expect(splitForDisplay([1, 2], 3)).toEqual({ shown: [1, 2], hiddenCount: 0 });
  });
});

function provisioned(): EnterpriseDetail {
  const d = base();
  d.player_binding = binding({}); // active brand player binding
  d.invite = { hq_invite_code: 'HQ-1', store_invite_code: 'ST-1', brand_code: 'DEMO', invite_code_rotated_at: null, claims: [] };
  d.enterprise.brand_registry_id = 'reg-1';
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
