/**
 * chunkRecoveryPolicy.ts — chunk 로드 실패(배포 직후 옛 hash 404) 자동 복구 정책.
 *
 * 배경 (프로덕션 장애):
 *   무인 매장은 브라우저를 며칠씩 열어둔다. 그 사이 새 배포가 나가면 옛 index.html 이
 *   참조하던 chunk 가 404 가 되고, 라우트가 영영 못 뜬다. 지금까지는 캐시를 비우고
 *   **딱 1회** 리로드한 뒤, 그래도 실패하면 throw → 화면 전체가 죽고(=상위 ErrorBoundary
 *   없음) 오디오 엘리먼트까지 사라져 매장이 무음이 된다. 아무도 없는 매장에서는
 *   그 상태가 영업 종료까지 지속된다.
 *
 * 정책:
 *   • 첫 실패는 지금처럼 즉시 캐시 정리 + 리로드 (개인/매장 공통).
 *   • 개인 사용자는 1회 실패 후 포기 — 사람이 보고 새로고침할 수 있다(기존 동작 유지).
 *   • 매장/브랜드 플레이어는 포기하지 않고 60초 간격으로 재시도한다. 단,
 *     - 지금 실제로 소리가 나고 있으면 리로드하지 않는다. 라우트 하나가 못 떠도
 *       전역 플레이어가 살아 음악은 계속 나오는 상태이므로, 리로드는 되레 음악을 끊고
 *       자동재생 정책에 막힐 위험만 만든다.
 *     - 무한 루프 방지를 위해 빌드당 상한(MAX_ATTEMPTS)을 둔다.
 */

/** 매장 모드에서 chunk 복구 리로드를 시도할 최대 횟수(빌드당). */
export const MAX_ATTEMPTS = 5;
/** 매장 모드 재시도 간격. */
export const RETRY_DELAY_MS = 60_000;

export interface ChunkRecoveryInput {
  /** 이 빌드에서 이미 실행한 복구 리로드 횟수. */
  attempts: number;
  /** 매장/브랜드 플레이어(무인 키오스크) 모드인가. */
  businessMode: boolean;
  /** 오디오가 실제로 소리를 내고 있는가. */
  audioActive: boolean;
  /** 마지막 복구 리로드 시각(ms). 아직 없으면 null. */
  lastAttemptAt: number | null;
  /** 현재 시각(ms). */
  now: number;
}

export type ChunkRecoveryDecision =
  /** 지금 캐시 정리 + 리로드. */
  | { action: 'reload' }
  /** delayMs 뒤에 다시 판단. */
  | { action: 'wait'; delayMs: number }
  /** 더 시도하지 않고 상위 ErrorBoundary 로 전달. */
  | { action: 'give-up' };

export function decideChunkRecovery(i: ChunkRecoveryInput): ChunkRecoveryDecision {
  // 첫 실패 — 기존과 동일하게 즉시 복구 시도.
  if (i.attempts <= 0) return { action: 'reload' };

  // 개인 사용자: 1회 복구했는데도 실패 → 사람이 판단하도록 넘긴다.
  if (!i.businessMode) return { action: 'give-up' };

  // 매장: 상한까지는 계속 되살린다.
  if (i.attempts >= MAX_ATTEMPTS) return { action: 'give-up' };

  // 소리가 나고 있으면 리로드가 곧 음악 중단이다 — 기다린다.
  if (i.audioActive) return { action: 'wait', delayMs: RETRY_DELAY_MS };

  const elapsed = i.lastAttemptAt === null ? Infinity : i.now - i.lastAttemptAt;
  if (elapsed >= RETRY_DELAY_MS) return { action: 'reload' };
  return { action: 'wait', delayMs: RETRY_DELAY_MS - elapsed };
}
