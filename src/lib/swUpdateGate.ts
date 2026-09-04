/**
 * swUpdateGate.ts — 서비스워커 자동 리로드 게이트.
 *
 * 배경: 새 빌드가 뜨면 서비스워커가 페이지를 스스로 리로드한다(main.tsx). 일반 사용자에겐
 *   맞는 동작이지만 24시간 무인 매장에서는 **배포 한 번 = 전 매장 음악 중단**이 된다.
 *   실제로 프로덕션에서 배포 직후 두 매장이 동시에 재생목록 1번 곡으로 리셋된 뒤
 *   소리가 나지 않는 상태가 확인됐다(리로드 직후에는 사용자 제스처가 없어 브라우저
 *   자동재생 정책에 막힌다).
 *
 * 정책:
 *   • 매장 모드에서 **실제로 재생 중이면** 리로드를 미룬다.
 *   • 재생이 멈춰 있으면(이미 문제 상태이거나 영업 종료) 즉시 적용한다 — 리로드가 오히려 복구다.
 *   • 무한정 미루면 키오스크가 옛 빌드에 갇히므로 상한을 둔다. 상한을 넘기면 적용하되,
 *     자동재생이 막히는 경우 전체화면 안내(PlaybackBlockedOverlay)가 뜨므로 눈에 보인다.
 *   • 운영자가 원할 때 즉시 적용할 수 있는 수동 경로(지금 적용)도 함께 제공한다.
 */

/** 재생 중이어도 이 시간을 넘기면 적용한다 — 키오스크가 옛 빌드에 영구히 갇히지 않도록. */
export const MAX_DEFER_MS = 12 * 60 * 60 * 1000; // 12시간

export interface ReloadGateInput {
  /** 매장/브랜드 플레이어 모드인가. */
  businessMode: boolean;
  /**
   * 오디오가 **실제로** 소리를 내고 있는가.
   * store.playing(재생 의도)을 쓰면 오류로 멈춘 플레이어도 true 라 리로드가 영원히
   * 미뤄진다 — 정작 리로드가 필요한 상태를 못 고치게 된다.
   */
  audioActive: boolean;
  /** 처음 리로드를 미룬 시각(ms). 아직 미룬 적 없으면 null. */
  deferredSince: number | null;
  /** 현재 시각(ms). */
  now: number;
}

/**
 * 지금 리로드를 미뤄야 하는가.
 *
 * 매장 모드 + 재생 중일 때만 미룬다. 일반 사용자는 기존처럼 즉시 리로드된다.
 */
export function shouldDeferReload(i: ReloadGateInput): boolean {
  if (!i.businessMode || !i.audioActive) return false;
  if (i.deferredSince !== null && i.now - i.deferredSince >= MAX_DEFER_MS) return false;
  return true;
}

/** 미뤄둔 업데이트가 상한에 도달했는가 (안내 문구용). */
export function deferExpired(deferredSince: number | null, now: number): boolean {
  return deferredSince !== null && now - deferredSince >= MAX_DEFER_MS;
}

/* ────────────────────────────────────────────────────────────────────────────
 * "지금 적용" 핸들러 registry.
 * 실제 리로드 로직은 main.tsx 가 소유한다(SW 등록과 같은 자리). UI 컴포넌트가
 * main.tsx 를 직접 import 하면 main → App → ... → 컴포넌트 → main 순환이 생기므로
 * 여기에 등록해서 우회한다.
 * ──────────────────────────────────────────────────────────────────────────── */
let applyNowFn: (() => void) | null = null;

/** main.tsx 가 부팅 시 1회 등록. */
export function registerApplyUpdate(fn: () => void): void {
  applyNowFn = fn;
}

/** 운영자가 "지금 적용" 을 눌렀을 때. 등록 전이면 안전하게 no-op. */
export function applyPendingUpdateNow(): void {
  applyNowFn?.();
}
