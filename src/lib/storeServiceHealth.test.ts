/**
 * storeServiceHealth.test.ts — Phase RC-30.1 §6 테스트 행렬.
 *
 * 이 파일이 지키는 것은 하나다:
 *   기기 하나가 죽은 것과 매장이 무음인 것은 다른 사건이다.
 */

import { describe, it, expect } from 'vitest';
import {
  STORE_AUDIO_STALE_SECONDS,
  assessStoreHealth,
  classifySession,
  classifyStoreService,
  describeStoreHealth,
  shouldRaiseMaskedOutageAlert,
  type StoreSessionSnapshot,
} from '@/lib/storeServiceHealth';

/** 2026-09-15 숙대 태블릿 — 154시간 자리 잡은 install. */
const PRIMARY = (over: Partial<StoreSessionSnapshot> = {}): StoreSessionSnapshot => ({
  sessionId: '823034d7',
  ageHours: 154.4,
  secondsSinceHeartbeat: 3,
  secondsSinceAudioProgress: 3,
  deviceKind: 'mobile',
  ...over,
});

/** 같은 계정 Windows — 오늘 열렸다. */
const SECONDARY = (over: Partial<StoreSessionSnapshot> = {}): StoreSessionSnapshot => ({
  sessionId: 'b2e9e765',
  ageHours: 4.3,
  secondsSinceHeartbeat: 2,
  secondsSinceAudioProgress: 2,
  deviceKind: 'desktop',
  ...over,
});

/* ════════════════════════════════════════════════════════════════════════ */
/* §5 재생의 증거는 진행 신호 하나뿐                                        */
/* ════════════════════════════════════════════════════════════════════════ */
describe('§5 audio progress contract — heartbeat 은 재생의 증거가 아니다', () => {
  it('heartbeat 만 싱싱하고 진행 신호가 없으면 playing 이 아니다', () => {
    expect(classifySession(PRIMARY({ secondsSinceAudioProgress: null }))).toBe('unproven');
  });

  it('heartbeat 이 싱싱해도 진행이 멎었으면 silent 다 (12:17 FROZEN 이 그 모양이었다)', () => {
    expect(classifySession(PRIMARY({ secondsSinceHeartbeat: 3, secondsSinceAudioProgress: 1_620 })))
      .toBe('silent');
  });

  it('❗heartbeat 이 늦어도 진행 신호가 싱싱하면 playing 이다 (progress > heartbeat)', () => {
    // 처음엔 이걸 silent 로 적었다 — 틀렸다. 매장에 소리가 나는지의 최상위 증거는 진행이다.
    expect(classifySession(PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 1 })))
      .toBe('playing');
  });

  it('진행 신호도 없고 heartbeat 도 멎었으면 silent 다', () => {
    expect(classifySession(PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: null })))
      .toBe('silent');
  });

  it('진행 신호가 싱싱할 때만 playing 이다', () => {
    expect(classifySession(PRIMARY())).toBe('playing');
  });

  it('문턱은 새 숫자가 아니다 — 0522 의 DOWN 300초', () => {
    expect(STORE_AUDIO_STALE_SECONDS).toBe(300);
    expect(classifySession(PRIMARY({ secondsSinceAudioProgress: 299 }))).toBe('playing');
    expect(classifySession(PRIMARY({ secondsSinceAudioProgress: 300 }))).toBe('silent');
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* §6 A~F                                                                   */
/* ════════════════════════════════════════════════════════════════════════ */
describe('§6 테스트 행렬', () => {
  it('A. primary 정상 → STORE PLAYING · 알림 없음', () => {
    const v = assessStoreHealth([PRIMARY()]);
    expect(v.store.service).toBe('playing');
    expect(v.primary).toBe('playing');
    expect(v.urgent).toBe(false);
    expect(describeStoreHealth(v)).toEqual({ tone: 'ok', text: '재생 중' });
  });

  it('❗B. primary 사망 + secondary 실제 진행 → STORE PLAYING · PRIMARY DEGRADED · 긴급 아님', () => {
    // 2026-09-15 18:51 숙대 실측 그대로.
    const v = assessStoreHealth([
      PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 }),
      SECONDARY(),
    ]);
    expect(v.store.service).toBe('playing');
    expect(v.primary).toBe('degraded');
    expect(v.urgent).toBe(false);
    expect(describeStoreHealth(v)).toEqual({
      tone: 'notice', text: '기본 재생기 오프라인 / 대체 재생기에서 재생 중',
    });
  });

  it('C. primary 사망 + secondary heartbeat 만 싱싱하고 진행은 멎음 → STORE OUTAGE 후보', () => {
    const v = assessStoreHealth([
      PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 }),
      SECONDARY({ secondsSinceHeartbeat: 2, secondsSinceAudioProgress: 3_600 }),
    ]);
    expect(v.store.service).toBe('outage');
    expect(v.urgent).toBe(true);
    expect(describeStoreHealth(v).tone).toBe('urgent');
  });

  it('D. 전부 멎음 → STORE OUTAGE', () => {
    const v = assessStoreHealth([
      PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 }),
      SECONDARY({ secondsSinceHeartbeat: 9_000, secondsSinceAudioProgress: 9_000 }),
    ]);
    expect(v.store.service).toBe('outage');
    expect(v.urgent).toBe(true);
  });

  it('E. 5초 살고 사라진 세션뿐 → 감시 대상 식별 불가 · 임의 복구 대상 없음 · 거짓 긴급 없음', () => {
    // 2026-09-15 ming/ai@swk.today 가 이 모양이었다 (age 1.3h).
    const v = assessStoreHealth([
      { sessionId: '2774f27f', ageHours: 1.3, secondsSinceHeartbeat: 4_786, secondsSinceAudioProgress: null },
    ]);
    expect(v.monitored.kind).toBe('unknown');
    expect(v.primary).toBe('unknown');
    // heartbeat 이 멎었으므로 그 세션은 silent 다 → 매장은 outage 로 잡힌다.
    // 다만 감시 대상은 여전히 모른다 — 복구 대상을 임의로 고르지 않는다.
    expect(v.store.service).toBe('outage');
    expect(v).not.toHaveProperty('recoveryTarget');
    // 그러나 "가려진 장애" 알림은 나가지 않는다 — 감시 대상을 모르기 때문이다.
    expect(shouldRaiseMaskedOutageAlert(v)).toBe(false);
  });

  it('❗F. heartbeat stale + progress fresh → PLAYING · urgent false (RC-30.1A §3 필수 회귀)', () => {
    const v = assessStoreHealth([
      PRIMARY({ secondsSinceHeartbeat: 900, secondsSinceAudioProgress: 12 }),
    ]);
    expect(classifySession(PRIMARY({ secondsSinceHeartbeat: 900, secondsSinceAudioProgress: 12 })))
      .toBe('playing');
    expect(v.store.service).toBe('playing');
    expect(v.primary).toBe('playing');
    expect(v.urgent).toBe(false);
    expect(shouldRaiseMaskedOutageAlert(v)).toBe(false);
  });

  it('E-2. heartbeat fresh + progress null → UNPROVEN · urgent false', () => {
    const v = assessStoreHealth([PRIMARY({ secondsSinceHeartbeat: 5, secondsSinceAudioProgress: null })]);
    expect(v.store).toEqual({ service: 'unknown', reason: 'heartbeat_only' });
    expect(v.primary).toBe('unproven');
    expect(v.urgent).toBe(false);
  });

  it('G. 같은 계정 다른 기기가 싱싱해도 incident 가 지목한 기기는 그대로다', () => {
    const v = assessStoreHealth(
      [PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 }), SECONDARY()],
      '823034d7',
    );
    expect(v.monitored).toEqual({ kind: 'resolved', sessionId: '823034d7', via: 'open_incident' });
    expect(v.primary).toBe('degraded');
    // 매장은 재생 중이지만 그것이 incident 를 닫는 근거가 되지 않는다.
    expect(v.store.service).toBe('playing');
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* §3 분류와 복구 대상을 섞지 않는다                                        */
/* ════════════════════════════════════════════════════════════════════════ */
describe('§3 ALERT CLASSIFICATION(store) 과 RECOVERY TARGETING(install) 을 섞지 않는다', () => {
  it('매장이 다른 기기에서 재생 중이어도 감시 대상은 바뀌지 않는다', () => {
    const dead = PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 });
    const v = assessStoreHealth([dead, SECONDARY()], '823034d7');
    expect(v.monitored.kind === 'resolved' && v.monitored.sessionId).toBe('823034d7');
  });

  it('반환값에 복구 대상 필드가 없다', () => {
    const v = assessStoreHealth([PRIMARY(), SECONDARY()]);
    expect(Object.keys(v).sort()).toEqual(['monitored', 'primary', 'store', 'urgent']);
  });

  it('evidence 는 근거일 뿐이다 — 거기로 명령을 보내라는 뜻이 아니다', () => {
    const v = assessStoreHealth([
      PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 }),
      SECONDARY(),
    ]);
    expect(v.store.service === 'playing' && v.store.evidence).toEqual(['b2e9e765']);
    // 감시 대상(= 복구가 향할 곳)은 evidence 와 다른 기기다.
    expect(v.monitored.kind === 'resolved' && v.monitored.sessionId).toBe('823034d7');
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* 구버전 클라이언트 — 화정점을 알람으로 만들지 않는다                      */
/* ════════════════════════════════════════════════════════════════════════ */
describe('진행 신호를 보내지 않는 기기 (화정점이 지금 그 상태다)', () => {
  it('살아 있는데 진행 신호가 없으면 outage 라고 단정하지 않는다', () => {
    const v = assessStoreHealth([
      { sessionId: '1177a528', ageHours: 313.2, secondsSinceHeartbeat: 59, secondsSinceAudioProgress: null },
    ]);
    expect(v.store).toEqual({ service: 'unknown', reason: 'heartbeat_only' });
    expect(v.urgent).toBe(false);
    expect(describeStoreHealth(v).tone).toBe('notice');
  });

  it('죽은 기기 + 진행 신호 없는 산 기기 → 무음이라고 단정하지 않는다', () => {
    const v = assessStoreHealth([
      PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 }),
      SECONDARY({ secondsSinceAudioProgress: null }),
    ]);
    expect(v.store.service).toBe('unknown');
    expect(v.urgent).toBe(false);
  });

  it('세션이 하나도 없으면 no_sessions 다', () => {
    expect(classifyStoreService([])).toEqual({ service: 'unknown', reason: 'no_sessions' });
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* §1 긴급 판정은 store 단위로만                                            */
/* ════════════════════════════════════════════════════════════════════════ */
describe('§1 긴급 장애는 store 의 모든 세션이 멎었을 때만', () => {
  it('한 세션이라도 진행 중이면 긴급이 아니다', () => {
    for (const idx of [0, 1, 2]) {
      const rows = [PRIMARY(), SECONDARY(), SECONDARY({ sessionId: 'c3', ageHours: 0.2 })].map((s, i) =>
        i === idx ? s : { ...s, secondsSinceHeartbeat: 9_999, secondsSinceAudioProgress: 9_999 },
      );
      expect(assessStoreHealth(rows).urgent).toBe(false);
    }
  });

  it('device kind 는 판정에 쓰이지 않는다 — 화정의 매장 재생기는 desktop 이다', () => {
    const asMobile = assessStoreHealth([PRIMARY({ deviceKind: 'mobile' })]);
    const asDesktop = assessStoreHealth([PRIMARY({ deviceKind: 'desktop' })]);
    expect(asMobile.store).toEqual(asDesktop.store);
    expect(asMobile.primary).toBe(asDesktop.primary);
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* 가려진 장애 알림 관문 — 두 조건을 모두 넘겨야 한다                       */
/* ════════════════════════════════════════════════════════════════════════ */
describe('shouldRaiseMaskedOutageAlert — FAIL CLOSED', () => {
  const dead = (id: string, age: number) => ({
    sessionId: id, ageHours: age, secondsSinceHeartbeat: 9_999, secondsSinceAudioProgress: 9_999,
  });

  it('매장 무음 + 감시 대상 확정 → 알린다', () => {
    const v = assessStoreHealth([dead('823034d7', 154.4)]);
    expect(v.monitored.kind).toBe('resolved');
    expect(shouldRaiseMaskedOutageAlert(v)).toBe(true);
  });

  it('매장 무음이지만 감시 대상 불명 → 알리지 않는다', () => {
    const v = assessStoreHealth([dead('a', 1.2), dead('b', 0.4)]);
    expect(v.monitored.kind).toBe('unknown');
    expect(shouldRaiseMaskedOutageAlert(v)).toBe(false);
  });

  it('자리 잡은 install 이 둘이면 알리지 않는다 — 임의로 고르지 않는다', () => {
    const v = assessStoreHealth([dead('a', 100), dead('b', 200)]);
    expect(v.monitored).toEqual({ kind: 'unknown', reason: 'multiple_established_installs' });
    expect(shouldRaiseMaskedOutageAlert(v)).toBe(false);
  });

  it('❗매장이 재생 중이면 감시 대상이 죽었어도 알리지 않는다 (이번 Phase 의 본론)', () => {
    const v = assessStoreHealth([
      PRIMARY({ secondsSinceHeartbeat: 17_075, secondsSinceAudioProgress: 17_075 }),
      SECONDARY(),
    ]);
    expect(v.primary).toBe('degraded');
    expect(shouldRaiseMaskedOutageAlert(v)).toBe(false);
  });
});
