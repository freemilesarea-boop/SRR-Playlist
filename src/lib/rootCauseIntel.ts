/**
 * rootCauseIntel — Root Cause & Impact & Outcome 순수 로직 (Phase AI-RECOMMENDATION-2).
 *
 * 추천이 생성된 이유를 실제 KPI/시계열의 방향·크기·시간 정렬로 "원인 후보(상관)"로만
 * 계산한다. **상관관계를 인과관계로 표현하지 않는다.** LLM 이 원인을 만들지 않는다.
 * 시계열이 부족하면 insufficient_data, 시계열이 아예 없으면 unsupported 로 정직하게 표시.
 *
 * 계산: Correlation(방향×크기×기간겹침×데이터충족) + Temporal Alignment(lag) → final_score.
 * Impact: 계산식이 명시된 4종(backlog/recovery/payment/run-rate)만. 임의 예측 없음.
 * Outcome: Before/After 로 improved/unchanged/worsened/insufficient_data/pending 분류.
 * Learning: outcome 집계(참고용, 자동 가중치 변경 없음).
 */

/* ── 공통 ─────────────────────────────────────────────────────────── */
export type AnalysisStatus = 'supported' | 'insufficient_data' | 'unsupported' | 'conflicting';
export const MIN_POINTS = 4;                 // 상관 계산 최소 데이터 포인트
export const LAGS = [0, 1, 7, 30] as const;  // 지원 lag(버킷 단위): same/1일/7일/1개월 상당

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const clamp100 = (n: number) => Math.max(0, Math.min(100, n));

/** Pearson 상관계수. 포인트 부족/분산 0 → null(추정 금지). */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < MIN_POINTS) return null;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { if (!isNum(a[i]) || !isNum(b[i])) return null; sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  if (da === 0 || db === 0) return null; // 분산 0 → 상관 정의 불가
  const r = num / Math.sqrt(da * db);
  return Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : null;
}

/** 첫 절반 대비 후 절반 평균 변화(방향/크기 파악용). */
export function windowDelta(series: number[]): { delta: number; rate: number | null } | null {
  const s = series.filter(isNum);
  if (s.length < MIN_POINTS) return null;
  const half = Math.floor(s.length / 2);
  const first = s.slice(0, half); const last = s.slice(s.length - half);
  const avg = (arr: number[]) => arr.reduce((x, y) => x + y, 0) / arr.length;
  const a = avg(first), b = avg(last);
  const delta = b - a;
  const rate = a === 0 ? null : Math.round(((b - a) / Math.abs(a)) * 1000) / 10;
  return { delta, rate };
}

/* ── Correlation ──────────────────────────────────────────────────── */
export interface CorrelationResult {
  status: AnalysisStatus;
  r: number | null;                 // -1~1 (부호=방향; +면 target 과 같은 방향)
  directionScore: number;           // 0~1
  magnitudeScore: number;           // 0~1
  temporalOverlapScore: number;     // 0~1
  dataCoverageScore: number;        // 0~1
  correlationScore: number;         // 0~100
  bestLag: number;                  // 후보가 target 대비 선행한 버킷 수(>0=선행)
  temporalAlignmentScore: number;   // 0~1
  pointsUsed: number;
}

/**
 * target(결과) 시계열과 candidate(원인 후보) 시계열의 상관을 계산한다.
 * expectSameDirection: 후보가 결과와 같은 방향으로 움직일 때 "원인 후보"로 본다.
 *   (예: 매출 감소 → 신규결제도 감소 = 같은 방향). r<0 이면 conflicting.
 * 시계열이 없으면(candidate 빈 배열) unsupported, 포인트 부족이면 insufficient_data.
 */
export function computeCorrelation(target: number[], candidate: number[]): CorrelationResult {
  const empty: CorrelationResult = {
    status: 'unsupported', r: null, directionScore: 0, magnitudeScore: 0,
    temporalOverlapScore: 0, dataCoverageScore: 0, correlationScore: 0, bestLag: 0, temporalAlignmentScore: 0, pointsUsed: 0,
  };
  if (!candidate || candidate.length === 0 || !target || target.length === 0) return empty;

  const tvalid = target.filter(isNum).length;
  const cvalid = candidate.filter(isNum).length;
  const overlap = Math.min(target.length, candidate.length);
  const pointsUsed = Math.min(tvalid, cvalid, overlap);
  if (pointsUsed < MIN_POINTS) return { ...empty, status: 'insufficient_data', pointsUsed };

  // lag 별 상관 중 |r| 최대 선택(후보를 lag 만큼 과거로 shift = 후보 선행 가정).
  let best: { lag: number; r: number } | null = null;
  for (const lag of LAGS) {
    if (lag >= overlap - MIN_POINTS + 1) continue;
    const t = target.slice(lag);           // 결과: lag 이후
    const c = candidate.slice(0, candidate.length - lag); // 후보: lag 이전
    const r = pearson(t, c);
    if (r != null && (best == null || Math.abs(r) > Math.abs(best.r))) best = { lag, r };
  }
  const base = pearson(target.slice(0, overlap), candidate.slice(0, overlap));
  if (best == null && base == null) return { ...empty, status: 'insufficient_data', pointsUsed };
  const chosen = best ?? { lag: 0, r: base as number };

  const r = chosen.r;
  const magnitudeScore = clamp01(Math.abs(r));
  const directionScore = r >= 0 ? 1 : 0; // 같은 방향이면 1, 반대면 0(=conflicting)
  const temporalOverlapScore = clamp01(overlap / Math.max(target.length, candidate.length));
  const dataCoverageScore = clamp01(pointsUsed / Math.max(target.length, MIN_POINTS));
  // 선행(lag>0)일수록 정렬 점수 가산(후행이면 base). 상한 1.
  const temporalAlignmentScore = clamp01(chosen.lag > 0 ? 0.7 + 0.3 * Math.min(chosen.lag / 7, 1) : 0.6);
  const correlationScore = clamp100(Math.round(magnitudeScore * temporalOverlapScore * dataCoverageScore * 100));

  const status: AnalysisStatus = r < 0 ? 'conflicting' : 'supported';
  return {
    status, r: Math.round(r * 100) / 100, directionScore, magnitudeScore,
    temporalOverlapScore: Math.round(temporalOverlapScore * 100) / 100,
    dataCoverageScore: Math.round(dataCoverageScore * 100) / 100,
    correlationScore, bestLag: chosen.lag,
    temporalAlignmentScore: Math.round(temporalAlignmentScore * 100) / 100, pointsUsed,
  };
}

/* ── Root Cause Candidate ─────────────────────────────────────────── */
export interface CandidateInput {
  metricKey: string; label: string;
  targetSeries: number[];        // 결과(추천 대상) 시계열
  candidateSeries: number[];     // 원인 후보 시계열
  currentValue: number | null; baselineValue: number | null;
  sourceDashboard: string; sourceRpc: string; timeWindow: string;
}
export interface RootCauseCandidate {
  metricKey: string; metricLabel: string;
  currentValue: number | null; baselineValue: number | null; delta: number | null; deltaRate: number | null;
  correlationScore: number; temporalAlignmentScore: number; dataCoverageScore: number; finalScore: number;
  bestLag: number; analysisStatus: AnalysisStatus; r: number | null;
  sourceDashboard: string; sourceRpc: string; timeWindow: string;
}

/** 후보 하나 분석. final_score = correlation × (0.7 + 0.3·temporal). 상태 정직 표기. */
export function analyzeCandidate(c: CandidateInput): RootCauseCandidate {
  const corr = computeCorrelation(c.targetSeries, c.candidateSeries);
  const delta = isNum(c.currentValue) && isNum(c.baselineValue) ? c.currentValue - c.baselineValue : null;
  const deltaRate = isNum(c.currentValue) && isNum(c.baselineValue) && c.baselineValue !== 0
    ? Math.round(((c.currentValue - c.baselineValue) / Math.abs(c.baselineValue)) * 1000) / 10 : null;
  const finalScore = corr.status === 'supported'
    ? clamp100(Math.round(corr.correlationScore * (0.7 + 0.3 * corr.temporalAlignmentScore)))
    : 0;
  return {
    metricKey: c.metricKey, metricLabel: c.label,
    currentValue: isNum(c.currentValue) ? c.currentValue : null, baselineValue: isNum(c.baselineValue) ? c.baselineValue : null,
    delta, deltaRate, correlationScore: corr.correlationScore, temporalAlignmentScore: corr.temporalAlignmentScore,
    dataCoverageScore: corr.dataCoverageScore, finalScore, bestLag: corr.bestLag, analysisStatus: corr.status, r: corr.r,
    sourceDashboard: c.sourceDashboard, sourceRpc: c.sourceRpc, timeWindow: c.timeWindow,
  };
}

export interface RootCauseResult {
  candidates: RootCauseCandidate[];   // supported, final_score 내림차순 TOP5
  conflicting: RootCauseCandidate[];  // 반대 방향(충돌 근거) — 숨기지 않음
  insufficient: RootCauseCandidate[]; // 분석 불충분/미지원
  overallStatus: AnalysisStatus;
}

/** 여러 후보를 분석해 TOP5 + 충돌 근거 + 불충분으로 분류. */
export function rankRootCauses(inputs: CandidateInput[]): RootCauseResult {
  const analyzed = inputs.map(analyzeCandidate);
  const candidates = analyzed.filter((a) => a.analysisStatus === 'supported').sort((x, y) => y.finalScore - x.finalScore).slice(0, 5);
  const conflicting = analyzed.filter((a) => a.analysisStatus === 'conflicting');
  const insufficient = analyzed.filter((a) => a.analysisStatus === 'insufficient_data' || a.analysisStatus === 'unsupported');
  const overallStatus: AnalysisStatus = candidates.length > 0 ? 'supported'
    : conflicting.length > 0 ? 'conflicting'
      : analyzed.some((a) => a.analysisStatus === 'insufficient_data') ? 'insufficient_data' : 'unsupported';
  return { candidates, conflicting, insufficient, overallStatus };
}

/* ── Impact Analysis (계산식 명시; 임의 예측 금지) ────────────────────── */
export type ImpactType = 'backlog_reduction' | 'recovery_coverage' | 'payment_recovery' | 'revenue_run_rate';
export interface ImpactResult {
  impactType: ImpactType;
  currentValue: number | null; targetCount: number | null; estimatedRemaining: number | null; coverageRate: number | null;
  calculationMethod: string; assumptions: string; supported: boolean; unsupportedReason: string | null;
}

export function computeImpact(type: ImpactType, x: { current?: number | null; target?: number | null; avgValue?: number | null }): ImpactResult {
  const cur = isNum(x.current) ? x.current : null;
  const tgt = isNum(x.target) ? x.target : null;
  const base: ImpactResult = { impactType: type, currentValue: cur, targetCount: tgt, estimatedRemaining: null, coverageRate: null, calculationMethod: '', assumptions: '', supported: false, unsupportedReason: null };

  if (type === 'backlog_reduction') {
    if (cur == null || tgt == null) return { ...base, supported: false, unsupportedReason: '현재값/처리대상 데이터 없음' };
    const remaining = Math.max(0, cur - tgt);
    return { ...base, estimatedRemaining: remaining, coverageRate: cur > 0 ? Math.round(Math.min(tgt / cur, 1) * 100) : null, supported: true,
      calculationMethod: 'estimated_remaining = max(0, current − target)', assumptions: '처리 대상은 즉시 처리 가정(성공률 예측 없음)' };
  }
  if (type === 'recovery_coverage') {
    if (cur == null || tgt == null || cur <= 0) return { ...base, supported: false, unsupportedReason: '전체/처리대상 데이터 없음' };
    return { ...base, estimatedRemaining: Math.max(0, cur - tgt), coverageRate: Math.round(Math.min(tgt / cur, 1) * 100), supported: true,
      calculationMethod: 'coverage_rate = min(target / current, 1)', assumptions: '재동기화 대상 범위만; 성공 보장 아님' };
  }
  if (type === 'payment_recovery') {
    if (cur == null || tgt == null) return { ...base, supported: false, unsupportedReason: '실패 결제/재시도 대상 데이터 없음' };
    const potential = Math.max(0, Math.min(tgt, cur));
    return { ...base, estimatedRemaining: potential, coverageRate: cur > 0 ? Math.round(Math.min(tgt / cur, 1) * 100) : null, supported: true,
      calculationMethod: 'potential_recovery = min(retry_target, failed_count)', assumptions: '잠재 복구 대상 수(성공률 예측 없음)' };
  }
  // revenue_run_rate: 활성 구독 × 정액 — 정액 계산만 허용(성장 예측 금지)
  const avg = isNum(x.avgValue) ? x.avgValue : null;
  if (cur == null || avg == null) return { ...base, impactType: 'revenue_run_rate', supported: false, unsupportedReason: '활성 구독/정액 데이터 없음' };
  return { ...base, impactType: 'revenue_run_rate', estimatedRemaining: Math.round(cur * avg), coverageRate: null, supported: true,
    calculationMethod: 'run_rate = active_subscriptions × avg_amount', assumptions: '정액 기준(행동/성장 예측 없음)' };
}

/* ── Outcome 분류 (Before/After) ──────────────────────────────────── */
export type OutcomeStatus = 'improved' | 'unchanged' | 'worsened' | 'insufficient_data' | 'pending';
export type Direction = 'lower_better' | 'higher_better';

/**
 * Before/After 로 결과 분류. after null → pending. 방향(lower/higher better) 반영.
 * epsilonRate: 변화가 이 비율 미만이면 unchanged.
 */
export function classifyOutcome(before: number | null, after: number | null, direction: Direction, epsilonRate = 0.05): OutcomeStatus {
  if (!isNum(before)) return 'insufficient_data';
  if (!isNum(after)) return 'pending';
  const delta = after - before;
  const denom = Math.abs(before) === 0 ? 1 : Math.abs(before);
  const rate = delta / denom;
  if (Math.abs(rate) < epsilonRate) return 'unchanged';
  const improvedWhenNegative = direction === 'lower_better';
  const good = improvedWhenNegative ? delta < 0 : delta > 0;
  return good ? 'improved' : 'worsened';
}

export interface OutcomeRecord { outcomeStatus: OutcomeStatus; delta: number | null }
/** 측정 Window 경과 여부(afterAt 존재 & window 만족). 프론트 게이팅용 보조. */
export function isWindowElapsed(beforeAtMs: number, window: 'immediate' | '1h' | '24h' | '7d', nowMs: number): boolean {
  const ms = { immediate: 0, '1h': 3600e3, '24h': 86400e3, '7d': 604800e3 }[window];
  return nowMs - beforeAtMs >= ms;
}

/* ── Learning Signal 집계 (참고용; 자동 가중치 변경 없음) ───────────────── */
export interface OutcomeLike { recommendationKey: string; actionType: string | null; outcomeStatus: OutcomeStatus; delta: number | null }
export interface LearningSignal {
  recommendationKey: string; actionType: string | null;
  timesExecuted: number; improvedCount: number; unchangedCount: number; worsenedCount: number;
  successRate: number | null; averageDelta: number | null;
}

export function aggregateLearning(outcomes: OutcomeLike[]): LearningSignal[] {
  const map = new Map<string, LearningSignal & { _deltas: number[] }>();
  for (const o of outcomes) {
    if (o.outcomeStatus === 'pending') continue;
    const key = `${o.recommendationKey}::${o.actionType ?? ''}`;
    let s = map.get(key);
    if (!s) { s = { recommendationKey: o.recommendationKey, actionType: o.actionType, timesExecuted: 0, improvedCount: 0, unchangedCount: 0, worsenedCount: 0, successRate: null, averageDelta: null, _deltas: [] }; map.set(key, s); }
    s.timesExecuted += 1;
    if (o.outcomeStatus === 'improved') s.improvedCount += 1;
    else if (o.outcomeStatus === 'unchanged') s.unchangedCount += 1;
    else if (o.outcomeStatus === 'worsened') s.worsenedCount += 1;
    if (isNum(o.delta)) s._deltas.push(o.delta);
  }
  return Array.from(map.values()).map((s) => {
    const decided = s.improvedCount + s.unchangedCount + s.worsenedCount;
    const successRate = decided > 0 ? Math.round((s.improvedCount / decided) * 1000) / 10 : null;
    const averageDelta = s._deltas.length > 0 ? Math.round((s._deltas.reduce((a, b) => a + b, 0) / s._deltas.length) * 100) / 100 : null;
    const { _deltas, ...rest } = s; void _deltas;
    return { ...rest, successRate, averageDelta };
  }).sort((a, b) => b.timesExecuted - a.timesExecuted);
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const ANALYSIS_LABEL: Record<AnalysisStatus, string> = {
  supported: '분석 지원', insufficient_data: '분석 불충분', unsupported: '시계열 미지원', conflicting: '충돌 근거',
};
export const ANALYSIS_TONE: Record<AnalysisStatus, 'success' | 'warning' | 'neutral' | 'info'> = {
  supported: 'info', insufficient_data: 'warning', unsupported: 'neutral', conflicting: 'warning',
};
export const OUTCOME_LABEL: Record<OutcomeStatus, string> = {
  improved: '개선', unchanged: '변화 없음', worsened: '악화', insufficient_data: '측정 불가', pending: '측정 대기',
};
export const OUTCOME_TONE: Record<OutcomeStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  improved: 'success', unchanged: 'neutral', worsened: 'danger', insufficient_data: 'warning', pending: 'info',
};
/** 인과 단정 금지 — 허용 문구만 생성. */
export function correlationPhrase(c: RootCauseCandidate): string {
  if (c.analysisStatus === 'conflicting') return `${c.metricLabel}: 일반적 원인 후보와 반대 방향(추가 확인 필요)`;
  if (c.analysisStatus !== 'supported') return `${c.metricLabel}: 현재 데이터로 분석 불가`;
  if (c.bestLag > 0) return `${c.metricLabel} 변화가 시간상 선행했습니다(원인 후보, 인과 아님)`;
  return `${c.metricLabel}가 같은 기간에 함께 변화했습니다(관련성 높음, 인과 아님)`;
}
