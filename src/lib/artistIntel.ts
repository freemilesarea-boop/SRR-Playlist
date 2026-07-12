/**
 * artistIntel — Artist Intelligence 순수 로직 (지속시간/비율/지원매트릭스/정합성).
 *
 * 퍼널 전환/단조 검증은 memberFunnel.ts 의 computeFunnel/finalConversion/
 * monotonicWarnings 를 재사용한다(동일 FunnelStep 구조). 여기서는 아티스트 전용
 * 표시·요약·지원여부 순수 함수만 둔다(단위 테스트 대상). 비율 0~100, NaN/Infinity 금지.
 */
import type { ArtistSummary, ArtistBreakdown } from './adminApi';

/** 초 → "m:ss" (트랙 평균 길이). */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '—';
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

/** 시간(h) 표시 — 큰 값은 일 단위. */
export function formatHours(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(h) || h < 0) return '—';
  if (h >= 48) return `${(h / 24).toFixed(1)}일`;
  return `${h.toFixed(1)}시간`;
}

/** ₩ 정수. */
export function formatKRW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '₩0';
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

/** 0~100 비율(%) — 분모 0 → null (NaN/Infinity 금지). */
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

/** 승인율 = 승인 / (승인+대기+거절). */
export function approvalRate(s: ArtistSummary): number | null {
  return pct(s.approved, s.total_artists);
}

/** QC 통과율 = QC approved / (approved + pending). */
export function qcPassRate(b: ArtistBreakdown): number | null {
  return pct(b.qc.approved, b.qc.approved + b.qc.pending);
}

/** 스트리밍 발생 아티스트 비율 = streamed / (streamed + no_stream). */
export function streamingCoverage(b: ArtistBreakdown): number | null {
  return pct(b.streaming.streamed_artists, b.streaming.streamed_artists + b.streaming.no_stream_artists);
}

/** 정합성 경고 — 아티스트 퍼널 단조 위반 외 요약 수준 체크. */
export function artistIntegrityWarnings(s: ArtistSummary): string[] {
  const w: string[] = [];
  if (s.approved > s.total_artists) w.push(`승인 ${s.approved} > 총 아티스트 ${s.total_artists}`);
  if (s.first_upload > s.approved) w.push(`업로드 ${s.first_upload} > 승인 ${s.approved}`);
  if (s.distributed > s.first_upload) w.push(`유통 ${s.distributed} > 업로드 ${s.first_upload}`);
  if (s.streaming > s.distributed) w.push(`스트리밍 ${s.streaming} > 유통 ${s.distributed}`);
  if (s.settled > s.streaming) w.push(`정산 ${s.settled} > 스트리밍 ${s.streaming}`);
  if (s.settle_paid > s.settled) w.push(`지급 ${s.settle_paid} > 정산 ${s.settled}`);
  return w;
}

/** 지원 여부 매트릭스 라벨. */
export const ARTIST_SUPPORT_LABELS: Record<string, string> = {
  ai_score: 'AI/QC Score', qc_history: 'QC History', playlist_exposure: 'Playlist Exposure',
  recommendation_score: '추천 알고리즘 점수', distribution_history: 'Distribution History',
  genre_history: 'Genre History', promotion: 'Promotion', country: '국가',
};

export function artistSupportMatrix(support: Record<string, boolean> | undefined): Array<{ key: string; label: string; supported: boolean }> {
  const s = support ?? {};
  return Object.keys(ARTIST_SUPPORT_LABELS).map((key) => ({
    key, label: ARTIST_SUPPORT_LABELS[key], supported: s[key] === true,
  }));
}
