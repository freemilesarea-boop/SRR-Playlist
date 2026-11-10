import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }));

import { slotDisplayState } from './outputSlotApi';

const base = { online: true, visibility: 'visible' as const, player_status: 'playing' as const, last_heartbeat_at: '2026-10-30T00:00:00Z' };

describe('분리 송출 공간 상태 판정', () => {
  it('한 번도 보고 안 한 공간', () => {
    expect(slotDisplayState({ ...base, last_heartbeat_at: null, online: false })).toBe('never');
  });
  it('끊김이 가장 우선', () => {
    expect(slotDisplayState({ ...base, online: false })).toBe('offline');
  });
  it('최소화된 창은 재생 중이어도 따로 알린다 — 집계·화면 꺼짐 방지가 빠진다', () => {
    expect(slotDisplayState({ ...base, visibility: 'hidden' })).toBe('hidden');
  });
  it('재생 중 / 일시정지 / 대기', () => {
    expect(slotDisplayState(base)).toBe('playing');
    expect(slotDisplayState({ ...base, player_status: 'paused' })).toBe('paused');
    expect(slotDisplayState({ ...base, player_status: 'stopped' })).toBe('idle');
  });
});

describe('안내방송 전용 창 상태', () => {
  it('음악이 없는 게 정상 — 켜져 있으면 안내 대기', () => {
    expect(slotDisplayState({ ...base, mode: 'announce', player_status: 'stopped' })).toBe('standby');
    expect(slotDisplayState({ ...base, mode: 'announce', online: false })).toBe('offline');
  });
});
