// AI-MUSIC-8 — Resolver race simulation. Models two (or more) resolver responses arriving in various orders and
// classifies the outcome given the adapter's stale/priority protection. The audit found the real store is
// unprotected last-writer-wins with no revision; this engine shows how the adapter's revision + priority rules
// make the outcome deterministic (or flags where the CURRENT code would be at risk). Pure & deterministic.

import { arbitrate } from './arbitration';
import type { QueueCommand, RaceResult, RaceClassification, ArbitrationInput } from './types';

export interface RaceInput {
  commands: QueueCommand[];               // in arrival order
  currentSessionId: string;
  currentStoreId: string;
  isProductionEnvironment: boolean;
  killSwitch: boolean;
  isControlStore: boolean;
  nowMs: number;
  // With the adapter's revision protection ON, a stale later-arriving response is rejected.
  adapterProtectionOn: boolean;
}

export function simulateRace(input: RaceInput): RaceResult {
  const reasons: string[] = [];
  if (input.commands.length === 0) return { classification: 'INSUFFICIENT_DATA', winner: null, reasons: ['Command 없음'] };

  const latestRevisionBySource: Record<string, number> = {};
  if (input.adapterProtectionOn) {
    for (const c of input.commands) {
      const cur = latestRevisionBySource[c.source];
      if (cur == null || c.requestRevision > cur) latestRevisionBySource[c.source] = c.requestRevision;
    }
  }

  const arb = arbitrate({
    commands: input.commands, isProductionEnvironment: input.isProductionEnvironment, killSwitch: input.killSwitch,
    isControlStore: input.isControlStore, currentSessionId: input.currentSessionId, currentStoreId: input.currentStoreId,
    nowMs: input.nowMs, latestRevisionBySource,
  } satisfies ArbitrationInput);

  const staleBlocked = arb.rejected.some((r) => r.reason === 'STALE');

  let classification: RaceClassification;
  if (arb.outcome === 'NO_VALID_COMMAND') { classification = 'INSUFFICIENT_DATA'; reasons.push('유효 Command 없음'); }
  else if (arb.outcome === 'CONFLICT') { classification = 'CONFLICT_REQUIRES_REVIEW'; reasons.push('동일 우선순위 서로 다른 source 충돌'); }
  else if (!input.adapterProtectionOn) {
    // Without revision protection, a late response can overwrite — the current store's real risk.
    classification = 'LAST_WRITE_RISK'; reasons.push('Adapter 보호 없음 — 늦은 응답이 최신 Queue 덮어쓸 위험(현행 store)');
  } else if (staleBlocked) { classification = 'STALE_RESPONSE_BLOCKED'; reasons.push('Adapter 가 오래된 응답 차단'); }
  else { classification = 'DETERMINISTIC'; reasons.push('우선순위+revision 으로 결정적'); }

  return { classification, winner: arb.winner?.source ?? null, reasons };
}
