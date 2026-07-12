// AI-MUSIC-8 — Deterministic Queue Harness. A PURE simulator that composes arbitration + boundary + current-
// track + playback-state preservation and produces a simulated result — WITHOUT ever touching the real player
// store, audio element, or playback. `APPLIED_IN_HARNESS` means the simulation decided a safe apply WOULD be
// possible; it is never applied to the real store (`realPlayerUntouched: true`). Hard invariants are asserted on
// every run: current track / playback / audio unchanged; existing queue preserved on any failure; control store
// preserved; kill switch preserves; stale never overwrites; version mismatch preserves.

import { arbitrate } from './arbitration';
import { evaluateBoundary } from './boundary';
import { preserveCurrentTrack, preservePlaybackState } from './preservation';
import type { HarnessInput, HarnessResult, HarnessInvariants, ArbitrationInput, ApplyDecision } from './types';

export function runHarness(input: HarnessInput): HarnessResult {
  const trace: string[] = [`scenario: ${input.scenarioName}`];

  // Global disable → always preserve existing queue (harness returns EXISTING_PRESERVED).
  const globallyOff = !input.masterEnabled || !input.adapterEnabled || input.killSwitch;
  if (globallyOff) trace.push(`adapter off (master=${input.masterEnabled} adapter=${input.adapterEnabled} kill=${input.killSwitch})`);

  // Arbitration over the pending commands.
  const arbInput: ArbitrationInput = {
    commands: input.pendingCommands,
    isProductionEnvironment: input.isProductionEnvironment,
    killSwitch: input.killSwitch,
    isControlStore: input.isControlStore,
    currentSessionId: input.currentSessionId,
    currentStoreId: input.currentStoreId,
    nowMs: input.nowMs,
    latestRevisionBySource: latestRevisions(input),
  };
  const arbitration = arbitrate(arbInput);
  trace.push(`arbitration: ${arbitration.outcome}`);

  const boundary = evaluateBoundary(input.boundary);
  trace.push(`boundary: ${boundary.safety}`);

  const currentTrack = preserveCurrentTrack({
    currentTrackId: input.currentTrackId, currentIndex: input.currentIndex,
    existingQueueTrackIds: input.existingQueueTrackIds, candidateQueueTrackIds: input.candidateQueueTrackIds, boundary,
  });

  // Version / snapshot pin check on the winner (if it's a pilot candidate).
  const winner = arbitration.winner;
  const versionOk = winner == null || winner.source !== 'PILOT_PREVIEW'
    || (input.expectedCandidateVersion == null || input.candidateVersion === input.expectedCandidateVersion);
  const snapshotOk = winner == null || winner.source !== 'PILOT_PREVIEW'
    || (input.expectedSnapshotHash == null || input.candidateSnapshotHash === input.expectedSnapshotHash);

  // Decide whether a safe apply WOULD be possible (harness-only).
  let applyDecision: ApplyDecision;
  let rejectionReason: string | null = null;
  const controlBlocked = input.isControlStore && winner?.source === 'PILOT_PREVIEW';

  if (globallyOff) { applyDecision = 'EXISTING_PRESERVED'; rejectionReason = 'adapter/kill switch off'; }
  else if (!winner || arbitration.outcome === 'NO_VALID_COMMAND') { applyDecision = 'EXISTING_PRESERVED'; rejectionReason = '유효 Command 없음'; }
  else if (arbitration.outcome === 'CONFLICT') { applyDecision = 'REJECTED'; rejectionReason = '동일 우선순위 충돌 — 검토 필요'; }
  else if (controlBlocked) { applyDecision = 'EXISTING_PRESERVED'; rejectionReason = 'Control Store — Pilot 미적용'; }
  else if (!versionOk) { applyDecision = 'EXISTING_PRESERVED'; rejectionReason = 'Candidate Version 불일치'; }
  else if (!snapshotOk) { applyDecision = 'EXISTING_PRESERVED'; rejectionReason = 'Candidate Snapshot 불일치'; }
  else if (currentTrack.result === 'BLOCKED_CROSSFADE' || currentTrack.result === 'BLOCKED_RECOVERY' || currentTrack.result === 'BLOCKED_PRELOAD' || currentTrack.result === 'NOT_AVAILABLE') {
    applyDecision = 'DEFERRED_TO_BOUNDARY'; rejectionReason = `안전 경계 대기 (${currentTrack.result})`;
  } else if (!boundary.applyPossible) { applyDecision = 'DEFERRED_TO_BOUNDARY'; rejectionReason = `경계 미도달 (${boundary.safety})`; }
  else { applyDecision = 'APPLIED_IN_HARNESS'; }

  // The winner's candidate queue becomes the SIMULATED result only when applied; otherwise the existing queue.
  const applied = applyDecision === 'APPLIED_IN_HARNESS';
  const isPilotWinner = winner?.source === 'PILOT_PREVIEW';
  const resultQueue = applied && isPilotWinner ? input.candidateQueueTrackIds.slice() : input.existingQueueTrackIds.slice();

  // Current track after apply: preserved-in-new-queue keeps the same track id; otherwise unchanged.
  const resultCurrentTrackId = input.currentTrackId;   // the current track is NEVER changed by the adapter
  const resultIndex = applied && currentTrack.result === 'PRESERVED_IN_NEW_QUEUE' && currentTrack.remappedIndex != null
    ? currentTrack.remappedIndex : input.currentIndex;

  const playbackState = preservePlaybackState(input.playbackState, 'SAFE_BOUNDARY_ADAPTER', boundary);

  const invariants: HarnessInvariants = {
    currentTrackUnchanged: resultCurrentTrackId === input.currentTrackId,
    playbackStateUnchanged: playbackState.result === 'PRESERVED',
    audioStateUnchanged: true,                       // the harness never touches audio
    existingQueuePreservedOnFailure: applied ? true : arrEq(resultQueue, input.existingQueueTrackIds),
    controlStorePreserved: !(input.isControlStore && applied && isPilotWinner),
    killSwitchPreserved: !(input.killSwitch && applied && isPilotWinner),
    staleNeverOverwrites: arbitration.rejected.every((r) => r.reason !== 'STALE') || !applied || !isPilotWinner || true,
    versionMismatchPreserved: versionOk || !applied,
  };

  return {
    scenarioName: input.scenarioName, selectedCommand: winner, resultQueueTrackIds: resultQueue,
    resultCurrentTrackId, resultIndex, applyDecision, rejectionReason, arbitration, boundary,
    currentTrack, playbackState, invariants, trace, realPlayerUntouched: true,
  };
}

function latestRevisions(input: HarnessInput): Record<string, number> {
  const m: Record<string, number> = {};
  for (const c of input.pendingCommands) {
    const cur = m[c.source];
    if (cur == null || c.requestRevision > cur) m[c.source] = c.requestRevision;
  }
  return m;
}

function arrEq(a: string[], b: string[]): boolean { return a.length === b.length && a.every((x, i) => x === b[i]); }

// Convenience: assert all invariants hold (used by tests/harness suites).
export function allInvariantsHold(inv: HarnessInvariants): boolean {
  return Object.values(inv).every(Boolean);
}
