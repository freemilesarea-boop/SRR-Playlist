// AI-MUSIC-8 — Queue apply arbitration. When several queue commands arrive concurrently, pick at most one
// WINNER by the AUDITED real precedence (franchise > schedule > store default; recovery/manual highest; pilot
// preview lowest and never in production). Stale (older revision than the latest for its source), expired,
// wrong-session/store, and — for pilot — production/kill-switch/control commands are rejected. An existing
// resolver command is never auto-displaced by a lower-priority pilot command. Pure & deterministic; decision
// only (never applied to the real queue).

import { priorityForSource } from './commandContract';
import type { ArbitrationInput, ArbitrationResult, QueueCommand } from './types';

export function arbitrate(input: ArbitrationInput): ArbitrationResult {
  const trace: string[] = [];
  const rejected: Array<{ commandId: string; reason: string }> = [];
  if (input.commands.length === 0) return { outcome: 'NO_VALID_COMMAND', winner: null, rejected, trace: ['Command 없음'] };

  const valid: QueueCommand[] = [];
  for (const c of input.commands) {
    // Scope / expiry.
    if (c.storeId !== input.currentStoreId) { rejected.push({ commandId: c.commandId, reason: 'WRONG_STORE' }); continue; }
    if (c.playerSessionId !== input.currentSessionId) { rejected.push({ commandId: c.commandId, reason: 'WRONG_SESSION' }); continue; }
    if (c.expiresAt != null && c.expiresAt <= input.nowMs) { rejected.push({ commandId: c.commandId, reason: 'EXPIRED' }); continue; }
    // Stale: older revision than the latest for this source.
    const latestRev = input.latestRevisionBySource[c.source];
    if (latestRev != null && c.requestRevision < latestRev) { rejected.push({ commandId: c.commandId, reason: 'STALE' }); trace.push(`${c.commandId} stale (rev ${c.requestRevision}<${latestRev})`); continue; }
    // Pilot preview safety.
    if (c.source === 'PILOT_PREVIEW') {
      if (input.isProductionEnvironment) { rejected.push({ commandId: c.commandId, reason: 'PILOT_NOT_ALLOWED_IN_PRODUCTION' }); continue; }
      if (input.killSwitch) { rejected.push({ commandId: c.commandId, reason: 'KILL_SWITCH' }); continue; }
      if (input.isControlStore) { rejected.push({ commandId: c.commandId, reason: 'CONTROL_STORE' }); continue; }
    }
    valid.push(c);
  }

  if (valid.length === 0) return { outcome: 'NO_VALID_COMMAND', winner: null, rejected, trace: [...trace, '유효 Command 없음'] };

  // Highest priority wins; tie-break by newest revision, then latest requestedAt.
  valid.sort((a, b) => {
    const pa = priorityForSource(a), pb = priorityForSource(b);
    if (pa !== pb) return pb - pa;
    if (a.requestRevision !== b.requestRevision) return b.requestRevision - a.requestRevision;
    return b.requestedAt - a.requestedAt;
  });
  const winner = valid[0];
  trace.push(`winner ${winner.commandId} (${winner.source}, pri ${priorityForSource(winner)})`);

  // Losers among valid = lower priority.
  for (const c of valid.slice(1)) rejected.push({ commandId: c.commandId, reason: 'LOWER_PRIORITY' });

  if (valid.length === 1) return { outcome: 'WINNER_SELECTED', winner, rejected, trace };

  // Two valid commands at the SAME top priority from different sources = a genuine conflict needing review.
  const top = priorityForSource(winner);
  const tiedDifferentSource = valid.filter((c) => priorityForSource(c) === top).map((c) => c.source);
  if (new Set(tiedDifferentSource).size > 1) {
    return { outcome: 'CONFLICT', winner, rejected, trace: [...trace, `동일 우선순위 충돌: ${[...new Set(tiedDifferentSource)].join(', ')}`] };
  }
  return { outcome: 'WINNER_SELECTED', winner, rejected, trace };
}
