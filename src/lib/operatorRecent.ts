/**
 * operatorRecent.ts — Phase ADMIN-UX-IMPLEMENT-2
 *
 * 운영자 "최근 사용 화면"을 localStorage 에 저장한다.
 *   • 저장 데이터는 최소(id/label/path)만 — 개인정보(이메일·Store ID 원문 등) 저장 금지.
 *   • Key 는 사용자 범위로 분리하되, userId 원문을 Key 에 쓰지 않고 비가역 해시로 축약.
 *   • 최신순, 중복 제거, 최대 MAX_RECENT.
 * 순수 로직 위주(유닛 테스트 용이). localStorage 접근은 try/catch 로 안전 처리.
 */
export interface RecentItem {
  id: string;
  label: string;
  path: string;
}

export const MAX_RECENT = 8;
const KEY_PREFIX = 'ops.recent.';

/** userId → 비가역 짧은 해시(djb2 → base36). Key 에 원문 식별자를 남기지 않기 위함. */
export function hashUserKey(userId: string | null | undefined): string {
  if (!userId) return 'anon';
  let h = 5381;
  for (let i = 0; i < userId.length; i++) {
    h = ((h << 5) + h + userId.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function storageKey(userId: string | null | undefined): string {
  return KEY_PREFIX + hashUserKey(userId);
}

/** 순수: 기존 목록에 새 항목을 최신순·중복제거·최대개수로 반영한 새 배열 반환. */
export function computeNextRecent(prev: RecentItem[], item: RecentItem): RecentItem[] {
  const deduped = prev.filter((r) => r.id !== item.id);
  return [item, ...deduped].slice(0, MAX_RECENT);
}

/** 저장 가능한 최소 형태로 정규화(여분 필드 제거 — 민감정보 저장 방지). */
export function sanitizeRecent(item: RecentItem): RecentItem {
  return { id: String(item.id), label: String(item.label), path: String(item.path) };
}

export function loadRecent(userId: string | null | undefined): RecentItem[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is RecentItem =>
        !!x && typeof x === 'object' &&
        typeof (x as RecentItem).id === 'string' &&
        typeof (x as RecentItem).label === 'string' &&
        typeof (x as RecentItem).path === 'string')
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function pushRecent(userId: string | null | undefined, item: RecentItem): RecentItem[] {
  const next = computeNextRecent(loadRecent(userId), sanitizeRecent(item));
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore quota / unavailable */
  }
  return next;
}

export function clearRecent(userId: string | null | undefined): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}
