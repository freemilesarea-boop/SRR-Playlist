import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

import {
  DEFAULT_MULTI_OUTPUT_CONFIG, normalizeMultiOutputConfig, shouldPlayAnnouncementsHere,
  slotConfigOf, validateMultiOutputConfig,
} from './multiOutput';

describe('분리 송출 설정', () => {
  it('비어 있거나 깨진 값은 기본값 모양으로 맞춘다', () => {
    expect(normalizeMultiOutputConfig(null)).toEqual(DEFAULT_MULTI_OUTPUT_CONFIG);
    const c = normalizeMultiOutputConfig({ slots: [{ slot: 2, mode: 'weird' }], announcement_slot: 9 });
    expect(c.slots).toHaveLength(3);
    expect(c.slots[1]).toEqual({ slot: 2, mode: 'off' });
    // 안내방송 플레이어가 꺼진 슬롯이면 켜진 첫 슬롯으로.
    expect(c.announcement_slot).toBe(1);
  });

  it('카테고리 없는 카테고리 매장 슬롯은 내 스케줄로 본다', () => {
    const c = normalizeMultiOutputConfig({
      slots: [{ slot: 1, mode: 'store', source: 'category' }], announcement_slot: 1,
    });
    expect(c.slots[0]).toEqual({ slot: 1, mode: 'store', source: 'schedule' });
  });

  it('저장 전 검증 — 사용할 플레이어·카테고리·안내방송 플레이어', () => {
    expect(validateMultiOutputConfig(DEFAULT_MULTI_OUTPUT_CONFIG)).toBeNull();
    expect(validateMultiOutputConfig({
      slots: [{ slot: 1, mode: 'off' }, { slot: 2, mode: 'off' }, { slot: 3, mode: 'off' }],
      announcement_slot: 1,
    })).not.toBeNull();
    expect(validateMultiOutputConfig({
      slots: [{ slot: 1, mode: 'store', source: 'category' }, { slot: 2, mode: 'off' }, { slot: 3, mode: 'off' }],
      announcement_slot: 1,
    })).toContain('카테고리');
    expect(validateMultiOutputConfig({
      slots: [{ slot: 1, mode: 'brand' }, { slot: 2, mode: 'off' }, { slot: 3, mode: 'off' }],
      announcement_slot: 2,
    })).toContain('안내방송');
  });

  it('창 번호로 그 창의 설정을 찾는다', () => {
    expect(slotConfigOf(DEFAULT_MULTI_OUTPUT_CONFIG, 2)?.mode).toBe('store');
    expect(slotConfigOf(DEFAULT_MULTI_OUTPUT_CONFIG, null)).toBeNull();
  });

  it('안내방송 — 꺼져 있으면 어디서든, 켜져 있으면 고른 창에서만', () => {
    const config = { ...DEFAULT_MULTI_OUTPUT_CONFIG, announcement_slot: 2 as const };
    expect(shouldPlayAnnouncementsHere({ enabled: false, config, slot: null })).toBe(true);
    expect(shouldPlayAnnouncementsHere({ enabled: true, config, slot: 2 })).toBe(true);
    expect(shouldPlayAnnouncementsHere({ enabled: true, config, slot: 1 })).toBe(false);
    // 분리 송출을 켠 상태의 일반 창(설정 화면 등)에서는 나가지 않는다.
    expect(shouldPlayAnnouncementsHere({ enabled: true, config, slot: null })).toBe(false);
  });
});
