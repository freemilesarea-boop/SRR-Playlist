// WEB-OBS-9 — Decision Recommendations. Rule-based, ADVISORY ONLY (requiresApproval / not automated /
// no remote control). Recommendations are generated from readiness status + incidents; they are never
// executed. Below the minimum confidence a strong recommendation is downgraded to OBSERVE.

import type { ReleaseReadiness, DecisionRecommendation, RecommendationAction, RecommendationUrgency } from './types';
import type { QualityIncident } from '../streamingQuality/analysis';
import { REC_MIN_CONFIDENCE_TO_RECOMMEND } from './thresholds';

const APPROVAL = { requiresApproval: true, automated: false, remoteControl: false } as const;

function rec(scope: string, action: RecommendationAction, urgency: RecommendationUrgency, reason: string, evidence: string[], confidence: number | null): DecisionRecommendation {
  return { id: `${scope}:${action}`, scope, action, urgency, reason, evidence, confidence, ...APPROVAL };
}

/** Build advisory recommendations for a release from its readiness. Confidence-gated. */
export function recommendForRelease(readiness: ReleaseReadiness): DecisionRecommendation[] {
  const out: DecisionRecommendation[] = [];
  const conf = readiness.confidence;
  const lowConf = conf != null && conf < REC_MIN_CONFIDENCE_TO_RECOMMEND;
  const ev: string[] = [];
  if (readiness.regressedMetrics > 0) ev.push(`회귀 지표 ${readiness.regressedMetrics}개`);
  if (readiness.criticalIncidents > 0) ev.push(`CRITICAL incident ${readiness.criticalIncidents}건`);
  ev.push(`${readiness.stores} Stores · ${readiness.sessions} Sessions`);
  if (conf != null) ev.push(`Confidence ${conf}%`);

  if (readiness.status === 'INSUFFICIENT_DATA') return [rec(readiness.release, 'OBSERVE', 'LOW', '표본 부족 — 승격 판단 보류, 표본 축적 관찰.', ev, conf)];
  if (lowConf) return [rec(readiness.release, 'OBSERVE', 'LOW', '신뢰도 낮음 — 강한 권고 보류, 관찰 지속.', ev, conf)];

  switch (readiness.status) {
    case 'BLOCK_RECOMMENDED':
      out.push(rec(readiness.release, 'BLOCK_RELEASE_RECOMMENDED', 'CRITICAL', '준비도 매우 낮음 — 승격 보류 권고(표시만, 자동 차단 아님).', ev, conf));
      out.push(rec(readiness.release, 'PREPARE_ROLLBACK_PLAN', 'HIGH', '이전 안정 release 확인/롤백 계획 준비 권고(자동 실행 없음).', ev, conf));
      break;
    case 'HIGH_RISK':
      out.push(rec(readiness.release, 'DELAY_RELEASE', 'HIGH', '위험 높음 — 승격 지연 및 원인 확인 권고.', ev, conf));
      break;
    case 'REVIEW_REQUIRED':
      out.push(rec(readiness.release, 'MONITOR', 'MEDIUM', '검토 필요 — 지표 관찰 후 승인 결정 권고.', ev, conf));
      break;
    case 'READY':
      out.push(rec(readiness.release, 'PROMOTE_OK', 'NONE', '지표 양호 — 운영자 승인 시 승격 가능(자동 merge 아님).', ev, conf));
      break;
    default:
      break;
  }
  return out;
}

/** Build advisory recommendations for open incidents. */
export function recommendForIncidents(incidents: QualityIncident[]): DecisionRecommendation[] {
  return incidents.filter((i) => i.severity === 'CRITICAL' || i.severity === 'HIGH').map((i) => {
    const action: RecommendationAction = i.severity === 'CRITICAL' ? 'ESCALATE' : 'INVESTIGATE_INCIDENT';
    const urgency: RecommendationUrgency = i.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH';
    return rec(i.scope + ':' + i.type, action, urgency, i.suggestedAction, i.evidence, null);
  });
}
