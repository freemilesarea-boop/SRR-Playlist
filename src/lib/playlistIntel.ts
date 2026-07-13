/**
 * playlistIntel — Adaptive Playlist Intelligence 순수 로직 (Phase AI-PLAYLIST-1).
 *
 * "성과가 좋은(실제 KPI 기준) Playlist" 를 추천하기 위한 점수·랭킹·적응형 추천 로직이다.
 * **AI 가 음악 취향을 추측하지 않는다** — 오직 실제 재생 이벤트 KPI(완주율·Skip율·다양성·
 * 커버리지·최신성) 비교로만 판단한다(단위 테스트 대상). Evidence 없는 추천 없음.
 *
 * 원천: playback_events_v2 집계(admin_playlist_intelligence). 이벤트 기반이므로 KPI 는
 * "추적된 재생 이벤트" 기준. Skip율/완주율 0~100, Score 0~100, NaN/Infinity 금지.
 */

/* ── 타입(서버 집계 형태) ─────────────────────────────────────────── */
export interface PlaylistKpi {
  playlist_id: string | null; playlist_title: string | null;
  events: number; skips: number; skip_rate: number | null; completion_rate: number | null;
  likes: number; replays: number; unique_tracks: number; store_type_count: number; last_event_at: string | null;
}
export interface IndustryKpi {
  store_type_slug: string; events: number; skip_rate: number | null; completion_rate: number | null;
  playlist_count: number; unique_tracks: number;
}
export interface BandKpi { band: string; events: number; skip_rate: number | null; completion_rate: number | null }
export interface SeasonKpi { season: string; events: number; skip_rate: number | null; completion_rate: number | null }

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
/** 비율(%) clamp 0~100. null 유지. */
export function clampPct(n: number | null | undefined): number | null {
  if (!isNum(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

export const MIN_EVENTS = 20;   // 신뢰할 만한 최소 이벤트 수

/* ── Playlist Score (Explainable; 성분 max 합 = 100) ─────────────────── */
export const PLAYLIST_WEIGHTS = { completion: 30, skip: 25, diversity: 15, coverage: 10, freshness: 10, evidence: 10 } as const;

export interface ScoreBreakdown { completion: number; skip: number; diversity: number; coverage: number; freshness: number; evidence: number; total: number }
export interface ScoredPlaylist {
  playlistId: string | null; title: string; score: number; breakdown: ScoreBreakdown;
  events: number; skipRate: number | null; completionRate: number | null; diversity: number | null; insufficient: boolean;
}

export function freshnessScore(lastAtMs: number | null, nowMs: number): number {
  if (lastAtMs == null || !Number.isFinite(lastAtMs)) return 0;
  const days = (nowMs - lastAtMs) / 86400e3;
  if (days <= 0) return 1;
  return clamp01(1 - days / 30);
}

/** Playlist 점수. 데이터 부족(events<MIN)이면 insufficient=true 로 표기(추정 없음). */
export function playlistScore(k: PlaylistKpi, nowMs: number): ScoredPlaylist {
  const completion = clampPct(k.completion_rate) ?? 0;
  const skipRate = clampPct(k.skip_rate) ?? 0;
  const diversity = k.events > 0 ? clamp01(k.unique_tracks / k.events) : 0;
  const coverage = clamp01(Math.min(k.store_type_count, 5) / 5);
  const lastMs = k.last_event_at ? Date.parse(k.last_event_at) : null;
  const freshness = freshnessScore(isNum(lastMs) ? lastMs : null, nowMs);
  const evidence = clamp01(Math.min(k.events, MIN_EVENTS) / MIN_EVENTS);

  const breakdown: ScoreBreakdown = {
    completion: Math.round((completion / 100) * PLAYLIST_WEIGHTS.completion),
    skip: Math.round(((100 - skipRate) / 100) * PLAYLIST_WEIGHTS.skip),
    diversity: Math.round(diversity * PLAYLIST_WEIGHTS.diversity),
    coverage: Math.round(coverage * PLAYLIST_WEIGHTS.coverage),
    freshness: Math.round(freshness * PLAYLIST_WEIGHTS.freshness),
    evidence: Math.round(evidence * PLAYLIST_WEIGHTS.evidence),
    total: 0,
  };
  breakdown.total = clamp100(breakdown.completion + breakdown.skip + breakdown.diversity + breakdown.coverage + breakdown.freshness + breakdown.evidence);

  return {
    playlistId: k.playlist_id, title: k.playlist_title ?? '(제목 없음)', score: breakdown.total, breakdown,
    events: k.events, skipRate: clampPct(k.skip_rate), completionRate: clampPct(k.completion_rate),
    diversity: k.events > 0 ? Math.round(diversity * 1000) / 10 : null, insufficient: k.events < MIN_EVENTS,
  };
}

/** Playlist 랭킹(점수 내림차순). */
export function rankPlaylists(kpis: PlaylistKpi[], nowMs: number): ScoredPlaylist[] {
  return kpis.map((k) => playlistScore(k, nowMs)).sort((a, b) => b.score - a.score);
}

/* ── Industry / Time / Season 요약(best/worst) ───────────────────────── */
export interface IndustrySummary extends IndustryKpi { rankMetric: number | null }
/** 완주율 기준 정렬(데이터 없으면 하위). */
export function summarizeIndustries(list: IndustryKpi[]): IndustrySummary[] {
  return list.map((i) => ({ ...i, skip_rate: clampPct(i.skip_rate), completion_rate: clampPct(i.completion_rate), rankMetric: clampPct(i.completion_rate) }))
    .sort((a, b) => (b.rankMetric ?? -1) - (a.rankMetric ?? -1));
}

/* ── Adaptive Recommendation (Evidence 기반; 취향 추측 없음) ───────────── */
export interface PlaylistEvidence { kpi: string; label: string; current: number | null; benchmark: number | null; source: string }
export interface PlaylistRecommendation {
  ruleKey: string; storeType: string; targetTitle: string; recommendedTitle: string;
  reason: string; evidence: PlaylistEvidence[]; priority: 'high' | 'medium' | 'low';
}

/** Skip율 초과 마진(%p) — 이보다 크면 교체 후보. */
export const SKIP_MARGIN = 5;
/** 완주율 미달 마진(%p). */
export const COMPLETION_MARGIN = 5;

/**
 * 각 store_type 에서 최고 성과 Playlist 를 기준으로, 같은 store_type 내 저성과 Playlist
 * (Skip율↑ 또는 완주율↓)에 교체를 추천한다. 실제 KPI 비교만. 데이터 부족 시 추천 없음.
 *
 * playlistsByStore: store_type 별로 이미 필터된 Playlist KPI (프론트가 store_type_slug 매핑).
 */
export function buildRecommendations(
  storeType: string, industryAvgCompletion: number | null, industryAvgSkip: number | null, playlists: PlaylistKpi[], nowMs: number,
): PlaylistRecommendation[] {
  const scored = playlists.filter((p) => p.events >= MIN_EVENTS).map((p) => ({ p, s: playlistScore(p, nowMs) }));
  if (scored.length < 2) return []; // 비교 대상 부족
  const best = scored.reduce((a, b) => (b.s.score > a.s.score ? b : a));
  const out: PlaylistRecommendation[] = [];
  for (const { p, s } of scored) {
    if (p.playlist_id === best.p.playlist_id) continue;
    const skip = clampPct(p.skip_rate) ?? 0;
    const completion = clampPct(p.completion_rate);
    const highSkip = industryAvgSkip != null && skip > industryAvgSkip + SKIP_MARGIN;
    const lowCompletion = industryAvgCompletion != null && completion != null && completion < industryAvgCompletion - COMPLETION_MARGIN;
    if (!highSkip && !lowCompletion) continue;
    const evidence: PlaylistEvidence[] = [
      { kpi: 'skip_rate', label: 'Skip율', current: skip, benchmark: clampPct(industryAvgSkip), source: 'playback_events_v2' },
      { kpi: 'completion_rate', label: '완주율', current: completion, benchmark: clampPct(industryAvgCompletion), source: 'playback_events_v2' },
      { kpi: 'recommended_score', label: '추천 Playlist 점수', current: best.s.score, benchmark: s.score, source: 'playlistScore' },
    ];
    out.push({
      ruleKey: highSkip ? 'high_skip_swap' : 'low_completion_swap', storeType,
      targetTitle: p.playlist_title ?? '(제목 없음)', recommendedTitle: best.p.playlist_title ?? '(제목 없음)',
      reason: highSkip
        ? `${storeType} Skip율(${skip}%)이 업종 평균(${clampPct(industryAvgSkip)}%)보다 높습니다.`
        : `${storeType} 완주율(${completion}%)이 업종 평균(${clampPct(industryAvgCompletion)}%)보다 낮습니다.`,
      evidence, priority: highSkip && lowCompletion ? 'high' : highSkip ? 'medium' : 'low',
    });
  }
  return out.sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]));
}

/* ── Learning Signal 집계(참고용; 자동 교체 없음) ─────────────────────── */
export interface RecoHistoryLike { ruleKey: string; state: 'suggested' | 'applied' | 'dismissed' }
export interface PlaylistLearning { ruleKey: string; total: number; applied: number; dismissed: number; suggested: number; applyRate: number | null }
export function aggregatePlaylistLearning(history: RecoHistoryLike[]): PlaylistLearning[] {
  const map = new Map<string, PlaylistLearning>();
  for (const h of history) {
    let s = map.get(h.ruleKey);
    if (!s) { s = { ruleKey: h.ruleKey, total: 0, applied: 0, dismissed: 0, suggested: 0, applyRate: null }; map.set(h.ruleKey, s); }
    s.total += 1;
    if (h.state === 'applied') s.applied += 1;
    else if (h.state === 'dismissed') s.dismissed += 1;
    else s.suggested += 1;
  }
  return Array.from(map.values()).map((s) => {
    const decided = s.applied + s.dismissed;
    return { ...s, applyRate: decided > 0 ? Math.round((s.applied / decided) * 1000) / 10 : null };
  }).sort((a, b) => b.total - a.total);
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const SCORE_COMPONENT_LABEL: Record<keyof ScoreBreakdown, string> = {
  completion: '완주', skip: 'Skip', diversity: '다양성', coverage: '커버리지', freshness: '최신성', evidence: '근거', total: 'Total',
};
export const PRIORITY_TONE: Record<PlaylistRecommendation['priority'], 'danger' | 'warning' | 'info'> = {
  high: 'danger', medium: 'warning', low: 'info',
};
export const PRIORITY_LABEL: Record<PlaylistRecommendation['priority'], string> = { high: 'High', medium: 'Medium', low: 'Low' };
