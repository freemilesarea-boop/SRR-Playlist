/**
 * 매장 관제 heartbeat 를 이 화면에서 보낼지 — GlobalStoreHeartbeat 의 순수 판정.
 */
const BLOCKED_PATH_PREFIXES = [
  '/admin',
  '/artist',
  '/curator',
  '/sales',
  '/sales-partners',
  '/auth',
  '/login',
  '/payment',
];

const STORE_PLAYER_PATH = '/business/player';

export function isHeartbeatBlockedPath(pathname: string): boolean {
  return BLOCKED_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export interface StoreHeartbeatGateInput {
  userId: string | null;
  accountType?: string | null;
  subscriptionType?: string | null;
  membershipTier?: string | null;
  businessMode: boolean;
  pathname: string;
  hasTrack: boolean;
}

export function shouldSendStoreHeartbeat(i: StoreHeartbeatGateInput): boolean {
  if (!i.userId) return false;
  const isStoreCandidate =
    i.accountType === 'business' ||
    i.subscriptionType === 'business' ||
    i.membershipTier === 'business' ||
    i.businessMode;
  if (!isStoreCandidate) return false;
  if (isHeartbeatBlockedPath(i.pathname)) return false;
  return i.hasTrack || i.pathname === STORE_PLAYER_PATH;
}
