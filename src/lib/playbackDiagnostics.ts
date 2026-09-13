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
import { supabase } from '@/lib/supabase';
import { isNativeApp } from '@/lib/native';

export type DiagnosticEvent =
  | 'session_start'
  | 'page_frozen'
  | 'page_resumed'
  | 'page_hidden'
  | 'autoplay_blocked'
  | 'autoplay_recovered'
  | 'track_cut_short'
  | 'playback_stalled';

export type DiagnosticReason =
  | 'sw_update'        // 새 빌드 적용으로 리로드
  | 'chunk_error'      // 청크 로드 실패 → 복구 리로드
  | 'self_heal'        // 무인 복구 로직이 리로드
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
  'sw_update', 'chunk_error', 'self_heal', 'fresh_load', 'media_error',
  'network', 'skip', 'policy_blocked', 'preview_limit', 'unknown',
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
