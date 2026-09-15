/**
 * storeServiceHealth.ts — "이 매장에서 지금 음악이 나오고 있는가".
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * 2026-09-15 18:51 KST 숙대점 실측:
 *
 *   823034d7  매장 태블릿   hb 17,075초 · progress 17,075초   ← 죽어 있다
 *   b2e9e765  Windows       hb      2초 · progress      2초   ← 실제로 재생 중
 *
 * 감시 대상 install(= 태블릿)만 보면 "매장 무응답" 이다. 그런데 **매장에서는
 * 음악이 나오고 있었다.** 점주가 직접 복구한 경로가 Windows 였을 뿐이다.
 * 여기서 긴급 알림을 보내면 틀린 알림이다.
 *
 * ── 그래서 둘을 가른다 ──────────────────────────────────────────────────────
 *
 *   DEVICE HEALTH         이 기기가 살아 있는가          → monitoredInstall.ts
 *   STORE SERVICE HEALTH  이 매장에 소리가 나는가        → 이 파일
 *
 * 섞으면 둘 다 틀린다. 기기 하나가 죽었다고 매장이 무음인 것이 아니고,
 * 매장에 소리가 난다고 죽은 기기가 살아난 것도 아니다.
 *
 * ── 이 파일이 하지 않는 것 ──────────────────────────────────────────────────
 * **복구 대상을 고르지 않는다.** 매장 서비스가 다른 세션에서 살아 있다고 해서
 * 죽은 기기의 incident 를 그 세션으로 닫거나, 복구 명령을 그 세션으로 보내지
 * 않는다. 그건 2026-09-15 14:34 FALSE RECOVERY 와 같은 실수다.
 *
 *   ALERT CLASSIFICATION  = store 단위   ← 이 파일
 *   RECOVERY TARGETING    = install 단위 ← monitoredInstall.ts · 0528
 *
 * 이 파일의 반환값에는 세션 **식별자**가 근거로만 들어 있고, 어디로 명령을
 * 보내라는 값은 없다.
 *
 * ── heartbeat 은 "소리가 난다" 의 증거가 아니다 ─────────────────────────────
 * heartbeat 은 "이 문서가 살아서 서버를 부르고 있다" 는 뜻이다. 2026-09-15
 * 12:17~12:44 에 숙대 태블릿은 27분 동안 heartbeat 를 정상으로 보내면서
 * 26곡을 무음으로 흘려보냈다. ready_state 4 도 마찬가지다 — 디코더가 준비됐다는
 * 뜻이지 소리가 났다는 뜻이 아니다.
 *
 * 그래서 재생 판정의 근거는 **last_audio_progress_at 하나뿐**이다(0524 가 만든
 * 칸이고 0527 이 audio_progress_age_seconds 로 노출한다).
 *
 * ── 모르면 모른다고 한다 ────────────────────────────────────────────────────
 * 진행 신호를 **한 번도 보낸 적 없는** 세션이 살아 있으면(구버전 클라이언트가
 * 그렇다 — 화정점이 지금 그 상태다) 그 매장이 무음이라고 단정할 수 없다.
 * 그때는 outage 가 아니라 unknown 이다. 틀린 긴급 알림보다 낫다.
 * 그 경우에도 서버 감지기(0522/0527)는 그대로 돌고 있다 — 이 분류기는
 * **가려진 장애 알림을 한 겹 더 거르는 자리**이지 감지기를 대체하지 않는다.
 */

import { resolveMonitoredInstall, type MonitoredInstall, type SessionCandidate } from '@/lib/monitoredInstall';

/**
 * 몇 초부터 "소리가 멎었다" 로 보는가.
 * 새 숫자가 아니다 — 0522 감지기의 DOWN 문턱(p_down_seconds = 300)을 그대로 쓴다.
 */
export const STORE_AUDIO_STALE_SECONDS = 300;

export interface StoreSessionSnapshot extends SessionCandidate {
  /** brand_player_sessions.last_seen_at 기준 경과. */
  secondsSinceHeartbeat: number;
  /**
   * brand_player_sessions.last_audio_progress_at 기준 경과.
   * **null = 이 세션은 진행 신호를 보낸 적이 없다.** 구버전 클라이언트가 그렇다.
   * null 을 "오래됐다" 로 취급하지 않는다.
   */
  secondsSinceAudioProgress: number | null;
}

/** 세션 하나가 지금 소리를 내고 있는가. */
export type SessionAudioState =
  /** 진행 신호가 싱싱하다. 이것만이 재생의 증거다. */
  | 'playing'
  /** heartbeat 도 진행도 오래됐다. 소리가 나지 않는다. */
  | 'silent'
  /** 살아는 있는데 진행 신호가 없다. 증명할 수 없다(§5 — heartbeat 만으로 재생 판정 금지). */
  | 'unproven';

export type StoreServiceHealth =
  /** 매장에 소리가 난다. evidence 는 근거일 뿐 복구 대상이 아니다. */
  | { service: 'playing'; evidence: readonly string[] }
  /** 진행 신호를 보낸 세션이 전부 멎었다. 긴급 장애 후보. */
  | { service: 'outage'; silentSessions: readonly string[] }
  /** 판정 불가. 긴급 알림을 보내지 않는다. */
  | { service: 'unknown'; reason: 'no_sessions' | 'heartbeat_only' };

/** 감시 대상 기기 자체의 상태. 매장 서비스 상태와 **별개**다. */
export type PrimaryDeviceState = 'playing' | 'degraded' | 'unproven' | 'unknown';

export interface StoreHealthVerdict {
  store: StoreServiceHealth;
  /** 감시 대상 install — 이 값은 이 분류기가 바꾸지 않는다. */
  monitored: MonitoredInstall;
  primary: PrimaryDeviceState;
  /** 긴급 장애 알림을 보내도 되는가. store 가 outage 일 때만 true. */
  urgent: boolean;
}

/** 세션 하나를 판정한다. */
export function classifySession(
  s: StoreSessionSnapshot,
  staleSeconds: number = STORE_AUDIO_STALE_SECONDS,
): SessionAudioState {
  // 문서가 멎었으면 진행 신호가 뭐였든 지금 소리는 나지 않는다.
  if (s.secondsSinceHeartbeat >= staleSeconds) return 'silent';
  // 살아는 있는데 진행 신호가 없다 — 재생한다고 말할 근거가 없다.
  if (s.secondsSinceAudioProgress === null) return 'unproven';
  return s.secondsSinceAudioProgress < staleSeconds ? 'playing' : 'silent';
}

/**
 * 매장 단위 서비스 상태.
 *
 * outage 는 **진행 신호를 보낸 세션이 하나라도 있고 그것들이 전부 멎었을 때**만
 * 나온다. 살아 있는데 진행 신호가 없는 세션이 섞여 있으면 unknown 이다.
 */
export function classifyStoreService(
  sessions: readonly StoreSessionSnapshot[],
  staleSeconds: number = STORE_AUDIO_STALE_SECONDS,
): StoreServiceHealth {
  if (sessions.length === 0) return { service: 'unknown', reason: 'no_sessions' };

  const states = sessions.map((s) => [s, classifySession(s, staleSeconds)] as const);

  const playing = states.filter(([, st]) => st === 'playing').map(([s]) => s.sessionId);
  if (playing.length > 0) return { service: 'playing', evidence: playing };

  // 살아 있으면서 진행 신호가 없는 세션이 있으면 무음이라고 단정하지 않는다.
  if (states.some(([, st]) => st === 'unproven')) return { service: 'unknown', reason: 'heartbeat_only' };

  return { service: 'outage', silentSessions: states.map(([s]) => s.sessionId) };
}

/**
 * 매장 상태와 기기 상태를 함께 낸다.
 *
 * 감시 대상 선정은 monitoredInstall 에 그대로 맡긴다 — 여기서 다시 고르지 않는다.
 */
export function assessStoreHealth(
  sessions: readonly StoreSessionSnapshot[],
  openIncidentSessionId?: string | null,
  staleSeconds: number = STORE_AUDIO_STALE_SECONDS,
): StoreHealthVerdict {
  const store = classifyStoreService(sessions, staleSeconds);
  const monitored = resolveMonitoredInstall(sessions, openIncidentSessionId);

  let primary: PrimaryDeviceState = 'unknown';
  if (monitored.kind === 'resolved') {
    const row = sessions.find((s) => s.sessionId === monitored.sessionId);
    if (row) {
      const st = classifySession(row, staleSeconds);
      primary = st === 'playing' ? 'playing' : st === 'unproven' ? 'unproven' : 'degraded';
    } else {
      // incident 가 가리키는 세션이 목록에 없다 = 24시간 넘게 조용하다.
      primary = 'degraded';
    }
  }

  return { store, monitored, primary, urgent: store.service === 'outage' };
}

/**
 * "가려진 장애" 알림을 보내도 되는가 — 감시 루틴의 B 경로 전용 관문.
 *
 * 두 조건을 **모두** 넘겨야 한다.
 *   1) 매장에 소리가 나지 않는다 (store outage)
 *   2) 그 매장의 감시 대상 install 이 무엇인지 안다
 *
 * 2번이 FAIL CLOSED 다. 어느 기기가 매장 재생기인지 모르면 "매장이 조용하다" 고
 * 말할 자리가 아니다 — 2026-09-15 ming 계정처럼 5초 살고 사라진 세션 하나뿐인
 * 경우가 그렇다. 그런 건은 서버 감지기(0522)의 incident 경로가 이미 다룬다.
 */
export function shouldRaiseMaskedOutageAlert(v: StoreHealthVerdict): boolean {
  return v.urgent && v.monitored.kind === 'resolved';
}

/** 운영자에게 보여줄 한 줄. 긴급도와 문구를 함께 낸다. */
export function describeStoreHealth(v: StoreHealthVerdict): { tone: 'urgent' | 'notice' | 'ok'; text: string } {
  if (v.store.service === 'outage') {
    return { tone: 'urgent', text: '매장 무음 — 재생 중인 기기가 없습니다' };
  }
  if (v.store.service === 'unknown') {
    return v.store.reason === 'no_sessions'
      ? { tone: 'notice', text: '최근 접속한 재생기가 없습니다' }
      : { tone: 'notice', text: '재생 여부 확인 불가 — 진행 신호를 보내지 않는 기기입니다' };
  }
  if (v.primary === 'degraded') {
    return { tone: 'notice', text: '기본 재생기 오프라인 / 대체 재생기에서 재생 중' };
  }
  return { tone: 'ok', text: '재생 중' };
}
