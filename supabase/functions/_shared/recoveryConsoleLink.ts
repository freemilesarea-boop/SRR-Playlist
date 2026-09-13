/**
 * recoveryConsoleLink.ts — Slack/이메일 장애 알림에 붙는 "Recovery Console 열기" 링크.
 *
 * 이 파일은 **순수 함수만** 담는다(Deno API 사용 금지). Edge Function 과 vitest 가
 * 같은 코드를 쓰기 위해서다 — 링크 규칙이 두 벌로 갈라지면 한쪽만 고쳐진다.
 *
 * ── 절대 규칙 ───────────────────────────────────────────────────────────────
 *  • URL 에 token / secret / 이메일 / 전화번호 / 매장 이름을 절대 넣지 않는다.
 *    쿼리에 실리는 것은 store_user_id(UUID) 하나뿐이고, 그것만으로는 아무 권한도
 *    생기지 않는다. 실제 복구 실행은 Admin 로그인 + 화면의 확인 절차를 거친다.
 *  • base URL 은 **서버가 가진 허용 목록**에서만 나온다. 알림 payload 나 요청 본문에
 *    실려 온 문자열로 URL 을 조합하지 않는다 — open redirect 방지.
 *  • 값이 조금이라도 수상하면 링크를 만들지 않고 null 을 준다. 링크가 없는 알림은
 *    불편할 뿐이지만, 잘못된 링크는 사고다.
 */

/** Recovery Console 이 사는 Admin 탭 key. AdminPage 의 ?tab= 값과 같아야 한다. */
export const RECOVERY_CONSOLE_TAB = 'brand-player';

/** 링크를 만들어도 되는 호스트. 여기 없는 호스트로는 절대 링크하지 않는다. */
export const ALLOWED_ADMIN_HOSTS: readonly string[] = [
  'deudda.com',
  'www.deudda.com',
  'localhost',
  '127.0.0.1',
];

/**
 * Recovery 링크·부가정보를 붙일 알림 kind. 이 목록 밖의 알림은 **손대지 않는다** —
 * 기존 운영 알림(정산·문의·결제 등)의 Slack/이메일 모양이 달라지면 안 된다.
 */
export const RECOVERY_LINK_KINDS: readonly string[] =
  ['brand_player_down', 'brand_player_recovered'];

/** 이 알림에 Recovery Console 링크를 붙여도 되는가. */
export function shouldAttachRecovery(kind: string | null | undefined): boolean {
  return !!kind && RECOVERY_LINK_KINDS.includes(kind);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * base URL 을 정규화한다. 허용 호스트가 아니거나 형식이 틀리면 null.
 * 반환값은 항상 origin 만 남긴 형태다(경로·쿼리·해시·인증정보 전부 버린다).
 */
export function normalizeAdminBaseUrl(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLocal(u.hostname))) return null;
  // URL 안에 박아 넣은 자격증명(https://user:pass@host)은 통째로 거부한다.
  if (u.username || u.password) return null;
  if (!ALLOWED_ADMIN_HOSTS.includes(u.hostname)) return null;
  return u.origin;
}

function isLocal(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1';
}

/**
 * 특정 매장을 미리 선택한 Recovery Console 링크.
 *
 * 링크는 화면을 열어줄 뿐이다 — 클릭만으로 복구 명령이 나가지 않는다.
 * (Slack interactive action 은 이번 단계에서 구현하지 않는다.)
 */
export function buildRecoveryConsoleUrl(
  baseUrl: string | null | undefined,
  storeUserId: string | null | undefined,
): string | null {
  const origin = normalizeAdminBaseUrl(baseUrl);
  if (!origin) return null;
  const id = (storeUserId ?? '').trim();
  if (!UUID_RE.test(id)) return null;
  return `${origin}/admin?tab=${RECOVERY_CONSOLE_TAB}&store=${id}`;
}

/**
 * 같은 링크의 **앱 내부 경로** 버전 (Web Push 의 url 필드용).
 * origin 이 없으므로 open redirect 여지가 없다. UUID 검증은 동일하게 건다.
 */
export function recoveryConsolePath(storeUserId: string | null | undefined): string | null {
  const id = (storeUserId ?? '').trim();
  if (!UUID_RE.test(id)) return null;
  return `/admin?tab=${RECOVERY_CONSOLE_TAB}&store=${id}`;
}
