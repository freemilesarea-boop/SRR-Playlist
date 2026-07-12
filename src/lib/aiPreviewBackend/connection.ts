// AI-MUSIC-12 — Preview connection verification (pure). Given what a new Preview deployment reports, classifies
// whether it is correctly bound to the ISOLATED preview backend. A frontend/server ref equal to production →
// PRODUCTION_BOUND (must never happen). Pure & deterministic.

import type { ConnectionInput, ConnectionResult, ConnectionStatus } from './types';

export function verifyConnection(i: ConnectionInput): ConnectionResult {
  const mk = (status: ConnectionStatus, reason: string): ConnectionResult => ({ status, reasons: [reason] });

  if (!i.deployed) return mk('NOT_DEPLOYED', '새 Preview Deployment 미배포 — 검증 불가');
  if (i.frontendProjectRef == null || i.serverProjectRef == null) return mk('NOT_AVAILABLE', 'Project Ref 확인 불가');
  if (i.frontendProjectRef === i.productionProjectRef || i.serverProjectRef === i.productionProjectRef) {
    return mk('PRODUCTION_BOUND', 'Preview 가 Production Project 에 바인딩됨 — 즉시 Rollback 필요');
  }
  if (i.frontendProjectRef !== i.serverProjectRef) return mk('MISBOUND', 'Frontend/Server Project Ref 불일치');
  if (!i.isPreviewEnvironment) return mk('MISBOUND', 'Preview 환경 아님');
  if (!i.superAdminFnPresent || !i.requiredBaseTablesPresent) return mk('CONNECTED_PARTIAL', '연결됨 — Base Schema/`_is_super_admin()` 미완성');
  if (!i.testbedFlagsOff || !i.killSwitchOn) return mk('CONNECTED_PARTIAL', '연결됨 — Testbed Flags/Kill Switch 상태 확인 필요');
  return mk('CONNECTED_ISOLATED', '격리 Preview Backend 에 정상 연결 · Base Schema/Flags/Kill Switch 확인');
}
