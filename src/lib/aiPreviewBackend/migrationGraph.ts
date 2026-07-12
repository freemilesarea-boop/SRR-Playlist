// AI-MUSIC-12 — Migration dependency graph for the preview schema baseline. Encodes the base-schema prerequisite
// plus the AI-MUSIC chain (0464 Foundation → 0465/0466/0467/0468/0469 → 0470 Preview Canary, with 0470 depending
// on {0468, 0469}). Validates that every required predecessor is present and precedes its dependant. A missing
// dependency blocks apply. Pure & deterministic.

import type { MigrationNode, MigrationGraphResult, MigrationGraphStatus } from './types';

// `BASE` is a synthetic node representing the applied base schema (stores/auth/playlist/... + _is_super_admin()).
export const AI_MUSIC_MIGRATION_GRAPH: MigrationNode[] = [
  { id: 'BASE', name: 'Base schema (stores/auth/playlist/playback/telemetry/streaming/governance + _is_super_admin)', requiredPredecessors: [], createdTables: 0, createdFunctions: 1, reversible: false, risk: 'low' },
  { id: '0464', name: 'AI Music Foundation', requiredPredecessors: ['BASE'], createdTables: 6, createdFunctions: 8, reversible: true, risk: 'low' },
  { id: '0465', name: 'AI Playlist Builder', requiredPredecessors: ['BASE', '0464'], createdTables: 5, createdFunctions: 6, reversible: true, risk: 'low' },
  { id: '0466', name: 'AI Learning Engine', requiredPredecessors: ['BASE', '0464'], createdTables: 6, createdFunctions: 6, reversible: true, risk: 'low' },
  { id: '0467', name: 'AI Music Experiments', requiredPredecessors: ['BASE', '0464'], createdTables: 11, createdFunctions: 6, reversible: true, risk: 'medium' },
  { id: '0468', name: 'AI Pilot Orchestration', requiredPredecessors: ['BASE', '0464'], createdTables: 7, createdFunctions: 8, reversible: true, risk: 'medium' },
  { id: '0469', name: 'AI Shadow Resolution', requiredPredecessors: ['BASE', '0464'], createdTables: 6, createdFunctions: 6, reversible: true, risk: 'medium' },
  { id: '0470', name: 'AI Preview Canary', requiredPredecessors: ['BASE', '0468', '0469'], createdTables: 7, createdFunctions: 22, reversible: true, risk: 'high' },
];

export interface MigrationGraphInput { nodes: MigrationNode[]; }

export function validateMigrationGraph(i: MigrationGraphInput): MigrationGraphResult {
  const ids = i.nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const missing: string[] = [];
  for (const n of i.nodes) for (const dep of n.requiredPredecessors) if (!idSet.has(dep)) missing.push(`${n.id}→${dep}`);

  // Topological order: BASE first, then numeric ids ascending.
  const orderedIds = [...ids].sort((a, b) => (a === 'BASE' ? -1 : b === 'BASE' ? 1 : a.localeCompare(b)));
  let orderValid = true;
  for (const n of i.nodes) {
    const ni = orderedIds.indexOf(n.id);
    for (const dep of n.requiredPredecessors) { const di = orderedIds.indexOf(dep); if (di < 0 || di > ni) orderValid = false; }
  }

  let status: MigrationGraphStatus;
  const reasons: string[] = [];
  if (i.nodes.length === 0) { status = 'INSUFFICIENT_DATA'; reasons.push('노드 없음'); }
  else if (missing.length > 0) { status = 'DEPENDENCY_MISSING'; reasons.push(`누락 의존성: ${missing.join(', ')} — Apply 금지`); }
  else if (!orderValid) { status = 'ORDER_INVALID'; reasons.push('의존성 순서 위반'); }
  else { status = 'VALID'; reasons.push(`순서: ${orderedIds.join(' → ')}`); }

  return { status, orderedIds, missing, reasons };
}
