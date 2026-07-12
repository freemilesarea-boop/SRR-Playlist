// AI-MUSIC-12 — Rollback plan (pure). On any preview provisioning/binding failure, restore ONLY the Vercel
// Preview scope to its prior values; never touch Production; re-create the Preview deployment; disable the
// testbed; and confirm no test data leaked. Production failover is forbidden. Pure & deterministic.

export type RollbackResult = 'ROLLBACK_PLAN_READY' | 'ROLLED_BACK' | 'PRODUCTION_FAILOVER_FORBIDDEN' | 'INSUFFICIENT_DATA';
export interface RollbackInput {
  previewEnvSnapshotPresent: boolean;    // the pre-change Preview-scope snapshot exists
  touchesProductionScope: boolean;       // any planned step touches Production scope
  executed: boolean;
}
export interface RollbackPlan {
  result: RollbackResult;
  steps: string[];
  productionUntouched: true;
}

export const ROLLBACK_STEPS = [
  'Vercel Preview scope 환경변수를 이전 Snapshot 값으로 복구 (Production scope 미변경)',
  'Preview Deployment 재생성',
  'Preview Backend 비활성화 (testbed_enabled=false)',
  'Kill Switch=true 확인',
  'Test Data 없음 확인 (AI_PREVIEW_TESTBED 태그 스캔)',
  'Branch/Project 삭제 여부 판단 · Secret 회전 · Audit 기록',
];

export function buildRollbackPlan(i: RollbackInput): RollbackPlan {
  if (i.touchesProductionScope) return { result: 'PRODUCTION_FAILOVER_FORBIDDEN', steps: ['Production Scope 변경/Failover 금지 — 계획 거부'], productionUntouched: true };
  if (!i.previewEnvSnapshotPresent) return { result: 'INSUFFICIENT_DATA', steps: ['이전 Preview Env Snapshot 없음 — 복구 기준 부재'], productionUntouched: true };
  return { result: i.executed ? 'ROLLED_BACK' : 'ROLLBACK_PLAN_READY', steps: ROLLBACK_STEPS, productionUntouched: true };
}
