/**
 * Sentry init — 0093 운영 에러 추적
 *
 * 정책:
 * - VITE_SENTRY_DSN 환경변수가 있을 때만 활성
 * - production 빌드 (`import.meta.env.PROD`) 에서만 활성
 * - 민감정보 (이메일 / Supabase anon key / service_role / RPC params 의 sha256 등) 마스킹
 * - 사용자 role 만 tag 로 기록 (id 는 비식별 hash 등은 시도 안 함)
 *
 * 호출: main.tsx 에서 1회 initSentry() 만 호출 — DSN 없으면 silent skip
 */
import { buildBootDiag } from '@/lib/bootRecovery';

// 동적 import 로 SDK 가 사용되지 않을 때 번들에서 빠지도록
let initialized = false;

const SENSITIVE_KEY_PATTERNS = [
  /key$/i, /token$/i, /secret$/i, /password$/i, /api[_-]?key/i,
  /^p_user_agent$/, /^p_anonymous_id$/,
];

function shouldMask(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function deepMask<T>(value: T, depth = 0): T {
  if (depth > 5) return value;
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((v) => deepMask(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (shouldMask(k)) {
      out[k] = '[masked]';
    } else if (typeof v === 'string' && v.length > 0) {
      // 이메일 형태 마스킹
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
        out[k] = v.replace(/(.{1,3})[^@]*(@.+)/, '$1***$2');
      } else {
        out[k] = v;
      }
    } else {
      out[k] = deepMask(v, depth + 1);
    }
  }
  return out as unknown as T;
}

export async function initSentry(opts?: { userRole?: string | null }): Promise<void> {
  if (initialized) return;
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  const env = (import.meta.env.VITE_APP_ENV as string | undefined) ?? import.meta.env.MODE;

  if (!dsn || !import.meta.env.PROD) {
    // DSN 없거나 dev — silent skip
    return;
  }

  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn,
      environment: env ?? 'production',
      // WEB-OPT-2 — 배포(build) 단위로 오류를 묶기 위한 release. 부팅 실패를 특정 배포에 귀속.
      release: (import.meta.env.VITE_BUILD_ID as string | undefined) || undefined,
      // 베타 단계 — 모든 transaction 수집 (운영 시 0.1 등으로 낮춤)
      tracesSampleRate: 0.1,
      // PII 자동 수집 비활성 (이메일/IP 등)
      sendDefaultPii: false,
      beforeSend(event) {
        // request 헤더 / cookies / IP 제거
        if (event.request) {
          delete event.request.cookies;
          if (event.request.headers) {
            delete (event.request.headers as Record<string, unknown>).authorization;
            delete (event.request.headers as Record<string, unknown>).cookie;
          }
        }
        // extra / contexts 마스킹
        if (event.extra) event.extra = deepMask(event.extra);
        if (event.contexts) {
          for (const k of Object.keys(event.contexts)) {
            event.contexts[k] = deepMask(event.contexts[k] as Record<string, unknown>);
          }
        }
        // user.email 마스킹
        if (event.user?.email) {
          event.user.email = event.user.email.replace(/(.{1,3})[^@]*(@.+)/, '$1***$2');
        }
        return event;
      },
    });
    if (opts?.userRole) {
      Sentry.setTag('user_role', opts.userRole);
    }
    initialized = true;
     
    console.info('[sentry] initialized', { env });
  } catch (e) {
    // SDK load 실패 — silent
     
    console.warn('[sentry] init failed:', e);
  }
}

/** 명시적 에러 capture (앱 코드 어디서든 호출 가능) */
export async function captureError(err: unknown, context?: Record<string, unknown>): Promise<void> {
  try {
    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    if (!dsn || !import.meta.env.PROD) return;
    const Sentry = await import('@sentry/react');
    Sentry.captureException(err, context ? { extra: deepMask(context) } : undefined);
  } catch {
    // noop
  }
}

/**
 * X6.67 — 매장 무인 운영 중 발생한 critical 오류 capture.
 *
 * 일반 captureError 와의 차이:
 *   - tag: business_mode=true, alert_priority=high → Sentry alert rule 에서 1순위로 필터
 *   - fingerprint: scope 단위 묶음 → 같은 매장에서 반복되는 동일 오류는 1 issue 로 그룹화
 *   - level: 'error' (자동)
 *
 * 사용 예 (Player.tsx 등 매장 핵심 경로):
 *   captureBusinessError(new Error('NETWORK_RETRY_EXHAUSTED'), 'player.network_retry', { trackId, retries: 3 })
 *
 * 운영자 alert 설정 (Sentry UI):
 *   - Project Alerts → Create Alert
 *   - Trigger: tag:business_mode=true AND tag:alert_priority=high
 *   - Action: Email / Slack / Webhook (매장 운영팀 채널)
 *   docs/SENTRY_ALERTS.md 참고.
 */
export async function captureBusinessError(
  err: unknown,
  scope: string,
  context?: Record<string, unknown>,
): Promise<void> {
  try {
    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    if (!dsn || !import.meta.env.PROD) return;
    const Sentry = await import('@sentry/react');
    Sentry.withScope((s) => {
      s.setTag('business_mode', 'true');
      s.setTag('alert_priority', 'high');
      s.setTag('scope', scope);
      // 같은 scope+errorName 묶음으로 그룹화 (한 매장 반복 오류 = 1 issue)
      const errName = err instanceof Error ? err.name + ':' + (err.message ?? '') : String(err);
      s.setFingerprint(['business', scope, errName.slice(0, 80)]);
      s.setLevel('error');
      if (context) s.setExtras(deepMask(context));
      if (err instanceof Error) {
        Sentry.captureException(err);
      } else {
        Sentry.captureMessage(String(err), 'error');
      }
    });
  } catch {
    // noop
  }
}

// ── WEB-OPT-2 부팅/복구 진단 ─────────────────────────────────────────
// 공통: DSN 없거나 dev 면 no-op. 정상 부팅에는 아무 이벤트도 보내지 않음(장애/복구만).
// 기록 금지: access/refresh token, 이메일, 사용자 id 원문, API 응답 본문, 곡/signed URL.
async function captureRecovery(
  kind: 'boot_failure' | 'chunk_load_failure' | 'sw_recovery',
  err: unknown,
  extra?: Record<string, unknown>,
): Promise<void> {
  try {
    const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
    if (!dsn || !import.meta.env.PROD) return;
    const Sentry = await import('@sentry/react');
    const diag = buildBootDiag({
      path: typeof location !== 'undefined' ? location.pathname : '/',
      online: typeof navigator !== 'undefined' ? navigator.onLine : null,
      hasController:
        typeof navigator !== 'undefined' && 'serviceWorker' in navigator
          ? !!navigator.serviceWorker.controller
          : null,
      attempt: typeof extra?.attempt === 'number' ? (extra.attempt as number) : undefined,
      reason: typeof extra?.reason === 'string' ? (extra.reason as string) : undefined,
    });
    Sentry.withScope((s) => {
      s.setTag('recovery_kind', kind);
      s.setTag('build_id', diag.build);
      s.setTag('online', String(diag.online));
      s.setTag('sw_controller', String(diag.hasController));
      s.setLevel(kind === 'sw_recovery' ? 'warning' : 'error');
      s.setFingerprint(['web-opt-2', kind, diag.build]);
      // pathname 만 담긴 diag + 마스킹된 extra(민감 키 제거) — 토큰/PII 없음.
      s.setExtras({ ...diag, ...(extra ? deepMask(extra) : {}) });
      if (err instanceof Error) Sentry.captureException(err);
      else Sentry.captureMessage(`${kind}: ${String(err ?? kind)}`, kind === 'sw_recovery' ? 'warning' : 'error');
    });
  } catch {
    // noop — 진단 실패가 앱에 영향 주지 않음
  }
}

/** 앱 최상단 렌더 실패(RootErrorBoundary) 진단. */
export function captureBootFailure(err: unknown, extra?: Record<string, unknown>): Promise<void> {
  return captureRecovery('boot_failure', err, extra);
}
/** dynamic import(chunk) 실패 진단(lazyWithRetry). */
export function captureChunkLoadFailure(err: unknown, extra?: Record<string, unknown>): Promise<void> {
  return captureRecovery('chunk_load_failure', err, extra);
}
/** SW/캐시 긴급 복구 발생 진단(watchdog 이후 재부팅 시 보고). */
export function captureServiceWorkerRecovery(extra?: Record<string, unknown>): Promise<void> {
  return captureRecovery('sw_recovery', new Error('service_worker_recovery'), extra);
}
