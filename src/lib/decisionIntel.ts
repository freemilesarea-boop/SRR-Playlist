/**
 * decisionIntel — Decision Intelligence & Adaptive Ranking 순수 로직 (Phase AI-RECOMMENDATION-3).
 *
 * 추천 우선순위를 **실제 운영 결과(Outcome)** 기반으로 계산한다. AI/LLM 이 순위를
 * 임의로 바꾸지 않는다. 이 단계는 **순위 계산만** 수행하며 Rule/Threshold/Weight 를
 * 자동으로 바꾸지 않는다(단위 테스트 대상).
 *
 * 원칙:
 *   - 모든 Ranking/Confidence/Quality 는 실제 History/Outcome count 기반(집계는 서버 RPC).
 *   - History 없는 추천을 자동으로 상위로 올리지 않는다(History/Outcome 성분 = 0).
 *   - 샘플 부족 → "신뢰도 낮음" 표시. 점수 0~100 clamp, NaN/Infinity 금지.
 *   - Ranking Score 는 성분별로 전부 공개(Explainability): Evidence/History/Outcome/Coverage/Freshness.
 */

/* ── 입력(기존 집계 재사용) ───────────────────────────────────────── */
export interface DecisionStat {
  recommendationKey: string;
  considered: number;   // history 기록 수
  dismissed: number; resolved: number;
  executed: number;     // outcome 완료(비 pending)
  improved: number; unchanged: number; worsened: number; insufficient: number; pending: number;
  avgDelta: number | null;
  successRate: number | null;   // 서버 제공(improved/decided)
  lastAt: string | null;
}

/** 라이브 추천(aiRecommendation.generateRecommendations 결과의 핵심 필드). */
export interface LiveRec {
  ruleKey: string; category: string; title: string;
  evidenceCount: number; evidenceSatisfied: number;  // Evidence 충족
  baseConfidence: number;   // 추천 자체 Confidence(데이터 충족률)
  baseScore: number;        // Priority score
  rootCauseSupported: number; rootCauseTotal: number; // Root Cause 후보 충족(coverage)
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/* ── Success Rate = improved / executed(decided), pending 제외 ────────── */
export function successRate(stat: Pick<DecisionStat, 'improved' | 'unchanged' | 'worsened'>): number | null {
  const decided = stat.improved + stat.unchanged + stat.worsened;
  if (decided <= 0) return null;
  return Math.round((stat.improved / decided) * 1000) / 10;
}

export const MIN_SAMPLES = 3; // 신뢰할 만한 최소 Outcome 샘플

/* ── Ranking Score (Explainable; 성분 max 합 = 100) ──────────────────── */
export const RANK_WEIGHTS = { evidence: 35, history: 22, outcome: 18, coverage: 15, freshness: 10 } as const;

export interface RankingBreakdown {
  evidence: number; history: number; outcome: number; coverage: number; freshness: number; total: number;
}
export interface RankedRecommendation {
  ruleKey: string; category: string; title: string;
  score: number; breakdown: RankingBreakdown;
  confidence: number; quality: number;
  successRate: number | null; executed: number; samples: number; lowConfidence: boolean;
}

/** freshness: 마지막 활동이 최근일수록 1(30일 선형 감쇠). 없으면 0. */
export function freshnessScore(lastAtMs: number | null, nowMs: number): number {
  if (lastAtMs == null || !Number.isFinite(lastAtMs)) return 0;
  const days = (nowMs - lastAtMs) / 86400e3;
  if (days <= 0) return 1;
  return clamp01(1 - days / 30);
}

/**
 * 추천 순위 계산. 각 성분 0~1 비율 × 가중치. History/Outcome 없으면 해당 성분 0
 * (자동 상승 금지). 반환에 성분 breakdown 전부 포함(Explainability).
 */
export function rankingScore(rec: LiveRec, stat: DecisionStat | undefined, nowMs: number): RankedRecommendation {
  const evidenceRatio = rec.evidenceCount > 0 ? clamp01(rec.evidenceSatisfied / rec.evidenceCount) : 0;
  const historyRatio = stat && stat.considered > 0 ? clamp01(Math.min(stat.considered, 10) / 10) : 0; // 표본 규모(최대 10)
  const sr = stat ? successRate(stat) : null;
  const outcomeRatio = sr != null ? clamp01(sr / 100) : 0; // 성공률(없으면 0 — 자동 상승 금지)
  const coverageRatio = rec.rootCauseTotal > 0 ? clamp01(rec.rootCauseSupported / rec.rootCauseTotal) : 0;
  const lastMs = stat?.lastAt ? Date.parse(stat.lastAt) : null;
  const freshRatio = freshnessScore(isNum(lastMs) ? lastMs : null, nowMs);

  const breakdown: RankingBreakdown = {
    evidence: Math.round(evidenceRatio * RANK_WEIGHTS.evidence),
    history: Math.round(historyRatio * RANK_WEIGHTS.history),
    outcome: Math.round(outcomeRatio * RANK_WEIGHTS.outcome),
    coverage: Math.round(coverageRatio * RANK_WEIGHTS.coverage),
    freshness: Math.round(freshRatio * RANK_WEIGHTS.freshness),
    total: 0,
  };
  breakdown.total = clamp100(breakdown.evidence + breakdown.history + breakdown.outcome + breakdown.coverage + breakdown.freshness);

  const samples = stat?.executed ?? 0;
  const lowConfidence = samples < MIN_SAMPLES;
  return {
    ruleKey: rec.ruleKey, category: rec.category, title: rec.title,
    score: breakdown.total, breakdown,
    confidence: recommendationConfidence(rec, stat, nowMs),
    quality: qualityScore(rec, stat, nowMs),
    successRate: sr, executed: samples, samples, lowConfidence,
  };
}

/* ── Confidence = Evidence Coverage × Outcome Availability × Samples × Freshness ─ */
export function recommendationConfidence(rec: LiveRec, stat: DecisionStat | undefined, nowMs: number): number {
  const evidenceCoverage = rec.evidenceCount > 0 ? clamp01(rec.evidenceSatisfied / rec.evidenceCount) : 0;
  const outcomeAvailability = stat && stat.executed > 0 ? 1 : 0.4; // Outcome 있으면 가중, 없으면 낮게(0 아님: Evidence 는 존재)
  const sampleFactor = stat ? clamp01(Math.min(stat.executed, MIN_SAMPLES) / MIN_SAMPLES) * 0.6 + 0.4 : 0.4;
  const lastMs = stat?.lastAt ? Date.parse(stat.lastAt) : null;
  const freshness = 0.5 + 0.5 * freshnessScore(isNum(lastMs) ? lastMs : null, nowMs);
  return clamp100(evidenceCoverage * outcomeAvailability * sampleFactor * freshness * 100);
}

/* ── Quality Score = Evidence·Outcome·Coverage·History·Freshness 평균 ────── */
export function qualityScore(rec: LiveRec, stat: DecisionStat | undefined, nowMs: number): number {
  const evidence = rec.evidenceCount > 0 ? rec.evidenceSatisfied / rec.evidenceCount : 0;
  const sr = stat ? successRate(stat) : null;
  const outcome = sr != null ? sr / 100 : 0;
  const coverage = rec.rootCauseTotal > 0 ? rec.rootCauseSupported / rec.rootCauseTotal : 0;
  const history = stat && stat.considered > 0 ? clamp01(Math.min(stat.considered, 10) / 10) : 0;
  const lastMs = stat?.lastAt ? Date.parse(stat.lastAt) : null;
  const freshness = freshnessScore(isNum(lastMs) ? lastMs : null, nowMs);
  return clamp100(((evidence + outcome + coverage + history + freshness) / 5) * 100);
}

/** 라이브 추천 배열 순위화(내림차순). stats 를 key 로 매핑. */
export function rankRecommendations(recs: LiveRec[], stats: DecisionStat[], nowMs: number): RankedRecommendation[] {
  const byKey = new Map(stats.map((s) => [s.recommendationKey, s]));
  return recs.map((r) => rankingScore(r, byKey.get(r.ruleKey), nowMs)).sort((a, b) => b.score - a.score);
}

/* ── Historical Analysis (집계 그대로 요약; 사실 count 만) ───────────────── */
export interface HistorySummary {
  recommendationKey: string; considered: number; executed: number;
  improved: number; unchanged: number; worsened: number; insufficient: number; pending: number;
  dismissed: number; resolved: number; successRate: number | null; avgDelta: number | null;
}
export function summarizeHistory(stat: DecisionStat): HistorySummary {
  return {
    recommendationKey: stat.recommendationKey, considered: stat.considered, executed: stat.executed,
    improved: stat.improved, unchanged: stat.unchanged, worsened: stat.worsened, insufficient: stat.insufficient,
    pending: stat.pending, dismissed: stat.dismissed, resolved: stat.resolved,
    successRate: successRate(stat), avgDelta: stat.avgDelta,
  };
}

/* ── Similar Case Engine ─────────────────────────────────────────────── */
export interface SimilarQuery { ruleKey: string; category: string; metricKeys: string[] }
export interface CaseRecord { ruleKey: string; category: string; metricKey: string | null; outcomeStatus: string; delta: number | null; at: string | null }
export interface SimilarResult {
  matchCount: number;
  cases: CaseRecord[];
  topOutcome: string | null;      // 최빈 Outcome
  avgDelta: number | null;
  improvedRate: number | null;
}

/**
 * 유사 사례 검색: Recommendation Type(ruleKey) 우선, 없으면 Category + Metric Pattern.
 * 실제 Outcome 기록만 사용. 없으면 matchCount=0(빈 상태).
 */
export function findSimilarCases(q: SimilarQuery, records: CaseRecord[]): SimilarResult {
  const exact = records.filter((r) => r.ruleKey === q.ruleKey);
  const pool = exact.length > 0 ? exact
    : records.filter((r) => r.category === q.category || (r.metricKey != null && q.metricKeys.includes(r.metricKey)));
  if (pool.length === 0) return { matchCount: 0, cases: [], topOutcome: null, avgDelta: null, improvedRate: null };

  const counts = new Map<string, number>();
  let deltaSum = 0, deltaN = 0, improved = 0, decided = 0;
  for (const r of pool) {
    counts.set(r.outcomeStatus, (counts.get(r.outcomeStatus) ?? 0) + 1);
    if (isNum(r.delta)) { deltaSum += r.delta; deltaN += 1; }
    if (['improved', 'unchanged', 'worsened'].includes(r.outcomeStatus)) { decided += 1; if (r.outcomeStatus === 'improved') improved += 1; }
  }
  let topOutcome: string | null = null; let topN = -1;
  for (const [k, v] of counts) if (v > topN) { topN = v; topOutcome = k; }
  return {
    matchCount: pool.length,
    cases: pool.slice(0, 10),
    topOutcome,
    avgDelta: deltaN > 0 ? Math.round((deltaSum / deltaN) * 100) / 100 : null,
    improvedRate: decided > 0 ? Math.round((improved / decided) * 1000) / 10 : null,
  };
}

/* ── Decision Timeline ───────────────────────────────────────────────── */
export type TimelineKind = 'recommendation' | 'action' | 'outcome' | 'learning' | 'ranking';
export interface TimelineEvent { kind: TimelineKind; label: string; at: string | null; detail?: string }

/** Outcome 기록을 Recommendation→Action→Outcome 타임라인으로 변환(시간 오름차순). */
export function buildTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : 0; const tb = b.at ? Date.parse(b.at) : 0;
    return ta - tb;
  });
}

/* ── Dashboard 집계(Most Successful / Ignored / Executed …) ───────────── */
export interface DecisionBoard {
  mostExecuted: HistorySummary[];
  highestSuccess: HistorySummary[];
  lowestSuccess: HistorySummary[];
  mostIgnored: HistorySummary[];   // dismissed 많은 순
}
export function buildBoard(stats: DecisionStat[]): DecisionBoard {
  const s = stats.map(summarizeHistory);
  const withSr = s.filter((x) => x.successRate != null && x.executed >= MIN_SAMPLES);
  return {
    mostExecuted: [...s].sort((a, b) => b.executed - a.executed).slice(0, 5),
    highestSuccess: [...withSr].sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0)).slice(0, 5),
    lowestSuccess: [...withSr].sort((a, b) => (a.successRate ?? 0) - (b.successRate ?? 0)).slice(0, 5),
    mostIgnored: [...s].sort((a, b) => b.dismissed - a.dismissed).slice(0, 5),
  };
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const RANK_COMPONENT_LABEL: Record<keyof RankingBreakdown, string> = {
  evidence: 'Evidence', history: 'History', outcome: 'Outcome', coverage: 'Coverage', freshness: 'Freshness', total: 'Total',
};
export function confidenceLabel(confidence: number, lowConfidence: boolean): string {
  if (lowConfidence) return '신뢰도 낮음(샘플 부족)';
  return confidence >= 70 ? '신뢰도 높음' : confidence >= 40 ? '신뢰도 보통' : '신뢰도 낮음';
}
