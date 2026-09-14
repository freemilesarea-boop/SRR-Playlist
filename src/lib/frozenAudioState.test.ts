// LEGACY-ANDROID-PLAYBACK-STABILITY §1 · §2 · §17
//
// 정지의 모양을 가르는 계약. 특히 **FROZEN_AUDIO_STATE** —
// paused=false · readyState>=2 · error 없음 · 위치만 정지.
// 표면 신호가 전부 "정상 재생" 이라고 말하는 상태이고, 숙대점에서 우리를
// 가장 오래 속인 모양이다.
import { describe, it, expect } from 'vitest';
import {
  classifyAudioFreeze, freezeNeedsRecovery, requiresTimerDetection,
  FREEZE_AFTER_MS, HAVE_CURRENT_DATA,
} from './frozenAudioState';

/** 정상 재생 중인 매장 플레이어. 각 테스트가 필요한 곳만 덮어쓴다. */
const healthy = {
  playing: true,
  suppressed: false,
  autoplayBlocked: false,
  crossfading: false,
  paused: false,
  ended: false,
  readyState: 4,
  errorCode: null as number | null,
  stalledMs: 0,
};

describe('§1 정상 재생 판정은 paused=false 로 하지 않는다', () => {
  it('위치가 움직이는 동안은 NONE', () => {
    expect(classifyAudioFreeze({ ...healthy, stalledMs: 0 })).toBe('NONE');
    expect(classifyAudioFreeze({ ...healthy, stalledMs: FREEZE_AFTER_MS - 1 })).toBe('NONE');
  });

  it('paused=false 라도 위치가 멈추면 정지로 본다', () => {
    const kind = classifyAudioFreeze({ ...healthy, paused: false, stalledMs: FREEZE_AFTER_MS });
    expect(kind).not.toBe('NONE');
    expect(kind).toBe('FROZEN_AUDIO_STATE');
  });
});

describe('§2 FROZEN_AUDIO_STATE — 표면상 전부 정상인데 소리만 없다', () => {
  it('paused=false · readyState>=2 · error 없음 · 위치 정지 → FROZEN_AUDIO_STATE', () => {
    for (const rs of [HAVE_CURRENT_DATA, 3, 4]) {
      expect(classifyAudioFreeze({
        ...healthy, paused: false, readyState: rs, errorCode: null, stalledMs: 10_000,
      })).toBe('FROZEN_AUDIO_STATE');
    }
  });

  it('이 모양은 타이머 감시로만 잡힌다 — 이벤트는 오지 않는다', () => {
    expect(requiresTimerDetection('FROZEN_AUDIO_STATE')).toBe(true);
    expect(requiresTimerDetection('PAUSED_FREEZE')).toBe(true);
    // 이쪽은 waiting/stalled/error 이벤트가 뜬다.
    expect(requiresTimerDetection('BUFFER_STARVED')).toBe(false);
    expect(requiresTimerDetection('MEDIA_ERROR')).toBe(false);
  });

  it('복구 사다리를 태워야 하는 모양이다', () => {
    expect(freezeNeedsRecovery('FROZEN_AUDIO_STATE')).toBe(true);
  });

  it('임계 경계: 미만은 NONE, 이상은 정지', () => {
    expect(classifyAudioFreeze({ ...healthy, stalledMs: FREEZE_AFTER_MS - 1 })).toBe('NONE');
    expect(classifyAudioFreeze({ ...healthy, stalledMs: FREEZE_AFTER_MS })).toBe('FROZEN_AUDIO_STATE');
  });

  it('첫 복구 칸(nudge 8초)보다 먼저 분류된다 — 복구 전 모양을 남기려고', () => {
    expect(FREEZE_AFTER_MS).toBeLessThan(8_000);
  });
});

describe('정지의 다른 모양들을 섞지 않는다', () => {
  it('의도가 재생인데 엘리먼트만 paused → PAUSED_FREEZE', () => {
    expect(classifyAudioFreeze({ ...healthy, paused: true, stalledMs: 10_000 }))
      .toBe('PAUSED_FREEZE');
  });

  it('버퍼가 마르면 BUFFER_STARVED (readyState < 2)', () => {
    for (const rs of [0, 1]) {
      expect(classifyAudioFreeze({ ...healthy, readyState: rs, stalledMs: 10_000 }))
        .toBe('BUFFER_STARVED');
    }
  });

  it('오류가 보고됐으면 추측하지 않는다 — MEDIA_ERROR 가 먼저다', () => {
    expect(classifyAudioFreeze({
      ...healthy, errorCode: 3, readyState: 0, paused: true, stalledMs: 10_000,
    })).toBe('MEDIA_ERROR');
  });

  it('paused 가 readyState 보다 먼저 판정된다 (엘리먼트가 멈춘 게 더 구체적이다)', () => {
    expect(classifyAudioFreeze({
      ...healthy, paused: true, readyState: 0, stalledMs: 10_000,
    })).toBe('PAUSED_FREEZE');
  });
});

describe('되살리면 안 되는 상태를 정지로 세지 않는다', () => {
  it('사용자가 멈춘 것은 건드리지 않는다', () => {
    expect(classifyAudioFreeze({ ...healthy, playing: false, stalledMs: 999_999 }))
      .toBe('INTENT_STOPPED');
  });

  it('본사 스케줄 억제 중은 정지가 아니다', () => {
    expect(classifyAudioFreeze({ ...healthy, suppressed: true, stalledMs: 999_999 }))
      .toBe('INTENT_STOPPED');
  });

  it('자동재생 차단은 제스처 문제다 — play() 를 눌러도 소용없다', () => {
    expect(classifyAudioFreeze({ ...healthy, autoplayBlocked: true, stalledMs: 999_999 }))
      .toBe('INTENT_STOPPED');
  });

  it('곡이 끝난 것은 정상 종료다', () => {
    expect(classifyAudioFreeze({ ...healthy, ended: true, stalledMs: 999_999 }))
      .toBe('ENDED');
  });

  it('크로스페이드 구간은 두 엘리먼트가 겹쳐 도는 정상 상태다', () => {
    expect(classifyAudioFreeze({ ...healthy, crossfading: true, stalledMs: 999_999 }))
      .toBe('NONE');
  });

  it('되살릴 대상이 아닌 모양에는 사다리를 태우지 않는다', () => {
    for (const k of ['NONE', 'INTENT_STOPPED', 'ENDED'] as const) {
      expect(freezeNeedsRecovery(k)).toBe(false);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* §17 Failure Injection — A · B · C                                          */
/*                                                                            */
/* 나머지 D~J 는 각 모듈의 테스트가 담당한다(아래 playbackFailureInjection).    */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§17 주입 시나리오', () => {
  it('A. currentTime freeze — 위치만 멈추고 나머지는 정상', () => {
    let ct = 12.5;
    const tick = (ms: number) => classifyAudioFreeze({ ...healthy, stalledMs: ms });
    expect(tick(0)).toBe('NONE');
    expect(tick(3_000)).toBe('NONE');
    expect(tick(5_000)).toBe('FROZEN_AUDIO_STATE');
    // 위치가 다시 움직이면(호출측이 stalledMs 를 0 으로 되돌린다) 정상으로 돌아온다.
    ct += 0.5;
    expect(ct).toBeGreaterThan(12.5);
    expect(tick(0)).toBe('NONE');
  });

  it('B. paused=false freeze — 표면 신호가 전부 정상이라고 말한다', () => {
    const i = { ...healthy, paused: false, readyState: 4, errorCode: null, stalledMs: 30_000 };
    // 표면만 보면 "재생 중" 이다.
    expect(i.paused).toBe(false);
    expect(i.readyState).toBeGreaterThanOrEqual(HAVE_CURRENT_DATA);
    expect(i.errorCode).toBeNull();
    // 그런데 분류는 정지다.
    expect(classifyAudioFreeze(i)).toBe('FROZEN_AUDIO_STATE');
    expect(freezeNeedsRecovery(classifyAudioFreeze(i))).toBe(true);
  });

  it('C. waiting/stalled 이벤트가 한 번도 오지 않는 freeze 도 잡는다', () => {
    // 이 분류기는 이벤트를 전혀 입력으로 받지 않는다 — 오직 상태 스냅샷뿐이다.
    // 그래서 이벤트가 0건이어도 판정이 달라지지 않는다.
    const withoutAnyEvent = classifyAudioFreeze({ ...healthy, stalledMs: 60_000 });
    expect(withoutAnyEvent).toBe('FROZEN_AUDIO_STATE');
    expect(requiresTimerDetection(withoutAnyEvent)).toBe(true);
  });
});
