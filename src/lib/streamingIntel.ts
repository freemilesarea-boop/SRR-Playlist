/**
 * streamingIntel — Streaming Intelligence 순수 로직 (완료율/스킵율/시간 포맷/지원매트릭스).
 *
 * Store/Fleet/Playback Health · Quality Score 는 기존 WEB-OBS RPC 값을 그대로
 * 사용하고 재계산하지 않는다(중복 구현 금지). 여기서는 전역 재생 스냅샷의 파생
 * 비율·표시·지원여부만 계산한다(단위 테스트 대상). 비율 0~100, NaN/Infinity 금지.
 */
import type { StreamingSummary } from './adminApi';

/** 0~100 비율 — 분모 0 → null (NaN/Infinity 금지). */
export function pct(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  const r = (numerator / denominator) * 100;
  if (!Number.isFinite(r)) return null;
  return Math.min(100, Math.max(0, Math.round(r * 10) / 10));
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

export function formatNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('ko-KR');
}

/** 초 → "H시간 M분" / "M분 S초". 재생시간 표시. */
export function formatSeconds(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  if (s >= 3600) { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return `${h}시간 ${m}분`; }
  if (s >= 60) { const m = Math.floor(s / 60); const r = s % 60; return `${m}분 ${r}초`; }
  return `${s}초`;
}

/** 완료율 = play_complete / play_start. */
export function completionRate(s: StreamingSummary): number | null {
  return pct(s.pb_complete, s.pb_start);
}

/** 스킵율 = skip / play_start. */
export function skipRate(s: StreamingSummary): number | null {
  return pct(s.pb_skip, s.pb_start);
}

/** 재생 성공(=시작 대비 완료) 색상 톤. */
export function rateTone(n: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (n == null) return 'neutral';
  if (n >= 80) return 'success';
  if (n >= 50) return 'warning';
  return 'danger';
}

/** 정합성 경고 — 완료·스킵 ≤ 시작, 온라인 ≤ 총 Player. */
export function streamingIntegrityWarnings(s: StreamingSummary): string[] {
  const w: string[] = [];
  if (s.pb_complete > s.pb_start) w.push(`재생 완료 ${s.pb_complete} > 재생 시작 ${s.pb_start}`);
  if (s.pb_skip > s.pb_start) w.push(`스킵 ${s.pb_skip} > 재생 시작 ${s.pb_start}`);
  if (s.online_players > s.total_players) w.push(`온라인 ${s.online_players} > 총 Player ${s.total_players}`);
  return w;
}

/** support[key] === true 인지. */
export function isSupported(support: Record<string, boolean> | undefined, key: string): boolean {
  return (support ?? {})[key] === true;
}

// 데이터 없음(미수집 텔레메트리) 항목 — UI 배지/안내용.
export const UNSUPPORTED_TELEMETRY: Array<{ key: string; label: string }> = [
  { key: 'streaming_quality', label: 'Streaming Quality Score' },
  { key: 'buffer', label: 'Buffer' },
  { key: 'crossfade', label: 'Crossfade' },
  { key: 'ttfa', label: 'Time To First Audio' },
  { key: 'decoder_error', label: 'Decoder/Media/Audio Error' },
  { key: 'queue', label: 'Queue (Size/Delay/Empty/Recovery)' },
  { key: 'scheduler', label: 'Scheduler Delay' },
  { key: 'recovery', label: 'Recovery' },
  { key: 'store_playback', label: 'Store 단위 재생/품질' },
];

/** 미지원(데이터 없음) 항목 목록 — support 매트릭스 기반. */
export function unsupportedList(support: Record<string, boolean> | undefined): string[] {
  return UNSUPPORTED_TELEMETRY.filter((t) => !isSupported(support, t.key)).map((t) => t.label);
}
