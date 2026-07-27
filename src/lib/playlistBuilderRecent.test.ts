import { describe, it, expect, beforeEach } from 'vitest';
import {
  type RecentCondition,
  RECENT_VERSION,
  MAX_RECENT_CONDITIONS,
  hashUserKey,
  sanitizeRecentCondition,
  computeNextRecent,
  loadRecentConditions,
  pushRecentCondition,
  clearRecentConditions,
} from './playlistBuilderRecent';
import { emptyPreset, profileToPreset } from './playlistPresets';

// minimal in-memory localStorage stub for node env
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const rc = (storeKey: string, label: string): RecentCondition => ({
  v: RECENT_VERSION,
  storeKey,
  label,
  conditions: emptyPreset().conditions,
});

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});

describe('hashUserKey', () => {
  it('stable + no raw id in key', () => {
    expect(hashUserKey('u1')).toBe(hashUserKey('u1'));
    expect(hashUserKey('secret@x.com')).not.toContain('secret');
    expect(hashUserKey(null)).toBe('anon');
  });
});

describe('computeNextRecent', () => {
  it('prepends + dedupes by storeKey|label + caps', () => {
    let list: RecentCondition[] = [];
    list = computeNextRecent(list, rc('cafe', '오후'));
    list = computeNextRecent(list, rc('gym', '기본'));
    list = computeNextRecent(list, rc('cafe', '오후')); // dup → moves front
    expect(list.map((r) => r.storeKey)).toEqual(['cafe', 'gym']);
    for (let i = 0; i < MAX_RECENT_CONDITIONS + 3; i++) list = computeNextRecent(list, rc(`s${i}`, 'x'));
    expect(list.length).toBe(MAX_RECENT_CONDITIONS);
  });
});

describe('sanitizeRecentCondition', () => {
  it('coerces + strips to known shape and stamps version', () => {
    const dirty = {
      v: 999,
      storeKey: 'gym',
      label: 'L',
      conditions: { ...profileToPreset({ store_key: 'gym', store_label: '헬스장' }).conditions, junk: 1 },
      secret: 'x',
    } as unknown as RecentCondition;
    const clean = sanitizeRecentCondition(dirty);
    expect(clean.v).toBe(RECENT_VERSION);
    expect(Object.keys(clean)).toEqual(['v', 'storeKey', 'label', 'conditions']);
    expect('junk' in (clean.conditions as unknown as Record<string, unknown>)).toBe(false);
  });
});

describe('load/push/clear (localStorage)', () => {
  it('round-trips a pushed condition', () => {
    pushRecentCondition('u1', rc('cafe', '오후'));
    const loaded = loadRecentConditions('u1');
    expect(loaded.length).toBe(1);
    expect(loaded[0].storeKey).toBe('cafe');
  });
  it('fail-safe empty on corrupt JSON', () => {
    localStorage.setItem('plb.recent.' + hashUserKey('u1'), '{not json');
    expect(loadRecentConditions('u1')).toEqual([]);
  });
  it('discards version-mismatch items', () => {
    const bad = [{ ...rc('cafe', '오후'), v: 0 }];
    localStorage.setItem('plb.recent.' + hashUserKey('u1'), JSON.stringify(bad));
    expect(loadRecentConditions('u1')).toEqual([]);
  });
  it('discards items with invalid conditions shape', () => {
    const bad = [{ v: RECENT_VERSION, storeKey: 'x', label: 'y', conditions: { nope: true } }];
    localStorage.setItem('plb.recent.' + hashUserKey('u1'), JSON.stringify(bad));
    expect(loadRecentConditions('u1')).toEqual([]);
  });
  it('clear removes entries', () => {
    pushRecentCondition('u1', rc('cafe', '오후'));
    clearRecentConditions('u1');
    expect(loadRecentConditions('u1')).toEqual([]);
  });
  it('is scoped per user', () => {
    pushRecentCondition('u1', rc('cafe', '오후'));
    expect(loadRecentConditions('u2')).toEqual([]);
  });
});
