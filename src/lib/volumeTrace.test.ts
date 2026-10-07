/**
 * volumeTrace 회귀 — 이 모듈은 "진단일 뿐 동작은 안 바꾼다" 가 전부다.
 * 그 약속이 깨지면 매장 재생이 망가지므로 여기서 못 박는다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveVolumeTraceEnabled,
  callerFromStack,
  formatVolumeTraceLine,
  publishPlayerDiagState,
  readPlayerDiagState,
} from './volumeTrace';

const fakeAudio = (volume: number, muted = false, paused = false) =>
  ({ volume, muted, paused }) as unknown as HTMLMediaElement;

describe('게이트', () => {
  it('아무 신호도 없으면 꺼져 있다 (매장 태블릿 기본값)', () => {
    expect(resolveVolumeTraceEnabled()).toBe(false);
    expect(resolveVolumeTraceEnabled({ search: '?x=1', storage: null })).toBe(false);
  });

  it('쿼리 · 저장소 · 빌드 플래그 · audioDebug 중 하나면 켜진다', () => {
    expect(resolveVolumeTraceEnabled({ search: '?volumeTrace=1' })).toBe(true);
    expect(resolveVolumeTraceEnabled({ storage: { getItem: () => '1' } })).toBe(true);
    expect(resolveVolumeTraceEnabled({ buildFlag: '1' })).toBe(true);
    expect(resolveVolumeTraceEnabled({ audioDebug: true })).toBe(true);
  });

  it('저장소 접근이 막혀도 던지지 않는다', () => {
    const hostile = { getItem: () => { throw new Error('blocked'); } };
    expect(() => resolveVolumeTraceEnabled({ storage: hostile })).not.toThrow();
    expect(resolveVolumeTraceEnabled({ storage: hostile })).toBe(false);
  });
});

describe('호출 위치 추출', () => {
  it('자기 자신(volumeTrace) 프레임은 건너뛴다', () => {
    const stack = [
      'Error',
      '    at Object.set [as volume] (http://x/volumeTrace.ts:120:7)',
      '    at crossfadeTick (http://x/Player.tsx:1841:30)',
    ].join('\n');
    expect(callerFromStack(stack)).toContain('Player.tsx:1841');
  });

  it('스택이 없어도 던지지 않는다', () => {
    expect(callerFromStack(undefined)).toBe('?');
  });
});

describe('판정 한 줄', () => {
  beforeEach(() => {
    publishPlayerDiagState({ activeIdx: 0, crossfading: false, storeVolume: 1 });
  });

  it('스토어와 active 가 같으면 CASE-B', () => {
    const line = formatVolumeTraceLine(fakeAudio(1), fakeAudio(0));
    expect(line).toContain('CASE-B');
  });

  // 이게 이 모듈을 만든 이유다 — 슬라이더 100 인데 실제로는 0.2 인 상태.
  it('스토어 1.0 인데 active 가 더 작으면 CASE-A', () => {
    const line = formatVolumeTraceLine(fakeAudio(0.2), fakeAudio(0));
    expect(line).toContain('CASE-A');
    expect(line).toContain('store=1.000');
    expect(line).toContain('active[0].volume=0.200');
  });

  it('crossfade 중이면 CASE-A 를 단정하지 않는다 (그때는 작은 게 정상)', () => {
    publishPlayerDiagState({ activeIdx: 0, crossfading: true, storeVolume: 1 });
    const line = formatVolumeTraceLine(fakeAudio(0.2), fakeAudio(0.8));
    expect(line).toContain('crossfade중');
    expect(line).toContain('crossfading=true');
  });

  it('activeIdx 가 1 이면 두 번째 엘리먼트를 active 로 본다', () => {
    publishPlayerDiagState({ activeIdx: 1, crossfading: false, storeVolume: 1 });
    const line = formatVolumeTraceLine(fakeAudio(0), fakeAudio(1));
    expect(line).toContain('active[1].volume=1.000');
    expect(line).toContain('CASE-B');
  });

  it('엘리먼트가 아직 없어도 던지지 않는다', () => {
    expect(() => formatVolumeTraceLine(null, null)).not.toThrow();
  });
});

describe('Player 상태 전달', () => {
  it('넘긴 값이 그대로 읽힌다', () => {
    publishPlayerDiagState({ activeIdx: 1, crossfading: true, storeVolume: 0.5 });
    expect(readPlayerDiagState()).toEqual({ activeIdx: 1, crossfading: true, storeVolume: 0.5 });
  });
});

describe('동작 불변', () => {
  it('설치해도 원본 setter 가 받는 값이 바뀌지 않는다', async () => {
    // 게이트를 켠 상태로 실제 prototype 패치를 걸고, 값이 그대로 가는지 본다.
    vi.stubGlobal('window', {
      location: { search: '?volumeTrace=1' },
      localStorage: null,
    });
    const seen: number[] = [];
    class FakeMedia {}
    Object.defineProperty(FakeMedia.prototype, 'volume', {
      configurable: true,
      get() { return seen[seen.length - 1] ?? 1; },
      set(v: number) { seen.push(v); },
    });
    vi.stubGlobal('HTMLMediaElement', FakeMedia);

    // 모듈 안의 installed 플래그를 피해 새 인스턴스를 받는다.
    vi.resetModules();
    const mod = await import('./volumeTrace');
    expect(mod.installVolumeTrace()).toBe(true);

    const el = new FakeMedia() as unknown as HTMLMediaElement;
    el.volume = 0.25;
    el.volume = 1;
    expect(seen).toEqual([0.25, 1]);   // 가로채되 바꾸지 않는다
    expect(mod.lastVolumeWrite(el)?.value).toBe(1);

    vi.unstubAllGlobals();
  });
});
