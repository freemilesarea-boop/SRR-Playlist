import { describe, it, expect } from 'vitest';
import {
  computeNextRecent, hashUserKey, sanitizeRecent, MAX_RECENT, type RecentItem,
} from './operatorRecent';

const item = (id: string): RecentItem => ({ id, label: `L-${id}`, path: `/ops/${id}` });

describe('computeNextRecent', () => {
  it('prepends newest', () => {
    const next = computeNextRecent([item('a')], item('b'));
    expect(next.map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('dedupes by id, moving to front', () => {
    const next = computeNextRecent([item('a'), item('b'), item('c')], item('c'));
    expect(next.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });
  it('caps at MAX_RECENT', () => {
    let list: RecentItem[] = [];
    for (let i = 0; i < MAX_RECENT + 5; i++) list = computeNextRecent(list, item(`x${i}`));
    expect(list.length).toBe(MAX_RECENT);
    expect(list[0].id).toBe(`x${MAX_RECENT + 4}`); // newest first
  });
});

describe('hashUserKey', () => {
  it('is stable for same id', () => {
    expect(hashUserKey('user-123')).toBe(hashUserKey('user-123'));
  });
  it('differs for different ids', () => {
    expect(hashUserKey('user-123')).not.toBe(hashUserKey('user-456'));
  });
  it('does not contain the raw id (no PII in key)', () => {
    expect(hashUserKey('secret@example.com')).not.toContain('secret');
    expect(hashUserKey('secret@example.com')).not.toContain('@');
  });
  it('null/undefined → anon', () => {
    expect(hashUserKey(null)).toBe('anon');
    expect(hashUserKey(undefined)).toBe('anon');
  });
});

describe('sanitizeRecent', () => {
  it('keeps only id/label/path (drops extra fields)', () => {
    const dirty = { id: 'a', label: 'L', path: '/ops/a', email: 'x@y.z', storeId: '999' } as unknown as RecentItem;
    const clean = sanitizeRecent(dirty);
    expect(clean).toEqual({ id: 'a', label: 'L', path: '/ops/a' });
    expect(Object.keys(clean)).toEqual(['id', 'label', 'path']);
  });
});
