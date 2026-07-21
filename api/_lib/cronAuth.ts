/**
 * cronAuth.ts — Fail-closed authentication for Vercel cron / scheduled endpoints.
 * (PLATFORM-HOTFIX-1)
 *
 * 배경: `daily-metrics` 는 `CRON_SECRET` 미설정 시 인증 검사를 통째로 건너뛰어
 * (fail-open) 인증 없이 service_role RPC 를 실행할 수 있었다. 이 헬퍼는 모든 cron
 * 엔드포인트가 동일한 fail-closed 규칙을 쓰도록 한다.
 *
 * 규칙:
 *   - CRON_SECRET 미설정/공백  → 503 CONFIGURATION_ERROR (인증 없이 절대 실행하지 않음)
 *   - 인증 헤더 없음            → 401 UNAUTHORIZED
 *   - Secret 불일치            → 403 FORBIDDEN
 *   Vercel Cron 은 `Authorization: Bearer <CRON_SECRET>` 를 자동 부여한다.
 *   내부 프록시 호출은 `x-cron-secret` 헤더도 허용한다.
 *
 * 보안: 전체 Secret 값을 로그/응답에 남기지 않는다. 비교는 상수시간.
 */

/** 상수시간 문자열 비교 (edge 런타임 안전 — Web Crypto timingSafeEqual 부재 대비). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export type CronAuthResult = { ok: true } | { ok: false; status: number; code: string };

/** 요청의 cron 인증을 fail-closed 로 검증. env 는 주입 가능(테스트용). */
export function verifyCronAuth(
  req: Pick<Request, 'headers'>,
  env: { CRON_SECRET?: string } = process.env as { CRON_SECRET?: string },
): CronAuthResult {
  const secret = (env.CRON_SECRET ?? '').trim();
  if (!secret) return { ok: false, status: 503, code: 'CONFIGURATION_ERROR' };

  const auth = req.headers.get('authorization') ?? '';
  const xcron = req.headers.get('x-cron-secret') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const provided = bearer || xcron;

  if (!provided) return { ok: false, status: 401, code: 'UNAUTHORIZED' };
  if (!timingSafeEqualStr(provided, secret)) return { ok: false, status: 403, code: 'FORBIDDEN' };
  return { ok: true };
}

/** 실패 결과를 표준 JSON 응답으로. (Secret 값 미노출) */
export function cronAuthErrorResponse(r: Extract<CronAuthResult, { ok: false }>): Response {
  return new Response(JSON.stringify({ error: r.code }), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}
