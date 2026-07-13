/**
 * playlistExperiment — Playlist A/B Experiment 순수 로직 (Phase AI-PLAYLIST-2).
 *
 * Playlist 를 AI 가 바로 교체하지 않고 **실험 → 비교 → 검증 → 승인 → 확산** 으로 안전하게
 * 발전시킨다. 여기서는 실제 재생 이벤트 KPI(playback_events_v2 집계)로 A/B 를 비교하고
 * 승자를 판정하는 순수 로직만 둔다(단위 테스트 대상). **자동 교체 없음.**
 *
 * 원칙: Evidence 없는 Winner 없음 · Sample 부족(<MIN)이면 '비교 불가(insufficient)' ·
 * 존재하는 KPI 만(양쪽 0인 이벤트성 지표는 '데이터 없음' 제외) · 점수/비율 clamp · NaN 금지.
 */
import { clampPct } from './playlistIntel';

/* ── 입력(admin_playlist_compare 행) ─────────────────────────────────── */
export interface CompareKpi {
  playlistId: string | null; title: string | null;
  events: number; skips: number; skip_rate: number | null; completion_rate: number | null;
  avg_listen_seconds: number | null; likes: number; replays: number; unique_tracks: number;
}

export const MIN_SAMPLE = 30; // 신뢰할 만한 최소 이벤트 수(양쪽 모두)

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/* ── KPI 비교 ─────────────────────────────────────────────────────── */
export type MetricWinner = 'a' | 'b' | 'tie' | 'na';   // na = 데이터 없음(양쪽 미지원)
export interface MetricCompare {
  key: string; label: string; direction: 'higher' | 'lower';
  aValue: number | null; bValue: number | null; winner: MetricWinner; diff: number | null;
}

interface MetricDef { key: string; label: string; direction: 'higher' | 'lower'; get: (k: CompareKpi) => number | null; countMetric?: boolean }
const METRICS: MetricDef[] = [
  { key: 'completion_rate', label: '완주율', direction: 'higher', get: (k) => clampPct(k.completion_rate) },
  { key: 'skip_rate', label: 'Skip율', direction: 'lower', get: (k) => clampPct(k.skip_rate) },
  { key: 'avg_listen_seconds', label: '평균 청취(초)', direction: 'higher', get: (k) => (isNum(k.avg_listen_seconds) ? Math.round(k.avg_listen_seconds * 10) / 10 : null) },
  { key: 'unique_ratio', label: '고유 트랙 비율', direction: 'higher', get: (k) => (k.events > 0 ? Math.round((k.unique_tracks / k.events) * 1000) / 10 : null) },
  { key: 'likes', label: 'Like 수', direction: 'higher', get: (k) => k.likes, countMetric: true },
  { key: 'replays', label: 'Replay 수', direction: 'higher', get: (k) => k.replays, countMetric: true },
];

function metricWinner(a: number | null, b: number | null, direction: 'higher' | 'lower', countMetric: boolean): { winner: MetricWinner; diff: number | null } {
  // 이벤트성 지표(likes/replays)가 양쪽 0 이면 데이터 없음 처리(승자 판정 제외).
  if (countMetric && (a ?? 0) === 0 && (b ?? 0) === 0) return { winner: 'na', diff: null };
  if (a == null && b == null) return { winner: 'na', diff: null };
  if (a == null) return { winner: 'b', diff: null };
  if (b == null) return { winner: 'a', diff: null };
  if (a === b) return { winner: 'tie', diff: 0 };
  const higherWins = direction === 'higher';
  const aBetter = higherWins ? a > b : a < b;
  return { winner: aBetter ? 'a' : 'b', diff: Math.round((a - b) * 10) / 10 };
}

export function compareKpis(a: CompareKpi, b: CompareKpi): MetricCompare[] {
  return METRICS.map((m) => {
    const av = m.get(a); const bv = m.get(b);
    const { winner, diff } = metricWinner(av, bv, m.direction, Boolean(m.countMetric));
    return { key: m.key, label: m.label, direction: m.direction, aValue: av, bValue: bv, winner, diff };
  });
}

/* ── Winner 판정 ─────────────────────────────────────────────────── */
export type ExperimentWinner = 'a' | 'b' | 'tie' | 'insufficient';
export interface WinnerResult {
  winner: ExperimentWinner;
  aWins: number; bWins: number; comparable: number;
  reason: string; sampleOk: boolean;
}

/**
 * Sample 부족(양쪽 중 하나라도 MIN_SAMPLE 미만) → insufficient(비교 불가).
 * 그 외에는 비교 가능 지표(na/tie 제외)에서 더 많이 이긴 쪽이 승자. 동수면 tie.
 */
export function decideWinner(metrics: MetricCompare[], eventsA: number, eventsB: number): WinnerResult {
  const sampleOk = eventsA >= MIN_SAMPLE && eventsB >= MIN_SAMPLE;
  if (!sampleOk) {
    return { winner: 'insufficient', aWins: 0, bWins: 0, comparable: 0, sampleOk: false,
      reason: `Sample 부족(A ${eventsA}, B ${eventsB} · 최소 ${MIN_SAMPLE}) — 비교 불가` };
  }
  const decisive = metrics.filter((m) => m.winner === 'a' || m.winner === 'b');
  const aWins = decisive.filter((m) => m.winner === 'a').length;
  const bWins = decisive.filter((m) => m.winner === 'b').length;
  if (decisive.length === 0) {
    return { winner: 'tie', aWins, bWins, comparable: 0, sampleOk: true, reason: '비교 가능한 지표 차이 없음' };
  }
  const winner: ExperimentWinner = aWins > bWins ? 'a' : bWins > aWins ? 'b' : 'tie';
  const label = winner === 'a' ? 'A' : winner === 'b' ? 'B' : '무승부';
  return { winner, aWins, bWins, comparable: decisive.length, sampleOk: true,
    reason: winner === 'tie' ? `동률(A ${aWins} · B ${bWins})` : `${label} 우세 (지표 ${Math.max(aWins, bWins)}/${decisive.length})` };
}

/* ── Winner Evidence (왜 이겼는지; 근거 공개) ─────────────────────────── */
export interface ExperimentEvidence { kpi: string; label: string; aValue: number | null; bValue: number | null; winner: MetricWinner; diff: number | null }
export function buildWinnerEvidence(metrics: MetricCompare[]): ExperimentEvidence[] {
  return metrics
    .filter((m) => m.winner === 'a' || m.winner === 'b')
    .map((m) => ({ kpi: m.key, label: m.label, aValue: m.aValue, bValue: m.bValue, winner: m.winner, diff: m.diff }));
}

/** 두 compare 행 → {a,b} 매핑(순서 무관, id 로 정렬). rows 가 1개/0개면 null 채움. */
export function alignRows(rows: CompareKpi[], aId: string | null, bId: string | null): { a: CompareKpi | null; b: CompareKpi | null } {
  const a = rows.find((r) => r.playlistId === aId) ?? null;
  const b = rows.find((r) => r.playlistId === bId) ?? null;
  return { a, b };
}

/* ── Learning 집계(완료 실험의 승자 빈도; 참고용) ───────────────────────── */
export interface ExperimentLike { winner: ExperimentWinner | null; playlistATitle: string | null; playlistBTitle: string | null; status: string }
export interface ExperimentLearning { playlistTitle: string; wins: number; appearances: number }
export function aggregateExperimentLearning(experiments: ExperimentLike[]): ExperimentLearning[] {
  const map = new Map<string, ExperimentLearning>();
  const bump = (title: string, won: boolean) => {
    let s = map.get(title);
    if (!s) { s = { playlistTitle: title, wins: 0, appearances: 0 }; map.set(title, s); }
    s.appearances += 1; if (won) s.wins += 1;
  };
  for (const e of experiments) {
    if (e.status !== 'completed') continue;
    const at = e.playlistATitle ?? '(A)'; const bt = e.playlistBTitle ?? '(B)';
    bump(at, e.winner === 'a'); bump(bt, e.winner === 'b');
  }
  return Array.from(map.values()).sort((a, b) => b.wins - a.wins || b.appearances - a.appearances);
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const STATUS_LABEL: Record<string, string> = { draft: '초안', running: '진행중', completed: '완료', cancelled: '취소' };
export const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'warning'> = { draft: 'neutral', running: 'info', completed: 'success', cancelled: 'warning' };
export const WINNER_LABEL: Record<ExperimentWinner, string> = { a: 'A 승', b: 'B 승', tie: '무승부', insufficient: '비교 불가' };
export const WINNER_TONE: Record<ExperimentWinner, 'success' | 'warning' | 'neutral' | 'info'> = { a: 'success', b: 'success', tie: 'neutral', insufficient: 'warning' };
export const METRIC_WINNER_LABEL: Record<MetricWinner, string> = { a: 'A', b: 'B', tie: '동률', na: '데이터 없음' };
