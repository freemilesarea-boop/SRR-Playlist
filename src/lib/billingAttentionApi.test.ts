import { describe, it, expect } from 'vitest';
import { overdueBucket } from './billingAttentionApi';

describe('overdueBucket', () => {
  it('2주 이내는 최근, 45일 이내는 한 달, 그 이상은 오래됨', () => {
    expect(overdueBucket(0)).toBe('recent');
    expect(overdueBucket(14)).toBe('recent');
    expect(overdueBucket(15)).toBe('month');
    expect(overdueBucket(45)).toBe('month');
    expect(overdueBucket(46)).toBe('old');
  });
});
