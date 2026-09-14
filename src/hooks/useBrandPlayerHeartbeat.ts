// Phase BRAND-1 — 브랜드 플레이어 heartbeat.
// useStoreHeartbeat 패턴 미러: (a) 트랙 변경 즉시 fire + (b) 60s interval.
// last_seen_at / current_track_id 갱신. 실패는 silent (재생 절대 방해 안 함).
//
// BRAND-PLAYER-SELF-HEAL-1 — **실제로 소리가 났던 곡만 보고한다.**
// 서버는 current_track_id 가 바뀌는 것을 "정상 재생 중"의 근거로 쓴다
// (current_track_started_at → admin_brand_player_health). 그런데 자동 복구가
// 정지된 곡을 계속 건너뛰면 큐 index 는 척척 넘어가므로, store 의 현재 곡을 그대로
// 보고할 경우 소리는 한 번도 안 나는데 서버 눈에는 잘 도는 매장으로 보인다.
// 자가 치유를 붙이면서 감시를 눈멀게 하는 셈이라, 여기서 audioActive(실제 재생
// 여부)를 기준으로 삼는다 — 소리가 안 나는 동안에는 마지막으로 실제 재생된 곡을
// 계속 보고하고, 서버는 그대로 stalled 로 판정한다.
//
// 0518 — 원격 제어: heartbeat 응답에 실려 오는 명령을 실행한다.
// 0520 — Realtime 을 기본 배달 경로로 올리고 **heartbeat 는 fallback 으로 남긴다.**
//   heartbeat 는 60초 주기라 최악 60초가 무음으로 흘러간다. WebSocket 이 살아
//   있으면 1초 안에 닿는다. 반대로 모바일 브라우저가 백그라운드에서 소켓을 끊거나
//   재연결에 실패하면 Realtime 은 아무것도 배달하지 못한다 — 그때 폴링이 받는다.
//   두 경로는 handleRemoteCommand 하나만 호출한다(실행부 분기 없음).
import { useEffect, useRef } from 'react';
import { usePlayerStore } from '@/store/playerStore';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { useAuthStore } from '@/store/authStore';
import {
  brandPlayerHeartbeat, subscribeStoreRecoveryCommands,
  type BrandPlayerHeartbeatResult,
} from '@/lib/api/brandPlayerApi';
import { decideCommandAction } from '@/lib/brandPlayerCommand';
import { handleRemoteCommand } from '@/lib/remoteRecoveryExecutor';
import {
  parseRealtimeCommandRow, executedCommandIds, type ClientIdentity,
} from '@/lib/remoteRecovery';
import { recordFlightEvent, getPlayerInstanceId } from '@/lib/playbackFlightRecorder';
import {
  readLivenessSnapshot, setRealtimeStatus, refreshStorageEstimate,
} from '@/lib/clientLiveness';
import {
  pageBuildHash, resolveNavigationType, readServiceWorkerState,
  requestServiceWorkerIdentity, isPageSwBuildMismatch,
} from '@/lib/pwaBuildIdentity';
import { logPlaybackDiagnostic } from '@/lib/playbackDiagnostics';

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * 16A — 지금 돌고 있는 코드의 신원. heartbeat 마다 같은 값을 보내도 된다.
 *
 * swBuildHash 는 SW 에게 물어봐야 알 수 있어 비동기다. 한 번 받으면 캐시한다 —
 * 같은 문서가 사는 동안 SW 가 바뀌면 controllerchange 로 페이지가 리로드되므로
 * (main.tsx), 문서 수명 안에서는 고정으로 봐도 된다.
 *
 * 실패해도 null 로 둘 뿐, heartbeat 를 막지 않는다. 관측이 재생을 방해하면 안 된다.
 */
let cachedSwBuildHash: string | null = null;
let swIdentityAsked = false;
let mismatchLogged = false;

function buildIdentityPayload() {
  const sw = readServiceWorkerState();
  return {
    pageBuildHash: pageBuildHash(),
    swBuildHash: cachedSwBuildHash,
    swControlled: sw.controlled,
    navigationType: resolveNavigationType(),
  };
}

/**
 * 17 — 이 heartbeat 순간의 클라이언트 상태.
 *
 * 읽기만 한다. 값을 못 읽으면 null 로 둘 뿐 heartbeat 를 막지 않는다 —
 * 관측이 재생을 방해하면 안 된다(16A 와 같은 원칙).
 */
function buildLivenessPayload() {
  let wakeLockActive: boolean | null = null;
  try { wakeLockActive = usePlaybackHealthStore.getState().wakeLockActive; } catch { /* noop */ }
  // 저장공간 추정은 비동기다 — 여기서 기다리지 않고 예약만 한다. 다음 heartbeat 가
  // 갱신된 값을 싣는다. 10분에 한 번만 실제로 묻는다.
  refreshStorageEstimate();
  return readLivenessSnapshot({
    playerInstanceId: getPlayerInstanceId(),
    wakeLockActive,
  });
}

/** SW 에게 identity 를 한 번 물어보고 캐시한다. 응답이 없으면 null 로 남긴다. */
async function ensureSwIdentity(): Promise<void> {
  if (swIdentityAsked) return;
  swIdentityAsked = true;
  const id = await requestServiceWorkerIdentity();
  cachedSwBuildHash = id?.swBuildHash ?? null;

  // 관측 이벤트일 뿐이다 — 이걸로 장애 처리도, 리로드도 하지 않는다(§9).
  if (!mismatchLogged && isPageSwBuildMismatch(pageBuildHash(), cachedSwBuildHash)) {
    mismatchLogged = true;
    recordFlightEvent('PAGE_SW_BUILD_MISMATCH');
    void logPlaybackDiagnostic('session_start', {
      reason: 'unknown',
      playerMode: 'brand',
      context: {
        kind: 'PAGE_SW_BUILD_MISMATCH',
        pageBuildHash: pageBuildHash(),
        swBuildHash: cachedSwBuildHash,
      },
    });
  }
}

/** 테스트용 — 모듈 수준 캐시를 비운다. */
export function __resetBuildIdentityCacheForTest(): void {
  cachedSwBuildHash = null; swIdentityAsked = false; mismatchLogged = false;
}

interface Options {
  brandId: string | null;
  sessionToken: string | null;
  enabled: boolean;
}

/**
 * 서버에 보고할 곡 = **마지막으로 실제 소리가 났던 곡**.
 * audioActive 가 false 인 동안(정지·자동 스킵 중)에는 기준점을 옮기지 않는다.
 * 아직 한 번도 재생된 적이 없으면 현재 곡을 그대로 보고한다(최초 진입).
 */
function resolveReportedTrackId(
  storeTrackId: string | null,
  lastAudibleRef: React.MutableRefObject<string | null>,
): string | null {
  const audioActive = usePlaybackHealthStore.getState().audioActive;
  if (audioActive) {
    lastAudibleRef.current = storeTrackId;
    return storeTrackId;
  }
  return lastAudibleRef.current ?? storeTrackId;
}

/**
 * 이 클라이언트가 누구인가. **호출 시점**에 읽는다 — 명령은 렌더와 무관한 순간에
 * 도착하고, 그때의 최신 신원으로 target 을 대조해야 한다.
 */
function readIdentity(sessionId: string | null): ClientIdentity {
  return {
    storeUserId: useAuthStore.getState().user?.id ?? null,
    sessionId,
    playerInstanceId: getPlayerInstanceId(),
  };
}

export function useBrandPlayerHeartbeat({ brandId, sessionToken, enabled }: Options): void {
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const lastTrackIdRef = useRef<string | null>(null);
  /** 마지막으로 실제 소리가 났던 곡 id. */
  const lastAudibleTrackIdRef = useRef<string | null>(null);
  // 구독해서 소리가 나기 시작한 순간 (a) 가 다시 돌게 한다. 이게 없으면 곡 전환이
  // 60s interval 까지 보고되지 않는다 — 전환 직후엔 아직 audioActive=false 이므로.
  const audioActive = usePlaybackHealthStore((s) => s.audioActive);

  const storeUserId = useAuthStore((s) => s.user?.id ?? null);
  /** 내 세션 id — heartbeat 응답으로 배운다. Realtime target 대조에 쓴다. */
  const sessionIdRef = useRef<string | null>(null);

  // heartbeat 응답 처리 — 세션 id 학습 + 명령 실행(fallback 경로).
  const consumeHeartbeat = (res: BrandPlayerHeartbeatResult): void => {
    if (!res || res.success !== true) return;
    if (typeof res.session_id === 'string' && res.session_id) {
      sessionIdRef.current = res.session_id;
    }
    // 0518 의 화이트리스트·필수필드 검사를 그대로 통과시킨다(legacy 경로 회귀 방지).
    const action = decideCommandAction(res, executedCommandIds());
    if (action.kind !== 'run') return;
    // 서버가 내 세션 토큰으로 대상을 확정해 건넨 명령이다 — target 대조는 서버가 끝냈다.
    handleRemoteCommand(
      { commandId: action.commandId, command: action.command, serverTargeted: true },
      readIdentity(sessionIdRef.current),
      'heartbeat',
    );
  };

  // (a) 트랙 변경(= 실제로 소리가 난 곡의 변경) 즉시 heartbeat
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    const reported = resolveReportedTrackId(currentTrackId, lastAudibleTrackIdRef);
    if (reported === lastTrackIdRef.current) return;
    lastTrackIdRef.current = reported;
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
    void brandPlayerHeartbeat(brandId, sessionToken, reported, ua, buildIdentityPayload(), buildLivenessPayload())
      .then(consumeHeartbeat)
      .catch(() => { /* silent */ });
  }, [enabled, brandId, sessionToken, currentTrackId, audioActive]);

  // (b) 60s interval — getState() 로 fresh 값 조회, deps 는 [enabled, brandId, sessionToken] 만
  useEffect(() => {
    if (!enabled || !brandId || !sessionToken) return;
    let cancelled = false;
    const fire = () => {
      const st = usePlayerStore.getState();
      const tid = resolveReportedTrackId(st.queue[st.index]?.id ?? null, lastAudibleTrackIdRef);
      lastTrackIdRef.current = tid;
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 300) : null;
      void brandPlayerHeartbeat(brandId, sessionToken, tid, ua, buildIdentityPayload(), buildLivenessPayload())
        .then((res) => { if (!cancelled) consumeHeartbeat(res); })
        .catch(() => { /* silent */ });
    };
    void ensureSwIdentity();
    fire();
    const id = window.setInterval(() => { if (!cancelled) fire(); }, HEARTBEAT_INTERVAL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [enabled, brandId, sessionToken]);

  // (c) 0520 — Realtime 즉시 배달. **control plane 이다.**
  //
  // 이 effect 는 오디오를 건드리지 않는다. 구독 실패·소켓 끊김·재연결 실패 어느
  // 경우에도 여기서 하는 일은 "명령을 못 받는 것" 뿐이고, 그때는 (b) 의 폴링이
  // 그대로 받는다. Player unmount·pause·queue reset 은 절대 하지 않는다.
  useEffect(() => {
    if (!enabled || !storeUserId) return;
    let sub: { unsubscribe: () => void } | null = null;
    try {
      sub = subscribeStoreRecoveryCommands(
        storeUserId,
        (row) => {
          // row 를 믿고 바로 실행하지 않는다 — target·TTL·상태·중복을 전부 다시 본다.
          handleRemoteCommand(
            parseRealtimeCommandRow(row), readIdentity(sessionIdRef.current), 'realtime',
          );
        },
        (status) => {
          recordFlightEvent('REALTIME_CHANNEL_STATUS', { extra: { status } });
          // 다음 heartbeat 가 이 상태를 서버로 옮긴다. 명령이 배달되지 않았을 때
          // "채널이 끊겨서" 인지 "프로세스가 없어서" 인지 가르는 유일한 단서다.
          setRealtimeStatus(status);
        },
      );
    } catch {
      /* 구독 자체가 실패해도 재생과 폴링은 그대로 간다 */
    }
    return () => { try { sub?.unsubscribe(); } catch { /* noop */ } };
  }, [enabled, storeUserId]);
}
