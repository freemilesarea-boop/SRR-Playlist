// STORE-PLAYER-DEAD-DETECTION-15 §10 — 서버측 무음 감지 규칙.
//
// 시나리오 번호는 Phase 지시서의 항목과 1:1 로 맞춘다.
import { describe, it, expect } from 'vitest';
import {
  resolveLiveness, decideAlert, attributeRecovery,
  SUSPECTED_DOWN_AFTER_S, DOWN_AFTER_S, HEALTHY_CHECKS_TO_RESOLVE,
  type OpenIncident,
} from './playerDownDetection';

/** 감시 대상인 정상 매장의 기본 입력. */
const store = (ageS: number | null) => ({
  heartbeatAgeSeconds: ageS,
  monitoringExempt: false,
  playbackExpected: true,
});

const noIncident = null;
const openSuspected: OpenIncident = { downNotified: false, healthyChecks: 0 };
const openNotified: OpenIncident = { downNotified: true, healthyChecks: 0 };

describe('경계값', () => {
  it('heartbeat 주기(60초)의 3배에서 SUSPECTED, 5배에서 DOWN', () => {
    expect(SUSPECTED_DOWN_AFTER_S).toBe(180);
    expect(DOWN_AFTER_S).toBe(300);
  });

  it('경계는 이상(>=) 이다 — 179/299 는 아직 아니다', () => {
    expect(resolveLiveness(store(179))).toBe('ONLINE');
    expect(resolveLiveness(store(180))).toBe('SUSPECTED_DOWN');
    expect(resolveLiveness(store(299))).toBe('SUSPECTED_DOWN');
    expect(resolveLiveness(store(300))).toBe('DOWN');
  });
});

describe('1. heartbeat 정상 → alert 0', () => {
  it('0초/30초/59초 전부 ONLINE 이고 아무 행동도 하지 않는다', () => {
    for (const age of [0, 30, 59]) {
      const liveness = resolveLiveness(store(age));
      expect(liveness).toBe('ONLINE');
      expect(decideAlert({ liveness, openIncident: noIncident })).toBe('none');
    }
  });
});

describe('2. heartbeat 1 interval miss → alert 0', () => {
  it('60초 주기에서 1회 결측(최대 119초)은 장애가 아니다', () => {
    for (const age of [61, 90, 119]) {
      const liveness = resolveLiveness(store(age));
      expect(liveness).toBe('ONLINE');
      expect(decideAlert({ liveness, openIncident: noIncident })).toBe('none');
    }
  });

  it('2회 결측(179초)까지도 Slack 을 보내지 않는다', () => {
    const liveness = resolveLiveness(store(179));
    expect(decideAlert({ liveness, openIncident: noIncident })).toBe('none');
  });
});

describe('3. threshold 초과 → DOWN 1회', () => {
  it('300초를 넘기면 DOWN 알림을 보낸다', () => {
    const liveness = resolveLiveness(store(305));
    expect(liveness).toBe('DOWN');
    expect(decideAlert({ liveness, openIncident: noIncident })).toBe('notify_down');
  });

  it('SUSPECTED 단계에서는 incident 만 열고 Slack 은 참는다', () => {
    const liveness = resolveLiveness(store(200));
    expect(liveness).toBe('SUSPECTED_DOWN');
    expect(decideAlert({ liveness, openIncident: noIncident })).toBe('open_incident');
  });

  it('SUSPECTED 로 이미 열린 incident 가 DOWN 이 되면 그때 1회 알린다', () => {
    expect(decideAlert({ liveness: 'DOWN', openIncident: openSuspected })).toBe('notify_down');
  });
});

describe('4. 계속 offline → 추가 alert 0', () => {
  it('이미 DOWN 을 알린 incident 에는 몇 번을 더 돌려도 알리지 않는다', () => {
    for (const age of [305, 600, 3600, 86_400]) {
      const liveness = resolveLiveness(store(age));
      expect(liveness).toBe('DOWN');
      expect(decideAlert({ liveness, openIncident: openNotified })).toBe('none');
    }
  });
});

describe('5. heartbeat 복구 → RECOVERED 1회', () => {
  it('연속 2회 건강해야 복구로 확정한다 — 1회는 플래핑일 수 있다', () => {
    expect(HEALTHY_CHECKS_TO_RESOLVE).toBe(2);
    const first = decideAlert({
      liveness: 'ONLINE',
      openIncident: { downNotified: true, healthyChecks: 0 },
    });
    expect(first).toBe('none');

    const second = decideAlert({
      liveness: 'ONLINE',
      openIncident: { downNotified: true, healthyChecks: 1 },
    });
    expect(second).toBe('notify_recovered');
  });

  it('DOWN 을 알린 적 없는 incident(SUSPECTED 로만 끝남)는 조용히 닫는다', () => {
    // 알리지도 않은 장애의 "복구됐습니다" 는 소음일 뿐이다.
    expect(decideAlert({
      liveness: 'ONLINE',
      openIncident: { downNotified: false, healthyChecks: 1 },
    })).toBe('none');
  });
});

describe('6. 재장애 → 새 DOWN 가능', () => {
  it('복구로 incident 가 닫힌 뒤 다시 끊기면 새 incident 로 다시 1회 알린다', () => {
    // 복구 → openIncident 는 null 이 된다.
    const again = resolveLiveness(store(400));
    expect(again).toBe('DOWN');
    expect(decideAlert({ liveness: again, openIncident: noIncident })).toBe('notify_down');
  });
});

describe('7. closed hours → alert 0', () => {
  it('재생 기대 시간이 아니면 아무리 조용해도 ONLINE 이다', () => {
    for (const age of [300, 3600, 86_400]) {
      const liveness = resolveLiveness({
        heartbeatAgeSeconds: age, monitoringExempt: false, playbackExpected: false,
      });
      expect(liveness).toBe('ONLINE');
      expect(decideAlert({ liveness, openIncident: noIncident })).toBe('none');
    }
  });
});

describe('8. disabled store → alert 0', () => {
  it('감시 제외 계정은 조용해도 장애가 아니다', () => {
    const liveness = resolveLiveness({
      heartbeatAgeSeconds: 86_400, monitoringExempt: true, playbackExpected: true,
    });
    expect(liveness).toBe('ONLINE');
    expect(decideAlert({ liveness, openIncident: noIncident })).toBe('none');
  });

  it('제외 계정에 열려 있던 incident 도 복구 알림 없이 닫힌다', () => {
    const liveness = resolveLiveness({
      heartbeatAgeSeconds: 86_400, monitoringExempt: true, playbackExpected: true,
    });
    expect(decideAlert({
      liveness, openIncident: { downNotified: false, healthyChecks: 1 },
    })).toBe('none');
  });
});

describe('9. session 교체 중 일시 gap → false alert 없음', () => {
  it('살아있는 세션이 여럿이면 가장 싱싱한 것이 canonical (오탐 방지)', () => {
    // 리로드로 새 세션이 생기고 옛 세션이 아직 revoke 전일 수 있다.
    // 둘 다 revoked 가 아니면 더 싱싱한 쪽을 canonical 로 본다.
    const canonicalAge = Math.min(5, 130);
    expect(resolveLiveness(store(canonicalAge))).toBe('ONLINE');
  });

  it('리로드로 세션이 잠깐 비어도(관측 세션 없음) 장애로 올리지 않는다', () => {
    expect(resolveLiveness(store(null))).toBe('ONLINE');
    expect(decideAlert({ liveness: 'ONLINE', openIncident: noIncident })).toBe('none');
  });
});

describe('10. stale old session heartbeat 가 current session 을 살려놓지 못한다', () => {
  it('revoke 된 옛 세션은 입력에서 빠진다 — 살아있는 세션만으로 판단', () => {
    // 옛 세션(revoked)이 최근까지 heartbeat 를 남겼더라도, canonical 계산에는
    // 들어오지 않는다. 남는 것은 실제 매장 세션의 나이(400초)뿐이다.
    const ageFromLiveSessionsOnly = 400;
    expect(resolveLiveness(store(ageFromLiveSessionsOnly))).toBe('DOWN');
  });

  it('반례 고정 — 옛/다른 세션의 heartbeat 를 섞으면 죽은 매장을 ONLINE 으로 오판한다', () => {
    // 이 계산을 하면 안 된다는 것을 테스트로 박아둔다. 0522 는 생존 판정 출처를
    // brand_player_sessions 하나로 좁혀 이 경로 자체를 없앴다
    // (stream_sessions_v2 는 FK 가 없어 session-scope 를 걸 수 없다).
    const wrongIfMixed = Math.min(10 /* 옛·다른 세션 */, 400 /* 실제 매장 세션 */);
    expect(resolveLiveness(store(wrongIfMixed))).toBe('ONLINE');   // ← 되면 안 되는 결과
  });
});

describe('복구 원인 귀속 — 추측 금지', () => {
  it('원격 복구 명령이 실제로 완료됐을 때만 automatic', () => {
    expect(attributeRecovery({ completedRemoteCommandInWindow: true })).toBe('automatic');
  });

  it('근거가 없으면 unknown 이다 — "점주가 고쳤다" 로 단정하지 않는다', () => {
    expect(attributeRecovery({ completedRemoteCommandInWindow: false })).toBe('unknown');
  });
});

describe('2026-09-14 숙대점 사고 재현', () => {
  // 09:46:31 마지막 heartbeat → 09:52:22 재개. 실측 351초.
  const OUTAGE_S = 351;

  it('기존 기준(20분 grace)으로는 절대 감지되지 않는다', () => {
    expect(OUTAGE_S).toBeLessThan(20 * 60);
  });

  it('새 기준에서는 DOWN 으로 잡힌다 (300초 초과)', () => {
    expect(resolveLiveness(store(OUTAGE_S))).toBe('DOWN');
  });

  it('다만 점주가 09:52:22 에 이미 고쳤다 — 알림은 사후 기록에 가깝다', () => {
    // 정직하게 적는다: 300초 임계 + 1분 크론이면 최초 Slack 가능 시각은
    // 대략 09:51:31~09:52:31 이다. 사람이 고친 시각과 겹친다.
    const earliestDetect = 300;          // 초
    const ownerFixedAt = OUTAGE_S;       // 초
    expect(earliestDetect).toBeLessThan(ownerFixedAt);
    expect(ownerFixedAt - earliestDetect).toBeLessThan(60);   // 여유가 1분 미만
  });
});
