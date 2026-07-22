// Phase BRAND-PLAYER-UX-5 — Queue 검색 + 섹션 구분(순수 함수).
// 검색/섹션은 항상 "원본 Queue Index"를 함께 보존한다 → 선택 시 jumpTo(originalIndex).
// Filtered Index ≠ Original Index. 새로운 Queue 를 만들지 않는다(현재 Queue 범위 client-side).
import type { TrackRow } from '@/types/db';

export interface QueueSearchItem {
  track: TrackRow;
  /** 원본 usePlayerStore.queue 배열의 index (jumpTo 대상). */
  originalIndex: number;
}

/** 제목/아티스트(선택적으로 앨범) 대상, 대소문자·앞뒤공백 무시. 민감정보는 검색하지 않는다. */
export function searchQueue(queue: TrackRow[], rawTerm: string): QueueSearchItem[] {
  const all: QueueSearchItem[] = queue.map((track, originalIndex) => ({ track, originalIndex }));
  const term = rawTerm.trim().toLowerCase();
  if (term === '') return all;
  return all.filter(({ track }) => {
    const title = (track.title ?? '').toLowerCase();
    const artist = (track.artist ?? '').toLowerCase();
    const album = ((track as { album_name?: string | null }).album_name ?? '').toLowerCase();
    return title.includes(term) || artist.includes(term) || album.includes(term);
  });
}

export interface QueueSections {
  current: QueueSearchItem | null;
  /** 현재 이후 재생 예정(현재 재생 정책 순서 유지). 각 항목은 원본 index 보존. */
  upcoming: QueueSearchItem[];
}

/**
 * 현재/다음 재생 섹션 구성.
 * shuffle 이 활성이고 shuffleOrder 가 유효하면 실제 재생 순서(shuffleOrder)를 따른다.
 * 아니면 선형 배열 순서. "최근 재생"은 Player 에 History 가 없으므로 여기서 만들지 않는다.
 */
export function buildQueueSections(
  queue: TrackRow[],
  index: number,
  shuffle: boolean,
  shuffleOrder: number[],
): QueueSections {
  if (queue.length === 0 || index < 0 || index >= queue.length) {
    return { current: null, upcoming: [] };
  }
  const current: QueueSearchItem = { track: queue[index], originalIndex: index };

  let order: number[];
  if (shuffle && shuffleOrder.length === queue.length) {
    const pos = shuffleOrder.indexOf(index);
    order = pos === -1
      ? seq(queue.length, index)                 // shuffleOrder 에 없으면 선형 폴백
      : shuffleOrder.slice(pos + 1);             // 현재 다음부터
  } else {
    order = seq(queue.length, index);
  }
  const upcoming = order
    .filter((i) => i >= 0 && i < queue.length && i !== index)
    .map((i) => ({ track: queue[i], originalIndex: i }));
  return { current, upcoming };
}

/** index 다음부터 끝까지의 선형 순서. */
function seq(len: number, index: number): number[] {
  const out: number[] = [];
  for (let i = index + 1; i < len; i++) out.push(i);
  return out;
}
