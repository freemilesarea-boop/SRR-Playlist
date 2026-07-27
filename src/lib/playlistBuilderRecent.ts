/**
 * playlistBuilderRecent — Phase AI-PLAYLIST-ADMIN-UX-2
 *
 * Playlist Builder "최근 사용 조건"을 localStorage 에 저장(신규 DB 테이블 없음).
 *   operatorRecent 패턴을 재사용: 사용자 범위 비가역 해시 Key, 최소 데이터만 저장,
 *   최신순·중복제거·최대개수. 여기에 version 필드 + 검증 + 실패 시 Fail-Safe 초기화 추가.
 *
 * 저장 금지: 개인정보, Secret, Track 전체 목록. Preset 조건(정책 요약)만 저장한다.
 */
import type { PresetConditions } from './playlistPresets';

/** 저장 스키마 버전 — 형식 변경 시 올린다(구버전은 로드시 폐기). */
export const RECENT_VERSION = 1;
export const MAX_RECENT_CONDITIONS = 6;
const KEY_PREFIX = 'plb.recent.';

/** 저장되는 최근 조건 1건. Track 목록은 저장하지 않는다. */
export interface RecentCondition {
  v: number; // version
  storeKey: string;
  label: string;
  conditions: PresetConditions;
}

/** userId → 비가역 짧은 해시(djb2 → base36). Key 에 원문 식별자를 남기지 않는다. */
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

function isConditions(x: unknown): x is PresetConditions {
  if (!x || typeof x !== 'object') return false;
  const c = x as Record<string, unknown>;
  return (
    Array.isArray(c.includeGenres) &&
    Array.isArray(c.excludeGenres) &&
    (c.vocal === 'any' || c.vocal === 'vocal' || c.vocal === 'instrumental') &&
    typeof c.excludeExplicit === 'boolean' &&
    typeof c.excludeBlocked === 'boolean'
  );
}

/** 저장 가능한 최소 형태로 정규화(여분 필드 제거). */
export function sanitizeRecentCondition(item: RecentCondition): RecentCondition {
  const c = item.conditions;
  return {
    v: RECENT_VERSION,
    storeKey: String(item.storeKey ?? ''),
    label: String(item.label ?? ''),
    conditions: {
      bpmMin: numOrNull(c.bpmMin),
      bpmMax: numOrNull(c.bpmMax),
      energyMin: numOrNull(c.energyMin),
      energyMax: numOrNull(c.energyMax),
      vocal: c.vocal,
      fitMin: numOrNull(c.fitMin),
      includeGenres: (c.includeGenres ?? []).map(String),
      excludeGenres: (c.excludeGenres ?? []).map(String),
      excludeExplicit: !!c.excludeExplicit,
      excludeBlocked: !!c.excludeBlocked,
      excludePenalized: !!c.excludePenalized,
      targetDurationSec: numOrNull(c.targetDurationSec),
      candidateSort: c.candidateSort === 'adaptive' ? 'adaptive' : 'fit',
    },
  };
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** 순수: 최신순·중복제거(storeKey+label 기준)·최대개수 반영. */
export function computeNextRecent(prev: RecentCondition[], item: RecentCondition): RecentCondition[] {
  const key = (r: RecentCondition) => `${r.storeKey}|${r.label}`;
  const k = key(item);
  const deduped = prev.filter((r) => key(r) !== k);
  return [item, ...deduped].slice(0, MAX_RECENT_CONDITIONS);
}

/** 저장 목록 로드. 파싱 실패/버전 불일치/형식 오류 시 Fail-Safe 로 빈 배열. */
export function loadRecentConditions(userId: string | null | undefined): RecentCondition[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentCondition =>
          !!x &&
          typeof x === 'object' &&
          (x as RecentCondition).v === RECENT_VERSION && // 버전 불일치 항목 폐기
          typeof (x as RecentCondition).storeKey === 'string' &&
          typeof (x as RecentCondition).label === 'string' &&
          isConditions((x as RecentCondition).conditions),
      )
      .slice(0, MAX_RECENT_CONDITIONS);
  } catch {
    return [];
  }
}

export function pushRecentCondition(
  userId: string | null | undefined,
  item: RecentCondition,
): RecentCondition[] {
  const next = computeNextRecent(loadRecentConditions(userId), sanitizeRecentCondition(item));
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(next));
  } catch {
    /* ignore quota / unavailable */
  }
  return next;
}

export function clearRecentConditions(userId: string | null | undefined): void {
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    /* ignore */
  }
}
