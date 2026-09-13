// 숙대점 4시간 28분 무음(2026-09-12 02:50~07:18) 회귀 방지.
// 탭이 죽은 뒤 서버가 보내는 복구 신호를 어떻게 처리해야 하는지 고정한다.
//
// 서버 판정은 최대 5분 늦다. 그 말을 그대로 따르면 이미 정상으로 돌아온 매장을
// 헛되이 건드리게 된다. 그래서 최종 판단은 클라이언트가 한다.
import { describe, it, expect } from 'vitest';
import { resolveRecoveryAction, type RecoveryState } from './playerRecoverySignal';

/** 소리가 죽은 매장 — 여기서 한 필드씩만 바꿔 테스트한다. */
function silentStore(over: Partial<RecoveryState> = {}): RecoveryState {
  return {
    businessMode: true,
    playing: true,
    audioActive: false,
    autoplayBlocked: false,
    suppressed: false,
    ...over,
  };
}

describe('resolveRecoveryAction — 복구 신호를 받았을 때', () => {
  it('매장 재생 의도는 살아있는데 소리가 없으면 재생을 다시 건다', () => {
    // 같은 문서 안이라 제스처 없이 소리가 난다 — 이게 이 기능의 핵심이다.
    expect(resolveRecoveryAction(silentStore())).toBe('resume');
  });

  it('이미 소리가 나고 있으면 건드리지 않는다 — 서버 판정이 늦었을 뿐이다', () => {
    // 이게 깨지면 멀쩡히 재생 중인 매장을 5분마다 끊어먹는다.
    expect(resolveRecoveryAction(silentStore({ audioActive: true }))).toBe('none');
  });

  it('사용자가 멈춘 것은 되살리지 않는다', () => {
    expect(resolveRecoveryAction(silentStore({ playing: false }))).toBe('none');
  });

  it('본사 스케줄로 억제된 동안에는 조용히 있는다', () => {
    expect(resolveRecoveryAction(silentStore({ suppressed: true }))).toBe('none');
  });

  it('자동재생이 막힌 상태는 play() 로 안 풀린다 — 사람을 기다린다', () => {
    // 제스처가 필요한 상태라 여기서 뭘 해도 소용없다.
    // PlaybackBlockedOverlay 가 이미 전체화면 안내를 띄우고 있다.
    expect(resolveRecoveryAction(silentStore({ autoplayBlocked: true }))).toBe('none');
  });

  it('일반 청취자 화면은 서버 신호로도 건드리지 않는다', () => {
    expect(resolveRecoveryAction(silentStore({ businessMode: false }))).toBe('none');
  });

  it('매장이 아니면 다른 조건이 아무리 맞아도 none', () => {
    expect(resolveRecoveryAction({
      businessMode: false, playing: true, audioActive: false,
      autoplayBlocked: false, suppressed: false,
    })).toBe('none');
  });
});
