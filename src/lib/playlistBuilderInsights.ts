/**
 * playlistBuilderInsights — Phase AI-PLAYLIST-ADMIN-UX-2
 *
 * Playlist Builder 파생 정보(순수 로직):
 *   - Quality Status(Ready / Needs Review / Blocked) — 규칙 기반(임의 AI 점수 아님)
 *   - Quality Dashboard 요약(분포/평균/카운트)
 *   - AI 순서 Diff(현재 vs 추천) + 인접 지표(개선 요약)
 *   - Save Review 요약 / Unsaved 변경 요약
 *   - Template 카드 요약
 * 모두 현재 편집 목록 크기에 대한 계산(대량 Catalog 전체 계산 아님).
 */
import {
  type BuilderTrack,
  type QualityIssue,
  type DistributionBucket,
  effectiveScore,
  isVocalTrack,
  generateWarnings,
  totalDuration,
  artistDistribution,
  genreDistribution,
  energyDistribution,
} from './playlistBuilder';

function isNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

// =============================================================================
// Quality Status (규칙 기반: Ready / Needs Review / Blocked)
// =============================================================================
export type QualityStatus = 'ready' | 'needs_review' | 'blocked';

/** 저장 차단 사유(Blocked)인 트랙: 가드레일 차단 / excluded / 필수 Audio URL 누락. */
export function isBlockingTrack(t: BuilderTrack): boolean {
  return t.guardrailBlocked === true || t.fitStatus === 'excluded' || !t.audioUrl;
}

/**
 * Playlist 상태 산출. Error 나 차단 트랙이 있으면 Blocked, Warning 이 있으면 Needs Review,
 * 아니면 Ready. (기존 runQualityCheck 결과 issues 와 트랙 상태를 함께 사용.)
 */
export function computeQualityStatus(tracks: BuilderTrack[], issues: QualityIssue[]): QualityStatus {
  const hasError = issues.some((i) => i.severity === 'error');
  const hasBlockingTrack = tracks.some(isBlockingTrack);
  if (hasError || hasBlockingTrack) return 'blocked';
  if (issues.some((i) => i.severity === 'warning')) return 'needs_review';
  return 'ready';
}

export function qualityStatusLabel(s: QualityStatus): string {
  return s === 'ready' ? 'Ready' : s === 'needs_review' ? 'Needs Review' : 'Blocked';
}

// =============================================================================
// Quality Dashboard 요약
// =============================================================================
export interface QualityDashboard {
  trackCount: number;
  totalDurationSec: number;
  targetDurationSec: number | null;
  durationFulfillment: number | null; // 0..1 (target 있을 때만)
  genre: DistributionBucket[];
  artist: DistributionBucket[];
  energy: DistributionBucket[];
  vocalRatio: number | null; // 판정 가능한 곡 중 vocal 비율
  instrumentalRatio: number | null;
  avgFit: number | null;
  avgAdaptive: number | null;
  blockedCount: number;
  penalizedCount: number;
  missingAudioCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  status: QualityStatus;
}

function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function buildQualityDashboard(
  tracks: BuilderTrack[],
  issues: QualityIssue[],
  opts: { targetDurationSec?: number | null } = {},
): QualityDashboard {
  const totalSec = totalDuration(tracks);
  const target = isNum(opts.targetDurationSec) && opts.targetDurationSec > 0 ? opts.targetDurationSec : null;

  let vocalYes = 0;
  let vocalNo = 0;
  for (const t of tracks) {
    const v = isVocalTrack(t);
    if (v === true) vocalYes++;
    else if (v === false) vocalNo++;
  }
  const vocalKnown = vocalYes + vocalNo;

  return {
    trackCount: tracks.length,
    totalDurationSec: totalSec,
    targetDurationSec: target,
    durationFulfillment: target ? Math.min(1, totalSec / target) : null,
    genre: genreDistribution(tracks),
    artist: artistDistribution(tracks),
    energy: energyDistribution(tracks),
    vocalRatio: vocalKnown > 0 ? vocalYes / vocalKnown : null,
    instrumentalRatio: vocalKnown > 0 ? vocalNo / vocalKnown : null,
    avgFit: avg(tracks.map((t) => t.fitScore).filter(isNum)),
    avgAdaptive: avg(tracks.map((t) => t.adaptiveScore).filter(isNum)),
    blockedCount: tracks.filter((t) => t.guardrailBlocked || t.fitStatus === 'excluded').length,
    penalizedCount: tracks.filter((t) => t.guardrailPenalty > 0 || t.fitStatus === 'review_needed').length,
    missingAudioCount: tracks.filter((t) => !t.audioUrl).length,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    infoCount: issues.filter((i) => i.severity === 'info').length,
    status: computeQualityStatus(tracks, issues),
  };
}

// =============================================================================
// AI 순서 Diff + 인접 지표
// =============================================================================
export interface OrderMove {
  trackId: string;
  title: string | null;
  fromIndex: number;
  toIndex: number;
  delta: number; // toIndex - fromIndex (음수=앞으로)
  reason: string;
  moved: boolean;
}

function moveReason(t: BuilderTrack, delta: number): string {
  if (t.guardrailBlocked || t.fitStatus === 'excluded') return '차단 트랙 후순위';
  if (t.guardrailPenalty > 0 || t.fitStatus === 'review_needed') return 'Penalized 후순위 조정';
  if (delta === 0) return '위치 유지';
  return delta < 0 ? '연속 반복 완화(앞으로 이동)' : '연속 반복 완화(뒤로 이동)';
}

/** 현재 순서 → 추천 순서의 트랙별 이동 정보. suggested 는 current 와 동일 집합이라고 가정. */
export function computeOrderDiff(current: BuilderTrack[], suggested: BuilderTrack[]): OrderMove[] {
  const fromIndex = new Map(current.map((t, i) => [t.track_id, i]));
  return suggested.map((t, toIdx) => {
    const from = fromIndex.get(t.track_id) ?? toIdx;
    const delta = toIdx - from;
    return {
      trackId: t.track_id,
      title: t.title,
      fromIndex: from,
      toIndex: toIdx,
      delta,
      reason: moveReason(t, delta),
      moved: delta !== 0,
    };
  });
}

export interface AdjacencyMetrics {
  sameArtistAdjacent: number;
  sameGenreAdjacent: number;
  avgBpmDelta: number | null;
  avgEnergyDelta: number | null;
  vocalAdjacent: number;
  warningCount: number;
}

/** 인접 쌍 기준 지표(순서 품질 요약). */
export function adjacencyMetrics(tracks: BuilderTrack[]): AdjacencyMetrics {
  let sameArtist = 0;
  let sameGenre = 0;
  let vocalAdj = 0;
  const bpmDeltas: number[] = [];
  const energyDeltas: number[] = [];
  for (let i = 1; i < tracks.length; i++) {
    const a = tracks[i - 1];
    const b = tracks[i];
    if (a.artist && b.artist && a.artist === b.artist) sameArtist++;
    if (a.genre && b.genre && a.genre === b.genre) sameGenre++;
    if (isVocalTrack(a) === true && isVocalTrack(b) === true) vocalAdj++;
    if (isNum(a.bpm) && isNum(b.bpm)) bpmDeltas.push(Math.abs(a.bpm - b.bpm));
    if (isNum(a.energyLevel) && isNum(b.energyLevel)) energyDeltas.push(Math.abs(a.energyLevel - b.energyLevel));
  }
  const warningCount = tracks.reduce((n, t) => n + generateWarnings(t, tracks).length, 0);
  return {
    sameArtistAdjacent: sameArtist,
    sameGenreAdjacent: sameGenre,
    avgBpmDelta: avg(bpmDeltas),
    avgEnergyDelta: avg(energyDeltas),
    vocalAdjacent: vocalAdj,
    warningCount,
  };
}

export interface OrderImprovement {
  current: AdjacencyMetrics;
  suggested: AdjacencyMetrics;
  movedCount: number;
}

export function orderImprovement(current: BuilderTrack[], suggested: BuilderTrack[]): OrderImprovement {
  const diff = computeOrderDiff(current, suggested);
  return {
    current: adjacencyMetrics(current),
    suggested: adjacencyMetrics(suggested),
    movedCount: diff.filter((d) => d.moved).length,
  };
}

// =============================================================================
// Save Review / Unsaved 요약
// =============================================================================
export interface UnsavedSummary {
  added: number;
  removed: number;
  reordered: number;
  hasChanges: boolean;
}

/** 저장 스냅샷(id) 대비 현재(id) 변경 요약: 추가/삭제/순서변경 수. */
export function unsavedChangeSummary(savedIds: string[], currentIds: string[]): UnsavedSummary {
  const savedSet = new Set(savedIds);
  const currentSet = new Set(currentIds);
  const added = currentIds.filter((id) => !savedSet.has(id)).length;
  const removed = savedIds.filter((id) => !currentSet.has(id)).length;
  // 공통 id 의 상대 순서 비교
  const savedCommon = savedIds.filter((id) => currentSet.has(id));
  const currentCommon = currentIds.filter((id) => savedSet.has(id));
  let reordered = 0;
  for (let i = 0; i < savedCommon.length; i++) {
    if (savedCommon[i] !== currentCommon[i]) reordered++;
  }
  return { added, removed, reordered, hasChanges: added > 0 || removed > 0 || reordered > 0 };
}

export interface SaveReviewSummary {
  trackCount: number;
  totalDurationSec: number;
  added: number;
  removed: number;
  reordered: number;
  errorCount: number;
  warningCount: number;
  status: QualityStatus;
  willBlock: boolean; // Error/차단 있어 저장 차단 여부
}

export function saveReviewSummary(
  savedIds: string[],
  current: BuilderTrack[],
  issues: QualityIssue[],
): SaveReviewSummary {
  const currentIds = current.map((t) => t.track_id);
  const u = unsavedChangeSummary(savedIds, currentIds);
  const status = computeQualityStatus(current, issues);
  return {
    trackCount: current.length,
    totalDurationSec: totalDuration(current),
    added: u.added,
    removed: u.removed,
    reordered: u.reordered,
    errorCount: issues.filter((i) => i.severity === 'error').length,
    warningCount: issues.filter((i) => i.severity === 'warning').length,
    status,
    willBlock: status === 'blocked',
  };
}

// =============================================================================
// Template 카드 요약
// =============================================================================
export interface TemplateSummary {
  trackCount: number;
  totalDurationSec: number;
  topGenres: string[];
  avgEnergy: number | null;
  vocalRatio: number | null;
}

export function templateSummary(tracks: BuilderTrack[]): TemplateSummary {
  const genres = genreDistribution(tracks).slice(0, 3).map((b) => b.key);
  let vocalYes = 0;
  let vocalKnown = 0;
  const energies: number[] = [];
  for (const t of tracks) {
    const v = isVocalTrack(t);
    if (v === true) {
      vocalYes++;
      vocalKnown++;
    } else if (v === false) {
      vocalKnown++;
    }
    if (isNum(t.energyLevel)) energies.push(t.energyLevel);
  }
  return {
    trackCount: tracks.length,
    totalDurationSec: totalDuration(tracks),
    topGenres: genres,
    avgEnergy: avg(energies),
    vocalRatio: vocalKnown > 0 ? vocalYes / vocalKnown : null,
  };
}

/** effectiveScore 로 후보 정렬(내림차순, null 은 뒤로). 비파괴(새 배열). */
export function sortByScore(tracks: BuilderTrack[], by: 'fit' | 'adaptive' = 'fit'): BuilderTrack[] {
  return [...tracks].sort((a, b) => {
    const sa = by === 'adaptive' ? (a.adaptiveScore ?? effectiveScore(a)) : (a.fitScore ?? effectiveScore(a));
    const sb = by === 'adaptive' ? (b.adaptiveScore ?? effectiveScore(b)) : (b.fitScore ?? effectiveScore(b));
    const va = isNum(sa) ? sa : -Infinity;
    const vb = isNum(sb) ? sb : -Infinity;
    return vb - va;
  });
}
