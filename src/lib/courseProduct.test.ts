import { describe, it, expect } from 'vitest';
import {
  formatKRW, normalizePhone, validateCourseProductForm, courseFormToParams, seatLabel,
  COURSE_ORDER_STATUS_LABEL, COURSE_ORDER_STATUS_TONE,
  type CourseProductForm,
} from './courseProduct';

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

describe('validateCourseProductForm', () => {
  const base: CourseProductForm = { name: '기초반', description: '설명', category: '보컬', price: 50000, capacity: '', sortOrder: '' };
  it('passes a valid form', () => {
    expect(validateCourseProductForm(base).ok).toBe(true);
  });
  it('requires a name', () => {
    expect(validateCourseProductForm({ ...base, name: '   ' }).ok).toBe(false);
  });
  it('requires a positive integer price', () => {
    expect(validateCourseProductForm({ ...base, price: 0 }).ok).toBe(false);
    expect(validateCourseProductForm({ ...base, price: -100 }).ok).toBe(false);
    expect(validateCourseProductForm({ ...base, price: 1000.5 }).ok).toBe(false);
    expect(validateCourseProductForm({ ...base, price: 'abc' }).ok).toBe(false);
  });
  it('allows empty capacity (unlimited) but rejects non-positive', () => {
    expect(validateCourseProductForm({ ...base, capacity: '' }).ok).toBe(true);
    expect(validateCourseProductForm({ ...base, capacity: 10 }).ok).toBe(true);
    expect(validateCourseProductForm({ ...base, capacity: 0 }).ok).toBe(false);
    expect(validateCourseProductForm({ ...base, capacity: -5 }).ok).toBe(false);
  });
});

describe('courseFormToParams', () => {
  it('normalizes numbers and nulls', () => {
    const p = courseFormToParams({ name: '  A  ', description: 'd', category: '  ', price: '50000', capacity: '', sortOrder: '' });
    expect(p).toEqual({ name: 'A', description: 'd', category: null, price: 50000, capacity: null, sort_order: 0 });
  });
  it('keeps capacity and sort when provided', () => {
    const p = courseFormToParams({ name: 'A', description: '', category: '보컬', price: 10000, capacity: '20', sortOrder: '3' });
    expect(p.capacity).toBe(20);
    expect(p.sort_order).toBe(3);
    expect(p.category).toBe('보컬');
  });
});

describe('seatLabel', () => {
  it('shows unlimited count', () => {
    expect(seatLabel(null, 5)).toBe('5명 신청');
  });
  it('shows remaining seats', () => {
    expect(seatLabel(3, 7)).toBe('잔여 3석');
  });
  it('shows sold out', () => {
    expect(seatLabel(0, 20)).toBe('마감');
  });
});

describe('status maps', () => {
  it('has label + tone for every status', () => {
    for (const s of ['requested', 'waiting', 'paid', 'canceled', 'failed'] as const) {
      expect(COURSE_ORDER_STATUS_LABEL[s]).toBeTruthy();
      expect(COURSE_ORDER_STATUS_TONE[s]).toBeTruthy();
    }
  });
});
