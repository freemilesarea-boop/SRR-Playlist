/**
 * globalErrorTelemetry.ts — 플레이어 **바깥**에서 잡는 전역 예외 기록.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────────
 * 2026-09-15 14:06:16 KST 숙대점에서 플레이어 계층이 멈췄다. 무엇이 멈췄는지는
 * 서버 기록으로 좁혔지만 **왜** 멈췄는지는 끝내 알 수 없었다. 이유는 단순하다:
 *
 *   유일한 클라이언트 진단기(Flight Recorder)가 플레이어와 같이 죽는다.
 *   정지를 감지해야 flush 하는데, 감지하는 코드가 함께 멈췄다.
 *   그날 12:17 사고 때는 3번 flush 됐고, 14:05 전후로는 **0번**이다.
 *
 * 그래서 보고자를 플레이어 밖에 둔다. window 전역 핸들러는 어느 컴포넌트가 죽든
 * 문서가 살아 있는 한 계속 돈다 — 그날 셸이 26분 38초 동안 살아 있었다는 것이
 * 실측으로 증명됐으므로, 이 경로였다면 기록이 남았다.
 *
 * ── 담지 않는 것 ────────────────────────────────────────────────────────────
 *   • 스택 전체를 담지 않는다. 프레임 몇 줄만 남기고 나머지는 지문(fingerprint)으로
 *     접는다 — 같은 버그를 같은 값으로 묶되 서버에 코드를 통째로 쌓지 않는다.
 *   • 개인정보를 담지 않는다. 메시지에서 URL 쿼리·토큰처럼 보이는 것은 지운다.
 *   • 사용자 입력·폼 값·트랙 제목을 담지 않는다.
 *
 * ── 재생을 절대 방해하지 않는다 ─────────────────────────────────────────────
 * 모든 경로가 try/catch 로 감싸여 있고 실패는 조용히 버린다. 관측이 서비스를
 * 멈추게 하면 관측을 넣은 의미가 없다.
 */
import { beaconPlaybackDiagnostic } from '@/lib/playbackDiagnostics';
import { pageBuildHash } from '@/lib/pwaBuildIdentity';
import { getPlayerInstanceId } from '@/lib/playbackFlightRecorder';
import { readControlPlaneIdentity } from '@/lib/recoveryControlPlane';

/** 한 건의 메시지 상한. 길면 자른다 — 스택 트레이스가 메시지에 붙는 경우가 많다. */
export const MAX_MESSAGE_CHARS = 300;
/** 남기는 스택 프레임 수. 원인을 가리키는 것은 보통 맨 위 몇 줄이다. */
export const MAX_STACK_FRAMES = 5;
/** 프레임 한 줄의 상한. 번들 경로가 길다. */
export const MAX_FRAME_CHARS = 160;
/** 같은 지문을 이 간격 안에 다시 보내지 않는다. 루프 예외가 서버를 채우지 못하게. */
export const DEDUPE_WINDOW_MS = 300_000;
/** 문서 한 수명당 상한. 무인 매장이 24시간 도는 동안의 총량을 묶는다. */
export const MAX_REPORTS_PER_DOCUMENT = 20;

/** 토큰·키처럼 보이는 것과 쿼리스트링을 지운다. */
export function redact(raw: string): string {
  return raw
    .replace(/([?&](?:token|key|apikey|access_token|refresh_token|code)=)[^&\s]*/gi, '$1***')
    .replace(/\?[^\s)]{8,}/g, '?***')
    .replace(/\b(?:ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,})\b/g, 'jwt***')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, (m) => `${m.slice(0, 6)}***`);
}

export function boundedMessage(err: unknown): string {
  let msg: string;
  if (err instanceof Error) msg = err.message || err.name;
  else if (typeof err === 'string') msg = err;
  else {
    try { msg = String((err as { message?: unknown })?.message ?? err); }
    catch { msg = 'unknown'; }
  }
  return redact(msg).slice(0, MAX_MESSAGE_CHARS);
}

export function errorClass(err: unknown): string {
  if (err instanceof Error) return err.name || 'Error';
  if (typeof err === 'string') return 'String';
  if (err === null) return 'null';
  return typeof err;
}

/**
 * 스택 지문 — 맨 위 몇 프레임만 남기고 redact 한다.
 *
 * 줄 번호·컬럼은 빌드마다 바뀌므로 지문에서 뺀다. 그래야 같은 버그가 배포를
 * 넘어서도 같은 값으로 묶인다.
 */
export function stackFingerprint(err: unknown): string[] {
  const stack = err instanceof Error && typeof err.stack === 'string' ? err.stack : '';
  if (!stack) return [];
  return stack
    .split('\n')
    .slice(1)                                   // 첫 줄은 메시지 반복이다
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_STACK_FRAMES)
    .map((l) => redact(l.replace(/:\d+:\d+\)?$/, ')')).slice(0, MAX_FRAME_CHARS));
}

/* ────────────────────────────────────────────────────────────────────────── */
/* 유계 전송                                                                    */
/* ────────────────────────────────────────────────────────────────────────── */

const sentAt = new Map<string, number>();
let reportCount = 0;

/** 테스트 전용. */
export function __resetGlobalErrorTelemetryForTest(): void {
  sentAt.clear();
  reportCount = 0;
}

export interface ErrorReportGate {
  allowed: boolean;
  reason?: 'duplicate' | 'document_limit';
}

/** 보낼지 말지. 순수 함수라 테스트가 시간을 직접 준다. */
export function gateReport(key: string, nowMs: number): ErrorReportGate {
  if (reportCount >= MAX_REPORTS_PER_DOCUMENT) return { allowed: false, reason: 'document_limit' };
  const last = sentAt.get(key);
  if (last !== undefined && nowMs - last < DEDUPE_WINDOW_MS) {
    return { allowed: false, reason: 'duplicate' };
  }
  sentAt.set(key, nowMs);
  reportCount += 1;
  return { allowed: true };
}

export type ErrorSource = 'window_error' | 'unhandled_rejection' | 'error_boundary';

export interface CapturedError {
  source: ErrorSource;
  /** React ErrorBoundary 경로에서만 채워진다. */
  componentContext?: string | null;
}

/**
 * 한 건을 서버로 보낸다.
 *
 * keepalive beacon 을 쓰는 이유: 예외 뒤에 곧바로 리로드/이탈이 따라올 수 있고,
 * 진행 중인 일반 fetch 는 문서가 사라질 때 함께 취소된다(Phase 24 에서 확인).
 */
export function reportGlobalError(err: unknown, meta: CapturedError, nowMs: number = Date.now()): boolean {
  try {
    const cls = errorClass(err);
    const msg = boundedMessage(err);
    const frames = stackFingerprint(err);
    // 지문 = 종류 + 메시지 + 최상단 프레임. 줄번호를 뺐으므로 배포를 넘어 안정적이다.
    const key = `${meta.source}|${cls}|${msg}|${frames[0] ?? ''}`;
    const gate = gateReport(key, nowMs);
    if (!gate.allowed) return false;

    const id = readControlPlaneIdentity();
    beaconPlaybackDiagnostic('app_error', {
      reason: 'unknown',
      playerMode: 'brand',
      context: {
        source: meta.source,
        errorClass: cls,
        message: msg,
        stack: frames,
        build: pageBuildHash(),
        playerInstanceId: getPlayerInstanceId(),
        sessionId: id.sessionId,
        // 라우트는 경로만. 쿼리·해시는 개인정보가 섞일 수 있어 버린다.
        route: typeof location === 'undefined' ? null : location.pathname,
        componentContext: meta.componentContext ?? null,
        visibility: typeof document === 'undefined' ? null : document.visibilityState,
        online: typeof navigator === 'undefined' ? null : navigator.onLine,
      },
    });
    return true;
  } catch {
    return false;                               // 관측 실패가 재생을 막아선 안 된다
  }
}

/**
 * 전역 핸들러 설치. **AppShell/main 계층에서 한 번만** 부른다.
 *
 * 플레이어 안에서 부르면 이 파일이 존재하는 이유가 사라진다 — 플레이어와 같이 죽는다.
 */
export function installGlobalErrorTelemetry(): () => void {
  if (typeof window === 'undefined') return () => {};

  const onError = (e: ErrorEvent) => {
    reportGlobalError(e.error ?? e.message, { source: 'window_error' });
  };
  const onRejection = (e: PromiseRejectionEvent) => {
    reportGlobalError(e.reason, { source: 'unhandled_rejection' });
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
