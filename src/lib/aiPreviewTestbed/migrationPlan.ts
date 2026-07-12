// AI-MUSIC-11 — Preview migration plan (validation only; apply NOT RUN this phase). Encodes the AI-MUSIC
// migrations 0464–0470 with their dependency order and validates the plan. It NEVER applies a migration; when
// the environment is not an isolated preview/local DB the status is BLOCKED (apply forbidden). Pure.

import type { MigrationMeta, MigrationPlanResult, MigrationPlanStatus } from './types';

// Dependency chain: each AI-MUSIC migration builds on the prior AI-MUSIC foundation; all sit atop base schema.
export const AI_MUSIC_MIGRATIONS: MigrationMeta[] = [
  { id: '0464', name: 'AI Music Foundation', newTables: 6, newFunctions: 8, altersExistingTables: false, dependsOn: [], securityDefiner: true, usesSuperAdmin: true, authDependency: true },
  { id: '0465', name: 'AI Playlist Builder', newTables: 5, newFunctions: 6, altersExistingTables: false, dependsOn: ['0464'], securityDefiner: true, usesSuperAdmin: true, authDependency: true },
  { id: '0466', name: 'AI Learning Engine', newTables: 6, newFunctions: 6, altersExistingTables: false, dependsOn: ['0464'], securityDefiner: true, usesSuperAdmin: true, authDependency: true },
  { id: '0467', name: 'AI Music Experiments', newTables: 11, newFunctions: 6, altersExistingTables: false, dependsOn: ['0464'], securityDefiner: true, usesSuperAdmin: true, authDependency: true },
  { id: '0468', name: 'AI Pilot Orchestration', newTables: 7, newFunctions: 8, altersExistingTables: false, dependsOn: ['0464'], securityDefiner: true, usesSuperAdmin: true, authDependency: true },
  { id: '0469', name: 'AI Shadow Resolution', newTables: 6, newFunctions: 6, altersExistingTables: false, dependsOn: ['0464'], securityDefiner: true, usesSuperAdmin: true, authDependency: true },
  { id: '0470', name: 'AI Preview Canary', newTables: 7, newFunctions: 22, altersExistingTables: false, dependsOn: ['0468', '0469'], securityDefiner: true, usesSuperAdmin: true, authDependency: true },
];

export interface MigrationPlanInput {
  migrations: MigrationMeta[];
  migrationApplyAllowed: boolean;        // from the environment audit
}

export function validateMigrationPlan(i: MigrationPlanInput): MigrationPlanResult {
  const ids = i.migrations.map((m) => m.id);
  const idSet = new Set(ids);
  const missingDependencies: string[] = [];
  for (const m of i.migrations) {
    for (const dep of m.dependsOn) if (!idSet.has(dep)) missingDependencies.push(`${m.id}→${dep}`);
  }
  // Topological order by id (they are numerically ordered and deps always precede).
  const orderedIds = [...ids].sort();

  // Verify every dependency precedes its dependant in the ordered list.
  let orderValid = true;
  for (const m of i.migrations) {
    const mi = orderedIds.indexOf(m.id);
    for (const dep of m.dependsOn) { const di = orderedIds.indexOf(dep); if (di < 0 || di > mi) orderValid = false; }
  }

  const reasons: string[] = [];
  let status: MigrationPlanStatus;
  if (missingDependencies.length > 0) { status = 'DEPENDENCY_MISSING'; reasons.push(`누락 의존성: ${missingDependencies.join(', ')}`); }
  else if (!orderValid) { status = 'ORDER_INVALID'; reasons.push('의존성 순서 위반'); }
  else if (!i.migrationApplyAllowed) { status = 'BLOCKED'; reasons.push('격리된 Preview/Local DB 아님 — Migration 적용 금지 (Production DB 적용 절대 금지)'); }
  else { status = 'APPLY_NOT_RUN'; reasons.push('계획/순서 유효 — 이번 Phase 는 적용하지 않음 (Validation Only)'); }

  return { status, orderedIds, missingDependencies, applied: false, reasons };
}
