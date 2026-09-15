/**
 * playbackDiagnostics.ts — 매장 재생이 왜 끊겼는지 기록.
 *
 * 왜 만들었나 — 숙대점(르하임스터디카페s 숙대점) 조사에서 벽에 부딪혔다:
 *   • 하트비트가 06:44 에 죽고 102분 무음. "탭이 얼었다" 는 **추론**이었다.
 *   • 곡이 20초에 끊긴 세션 272건(109개 서로 다른 곡). **원인을 특정하지 못했다.**
 *   • 자동재생 차단 화면은 봤지만 직전에 왜 리로드됐는지 알 수 없었다.
 *
 * stream_sessions_v2 는 "얼마나 재생됐나" 만 안다. 이 모듈이 "왜 끊겼나" 를 채운다.
 *
 * 원칙:
 *   • 정상 재생 중에는 아무것도 안 쓴다 — 중단/복구 시점만.
 *   • fire-and-forget. 기록 실패가 재생을 막지 않는다.
 *   • 서버에서도 분당 20건 제한이 걸려 있다(폭주 방지).
 */
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isNativeApp } from '@/lib/native';

export type DiagnosticEvent =
  | 'session_start'
  | 'page_frozen'
  | 'page_resumed'
  | 'page_hidden'
  | 'autoplay_blocked'
  | 'autoplay_recovered'
  | 'track_cut_short'
  | 'playback_stalled'
  // 22 — 업데이트 수명주기. 오늘 프로덕션에 6번 배포했는데 두 매장 다 하나도
  // 활성화하지 않았고, **그 사실을 서버에서 볼 방법이 없었다.** 무인 업데이트를
  // 만들려면 먼저 업데이트가 감지됐는지부터 보여야 한다.
  | 'update_pending'
  | 'update_activated'
  | 'update_blocked'
  // 24 — 새 SW 가 이 문서를 넘겨받은 **그 순간**. 리로드가 곧바로 따라올 수 있어
  // 일반 RPC 로는 기록이 남지 않는다(아래 beacon 참고).
  | 'sw_controllerchange'
  // 25 — 오디오 파이프라인이 얼어붙은 **그 순간**. 예전에는 이 사실이 링버퍼
  // 안에만 있다가 playback_stalled 업로드 때만 서버에 닿았다(2026-09-15 숙대점
  // 27분 무음 동안 단 3건). 정지 구간당 1회, 최소 간격을 두고 즉시 보낸다.
  | 'audio_frozen'
  // 27 — 플레이어 **바깥**(AppShell/window)에서 잡은 예외. 2026-09-15 숙대점에서
  // 플레이어 계층이 멈춘 이유를 끝내 알 수 없었던 것은 유일한 진단기가 플레이어와
  // 함께 죽었기 때문이다(globalErrorTelemetry.ts).
  | 'app_error'
  // 27 — "플레이어는 멈췄는데 셸은 살아 있다". 평소에는 보내지 않는다 —
  // 플레이어 계층이 멈춘 동안에만 제어면이 남긴다(recoveryControlPlane.ts).
  | 'shell_health'
  // 29 — 플레이어 실행 자체가 멎었고 셸이 그것을 감지했다. Phase 28 failure
  // matrix 의 I(Player timer loss)를 닫는 신호다. 셸 주도 복구마다 1건.
  | 'player_execution_stale';

export type DiagnosticReason =
  | 'sw_update'        // 새 빌드 적용으로 리로드
  | 'chunk_error'      // 청크 로드 실패 → 복구 리로드
  | 'self_heal'        // 무인 복구 로직이 리로드
  | 'remote_recovery'  // 운영자가 원격 복구 명령으로 리로드
  | 'fresh_load'       // 사용자가 직접 열었거나 첫 진입
  | 'media_error'      // 오디오 디코딩/네트워크 오류
  | 'network'          // 오프라인/회선 문제
  | 'skip'             // 정책·큐에 의한 건너뛰기
  | 'policy_blocked'   // 업종 정책(스터디카페 등)에 막힘
  | 'preview_limit'    // 무료 등급 25초 제한
  | 'unknown';

export type PlayerMode = 'store' | 'brand' | 'personal';

/** 리로드 사유를 페이지 간에 넘기는 키 — reloadApp 이 심고 다음 로드가 읽는다. */
const RELOAD_REASON_KEY = 'deudda:reload-reason';

/**
 * 리로드 직전에 사유를 남긴다. 다음 페이지 로드의 session_start 가 이걸 읽는다.
 * 지금은 "왜 리로드됐는지" 를 알 방법이 전혀 없다 — 그 공백을 메운다.
 */
export function markReloadReason(reason: DiagnosticReason): void {
  try {
    sessionStorage.setItem(RELOAD_REASON_KEY, reason);
  } catch {
    /* 사파리 프라이빗 등 — 무시 */
  }
}

/** 직전 리로드 사유를 꺼내고 지운다(1회성). 없으면 fresh_load. */
export function takeReloadReason(): DiagnosticReason {
  try {
    const v = sessionStorage.getItem(RELOAD_REASON_KEY);
    sessionStorage.removeItem(RELOAD_REASON_KEY);
    return isDiagnosticReason(v) ? v : 'fresh_load';
  } catch {
    return 'fresh_load';
  }
}

const REASONS: ReadonlySet<string> = new Set<DiagnosticReason>([
  'sw_update', 'chunk_error', 'self_heal', 'remote_recovery', 'fresh_load',
  'media_error', 'network', 'skip', 'policy_blocked', 'preview_limit', 'unknown',
]);

export function isDiagnosticReason(v: unknown): v is DiagnosticReason {
  return typeof v === 'string' && REASONS.has(v);
}

/**
 * 곡이 "끝까지 안 갔다" 고 볼지 판정.
 *
 * 숙대점에서 20초·50초짜리 세션이 대량으로 남았는데 정상 곡은 90~300초다.
 * 재생 시간이 곡 길이의 일정 비율에 못 미치면 중단으로 본다.
 * 곡 길이를 모르면(메타데이터 실패) 최소 시간 기준으로만 판정한다.
 */
export function isCutShort(opts: {
  playedSeconds: number;
  trackDurationSeconds: number | null | undefined;
  /** 사용자가 직접 넘긴 경우는 중단이 아니다. */
  userSkipped?: boolean;
}): boolean {
  if (opts.userSkipped) return false;
  const played = opts.playedSeconds;
  if (!Number.isFinite(played) || played <= 0) return false;
  const dur = opts.trackDurationSeconds;
  if (dur && Number.isFinite(dur) && dur > 0) {
    // 곡의 80% 미만에서 끝났으면 중단 (페이드/크로스페이드 여유 감안)
    return played < dur * 0.8;
  }
  // 길이를 모르면 30초 미만만 중단으로 본다 — 오탐 방지
  return played < 30;
}

/** 재생 기록 한 줄. 실패는 조용히 무시된다. */
/* ────────────────────────────────────────────────────────────────────────── */
/* 리로드를 견디는 기록 — keepalive beacon                                      */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * 왜 따로 필요한가 — 2026-09-14 숙대점이 두 번 연속 배포를 자동으로 받았는데
 * update_pending / update_blocked / update_activated 가 **전 매장 통틀어 0건**이었다.
 * 같은 함수로 보내는 session_start 는 같은 기기에서 정상으로 남는다. 차이는 하나뿐이다:
 * 업데이트 기록은 **네비게이션 직전**에 나가고, 진행 중인 fetch 는 문서가 사라질 때
 * 함께 취소된다.
 *
 * 그래서 이 경로는 `keepalive: true` 로 보낸다 — 문서가 사라져도 브라우저가 요청을
 * 끝까지 배달한다. 실패하면 조용히 넘어간다. 관측이 재생을 방해하면 안 된다.
 *
 * 토큰은 auth 상태 변화에서 받아 캐시한다(동기적으로 읽어야 하므로). 없으면 anon 으로
 * 보내고, 그 경우 서버의 auth.uid() 가 null 이라 행이 생기지 않는다 — 조용한 실패지만
 * 잘못된 user_id 로 남기는 것보다 낫다.
 */
let cachedAccessToken: string | null = null;

if (isSupabaseConfigured) {
  void supabase.auth.getSession()
    .then(({ data }) => { cachedAccessToken = data.session?.access_token ?? null; })
    .catch(() => { /* noop */ });
  supabase.auth.onAuthStateChange((_e, session) => {
    cachedAccessToken = session?.access_token ?? null;
  });
}

export function beaconPlaybackDiagnostic(
  event: DiagnosticEvent,
  opts: { reason?: DiagnosticReason; context?: Record<string, unknown>; playerMode?: PlayerMode } = {},
): void {
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
    if (!url || !anon || typeof fetch !== 'function') return;
    void fetch(`${url}/rest/v1/rpc/log_store_playback_diagnostic`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${cachedAccessToken ?? anon}`,
      },
      body: JSON.stringify({
        p_event: event,
        p_reason: opts.reason ?? null,
        p_context: opts.context ?? {},
        p_player_mode: opts.playerMode ?? null,
        p_is_native: isNativeApp(),
      }),
    }).catch(() => { /* 진단 기록 실패가 재생을 막아선 안 된다 */ });
  } catch {
    /* 진단 기록 실패가 재생을 막아선 안 된다 */
  }
}

export async function logPlaybackDiagnostic(
  event: DiagnosticEvent,
  opts: {
    reason?: DiagnosticReason;
    context?: Record<string, unknown>;
    playerMode?: PlayerMode;
  } = {},
): Promise<void> {
  try {
    await supabase.rpc('log_store_playback_diagnostic', {
      p_event: event,
      p_reason: opts.reason ?? null,
      p_context: opts.context ?? {},
      p_player_mode: opts.playerMode ?? null,
      p_is_native: isNativeApp(),
    });
  } catch {
    /* 진단 기록 실패가 재생을 막아선 안 된다 */
  }
}

/**
 * 탭 얼림/복귀 감시.
 *
 * 숙대점의 102분 무음이 바로 이 경우로 추정됐지만 증거가 없었다.
 * freeze/resume 은 브라우저가 탭을 정리·복구할 때 실제로 발생하는 이벤트다.
 * 이걸 남겨두면 다음부터는 추론이 아니라 기록으로 확인된다.
 *
 * @returns 해제 함수
 */
export function watchPageLifecycle(playerMode: PlayerMode): () => void {
  if (typeof document === 'undefined') return () => {};

  const onFreeze = () => {
    // freeze 직후 페이지가 정지되므로 keepalive 로 보낸다.
    void logPlaybackDiagnostic('page_frozen', { playerMode, reason: 'unknown' });
  };
  const onResume = () => {
    void logPlaybackDiagnostic('page_resumed', { playerMode });
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      void logPlaybackDiagnostic('page_hidden', { playerMode });
    }
  };

  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onResume);
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    document.removeEventListener('freeze', onFreeze);
    document.removeEventListener('resume', onResume);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
