import { describe, expect, it } from 'vitest';
import {
  SETTLEMENT_STATUSES, ACCOUNT_STATUSES, ENTITY_TYPES, DELTA_REASON_CANDIDATES, ACCESS_AUDIT_ACTIONS,
  OPERATION_MODE_COLUMNS, DEVELOPER_MODE_EXTRA_COLUMNS,
  maskResidentNumber, maskAccountNumber, maskEmail, formatKrw, translateSettlementStatus,
  classifyAccountStatus, classifyShadowDelta, buildDeltaExplanation, filterSettlementRows,
  calculateSettlementKpis, summarizePayoutHistory, SETTLEMENT_READABILITY_SUPPORT,
} from './settlementReadability';

describe('settlementReadability 상수', () => {
  it('whitelist 개수 고정 — 정산상태 6·계좌상태 4·유형 4·이유후보 10·Audit 9', () => {
    expect(SETTLEMENT_STATUSES).toHaveLength(6);
    expect(ACCOUNT_STATUSES).toHaveLength(4);
    expect(ENTITY_TYPES).toHaveLength(4);
    expect(DELTA_REASON_CANDIDATES).toHaveLength(10);
    expect(ACCESS_AUDIT_ACTIONS).toHaveLength(9);
    expect(OPERATION_MODE_COLUMNS).toContain('artist_name');
    expect(OPERATION_MODE_COLUMNS).not.toContain('settlement_id');
    expect(DEVELOPER_MODE_EXTRA_COLUMNS).toContain('settlement_id');
  });
});

describe('maskResidentNumber (0300 정책 미러)', () => {
  it('앞 6자리만 노출·뒤 7자리 전체 마스킹', () => {
    expect(maskResidentNumber('930101-1234567')).toBe('930101-*******');
    expect(maskResidentNumber('9301011234567')).toBe('930101-*******');
    expect(maskResidentNumber('123')).toBe('******');
    expect(maskResidentNumber(null)).toBeNull();
    expect(maskResidentNumber('  ')).toBeNull();
  });
});

describe('maskAccountNumber (0300 정책 미러)', () => {
  it('끝 4자리만 노출·최소 4개 * 보장', () => {
    expect(maskAccountNumber('110222123456')).toBe('********3456');
    expect(maskAccountNumber('12345')).toBe('****2345');
    expect(maskAccountNumber('123')).toBe('***');
    expect(maskAccountNumber(null)).toBeNull();
  });
});

describe('maskEmail', () => {
  it('로컬부 마스킹·도메인 유지', () => {
    expect(maskEmail('hong@test.com')).toBe('ho**@test.com');
    expect(maskEmail('a@b.com')).toBe('a**@b.com');
    expect(maskEmail('invalid')).toBeNull();
  });
});

describe('formatKrw/translateSettlementStatus', () => {
  it('원화 표기·한글 상태 라벨', () => {
    expect(formatKrw(158000)).toBe('158,000원');
    expect(formatKrw(null)).toBe('—');
    expect(formatKrw(Number.NaN)).toBe('—');
    expect(translateSettlementStatus('pending')).toBe('지급대기');
    expect(translateSettlementStatus('paid')).toBe('지급완료');
    expect(translateSettlementStatus('held')).toBe('보류');
    expect(translateSettlementStatus('unknown_x')).toBe('unknown_x');
  });
});

describe('classifyAccountStatus', () => {
  it('미등록/검증대기/검증완료/검증실패 구분', () => {
    expect(classifyAccountStatus({ hasAccount: false, verificationStatus: null })).toBe('unregistered');
    expect(classifyAccountStatus({ hasAccount: true, verificationStatus: 'pending' })).toBe('verification_pending');
    expect(classifyAccountStatus({ hasAccount: true, verificationStatus: 'verified' })).toBe('verified');
    expect(classifyAccountStatus({ hasAccount: true, verificationStatus: 'rejected' })).toBe('verification_failed');
  });
});

describe('classifyShadowDelta (성분 분해 — 계산 변경 없음)', () => {
  const comp = (over: Partial<{ grossDelta: number; companyFeeDelta: number; agentFeeDelta: number; taxDelta: number; carryoverDelta: number }> = {}) => ({ grossDelta: 0, companyFeeDelta: 0, agentFeeDelta: 0, taxDelta: 0, carryoverDelta: 0, ...over });
  it('차이 없음/단일 성분/복합 성분 구분·이유는 후보', () => {
    expect(classifyShadowDelta({ v1Net: 100, v2Net: 100, components: comp() })).toMatchObject({ netDelta: 0, primaryReasonCandidate: 'no_difference', reasonIsCandidateOnly: true, shadowRecalculated: false });
    const tax = classifyShadowDelta({ v1Net: 100000, v2Net: 96800, components: comp({ taxDelta: -3200 }) });
    expect(tax).toMatchObject({ netDelta: -3200, primaryReasonCandidate: 'tax_difference' });
    const gross = classifyShadowDelta({ v1Net: 100000, v2Net: 98470, components: comp({ grossDelta: -1530 }) });
    expect(gross.primaryReasonCandidate).toBe('gross_or_eligible_difference');
    const mixed = classifyShadowDelta({ v1Net: 100, v2Net: 300, components: comp({ grossDelta: 120, taxDelta: -80 }) });
    expect(mixed.primaryReasonCandidate).toBe('mixed_difference');
  });
  it('v1/v2 결측·값 결측은 정직 유지', () => {
    expect(classifyShadowDelta({ v1Net: 100, v2Net: null, components: null }).primaryReasonCandidate).toBe('insufficient_data');
    expect(classifyShadowDelta({ v1Net: 100, v2Net: 200, components: null, v2Missing: true }).primaryReasonCandidate).toBe('v1_only_missing_v2');
    expect(classifyShadowDelta({ v1Net: null, v2Net: 200, components: null, v1Missing: true }).primaryReasonCandidate).toBe('v2_only_missing_v1');
    expect(classifyShadowDelta({ v1Net: 100, v2Net: 200, components: comp() }).primaryReasonCandidate).toBe('insufficient_data');
  });
});

describe('buildDeltaExplanation (왜 차이가 나는지 표기)', () => {
  it('유효재생/세금/이월 사유 문구 생성 — 후보 표기', () => {
    expect(buildDeltaExplanation({ primaryReasonCandidate: 'gross_or_eligible_difference', netDelta: -1530, eligibleStreamDelta: -15 })).toBe('v2 Gross/유효재생 차이 후보: 유효재생 -15건 → Net -1,530원');
    expect(buildDeltaExplanation({ primaryReasonCandidate: 'tax_difference', netDelta: 3200 })).toBe('원천징수(세금) 차이 후보 → Net +3,200원');
    expect(buildDeltaExplanation({ primaryReasonCandidate: 'no_difference', netDelta: 0 })).toBe('v1 = v2 (차이 없음)');
    expect(buildDeltaExplanation({ primaryReasonCandidate: 'v1_only_missing_v2', netDelta: null })).toBe('차이 판정 불가(insufficient_data)');
  });
});

describe('filterSettlementRows', () => {
  const rows = [
    { artist_name: '홍길동밴드', real_name: '홍길동', nickname: 'hong', email: 'hong@test.com', status: 'pending', bank_name: '국민은행', masked_account_number: '********3456', entity_type: 'business', final_payout_amount: 158000 },
    { artist_name: '김아티스트', real_name: '김회원', nickname: 'kim', email: 'kim@test.com', status: 'paid', bank_name: '신한은행', masked_account_number: '********7890', entity_type: 'individual_other_income', final_payout_amount: 50000 },
  ];
  it('이름/이메일/은행/끝4자리/상태/유형/금액범위 필터', () => {
    expect(filterSettlementRows(rows, { search: '홍길동' })).toHaveLength(1);
    expect(filterSettlementRows(rows, { search: 'kim@test.com' })).toHaveLength(1);
    expect(filterSettlementRows(rows, { search: '3456' })).toHaveLength(1);
    expect(filterSettlementRows(rows, { status: 'paid' })).toHaveLength(1);
    expect(filterSettlementRows(rows, { bank: '국민' })).toHaveLength(1);
    expect(filterSettlementRows(rows, { entityType: 'business' })).toHaveLength(1);
    expect(filterSettlementRows(rows, { minAmount: 100000 })).toHaveLength(1);
    expect(filterSettlementRows(rows, { maxAmount: 60000 })).toHaveLength(1);
    expect(filterSettlementRows(rows, {})).toHaveLength(2);
  });
});

describe('calculateSettlementKpis (재계산 없음)', () => {
  it('지급예정/완료/보류/이월/미등록/검증실패 집계', () => {
    const k = calculateSettlementKpis([
      { status: 'pending', final_payout_amount: 100000, account_status: 'verified' },
      { status: 'payable', final_payout_amount: 58000, account_status: 'unregistered' },
      { status: 'paid', final_payout_amount: 163000, account_status: 'verified' },
      { status: 'held', final_payout_amount: 5000, account_status: 'verification_failed' },
      { status: 'carried_over', final_payout_amount: 0, account_status: 'verified' },
    ]);
    expect(k).toMatchObject({ payableTotal: 158000, paidTotal: 163000, heldCount: 1, carriedOverCount: 1, unregisteredAccountCount: 1, verificationFailedCount: 1, settlementValuesRecomputed: false });
    expect(calculateSettlementKpis(null).payableTotal).toBe(0);
  });
});

describe('summarizePayoutHistory', () => {
  it('월 내림차순·원화/한글 라벨', () => {
    const h = summarizePayoutHistory([
      { settlement_month: '2026-06-01', final_payout: 158000, status: 'paid' },
      { settlement_month: '2026-07-01', final_payout: 163000, status: 'pending' },
    ]);
    expect(h[0]).toMatchObject({ label: '2026-07', amountLabel: '163,000원', statusLabel: '지급대기' });
    expect(h[1]).toMatchObject({ label: '2026-06', amountLabel: '158,000원', statusLabel: '지급완료' });
  });
});

describe('지원 매트릭스(변경 금지 명시)', () => {
  it('settlement/payment/shadow/version 변경 계열 전부 unsupported', () => {
    const unsupported = SETTLEMENT_READABILITY_SUPPORT.filter((s) => s.status === 'unsupported').map((s) => s.key);
    expect(unsupported).toContain('settlement_modification');
    expect(unsupported).toContain('payment_execution_change');
    expect(unsupported).toContain('shadow_recalculation');
    expect(unsupported).toContain('version_change');
    expect(unsupported).toContain('pii_plaintext_in_list');
    expect(SETTLEMENT_READABILITY_SUPPORT.filter((s) => s.status === 'supported').length).toBe(14);
  });
});
