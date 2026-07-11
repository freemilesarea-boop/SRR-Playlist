// WEB-OBS-9 — Change Impact Analyzer. Compares two releases (previous → current) and grades the risk of
// the change. Advisory recommendation only — it proposes DELAY/BLOCK/PROMOTE labels, never acts.

import { round } from '../observability/math';
import type { StreamingQualityResult } from '../streamingQuality/types';
import { computeQualityRegression } from '../streamingQuality/analysis';
import { IMPACT_SIGNIFICANT_SCORE_DELTA, IMPACT_HIGH_RISK_SCORE_DELTA } from './thresholds';
import type { ChangeImpact, ImpactRisk, RecommendationAction } from './types';

/** Analyze the impact of moving from `previous` to `current` release. */
export function analyzeChangeImpact(previous: StreamingQualityResult, current: StreamingQualityResult): ChangeImpact {
  const notes: string[] = [];
  if (previous.score == null || current.score == null || previous.confidence === 'INSUFFICIENT' || current.confidence === 'INSUFFICIENT') {
    return {
      previous: previous.scope, current: current.scope, scoreDelta: null, regressedMetrics: 0, improvedMetrics: 0,
      risk: 'INSUFFICIENT_DATA', recommendation: 'OBSERVE', significant: false,
      notes: ['표본/점수 부족 — 영향 판정 불가'],
    };
  }
  const reg = computeQualityRegression(previous, current);
  const delta = current.score - previous.score; // negative = worse
  const drop = -delta;
  const significant = Math.abs(delta) >= IMPACT_SIGNIFICANT_SCORE_DELTA;

  let risk: ImpactRisk = 'LOW';
  let recommendation: RecommendationAction = 'PROMOTE_OK';
  if (drop >= IMPACT_HIGH_RISK_SCORE_DELTA || reg.regressedCount >= 3) { risk = 'HIGH'; recommendation = 'BLOCK_RELEASE_RECOMMENDED'; notes.push('큰 품질 저하 — 승격 보류 권고(표시만)'); }
  else if (drop >= IMPACT_SIGNIFICANT_SCORE_DELTA || reg.regressedCount >= 1) { risk = 'MODERATE'; recommendation = 'DELAY_RELEASE'; notes.push('품질 저하 감지 — 지연/확인 권고'); }
  else if (delta > 0) { notes.push('품질 개선 또는 유지'); }

  notes.push(`score ${previous.score} → ${current.score} (Δ${round(delta, 1)})`);
  notes.push(`회귀 ${reg.regressedCount} · 개선 ${reg.improvedCount}`);

  return {
    previous: previous.scope, current: current.scope, scoreDelta: round(delta, 1),
    regressedMetrics: reg.regressedCount, improvedMetrics: reg.improvedCount, risk, recommendation, significant, notes,
  };
}
