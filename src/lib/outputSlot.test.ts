// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetOutputSlotForTest, getOutputSlot, parseOutputSlot, slotScopedKey, withOutputSlot,
  isOutputSlotOpen, listenOutputSlotPresence,
} from './outputSlot';

function setUrl(search: string) {
  window.history.replaceState(null, '', `/brand/player/x${search}`);
}

afterEach(() => {
  sessionStorage.clear();
  setUrl('');
  __resetOutputSlotForTest();
});

describe('outputSlot — 분리 송출 창 번호', () => {
  it('1~3 만 슬롯이다', () => {
    expect(parseOutputSlot('2')).toBe(2);
    expect(parseOutputSlot(3)).toBe(3);
    expect(parseOutputSlot('4')).toBeNull();
    expect(parseOutputSlot('')).toBeNull();
    expect(parseOutputSlot(null)).toBeNull();
  });

  it('주소의 ?slot= 을 읽고 이 창에 고정한다 — 새로고침·이동 후에도 유지', () => {
    setUrl('?slot=2');
    expect(getOutputSlot()).toBe(2);
    // 주소에서 slot 이 사라져도(화면 이동) 같은 창은 같은 번호.
    setUrl('');
    __resetOutputSlotForTest();
    expect(getOutputSlot()).toBe(2);
  });

  it('슬롯 창이 아니면 키가 그대로다 — 기존 동작과 같다', () => {
    expect(getOutputSlot()).toBeNull();
    expect(slotScopedKey('srr-player-session')).toBe('srr-player-session');
  });

  it('슬롯 창은 키에 번호가 붙어 다른 창과 섞이지 않는다', () => {
    setUrl('?slot=3');
    expect(slotScopedKey('deudda.audioOutput.v1')).toBe('deudda.audioOutput.v1::slot3');
  });

  it('주소에 slot 붙이기', () => {
    expect(withOutputSlot('/business/player', 1)).toBe('/business/player?slot=1');
    expect(withOutputSlot('/brand?x=1', 2)).toBe('/brand?x=1&slot=2');
  });

  it('이미 열린 같은 번호 창은 다시 열지 않는다 — 재생 중인 음악을 끊지 않게', async () => {
    const stop = listenOutputSlotPresence(2);
    try {
      expect(await isOutputSlotOpen(2)).toBe(true);
      expect(await isOutputSlotOpen(3, 60)).toBe(false);
    } finally {
      stop();
    }
  });
});
