// AI-MUSIC-1 — Discovery Pool. A new track is NEVER auto-distributed. It advances through gated stages:
// Candidate → Pilot → Evaluation → Recommended Expansion → Approved → General Distribution. This engine
// evaluates pilot stats and RECOMMENDS the next stage; approval + distribution are operator actions.

import { round, safeRatio } from '../observability/math';
import {
  DISCOVERY_PILOT_STORES, DISCOVERY_MIN_PILOT_PLAYS, DISCOVERY_EXPAND_COMPLETION, DISCOVERY_EXPAND_SKIP_MAX,
} from './thresholds';
import type { DiscoveryCandidate, DiscoveryStage } from './types';

export interface DiscoveryInput {
  trackId: string; title: string | null;
  stage: DiscoveryStage;
  pilotStores: number;
  pilotPlays: number;
  pilotCompletes: number;
  pilotSkips: number;
}

const APPROVAL = { requiresApproval: true, automated: false } as const;

/** Evaluate a discovery candidate and recommend the next gated step. Never auto-distributes. */
export function evaluateDiscovery(input: DiscoveryInput): DiscoveryCandidate {
  const completion = input.pilotPlays > 0 ? safeRatio(input.pilotCompletes, input.pilotPlays) : null;
  const skip = input.pilotPlays > 0 ? safeRatio(input.pilotSkips, input.pilotPlays) : null;

  let recommendation: string;
  if (input.stage === 'CANDIDATE') {
    recommendation = `Pilot 권고 — 소수 매장(≤${DISCOVERY_PILOT_STORES})에서 시범(운영자 승인 필요)`;
  } else if (input.pilotPlays < DISCOVERY_MIN_PILOT_PLAYS) {
    recommendation = `Evaluation 보류 — pilot 재생 부족 (${input.pilotPlays}/${DISCOVERY_MIN_PILOT_PLAYS}) INSUFFICIENT_DATA`;
  } else if (completion != null && skip != null && completion >= DISCOVERY_EXPAND_COMPLETION && skip <= DISCOVERY_EXPAND_SKIP_MAX) {
    recommendation = 'Recommended Expansion — 성과 양호, 승인 검토 권고(자동 배포 아님)';
  } else {
    recommendation = 'Hold — 성과 미달, 확장 보류 권고';
  }

  return {
    trackId: input.trackId, title: input.title, stage: input.stage,
    pilotStores: input.pilotStores, pilotPlays: input.pilotPlays,
    pilotCompletion: round(completion, 3), pilotSkip: round(skip, 3),
    recommendation, ...APPROVAL,
  };
}
