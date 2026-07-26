import { describe, it, expect } from 'vitest';
import {
  validateRotationPool,
  poolSignature,
  advanceRotationPlaylist,
  pickRotationAnchor,
  type RotationPoolRow,
} from '@/lib/storePlaybackRuntime';

// UUID helpers (must satisfy the module's UUID_RE).
const U = (tail: string) => `0e000000-0000-4000-8000-0000000000${tail}`;
const P = (tail: string) => `0c000000-0000-4000-8000-0000000000${tail}`;
const FA = '0a000000-0000-4000-8000-000000000001';
const FB = '0b000000-0000-4000-8000-000000000002';

function rawSet(over: Record<string, unknown>): Record<string, unknown> {
  return {
    playlist_set_id: U('a1'),
    playlist_id: P('a1'),
    name: 'Set',
    rotation_order: 1,
    is_active: true,
    valid_from: null,
    valid_until: null,
    franchise_id: FA,
    created_at: '2026-07-25T00:00:00.000Z',
    ...over,
  };
}

function row(setTail: string, plTail: string, order: number): RotationPoolRow {
  return {
    playlistSetId: U(setTail),
    playlistId: P(plTail),
    name: `Set-${setTail}`,
    rotationOrder: order,
    validFrom: null,
    validUntil: null,
    franchiseId: FA,
    createdAt: '2026-07-25T00:00:00.000Z',
  };
}

describe('validateRotationPool — contract validation (§9/§19)', () => {
  it('keeps valid active rows, sorted by rotation_order', () => {
    const { rows } = validateRotationPool([
      rawSet({ playlist_set_id: U('a2'), rotation_order: 2 }),
      rawSet({ playlist_set_id: U('a1'), rotation_order: 1 }),
    ]);
    expect(rows.map((r) => r.playlistSetId)).toEqual([U('a1'), U('a2')]);
  });

  it('drops inactive rows', () => {
    const { rows } = validateRotationPool([rawSet({ is_active: false })]);
    expect(rows).toHaveLength(0);
  });

  it('drops malformed UUID / non-integer rotation_order', () => {
    const { rows, dropped } = validateRotationPool([
      rawSet({ playlist_set_id: 'not-a-uuid' }),
      rawSet({ playlist_id: 'bad' }),
      rawSet({ rotation_order: 1.5 }),
      rawSet({ rotation_order: '2' }),
    ]);
    expect(rows).toHaveLength(0);
    expect(dropped).toBe(4);
  });

  it('dedupes by playlist_set_id', () => {
    const { rows } = validateRotationPool([
      rawSet({ playlist_set_id: U('a1'), rotation_order: 1 }),
      rawSet({ playlist_set_id: U('a1'), rotation_order: 2 }),
    ]);
    expect(rows).toHaveLength(1);
  });

  it('deterministic tie-break: same order → created_at → id', () => {
    const { rows } = validateRotationPool([
      rawSet({ playlist_set_id: U('a2'), rotation_order: 1, created_at: '2026-07-25T02:00:00.000Z' }),
      rawSet({ playlist_set_id: U('a1'), rotation_order: 1, created_at: '2026-07-25T01:00:00.000Z' }),
    ]);
    expect(rows.map((r) => r.playlistSetId)).toEqual([U('a1'), U('a2')]);
  });

  it('flags + excludes cross-franchise rows when an expected franchise is given (§30)', () => {
    const { rows, crossFranchise } = validateRotationPool(
      [rawSet({ franchise_id: FA }), rawSet({ playlist_set_id: U('b9'), franchise_id: FB })],
      FA,
    );
    expect(crossFranchise).toBe(true);
    expect(rows.every((r) => r.franchiseId === FA)).toBe(true);
  });

  it('non-array payload → empty pool', () => {
    expect(validateRotationPool(null).rows).toHaveLength(0);
    expect(validateRotationPool(undefined).rows).toHaveLength(0);
    expect(validateRotationPool({} as unknown).rows).toHaveLength(0);
  });
});

describe('poolSignature — memory invalidation key (§12)', () => {
  it('is stable for the same pool and changes on reorder/add/remove', () => {
    const a = [row('a1', 'a1', 1), row('a2', 'a2', 2)];
    const b = [row('a1', 'a1', 1), row('a2', 'a2', 2)];
    expect(poolSignature(a, FA)).toBe(poolSignature(b, FA));
    expect(poolSignature(a, FA)).not.toBe(poolSignature([row('a2', 'a2', 2), row('a1', 'a1', 1)], FA));
    expect(poolSignature(a, FA)).not.toBe(poolSignature([...a, row('a3', 'a3', 3)], FA));
    expect(poolSignature(a, FA)).not.toBe(poolSignature(a, FB));
  });
});

describe('advanceRotationPlaylist — runtime rotation (§10/§13/§20)', () => {
  it('empty pool → null (caller uses resolver playlist)', () => {
    expect(advanceRotationPlaylist([], U('a1'), P('a1'))).toBeNull();
  });

  it('pool of 1 → keeps the same playlist', () => {
    const c = advanceRotationPlaylist([row('a1', 'a1', 1)], U('a1'), P('a1'));
    expect(c?.playlistId).toBe(P('a1'));
  });

  it('pool of 2 → advances to the next set', () => {
    const pool = [row('a1', 'a1', 1), row('a2', 'a2', 2)];
    const c = advanceRotationPlaylist(pool, U('a1'), P('a1'));
    expect(c?.set.playlistSetId).toBe(U('a2'));
    expect(c?.playlistId).toBe(P('a2'));
  });

  it('last → wraps to first (cyclic)', () => {
    const pool = [row('a1', 'a1', 1), row('a2', 'a2', 2), row('a3', 'a3', 3)];
    const c = advanceRotationPlaylist(pool, U('a3'), P('a3'));
    expect(c?.set.playlistSetId).toBe(U('a1'));
  });

  it('current set not in pool → first eligible', () => {
    const pool = [row('a1', 'a1', 1), row('a2', 'a2', 2)];
    const c = advanceRotationPlaylist(pool, U('zz'), P('zz'));
    expect(c?.set.playlistSetId).toBe(U('a1'));
  });

  it('duplicate playlist_id → skips to the next DIFFERENT playlist (§13)', () => {
    // A(pX) → B(pX) → C(pY): from A, skip B (same pX), land on C.
    const pool = [row('a1', 'x', 1), row('a2', 'x', 2), row('a3', 'y', 3)];
    const c = advanceRotationPlaylist(pool, U('a1'), P('x'));
    expect(c?.playlistId).toBe(P('y'));
    expect(c?.set.playlistSetId).toBe(U('a3'));
  });

  it('all sets share one playlist_id → playlist stays unchanged (no reload)', () => {
    const pool = [row('a1', 'x', 1), row('a2', 'x', 2)];
    const c = advanceRotationPlaylist(pool, U('a1'), P('x'));
    expect(c?.playlistId).toBe(P('x'));
  });
});

describe('pickRotationAnchor — seed position (§2/§12)', () => {
  const pool = [row('a1', 'a1', 1), row('a2', 'a2', 2)];
  it('returns the resolver set when present in the pool', () => {
    expect(pickRotationAnchor(pool, U('a2'))?.playlistSetId).toBe(U('a2'));
  });
  it('falls back to the first set when the resolver set is absent', () => {
    expect(pickRotationAnchor(pool, U('zz'))?.playlistSetId).toBe(U('a1'));
  });
  it('falls back to the first set when resolver set is null', () => {
    expect(pickRotationAnchor(pool, null)?.playlistSetId).toBe(U('a1'));
  });
  it('empty pool → null', () => {
    expect(pickRotationAnchor([], U('a1'))).toBeNull();
  });
});
