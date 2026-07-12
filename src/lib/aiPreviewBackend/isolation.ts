// AI-MUSIC-12 — Backend isolation validator. The preview backend must differ from production on EVERY axis:
// project ref, DB host, auth tenant, storage namespace. Any single shared axis blocks the testbed seeder /
// fixtures / canary. A production environment scope is always PRODUCTION_SCOPE (unsafe). Pure & deterministic.

import type { BackendIsolationInput, BackendIsolationResult, BackendIsolationStatus } from './types';

export function validateBackendIsolation(i: BackendIsolationInput): BackendIsolationResult {
  const mk = (status: BackendIsolationStatus, blocker: string | null): BackendIsolationResult =>
    ({ status, blockers: blocker ? [blocker] : [] });

  if (i.environmentScope === 'production') return mk('PRODUCTION_SCOPE', 'Production 환경 Scope — Preview Backend 로 사용 금지');
  if (i.previewProjectRef == null) return mk('INSUFFICIENT_DATA', 'Preview Project Ref 미확인');
  if (i.previewProjectRef.trim() === i.productionProjectRef.trim()) return mk('SHARED_PROJECT', 'Preview 가 Production Project Ref 와 동일');

  // Each axis must be present AND different. Missing hash → INSUFFICIENT_DATA (never a false ISOLATED).
  if (i.previewDbHostHash == null || i.productionDbHostHash == null) return mk('INSUFFICIENT_DATA', 'DB Host Hash 미확인');
  if (i.previewDbHostHash === i.productionDbHostHash) return mk('SHARED_DB', 'DB Host 동일');
  if (i.previewAuthTenantHash == null || i.productionAuthTenantHash == null) return mk('INSUFFICIENT_DATA', 'Auth Tenant Hash 미확인');
  if (i.previewAuthTenantHash === i.productionAuthTenantHash) return mk('SHARED_AUTH', 'Auth Tenant 동일');
  if (i.previewStorageNamespaceHash == null || i.productionStorageNamespaceHash == null) return mk('INSUFFICIENT_DATA', 'Storage Namespace Hash 미확인');
  if (i.previewStorageNamespaceHash === i.productionStorageNamespaceHash) return mk('SHARED_STORAGE', 'Storage Namespace 동일');

  const blockers: string[] = [];
  if (!i.killSwitch) blockers.push('Kill Switch OFF');
  if (i.testbedEnabled) blockers.push('Testbed Enabled (이번 Phase 기본 false 여야 함)');
  if (blockers.length > 0) return { status: 'PARTIAL', blockers };

  return mk('ISOLATED', null);
}

export function isBackendIsolated(s: BackendIsolationStatus): s is 'ISOLATED' { return s === 'ISOLATED'; }
