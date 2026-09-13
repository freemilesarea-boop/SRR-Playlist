import { describe, it, expect } from 'vitest';
import { decideCommandAction } from './brandPlayerCommand';
import type { BrandPlayerHeartbeatResult } from '@/lib/api/brandPlayerApi';

const none = new Set<string>();

function res(over: Partial<BrandPlayerHeartbeatResult>): BrandPlayerHeartbeatResult {
  return { success: true, command: null, command_id: null, ...over };
}

describe('decideCommandAction', () => {
  it('명령이 있으면 실행한다', () => {
    const a = decideCommandAction(res({ command: 'reload', command_id: 'c1' }), none);
    expect(a).toEqual({ kind: 'run', command: 'reload', commandId: 'c1' });
  });

  it('play / next 도 실행한다', () => {
    expect(decideCommandAction(res({ command: 'play', command_id: 'c2' }), none).kind).toBe('run');
    expect(decideCommandAction(res({ command: 'next', command_id: 'c3' }), none).kind).toBe('run');
  });

  it('명령이 없는 평범한 heartbeat 는 아무것도 하지 않는다', () => {
    expect(decideCommandAction(res({}), none)).toEqual({ kind: 'none' });
  });

  it('heartbeat 실패면 명령이 실려 있어도 무시한다 — 세션이 죽었을 수 있다', () => {
    const a = decideCommandAction(res({ success: false, command: 'reload', command_id: 'c1' }), none);
    expect(a).toEqual({ kind: 'none' });
  });

  it('이미 실행한 command_id 는 다시 실행하지 않는다 — reload 무한루프 방지', () => {
    const done = new Set(['c1']);
    expect(decideCommandAction(res({ command: 'reload', command_id: 'c1' }), done)).toEqual({ kind: 'none' });
  });

  it('command_id 가 없으면 실행하지 않는다 — 중복 방지가 불가능하다', () => {
    const a = decideCommandAction(res({ command: 'reload', command_id: null }), none);
    expect(a).toEqual({ kind: 'none' });
  });

  it('모르는 명령은 무시한다 — 서버가 앞서 나가도 매장이 오작동하면 안 된다', () => {
    const a = decideCommandAction(
      res({ command: 'self_destruct' as unknown as 'reload', command_id: 'c9' }),
      none,
    );
    expect(a).toEqual({ kind: 'none' });
  });

  it('구버전 서버 응답(키 없음)도 안전하게 넘어간다', () => {
    expect(decideCommandAction({ success: true }, none)).toEqual({ kind: 'none' });
  });

  it('null/undefined 응답도 안전하다', () => {
    expect(decideCommandAction(null, none)).toEqual({ kind: 'none' });
    expect(decideCommandAction(undefined, none)).toEqual({ kind: 'none' });
  });
});
