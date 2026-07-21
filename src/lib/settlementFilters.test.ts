import { describe, it, expect } from 'vitest';
import {
  applySettlementFilters,
  settlementFacetMatches,
  settlementSearchMatches,
  buildSettlementDisplayModel,
  SETTLEMENT_FACET_LABELS,
  type SettlementFacet,
} from './settlementDisplayModel';
import type { AdminSettlementRow } from './artistSettlementApi';

function row(over: Partial<AdminSettlementRow>): AdminSettlementRow {
  return {
    id: 'x', settlement_month: '2099-02-01', artist_user_id: 'u-000', artist_nickname: 'n', artist_email: 'e',
    gross_settlement_amount: 0, company_fee_amount: 0, sales_agent_fee_amount: 0, artist_net_settlement: 0,
    previous_carried_amount: 0, total_settlement_amount: 0, meets_min_payout: false, withholding_tax_amount: 0,
    final_payout_amount: 0, carried_over_amount: 0, status: 'pending', finalized_at: null, paid_at: null,
    created_at: '', payout_account_id: null, legal_name: null, rrn_masked: null, has_rrn: false, bank_name: null,
    masked_account_number: null, account_holder: null, has_account_number: false, tax_withholding_type: null,
    payout_account_status: 'missing', is_manual_carryover: false, carryover_applied: false, carried_over_to_month: null,
    carryover_reason: null, held_reason: null, merged_into_settlement_id: null, payout_memo: null, version: 1,
    is_current: true, ...over,
  };
}
const model = (over: Partial<AdminSettlementRow>) => buildSettlementDisplayModel(row(over));

describe('settlementFacetMatches', () => {
  it('payable: effectivePayable>0 & not paid', () => {
    expect(settlementFacetMatches(model({ status: 'payable', final_payout_amount: 100 }), 'payable')).toBe(true);
    expect(settlementFacetMatches(model({ status: 'paid', final_payout_amount: 100, meets_min_payout: true }), 'payable')).toBe(false);
  });
  it('paid', () => {
    expect(settlementFacetMatches(model({ status: 'paid', final_payout_amount: 100 }), 'paid')).toBe(true);
    expect(settlementFacetMatches(model({ status: 'payable', final_payout_amount: 100 }), 'paid')).toBe(false);
  });
  it('held', () => {
    expect(settlementFacetMatches(model({ status: 'held', held_reason: 'pii_incomplete' }), 'held')).toBe(true);
  });
  it('manual vs auto carryover', () => {
    expect(settlementFacetMatches(model({ status: 'carried_over', is_manual_carryover: true }), 'manual_carryover')).toBe(true);
    expect(settlementFacetMatches(model({ status: 'carried_over', is_manual_carryover: true }), 'auto_carryover')).toBe(false);
    expect(settlementFacetMatches(model({ status: 'carried_over', is_manual_carryover: false }), 'auto_carryover')).toBe(true);
  });
  it('below_min: pending & !meetsMin & !paid & !held', () => {
    expect(settlementFacetMatches(model({ status: 'pending', meets_min_payout: false }), 'below_min')).toBe(true);
    expect(settlementFacetMatches(model({ status: 'pending', meets_min_payout: true }), 'below_min')).toBe(false);
  });
  it('identity / account / tax review map to requiredAction', () => {
    expect(settlementFacetMatches(model({ status: 'held', held_reason: 'pii_incomplete' }), 'identity_incomplete')).toBe(true);
    expect(settlementFacetMatches(model({ status: 'held', held_reason: 'account_unverified' }), 'account_incomplete')).toBe(true);
    expect(settlementFacetMatches(model({ status: 'held', held_reason: 'tax_type_unknown' }), 'tax_review')).toBe(true);
  });
  it('has_carryover: previous or next > 0', () => {
    expect(settlementFacetMatches(model({ previous_carryover_untaxed_amount: 500 }), 'has_carryover')).toBe(true);
    expect(settlementFacetMatches(model({ status: 'carried_over', carryover_taxed_amount: 500 }), 'has_carryover')).toBe(true);
    expect(settlementFacetMatches(model({}), 'has_carryover')).toBe(false);
  });
  it('all always matches', () => {
    expect(settlementFacetMatches(model({}), 'all')).toBe(true);
  });
});

describe('settlementSearchMatches', () => {
  const r = row({ artist_nickname: '가수A', artist_email: 'Star@Example.com', legal_name: '홍길동', artist_user_id: 'uuid-1234-abcd' });
  it('empty / whitespace query matches everything', () => {
    expect(settlementSearchMatches(r, '')).toBe(true);
    expect(settlementSearchMatches(r, '   ')).toBe(true);
  });
  it('matches nickname / email (case-insensitive) / legal_name / user id', () => {
    expect(settlementSearchMatches(r, '가수')).toBe(true);
    expect(settlementSearchMatches(r, 'star@example.com')).toBe(true);
    expect(settlementSearchMatches(r, '홍길동')).toBe(true);
    expect(settlementSearchMatches(r, 'abcd')).toBe(true);
  });
  it('trims surrounding whitespace', () => {
    expect(settlementSearchMatches(r, '  가수A  ')).toBe(true);
  });
  it('non-match returns false', () => {
    expect(settlementSearchMatches(r, '없는이름')).toBe(false);
  });
});

describe('applySettlementFilters — shared dataset for 목록/Summary/CSV', () => {
  const rows = [
    row({ id: 'p', status: 'paid', final_payout_amount: 9670, meets_min_payout: true, artist_nickname: '지급완료님' }),
    row({ id: 'c', status: 'carried_over', is_manual_carryover: true, carryover_taxed_amount: 29010, artist_nickname: '수동이월님' }),
    row({ id: 'y', status: 'payable', final_payout_amount: 12000, meets_min_payout: true, artist_nickname: '지급가능님' }),
  ];
  it('facet=all + no search returns all rows', () => {
    expect(applySettlementFilters(rows, 'all', '').map((r) => r.id)).toEqual(['p', 'c', 'y']);
  });
  it('facet=paid narrows to paid only', () => {
    expect(applySettlementFilters(rows, 'paid', '').map((r) => r.id)).toEqual(['p']);
  });
  it('facet=manual_carryover narrows to manual carry only', () => {
    expect(applySettlementFilters(rows, 'manual_carryover', '').map((r) => r.id)).toEqual(['c']);
  });
  it('search combines with facet (AND)', () => {
    expect(applySettlementFilters(rows, 'all', '지급가능').map((r) => r.id)).toEqual(['y']);
    expect(applySettlementFilters(rows, 'paid', '지급가능').map((r) => r.id)).toEqual([]);
  });
});

describe('SETTLEMENT_FACET_LABELS', () => {
  it('every facet key has a Korean label', () => {
    const facets: SettlementFacet[] = ['all', 'payable', 'paid', 'held', 'auto_carryover', 'manual_carryover',
      'below_min', 'identity_incomplete', 'account_incomplete', 'tax_review', 'has_carryover'];
    for (const f of facets) expect(SETTLEMENT_FACET_LABELS[f]).toBeTruthy();
  });
});
