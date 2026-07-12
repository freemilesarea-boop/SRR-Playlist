// AI-MUSIC-11 — Preview environment architecture audit. Determines whether the Preview build talks to an
// ISOLATED preview/local DB or SHARES the production DB. Migration apply is allowed ONLY for a genuinely
// isolated preview (or local) DB — never when the preview project ref equals (or is unset relative to) the
// production ref. Pure & deterministic.

import type { EnvironmentAuditInput, EnvironmentAuditResult, EnvironmentIsolation } from './types';

export function auditEnvironment(i: EnvironmentAuditInput): EnvironmentAuditResult {
  const reasons: string[] = [];
  const mk = (isolation: EnvironmentIsolation, migrationApplyAllowed: boolean, reason: string): EnvironmentAuditResult =>
    ({ isolation, migrationApplyAllowed, reasons: [reason] });

  // No preview backend configured at all → can only validate locally.
  if (i.previewProjectRef == null && i.previewSupabaseUrl == null) {
    return i.localSupabaseAvailable
      ? mk('LOCAL_ONLY', true, 'Preview 전용 backend 미구성 — Local Supabase 검증만 가능 (외부 Preview QA 불가)')
      : mk('NOT_AVAILABLE', false, 'Preview 전용 backend 및 Local Supabase 모두 없음');
  }

  // Preview points at the SAME project as production → shared production DB. Apply forbidden.
  const sameRef = i.previewProjectRef != null && i.previewProjectRef === i.productionProjectRef;
  const sameUrl = i.previewSupabaseUrl != null && i.productionSupabaseUrl != null && i.previewSupabaseUrl === i.productionSupabaseUrl;
  if (sameRef || sameUrl) {
    return mk('SHARED_PRODUCTION_DB', false, 'Preview 가 Production Supabase 를 공유함 — Preview Migration 적용 금지, Test Data 생성 금지');
  }

  // A distinct preview project ref exists but env vars are not scoped separately → only partial isolation.
  if (i.previewProjectRef != null && !i.previewEnvVarsScopedSeparately) {
    return mk('PARTIAL_ISOLATION', false, 'Preview 전용 ref 존재하나 Env Var 분리 미확인 — 적용 보류');
  }
  if (i.previewProjectRef != null && !i.serverSideEnvVerification) {
    reasons.push('Server-side 환경 검증 미확인');
    return { isolation: 'PARTIAL_ISOLATION', migrationApplyAllowed: false, reasons };
  }

  if (i.previewProjectRef != null) {
    return mk('ISOLATED_PREVIEW_DB', true, '분리된 Preview 전용 Supabase 확인 — Preview Migration 적용 가능');
  }
  return mk('UNSAFE', false, '환경 판정 불가 — 안전하지 않음');
}

/** A hard guard: is this the production project ref? Used by seeder/cleanup to REJECT it. */
export function isProductionProjectRef(ref: string | null, productionRef: string): boolean {
  return ref != null && ref.trim() === productionRef.trim();
}
