import { describe, it, expect } from 'vitest';
import {
  matchesPayoutAccountFilter,
  countByPayoutAccountFilter,
  PAYOUT_ACCOUNT_FILTERS,
  type PayoutAccountStatusFields,
} from './payoutAccountFilter';

const row = (verification_status: string, is_pii_complete: boolean): PayoutAccountStatusFields =>
  ({ verification_status, is_pii_complete });

// 8/31 #525 의 실제 형태를 그대로 옮긴 표본:
// 인증 대기 1 · 인증+완비 2 · 인증됐지만 미완비 3(지급 보류) · 거절 1.
const SAMPLE: PayoutAccountStatusFields[] = [
  row('pending', false),
  row('verified', true),
  row('verified', true),
  row('verified', false),
  row('verified', false),
  row('verified', false),
  row('rejected', false),
];

describe('payout account filter', () => {
  it("'정보 미완비' 는 인증됐지만 지급 요건 미충족인 것만 잡는다", () => {
    const hits = SAMPLE.filter((r) => matchesPayoutAccountFilter(r, 'incomplete'));
    expect(hits).toHaveLength(3);
    for (const r of hits) {
      expect(r.verification_status).toBe('verified');
      expect(r.is_pii_complete).toBe(false);
    }
  });

  it("미인증 계좌는 요건이 비어 있어도 '미완비' 로 세지 않는다", () => {
    // 아직 인증 단계라 '지급 보류' 가 아니다 — pending/rejected 칸에만 들어간다.
    expect(matchesPayoutAccountFilter(row('pending', false), 'incomplete')).toBe(false);
    expect(matchesPayoutAccountFilter(row('rejected', false), 'incomplete')).toBe(false);
    expect(matchesPayoutAccountFilter(row('pending', false), 'pending')).toBe(true);
    expect(matchesPayoutAccountFilter(row('rejected', false), 'rejected')).toBe(true);
  });

  it("'지급 가능' 은 인증 + 요건 완비", () => {
    expect(matchesPayoutAccountFilter(row('verified', true), 'ready')).toBe(true);
    expect(matchesPayoutAccountFilter(row('verified', false), 'ready')).toBe(false);
    expect(matchesPayoutAccountFilter(row('pending', true), 'ready')).toBe(false);
  });

  it('verified 는 미완비와 지급가능으로만 갈리고 겹치지 않는다', () => {
    for (const r of SAMPLE.filter((x) => x.verification_status === 'verified')) {
      const inc = matchesPayoutAccountFilter(r, 'incomplete');
      const ready = matchesPayoutAccountFilter(r, 'ready');
      expect(inc).not.toBe(ready);
    }
  });

  it('건수 합계 — 전체는 모든 행, 나머지는 배타적으로 전체를 채운다', () => {
    const c = countByPayoutAccountFilter(SAMPLE);
    expect(c.all).toBe(SAMPLE.length);
    expect(c.pending).toBe(1);
    expect(c.incomplete).toBe(3);
    expect(c.ready).toBe(2);
    expect(c.rejected).toBe(1);
    expect(c.pending + c.incomplete + c.ready + c.rejected).toBe(c.all);
  });

  it('빈 목록에서도 모든 필터 키가 0 으로 존재한다', () => {
    const c = countByPayoutAccountFilter([]);
    for (const f of PAYOUT_ACCOUNT_FILTERS) expect(c[f.key]).toBe(0);
  });
});
