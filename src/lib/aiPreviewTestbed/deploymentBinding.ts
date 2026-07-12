// AI-MUSIC-11 — Preview deployment binding. A candidate/allowlist is only valid for a fixed deployment id; a new
// commit produces a new deployment id (invalidating the fixture). If the deployment id can't be pinned/verified
// at runtime, canary activation must be forbidden. Pure & deterministic.

import type { DeploymentBindingInput, DeploymentBindingResult, DeploymentBindingStatus } from './types';

export function evaluateDeploymentBinding(i: DeploymentBindingInput): DeploymentBindingResult {
  const mk = (status: DeploymentBindingStatus, reason: string): DeploymentBindingResult => ({ status, reasons: [reason] });
  if (i.allowedDeploymentId == null || i.currentDeploymentId == null) return mk('NOT_AVAILABLE', 'Deployment ID 미고정 — Canary Activation 금지');
  if (!i.runtimeDeploymentIdReadable) return mk('UNSAFE', 'Runtime 에서 Deployment ID 확인 불가 — 활성화 금지');
  if (i.allowedDeploymentId !== i.currentDeploymentId) return mk('PARTIAL', 'Deployment ID 불일치 — 새 배포 시 Fixture 무효 (재승인 필요)');
  if (!i.stableAliasAvailable) return { status: 'BOUND', reasons: ['Deployment ID 일치 (Stable Alias 없음 — 새 커밋마다 재바인딩 필요)'] };
  return mk('BOUND', 'Deployment ID 고정 및 일치');
}
