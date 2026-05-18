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
    // eslint-disable-next-line no-console
    console.info('[sentry] initialized', { env });
  } catch (e) {
    // SDK load 실패 — silent
    // eslint-disable-next-line no-console
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
