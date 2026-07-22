// Phase BRAND-PLAYER-UX-5 — 재생 시간 포맷 + 진행률 계산(순수 함수).
// NaN/Infinity/음수/미확정 방어. 1시간 이상 음원 h:mm:ss 표시.

/** 초 → "m:ss" 또는 "h:mm:ss". 유효하지 않으면 "0:00". */
export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** duration 미확정("--:--") 여부. */
export function isDurationPending(duration: number): boolean {
  return !Number.isFinite(duration) || duration <= 0;
}

/** 진행률 0..1 (0 나누기/역전/범위 방어). */
export function playbackProgress(currentTime: number, duration: number): number {
  if (!Number.isFinite(currentTime) || currentTime < 0) return 0;
  if (isDurationPending(duration)) return 0;
  const r = currentTime / duration;
  if (!Number.isFinite(r)) return 0;
  return Math.min(1, Math.max(0, r));
}

/** 진행률(0..1) + duration → 초 위치(seek 대상). 범위 clamp. */
export function progressToSeconds(ratio: number, duration: number): number {
  if (isDurationPending(duration)) return 0;
  const r = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  return Math.min(duration, Math.max(0, r * duration));
}
