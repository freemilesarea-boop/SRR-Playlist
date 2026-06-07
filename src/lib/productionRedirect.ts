/**
 * productionRedirect.ts — Vercel preview URL 접속 시 production 도메인으로 강제 이동 (X6.26)
 *
 * 배경:
 *   사용자가 `https://srr-playlist.vercel.app` 으로 접속할 경우, OAuth /
 *   share / SEO / 쿠키 정책 일관성 측면에서 production (`www.deudda.com`)
 *   으로 강제 redirect 해서 단일 origin 으로 정리.
 *
 * 정책:
 *   - production 빌드 + 호스트가 `srr-playlist.vercel.app` 인 경우에만 동작.
 *   - `localhost`, `127.0.0.1`, `deudda.com`, `www.deudda.com` 는 건드리지 않음.
 *   - Vercel preview branch deploy (`*-git-*.vercel.app`) 도 건드리지 않음 — 운영 검수에 필요.
 *   - DEV 모드 (vite dev 서버) 는 절대 안 건드림.
 *   - 사용자가 `?keepVercel=1` 쿼리로 의도적 vercel 도메인 유지 가능 (테스트용).
 *   - path / search / hash 보존 — OAuth callback URL 도 끊김 없이 전환.
 *
 * 호출 시점:
 *   `main.tsx` 의 createRoot 호출 이전. 가장 빠른 시점에서 redirect 해 부분 렌더
 *   부작용 (PWA SW register, 로컬 토큰 set 등) 을 막음.
 */

const PRODUCTION_HOST = 'www.deudda.com';
const VERCEL_PROD_HOSTS = new Set(['srr-playlist.vercel.app']);

export function shouldRedirectToProduction(loc: Location = window.location): boolean {
  // dev 모드는 무조건 skip
  if (import.meta.env.DEV) return false;
  // 명시적 우회 — ?keepVercel=1 또는 sessionStorage flag
  try {
    if (loc.search.includes('keepVercel=1')) return false;
    if (window.sessionStorage?.getItem('srr-keep-vercel') === '1') return false;
  } catch {
    /* private mode 등 — skip */
  }
  // 호스트 매칭 — production-pinned Vercel URL 만 redirect 대상
  return VERCEL_PROD_HOSTS.has(loc.hostname);
}

export function redirectToProductionIfNeeded(): void {
  if (typeof window === 'undefined') return;
  if (!shouldRedirectToProduction()) return;
  const { pathname, search, hash } = window.location;
  const target = `https://${PRODUCTION_HOST}${pathname}${search}${hash}`;
  // replace 로 history 누적 방지 — 뒤로가기 시 vercel.app 로 되돌아가지 않음
  window.location.replace(target);
}
