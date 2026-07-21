/**
 * authRedirect.ts — 인증 redirect origin resolver + open-redirect 방지 (AUTH-STABILIZATION-1)
 *
 * 목적:
 *   - OAuth / 이메일 인증 / 비밀번호 재설정 콜백 URL 을 한 곳에서 생성한다.
 *   - 허용된 origin 에서만 콜백을 돌려받고, 알 수 없는(주입된) host 는 fail-closed 로
 *     canonical production origin 으로 되돌린다.
 *   - 로그인 후 복귀 경로(returnTo)를 내부 경로로만 제한해 Open Redirect 를 차단한다.
 *
 * 설계 원칙(외부 설정과의 관계):
 *   - 정상 origin(운영 apex/www, *.vercel.app preview, localhost)은 "현재 origin 그대로" 사용한다.
 *     → PKCE code_verifier 가 저장된 origin 과 콜백 origin 이 동일해야 교환이 성공하므로,
 *       apex↔www 같은 origin 이동을 임의로 강제하지 않는다(그건 Supabase Redirect URL
 *       화이트리스트로 해결할 외부 설정 문제다 — 07-production-checklist 참고).
 *   - 허용 목록에 없는 origin 만 canonical 로 fail-closed.
 */

/** 운영 canonical origin (productionRedirect.ts 의 PRODUCTION_HOST 와 일치). */
export const CANONICAL_AUTH_ORIGIN = 'https://www.deudda.com';

/** 인증 콜백을 돌려받아도 되는 origin 인지 판정 (fail-closed). */
export function isAllowedAuthOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  const host = u.hostname;
  // 로컬 개발 (http 허용)
  if ((u.protocol === 'http:' || u.protocol === 'https:') && (host === 'localhost' || host === '127.0.0.1')) {
    return true;
  }
  // 그 외는 https 만
  if (u.protocol !== 'https:') return false;
  // 운영 도메인 (apex + www)
  if (host === 'deudda.com' || host === 'www.deudda.com') return true;
  // Vercel preview / production 배포 (*.vercel.app)
  if (host === 'vercel.app' || host.endsWith('.vercel.app')) return true;
  return false;
}

/**
 * 인증 콜백에 사용할 origin. 허용 origin 이면 현재 origin 그대로(동일-origin PKCE 보존),
 * 아니면 canonical 로 fail-closed.
 */
export function getAuthRedirectOrigin(loc: Pick<Location, 'origin'> = window.location): string {
  const origin = loc?.origin ?? '';
  return isAllowedAuthOrigin(origin) ? origin : CANONICAL_AUTH_ORIGIN;
}

/** OAuth / 이메일 인증 콜백 URL. */
export function getOAuthCallbackUrl(loc: Pick<Location, 'origin'> = window.location): string {
  return `${getAuthRedirectOrigin(loc)}/auth/callback`;
}

/** 비밀번호 재설정(recovery) 콜백 URL. */
export function getPasswordResetUrl(loc: Pick<Location, 'origin'> = window.location): string {
  return `${getAuthRedirectOrigin(loc)}/auth/reset`;
}

/**
 * 로그인 후 복귀 경로 sanitizer — 내부 절대경로만 허용해 Open Redirect 를 차단한다.
 * 허용: `/`, `/business`, `/playlist/123?x=1#h` …
 * 차단: `//evil.com`, `/\evil.com`, `https://evil.com`, 제어문자 포함, 상대경로.
 */
export function sanitizeAuthReturnPath(
  path: string | null | undefined,
  fallback = '/',
): string {
  if (!path || typeof path !== 'string') return fallback;
  const p = path.trim();
  if (!p.startsWith('/')) return fallback; // 반드시 내부 절대경로
  if (p.startsWith('//') || p.startsWith('/\\')) return fallback; // protocol-relative / 역슬래시 우회
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return fallback; // 개행/탭 등 제어문자 우회 차단
  }
  return p;
}
