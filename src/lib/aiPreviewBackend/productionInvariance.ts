// AI-MUSIC-12 — Production invariance verification (pure). Compares before/after production snapshots (hashes/
// presence only, never raw secrets). ANY difference → CHANGED (a rebinding must NEVER alter production). Pure.

import type { ProductionSnapshot, InvarianceResult, InvarianceStatus } from './types';

export function checkProductionInvariance(before: ProductionSnapshot | null, after: ProductionSnapshot | null): InvarianceResult {
  if (before == null || after == null) return { status: 'INSUFFICIENT_DATA', changed: [] };
  const changed: string[] = [];
  if (before.projectRef !== after.projectRef) changed.push('projectRef');
  if (before.supabaseUrlHash !== after.supabaseUrlHash) changed.push('supabaseUrlHash');
  if (before.anonKeyPresent !== after.anonKeyPresent) changed.push('anonKeyPresent');
  if (before.serviceRoleKeyPresent !== after.serviceRoleKeyPresent) changed.push('serviceRoleKeyPresent');
  if (before.migrationHead !== after.migrationHead) changed.push('migrationHead');
  if (before.deploymentSha !== after.deploymentSha) changed.push('deploymentSha');
  const status: InvarianceStatus = changed.length === 0 ? 'INVARIANT' : 'CHANGED';
  return { status, changed };
}
