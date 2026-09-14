/**
 * playerDownDetection.ts — 서버가 "소리가 끊긴 것"을 스스로 알아채는 규칙.
 *
 * 왜 만들었나 — 2026-09-14 09:46:31~09:52:22 KST 숙대점에서 5분 51초 무음이
 * 발생했는데 Slack 알림이 0건이었다. 감지 로직이 고장난 게 아니다. 기존 기준이
 * 이 사고보다 한 자릿수 굵었다:
 *
 *   _brand_player_session_health: last_seen_at 이 10분 지나야 'offline'
 *   detect_brand_player_incidents: 거기서 다시 20분(p_offline_grace_minutes)
 *   cron: 5분마다
 *
 * 즉 heartbeat 가 완전히 죽어도 Slack 까지 최소 20~25분이 걸린다. 6분짜리
 * 사고는 설계상 보이지 않는다.
 *
 * 핵심 전제 — **클라이언트는 자기 죽음을 보고할 수 없다.**
 * 탭/PWA 프로세스가 죽으면 Flight Recorder flush 도, pagehide/beforeunload 도,
 * Realtime unsubscribe 도 오지 않는다. 그러므로 유일하게 믿을 수 있는 신호는
 * **heartbeat 의 부재(silence)** 이고, 그 판단은 서버에서 해야 한다.
 *
 * 이 모듈은 그 판단 규칙의 **정본(spec)** 이다. 실제 실행은 SQL(0522)이 하지만,
 * 경계값과 상태 전이는 여기서 테스트로 고정한다.
 */

/** 플레이어 생존 상태. ONLINE → SUSPECTED_DOWN → DOWN 순으로만 악화된다. */
export type PlayerLiveness = 'ONLINE' | 'SUSPECTED_DOWN' | 'DOWN';

/**
 * 경계값 — 매장 heartbeat 주기가 60초(useBrandPlayerHeartbeat)라는 사실에서 나온다.
 *
 *   SUSPECTED_DOWN  180초 = 3회 연속 결측. 알림은 보내지 않는다(관측만).
 *   DOWN            300초 = 5회 연속 결측. 여기서 Slack 1회.
 *
 * 왜 180/300 인가 — 60초 주기에서 1회 결측(최대 119초 age)은 지연·재시도로도
 * 흔하다. 3회를 넘기면 타이머가 살아있다고 보기 어렵다. 5회(5분)면 소리는 이미
 * 끊겨 있다. 더 짧게 잡지 않는 이유는 오탐 비용이 크기 때문이다 — [긴급] 알림이
 * 자주 틀리면 알림 자체를 안 믿게 된다(0516 에서 데모 계정으로 이미 겪었다).
 */
export const SUSPECTED_DOWN_AFTER_S = 180;
export const DOWN_AFTER_S = 300;

export interface LivenessInput {
  /**
   * 이 매장에서 가장 최근에 도착한 신호의 나이(초).
   *
   * 두 갈래를 **둘 다** 본 뒤 더 싱싱한 쪽을 쓴다:
   *   brand_player_sessions.last_seen_at   — 60초 주기 제어 heartbeat
   *   stream_sessions_v2.last_heartbeat_at — 10초 주기 재생 검증 heartbeat
   * 하나가 막혀도 다른 하나가 살아 있으면 플레이어는 살아 있는 것이다.
   *
   * null 이면 관측 가능한 세션이 아예 없다는 뜻.
   */
  heartbeatAgeSeconds: number | null;
  /** 감시 제외 계정(데모·내부 테스트)인가. brand_player_monitoring_exempt. */
  monitoringExempt: boolean;
  /**
   * 지금 이 매장에서 음악이 나오고 있어야 하는가.
   * 영업 종료로 일부러 꺼둔 상태라면 false — 장애가 아니다.
   */
  playbackExpected: boolean;
}

/**
 * 현재 생존 상태를 판정한다. 부작용 없음.
 *
 * 감시 제외이거나 재생 기대 시간이 아니면 **무조건 ONLINE** 으로 본다.
 * "조용한 게 정상인 상태"를 장애로 올리지 않기 위해서다.
 */
export function resolveLiveness(i: LivenessInput): PlayerLiveness {
  if (i.monitoringExempt) return 'ONLINE';
  if (!i.playbackExpected) return 'ONLINE';

  const age = i.heartbeatAgeSeconds;
  if (age === null) return 'ONLINE';       // 관측 대상 세션 없음 — 판단 보류
  if (!Number.isFinite(age) || age < 0) return 'ONLINE';

  if (age >= DOWN_AFTER_S) return 'DOWN';
  if (age >= SUSPECTED_DOWN_AFTER_S) return 'SUSPECTED_DOWN';
  return 'ONLINE';
}

/** 현재 열려 있는 incident 의 상태(없으면 null). */
export interface OpenIncident {
  /** 이 incident 로 DOWN Slack 을 이미 한 번 보냈는가. */
  downNotified: boolean;
  /** 연속으로 건강하게 관측된 횟수 — 복구 확정 전 플래핑을 거른다. */
  healthyChecks: number;
}

export type AlertAction =
  /** 아무것도 하지 않는다. */
  | 'none'
  /** incident 를 연다(관측 기록). 아직 Slack 은 보내지 않는다. */
  | 'open_incident'
  /** incident 를 열고/갱신하고 **DOWN Slack 을 1회** 보낸다. */
  | 'notify_down'
  /** incident 를 닫고 복구 Slack 을 1회 보낸다. */
  | 'notify_recovered';

/** 복구 확정에 필요한 연속 건강 관측 횟수. 1회는 플래핑일 수 있다. */
export const HEALTHY_CHECKS_TO_RESOLVE = 2;

export interface AlertInput {
  liveness: PlayerLiveness;
  openIncident: OpenIncident | null;
}

/**
 * 알림 행동을 정한다.
 *
 * 중복 방지가 이 함수의 본체다:
 *   • DOWN Slack 은 **한 outage 당 정확히 1회** (downNotified 가 잠근다).
 *   • heartbeat 가 계속 없어도 매 분 다시 보내지 않는다.
 *   • 복구 후 다시 끊기면 그때는 새 incident 이므로 다시 1회 보낸다.
 */
export function decideAlert(i: AlertInput): AlertAction {
  const inc = i.openIncident;

  if (i.liveness === 'DOWN') {
    if (inc === null) return 'notify_down';          // 새 사고 — 열고 알린다
    return inc.downNotified ? 'none' : 'notify_down';
  }

  if (i.liveness === 'SUSPECTED_DOWN') {
    // 아직 확정이 아니다. 기록만 남기고 Slack 은 참는다.
    return inc === null ? 'open_incident' : 'none';
  }

  // ONLINE
  if (inc === null) return 'none';
  if (inc.healthyChecks + 1 >= HEALTHY_CHECKS_TO_RESOLVE) {
    // DOWN 을 알린 적 없는 incident(=SUSPECTED 로만 끝난 것)는 조용히 닫는다.
    return inc.downNotified ? 'notify_recovered' : 'none';
  }
  return 'none';
}

/**
 * 서버가 관측한 사실만으로 "사람이 고쳤는지 / 저절로 돌아왔는지" 를 말할 수 있는가.
 *
 * 답: **없다.** heartbeat 재개만으로는 둘을 구분할 수 없다. 원격 복구 명령이
 * 실제로 전달·실행된 기록(brand_player_commands)이 있을 때만 automatic 이라고
 * 말할 수 있고, 그 밖에는 전부 unknown 이다. 점주가 고쳤다고 단정하지도 않는다.
 */
export type RecoveryAttribution = 'automatic' | 'unknown';

export function attributeRecovery(opts: {
  /** 이 outage 구간에 실행 완료된 원격 복구 명령이 있었는가. */
  completedRemoteCommandInWindow: boolean;
}): RecoveryAttribution {
  return opts.completedRemoteCommandInWindow ? 'automatic' : 'unknown';
}
