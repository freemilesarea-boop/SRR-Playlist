import { describe, it, expect } from 'vitest';
import { formatKRW, normalizePhone } from './paymentFormat';

describe('formatKRW', () => {
  it('formats with ₩ and thousands separators', () => {
    expect(formatKRW(0)).toBe('₩0');
    expect(formatKRW(4900)).toBe('₩4,900');
    expect(formatKRW(1234567)).toBe('₩1,234,567');
  });
});

describe('normalizePhone', () => {
  it('strips non-digits', () => {
    expect(normalizePhone('010-1234-5678')).toBe('01012345678');
    expect(normalizePhone('  +82 10 1 ')).toBe('82101');
  });
});
