import { describe, it, expect } from 'vitest';
import {
  createHistory,
  pushHistory,
  canUndo,
  canRedo,
  undo,
  redo,
  resetHistory,
  hasUnsavedTrackChanges,
  hasUnsavedValue,
  HISTORY_LIMIT,
} from './playlistBuilderHistory';

describe('history — push/undo/redo', () => {
  it('starts empty', () => {
    const h = createHistory([1]);
    expect(h.present).toEqual([1]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it('push moves present to past and clears future', () => {
    let h = createHistory('a');
    h = pushHistory(h, 'b');
    expect(h.present).toBe('b');
    expect(h.past).toEqual(['a']);
    expect(canUndo(h)).toBe(true);
  });

  it('undo then redo round-trips', () => {
    let h = createHistory('a');
    h = pushHistory(h, 'b');
    h = pushHistory(h, 'c');
    h = undo(h);
    expect(h.present).toBe('b');
    expect(canRedo(h)).toBe(true);
    h = undo(h);
    expect(h.present).toBe('a');
    expect(canUndo(h)).toBe(false);
    h = redo(h);
    expect(h.present).toBe('b');
    h = redo(h);
    expect(h.present).toBe('c');
    expect(canRedo(h)).toBe(false);
  });

  it('push after undo clears the redo branch', () => {
    let h = createHistory('a');
    h = pushHistory(h, 'b');
    h = undo(h); // present a, future [b]
    h = pushHistory(h, 'z'); // clears future
    expect(h.present).toBe('z');
    expect(canRedo(h)).toBe(false);
  });

  it('push of identical reference is a no-op', () => {
    const val = { x: 1 };
    let h = createHistory(val);
    h = pushHistory(h, val);
    expect(h.past).toEqual([]);
  });

  it('undo/redo at boundaries are no-ops', () => {
    const h = createHistory('a');
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it('respects HISTORY_LIMIT (drops oldest)', () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = pushHistory(h, i);
    expect(h.past.length).toBe(HISTORY_LIMIT);
    expect(h.present).toBe(HISTORY_LIMIT + 10);
  });

  it('resetHistory clears past/future keeping present', () => {
    let h = createHistory('a');
    h = pushHistory(h, 'b');
    h = resetHistory(h);
    expect(h.present).toBe('b');
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });
});

describe('unsaved changes', () => {
  it('detects track id order changes', () => {
    expect(hasUnsavedTrackChanges(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(hasUnsavedTrackChanges(['a', 'b'], ['b', 'a'])).toBe(true); // reorder
    expect(hasUnsavedTrackChanges(['a', 'b'], ['a'])).toBe(true); // removed
    expect(hasUnsavedTrackChanges(['a'], ['a', 'b'])).toBe(true); // added
  });

  it('detects value changes via stable compare', () => {
    expect(hasUnsavedValue({ a: 1 }, { a: 1 })).toBe(false);
    expect(hasUnsavedValue({ a: 1 }, { a: 2 })).toBe(true);
    const same = { a: 1 };
    expect(hasUnsavedValue(same, same)).toBe(false);
  });
});
