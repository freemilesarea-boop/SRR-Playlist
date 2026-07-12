// AI-MUSIC-11 — Seeder guard (pure decision logic used by scripts/seed-ai-preview-testbed.ts). It HARD-REJECTS
// the production project ref, requires an explicit --confirm-preview, and requires a preview environment before
// it would ever write. Dry-run is the default and writes nothing. This function never touches a DB; the script
// wraps it. Pure & deterministic.

import type { SeederGuardInput, SeederGuard, SeederGuardResult } from './types';
import { isProductionProjectRef } from './environment';

export function guardSeeder(i: SeederGuardInput): SeederGuard {
  const mk = (result: SeederGuardResult, reason: string, wouldWrite: boolean): SeederGuard => ({ result, reasons: [reason], wouldWrite });

  // Production ref is rejected unconditionally — even in dry-run we refuse to target it.
  if (isProductionProjectRef(i.targetProjectRef, i.productionProjectRef)) {
    return mk('REJECTED_PRODUCTION_REF', 'Production Project Ref 거부 — Test Data 생성 절대 금지', false);
  }
  if (i.targetProjectRef == null || i.environment !== 'preview') {
    return mk('REJECTED_NOT_PREVIEW', 'Preview 환경/Project Ref 미확인 — 실행 거부', false);
  }
  if (i.dryRun) return mk('ALLOWED_DRY_RUN', 'Dry-run — 아무것도 쓰지 않음 (계획만 출력)', false);
  if (!i.confirmPreview) return mk('REJECTED_NO_CONFIRM', '--confirm-preview 없음 — 실제 write 거부', false);
  return mk('ALLOWED_PREVIEW', 'Preview 확인 + confirm — 격리 Preview DB 에만 write 허용', true);
}
