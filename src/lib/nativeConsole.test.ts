// logcat 에서 읽을 수 있는 형태인지.
//
// 실제로 이것 때문에 기기 디버깅이 막혔다. 진단 정보를 다 실어 보낸 로그가
// logcat 에는 이렇게만 찍혔다:
//   Msg: [audio] metadata timeout — duration 0:00, 재생 불가 처리 [object Object]
// readyState 도 networkState 도 currentSrc 도 볼 수 없었다.
import { describe, it, expect } from 'vitest';
import { toLogString } from './nativeConsole';

describe('toLogString', () => {
  it('객체는 내용이 보이게 바꾼다 — [object Object] 가 되면 안 된다', () => {
    const out = toLogString({ readyState: 0, networkState: 2, currentSrc: 'https://x/y.mp3' });
    expect(out).not.toBe('[object Object]');
    expect(out).toContain('readyState');
    expect(out).toContain('networkState');
    expect(out).toContain('y.mp3');
  });

  it('문자열은 그대로 둔다 — 따옴표를 덧씌우지 않는다', () => {
    expect(toLogString('[audio] metadata timeout')).toBe('[audio] metadata timeout');
  });

  it('Error 는 이름과 메시지를 남긴다', () => {
    expect(toLogString(new TypeError('boom'))).toBe('TypeError: boom');
  });

  it('중첩된 Error 도 메시지가 살아남는다 — 보통 여기에 원인이 있다', () => {
    const out = toLogString({ step: 'exchange', cause: new Error('invalid_grant') });
    expect(out).toContain('invalid_grant');
  });

  it('순환 참조가 있어도 던지지 않는다 — 로그가 원래 문제를 덮으면 안 된다', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect(() => toLogString(a)).not.toThrow();
    expect(toLogString(a)).toContain('circular');
  });

  it('아주 큰 객체는 잘라서 넘긴다 — logcat 한 줄을 통째로 잡아먹지 않게', () => {
    const big = { blob: 'x'.repeat(50_000) };
    const out = toLogString(big);
    expect(out.length).toBeLessThan(3000);
    expect(out).toContain('잘림');
  });

  it('null · undefined · 숫자도 알아볼 수 있게 남는다', () => {
    expect(toLogString(null)).toBe('null');
    expect(toLogString(undefined)).toBe('undefined');
    expect(toLogString(12)).toBe('12');
  });
});
