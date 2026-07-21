import { describe, it, expect } from 'vitest';
import {
  buildSettlementDisplayModel,
  humanizeHoldReason,
  humanizeTaxType,
  artistStatusGuidance,
  summarizeSettlements,
  settlementRowsToCsv,
  requiredActionLabel,
} from './settlementDisplayModel';
import type { AdminSettlementRow } from './artistSettlementApi';

function row(over: Partial<AdminSettlementRow>): AdminSettlementRow {
  return {
    id: 'x', settlement_month: '2099-02-01', artist_user_id: 'a',
    artist_nickname: 'n', artist_email: 'e',
    gross_settlement_amount: 0, company_fee_amount: 0, sales_agent_fee_amount: 0,
    artist_net_settlement: 0, previous_carried_amount: 0, total_settlement_amount: 0,
    meets_min_payout: false, withholding_tax_amount: 0, final_payout_amount: 0,
    carried_over_amount: 0, status: 'pending', finalized_at: null, paid_at: null,
    created_at: '', payout_account_id: null, legal_name: null, rrn_masked: null,
    has_rrn: false, bank_name: null, masked_account_number: null, account_holder: null,
    has_account_number: false, tax_withholding_type: null, payout_account_status: 'missing',
    is_manual_carryover: false, carryover_applied: false, carried_over_to_month: null,
    carryover_reason: null, held_reason: null, merged_into_settlement_id: null,
    payout_memo: null, version: 1, is_current: true, ...over,
  };
}

describe('buildSettlementDisplayModel — status-aware amounts (no double count)', () => {
  it('manually-carried payable: final and carryover_taxed are the SAME money → not summed', () => {
    // RELEASE-GATE-1 risk: final_payout=29010 AND carryover_taxed=29010 on a carried_over row
    const m = buildSettlementDisplayModel(row({
      status: 'carried_over', final_payout_amount: 29010,
      carryover_taxed_amount: 29010, carryover_untaxed_amount: 0, is_manual_carryover: true,
    }));
    expect(m.effectivePayableAmount).toBe(0);              // carried → not currently payable
    expect(m.totalNextCarryoverAmount).toBe(29010);         // the money is the carryover
    expect(m.paidAmount).toBe(0);
    // the two fields are never added into one current figure
    expect(m.effectivePayableAmount + m.totalNextCarryoverAmount).toBe(29010); // not 58020
    expect(m.calculatedFinalPayoutAmount).toBe(29010);      // stale value kept only as reference
  });

  it('payable: effectivePayable = final, carryover = 0', () => {
    const m = buildSettlementDisplayModel(row({ status: 'payable', final_payout_amount: 9670, meets_min_payout: true }));
    expect(m.effectivePayableAmount).toBe(9670);
    expect(m.totalNextCarryoverAmount).toBe(0);
    expect(m.remainingUnpaidAmount).toBe(9670);
    expect(m.paidAmount).toBe(0);
  });

  it('paid: paidAmount = final, remaining = 0, carryover = 0', () => {
    const m = buildSettlementDisplayModel(row({ status: 'paid', final_payout_amount: 9670, meets_min_payout: true, paid_at: '2099-03-01' }));
    expect(m.paidAmount).toBe(9670);
    expect(m.effectivePayableAmount).toBe(9670);
    expect(m.remainingUnpaidAmount).toBe(0);
    expect(m.totalNextCarryoverAmount).toBe(0);
  });

  it('pending below-min: effectivePayable 0, carryover = carried_over', () => {
    const m = buildSettlementDisplayModel(row({ status: 'pending', meets_min_payout: false, carried_over_amount: 5000, carryover_untaxed_amount: 5000 }));
    expect(m.effectivePayableAmount).toBe(0);
    expect(m.totalNextCarryoverAmount).toBe(5000);
    expect(m.nextUntaxedCarryoverAmount).toBe(5000);
  });

  it('pending meets-min: effectivePayable = final (will be payable)', () => {
    const m = buildSettlementDisplayModel(row({ status: 'pending', meets_min_payout: true, final_payout_amount: 9670 }));
    expect(m.effectivePayableAmount).toBe(9670);
    expect(m.totalNextCarryoverAmount).toBe(0);
  });

  it('held pii: payable 0, calculated shown, hold reason present', () => {
    const m = buildSettlementDisplayModel(row({ status: 'held', held_reason: 'pii_incomplete', final_payout_amount: 19340, meets_min_payout: true }));
    expect(m.effectivePayableAmount).toBe(0);
    expect(m.calculatedFinalPayoutAmount).toBe(19340);
    expect(m.holdReason).toBe('pii_incomplete');
    expect(m.isHeld).toBe(true);
  });

  it('taxed carry-in not double counted into taxable base (uses snapshot when present)', () => {
    const m = buildSettlementDisplayModel(row({
      status: 'pending', meets_min_payout: true, taxable_base_amount: 12000,
      previous_carryover_untaxed_amount: 12000, previous_carryover_taxed_amount: 9670,
      withholding_tax_amount: 396, final_payout_amount: 21274,
    }));
    expect(m.taxableBaseAmount).toBe(12000);
    expect(m.previousTaxedCarryoverAmount).toBe(9670);
    expect(m.previousUntaxedCarryoverAmount).toBe(12000);
    expect(m.totalPreviousCarryoverAmount).toBe(21670);
  });

  it('graceful degrade: no split fields → legacy carried amounts as untaxed', () => {
    const m = buildSettlementDisplayModel(row({ status: 'carried_over', carried_over_amount: 8000, previous_carried_amount: 3000 }));
    expect(m.nextUntaxedCarryoverAmount).toBe(8000);
    expect(m.nextTaxedCarryoverAmount).toBe(0);
    expect(m.previousUntaxedCarryoverAmount).toBe(3000);
  });
});

describe('humanizeHoldReason', () => {
  it('maps known reasons to friendly text', () => {
    expect(humanizeHoldReason('pii_incomplete')).toContain('주민등록번호');
    expect(humanizeHoldReason('account_missing')).toContain('계좌');
    expect(humanizeHoldReason('tax_type_unknown')).toContain('원천징수');
    expect(humanizeHoldReason('auto_merged_into_2099-03')).toContain('2099-03');
    expect(humanizeHoldReason(null)).toBeNull();
  });
});

describe('humanizeTaxType', () => {
  it('labels type with rate', () => {
    expect(humanizeTaxType('business_income_3_3', 0.033)).toBe('사업소득 3.3% (3.3%)');
    expect(humanizeTaxType('other_income_8_8', 0.088)).toBe('기타소득 8.8% (8.8%)');
    expect(humanizeTaxType('none', 0)).toContain('원천징수 없음');
    expect(humanizeTaxType(null, null)).toBe('—');
  });
});

describe('artistStatusGuidance — no internal jargon', () => {
  it('gives friendly guidance without "PII"', () => {
    const held = buildSettlementDisplayModel(row({ status: 'held', held_reason: 'pii_incomplete' }));
    const g = artistStatusGuidance(held);
    expect(g).not.toContain('PII');
    expect(g).toContain('정산 정보');
    expect(artistStatusGuidance(buildSettlementDisplayModel(row({ status: 'paid', final_payout_amount: 1, meets_min_payout: true })))).toContain('지급 완료');
    expect(artistStatusGuidance(buildSettlementDisplayModel(row({ status: 'carried_over', carried_over_amount: 1 })))).toContain('이월');
  });
});

describe('summarizeSettlements + CSV parity (no double count)', () => {
  const dataset = [
    row({ status: 'payable', final_payout_amount: 9670, meets_min_payout: true, artist_net_settlement: 10000 }),
    row({ status: 'paid', final_payout_amount: 18240, meets_min_payout: true, paid_at: '2099-03-01', artist_net_settlement: 20000 }),
    // manually-carried payable: final 29010 AND carryover_taxed 29010 = same money
    row({ status: 'carried_over', final_payout_amount: 29010, carryover_taxed_amount: 29010, carryover_untaxed_amount: 0, is_manual_carryover: true }),
    // below-min carried
    row({ status: 'pending', meets_min_payout: false, carried_over_amount: 5000, carryover_untaxed_amount: 5000 }),
    row({ status: 'held', held_reason: 'pii_incomplete', final_payout_amount: 19340, meets_min_payout: true }),
  ];

  it('summary does not double-count manual-carry money across payable and carryover', () => {
    const s = summarizeSettlements(dataset);
    expect(s.count).toBe(5);
    // effective payable: payable 9670 + paid 18240 (paid path) = 27910 (held=0, carried=0, below-min=0)
    expect(s.totalEffectivePayable).toBe(9670 + 18240);
    expect(s.totalPaid).toBe(18240);
    // next carryover: manual-carry 29010 + below-min 5000 = 34010 (payable/paid/held excluded)
    expect(s.totalNextCarryover).toBe(29010 + 5000);
    // the manual-carry 29010 appears in carryover ONLY, never added to payable
    expect(s.totalEffectivePayable).toBe(27910);
    expect(s.heldCount).toBe(1);
    expect(s.identityIncompleteCount).toBe(1);
  });

  it('CSV column sums equal the on-screen summary (parity)', () => {
    const s = summarizeSettlements(dataset);
    const csv = settlementRowsToCsv(dataset);
    const rows = csv.split('\n');
    const header = rows[0].split(',');
    const idxPayable = header.indexOf('현재 지급 가능액');
    const idxNextUntaxed = header.indexOf('다음 미과세 이월');
    const idxNextTaxed = header.indexOf('다음 기과세 이월');
    const idxPaid = header.indexOf('지급 완료액');
    let payable = 0, nextCarry = 0, paid = 0;
    for (const line of rows.slice(1)) {
      const c = line.split(',');
      payable += Number(c[idxPayable]);
      nextCarry += Number(c[idxNextUntaxed]) + Number(c[idxNextTaxed]);
      paid += Number(c[idxPaid]);
    }
    expect(payable).toBe(s.totalEffectivePayable);
    expect(nextCarry).toBe(s.totalNextCarryover);
    expect(paid).toBe(s.totalPaid);
  });

  it('CSV omits sensitive columns and values (no account/rrn data)', () => {
    const header = settlementRowsToCsv([]).split('\n')[0];
    // no sensitive COLUMNS (account number / rrn)
    expect(header).not.toMatch(/계좌|주민|rrn|account_number/i);
    // no masked account / rrn VALUE patterns in the data
    const csv = settlementRowsToCsv(dataset);
    expect(csv).not.toMatch(/\*{3,}\d|\d{6}-\*/);
  });
});

describe('displayAmountKind + requiredAction + statusLabel', () => {
  it('kinds by status', () => {
    expect(buildSettlementDisplayModel(row({ status: 'paid', final_payout_amount: 1, meets_min_payout: true })).displayAmountKind).toBe('paid');
    expect(buildSettlementDisplayModel(row({ status: 'payable', final_payout_amount: 1, meets_min_payout: true })).displayAmountKind).toBe('payable');
    expect(buildSettlementDisplayModel(row({ status: 'held', held_reason: 'pii_incomplete' })).displayAmountKind).toBe('held');
    expect(buildSettlementDisplayModel(row({ status: 'carried_over', is_manual_carryover: true, carryover_taxed_amount: 1 })).displayAmountKind).toBe('manual_carryover');
    expect(buildSettlementDisplayModel(row({ status: 'carried_over', carried_over_amount: 1 })).displayAmountKind).toBe('auto_carryover');
  });
  it('required actions', () => {
    expect(buildSettlementDisplayModel(row({ status: 'held', held_reason: 'pii_incomplete' })).requiredAction).toBe('verify_identity');
    expect(buildSettlementDisplayModel(row({ status: 'held', held_reason: 'account_unverified' })).requiredAction).toBe('verify_account');
    expect(buildSettlementDisplayModel(row({ status: 'held', held_reason: 'tax_type_unknown' })).requiredAction).toBe('set_tax');
    expect(buildSettlementDisplayModel(row({ status: 'payable', final_payout_amount: 1, meets_min_payout: true })).requiredAction).toBe('pay');
    expect(requiredActionLabel('verify_identity')).toBe('정산정보 확인');
  });
  it('held statusLabel avoids raw code', () => {
    expect(buildSettlementDisplayModel(row({ status: 'held', held_reason: 'pii_incomplete' })).statusLabel).toBe('정산정보 입력 필요');
  });
});
