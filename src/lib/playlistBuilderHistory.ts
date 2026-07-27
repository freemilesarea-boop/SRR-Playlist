/**
 * playlistBuilderHistory.ts — Phase AI-PLAYLIST-ADMIN-UX-1
 *
 * PURE undo/redo history + unsaved-changes detection for the Playlist Builder
 * (no network, no DOM, fully unit-testable). Frontend edit-state only —
 * NOTHING here writes to the DB. The builder keeps an in-memory draft; the DB
 * is touched only on explicit admin Save (handled by the service layer).
 *
 * 설계:
 *   • History<T> — 불변 스냅샷 스택. push 는 redo 스택을 비운다(표준 편집 의미론).
 *   • 스택 크기 상한(HISTORY_LIMIT)으로 메모리 폭주 방지 — 초과 시 가장 오래된 것 폐기.
 *   • unsaved 판정은 "마지막 저장 스냅샷" 대비 얕은-순서 비교(순수 함수).
 */

/** 되돌리기/다시하기 스택. present 는 현재 상태. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

/** 히스토리 스택 상한(present 제외 past 최대 길이). */
export const HISTORY_LIMIT = 100;

/** 초기 상태로 히스토리 생성. */
export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, future: [] };
}

/**
 * 새 상태를 push. 현재 present 를 past 로 밀고 future 를 비운다.
 * next 가 참조상 동일하면 no-op(불필요한 히스토리 오염 방지).
 */
export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h;
  const past = [...h.past, h.present];
  // 상한 초과 시 앞쪽(가장 오래된) 폐기.
  const trimmed = past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past;
  return { past: trimmed, present: next, future: [] };
}

export function canUndo<T>(h: History<T>): boolean {
  return h.past.length > 0;
}

export function canRedo<T>(h: History<T>): boolean {
  return h.future.length > 0;
}

/** 한 단계 되돌리기. 불가하면 그대로 반환. */
export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  return {
    past: h.past.slice(0, -1),
    present: previous,
    future: [h.present, ...h.future],
  };
}

/** 한 단계 다시하기. 불가하면 그대로 반환. */
export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const next = h.future[0];
  return {
    past: [...h.past, h.present],
    present: next,
    future: h.future.slice(1),
  };
}

/**
 * 히스토리를 현재 present 기준으로 초기화(저장 직후 등).
 * past/future 를 비워 "깨끗한 편집 시작점"으로 만든다.
 */
export function resetHistory<T>(h: History<T>): History<T> {
  return { past: [], present: h.present, future: [] };
}

// =============================================================================
// Unsaved changes
// =============================================================================

/**
 * 저장 스냅샷 대비 미저장 변경 여부. id 배열의 순서까지 비교한다.
 * (트랙 목록/순서 편집 감지용 — 순서 변경도 unsaved 로 잡아야 한다.)
 */
export function hasUnsavedTrackChanges(savedIds: string[], currentIds: string[]): boolean {
  if (savedIds.length !== currentIds.length) return true;
  for (let i = 0; i < savedIds.length; i++) {
    if (savedIds[i] !== currentIds[i]) return true;
  }
  return false;
}

/**
 * 임의 직렬화 가능한 값의 미저장 변경 여부(메타데이터 폼 등).
 * 안정적인 JSON 비교 — 순환 참조 없는 평범한 객체 대상.
 */
export function hasUnsavedValue<T>(saved: T, current: T): boolean {
  if (Object.is(saved, current)) return false;
  try {
    return JSON.stringify(saved) !== JSON.stringify(current);
  } catch {
    // 직렬화 불가하면 보수적으로 "변경됨" 처리.
    return true;
  }
}
