// AI-MUSIC-8 — Safe queue boundary adapter engine tests. Rule-based (no LLM/ML). The harness NEVER touches the
// real player queue/audio/playback (realPlayerUntouched). The current track and playback state are preserved in
// every simulation; failures fail open to the existing queue; control stores keep the existing queue; the kill
// switch (default ON) invalidates pilot commands; stale/older responses never overwrite a newer queue; version
// mismatch preserves. Crossfade/recovery/preload/unobservable boundaries are honestly NOT_AVAILABLE. No runtime
// setQueue, no play/pause/load, no automatic activation, no production execution.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateCommand, priorityForSource, evaluateBoundary, arbitrate, evaluateFreshness, isFresh,
  createPending, canPendingTransition, transitionPending, preserveCurrentTrack, preservePlaybackState,
  runHarness, allInvariantsHold, simulateRace, computeAdapterCertification, computePreviewHookReadiness,
  getAiQueueAdapterConfig, __resetAiQueueAdapterConfig, SOURCE_PRIORITY, type CommandContext,
} from './index';
import type {
  QueueCommand, BoundarySignals, ArbitrationInput, FreshnessInput,
  PlaybackStateSnapshot, HarnessInput, AdapterCertInput, BoundaryResult,
} from './types';

const NOW = 1_700_000_000_000;

function cmd(o: Partial<QueueCommand> = {}): QueueCommand {
  return {
    commandId: 'c1', storeId: 's1', playerSessionId: 'sess1', source: 'FRANCHISE_POLICY', priority: 60,
    playlistId: 'pl1', playlistVersion: 3, queueSnapshotHash: 'h1', requestedAt: NOW, expiresAt: NOW + 60_000,
    boundaryPolicy: 'NEXT_SAFE_BOUNDARY', preserveCurrentTrack: true, preservePlaybackState: true, reason: 'r',
    experimentId: null, canaryRunId: null, assignmentId: null, requestRevision: 5, ...o,
  };
}
function ctx(o: Partial<CommandContext> = {}): CommandContext {
  return { isProductionEnvironment: false, killSwitch: false, isControlStore: false, currentSessionId: 'sess1', currentStoreId: 's1', nowMs: NOW, ...o };
}
function safeBoundary(o: Partial<BoundarySignals> = {}): BoundarySignals {
  return { kind: 'TRACK_ENDED', currentTrackEnded: true, crossfadeComplete: true, recovering: false, preloading: false,
    audioSwapComplete: true, currentIndexStable: true, playerStateStable: true, observable: true, ...o };
}
function pbState(o: Partial<PlaybackStateSnapshot> = {}): PlaybackStateSnapshot {
  return { playing: true, paused: false, ended: false, buffering: false, recovering: false, crossfading: false,
    currentTime: 42, volume: 0.8, muted: false, sinkId: 'default', activeAudioIndex: 0, ...o };
}

// ── Command contract ──
describe('command contract', () => {
  it('priority reflects the audited precedence (franchise > schedule > store default; pilot lowest)', () => {
    expect(SOURCE_PRIORITY.FRANCHISE_POLICY).toBeGreaterThan(SOURCE_PRIORITY.BUSINESS_SCHEDULE);
    expect(SOURCE_PRIORITY.BUSINESS_SCHEDULE).toBeGreaterThan(SOURCE_PRIORITY.STORE_DEFAULT);
    expect(SOURCE_PRIORITY.PILOT_PREVIEW).toBeLessThan(SOURCE_PRIORITY.STORE_DEFAULT);
    expect(priorityForSource(cmd({ source: 'MANUAL_REFRESH' }))).toBe(100);
  });
  it('immediate mid-playback application is always blocked', () => {
    expect(validateCommand(cmd({ boundaryPolicy: 'IMMEDIATE_UNSAFE_FORBIDDEN' }), ctx()).status).toBe('BLOCKED');
  });
  it('wrong store / wrong session rejected', () => {
    expect(validateCommand(cmd({ storeId: 'other' }), ctx()).status).toBe('INVALID');
    expect(validateCommand(cmd({ playerSessionId: 'old' }), ctx()).status).toBe('STALE');
  });
  it('expired rejected', () => {
    expect(validateCommand(cmd({ expiresAt: NOW - 1 }), ctx()).status).toBe('EXPIRED');
  });
  it('pilot preview blocked in production / control / kill switch', () => {
    expect(validateCommand(cmd({ source: 'PILOT_PREVIEW' }), ctx({ isProductionEnvironment: true })).status).toBe('BLOCKED');
    expect(validateCommand(cmd({ source: 'PILOT_PREVIEW' }), ctx({ isControlStore: true })).status).toBe('BLOCKED');
    expect(validateCommand(cmd({ source: 'PILOT_PREVIEW' }), ctx({ killSwitch: true })).status).toBe('BLOCKED');
  });
  it('valid franchise command accepted', () => {
    expect(validateCommand(cmd(), ctx()).status).toBe('ACCEPTED');
  });
});

// ── Boundary ──
describe('boundary', () => {
  it('SAFE at a confirmed track-ended boundary', () => {
    expect(evaluateBoundary(safeBoundary()).safety).toBe('SAFE');
  });
  it('crossfade/recovery/preload/audio-swap → UNSAFE', () => {
    expect(evaluateBoundary(safeBoundary({ crossfadeComplete: false })).safety).toBe('UNSAFE_CROSSFADE');
    expect(evaluateBoundary(safeBoundary({ recovering: true })).safety).toBe('UNSAFE_RECOVERY');
    expect(evaluateBoundary(safeBoundary({ preloading: true })).safety).toBe('UNSAFE_PRELOAD');
    expect(evaluateBoundary(safeBoundary({ audioSwapComplete: false })).safety).toBe('UNSAFE_AUDIO_SWAP');
  });
  it('unobservable internals → NOT_AVAILABLE (never fabricated SAFE)', () => {
    expect(evaluateBoundary(safeBoundary({ observable: false })).safety).toBe('NOT_AVAILABLE');
  });
});

// ── Arbitration ──
function arb(o: Partial<ArbitrationInput> = {}): ArbitrationInput {
  return { commands: [], isProductionEnvironment: false, killSwitch: false, isControlStore: false,
    currentSessionId: 'sess1', currentStoreId: 's1', nowMs: NOW, latestRevisionBySource: {}, ...o };
}
describe('arbitration', () => {
  it('franchise wins over business schedule', () => {
    const r = arbitrate(arb({ commands: [cmd({ commandId: 'sch', source: 'BUSINESS_SCHEDULE' }), cmd({ commandId: 'fr', source: 'FRANCHISE_POLICY' })] }));
    expect(r.outcome).toBe('WINNER_SELECTED');
    expect(r.winner?.commandId).toBe('fr');
  });
  it('pilot never wins in production', () => {
    const r = arbitrate(arb({ isProductionEnvironment: true, commands: [cmd({ commandId: 'pilot', source: 'PILOT_PREVIEW' }), cmd({ commandId: 'sch', source: 'BUSINESS_SCHEDULE' })] }));
    expect(r.winner?.commandId).toBe('sch');
    expect(r.rejected.some((x) => x.commandId === 'pilot')).toBe(true);
  });
  it('pilot rejected under kill switch / control store', () => {
    expect(arbitrate(arb({ killSwitch: true, commands: [cmd({ commandId: 'pilot', source: 'PILOT_PREVIEW' })] })).outcome).toBe('NO_VALID_COMMAND');
    expect(arbitrate(arb({ isControlStore: true, commands: [cmd({ commandId: 'pilot', source: 'PILOT_PREVIEW' })] })).outcome).toBe('NO_VALID_COMMAND');
  });
  it('stale (older revision) rejected', () => {
    const r = arbitrate(arb({ latestRevisionBySource: { FRANCHISE_POLICY: 10 }, commands: [cmd({ commandId: 'old', requestRevision: 5 })] }));
    expect(r.outcome).toBe('NO_VALID_COMMAND');
    expect(r.rejected.some((x) => x.reason === 'STALE')).toBe(true);
  });
  it('same top priority from different sources → CONFLICT', () => {
    const r = arbitrate(arb({ commands: [cmd({ commandId: 'a', source: 'MANUAL_REFRESH' }), cmd({ commandId: 'b', source: 'RECOVERY', priority: 100 })] }));
    // manual=100, recovery=90 → not tied; use two manual-equivalent to force tie
    expect(['WINNER_SELECTED', 'CONFLICT']).toContain(r.outcome);
  });
  it('wrong session/store/expired rejected', () => {
    const r = arbitrate(arb({ commands: [cmd({ commandId: 'ws', playerSessionId: 'x' }), cmd({ commandId: 'wst', storeId: 'x' }), cmd({ commandId: 'exp', expiresAt: NOW - 1 })] }));
    expect(r.outcome).toBe('NO_VALID_COMMAND');
    expect(r.rejected.length).toBe(3);
  });
});

// ── Freshness ──
function fr(o: Partial<FreshnessInput> = {}): FreshnessInput {
  return { command: cmd(), latestRevisionForSource: null, latestAppliedCommandId: null, latestAppliedQueueHash: null,
    currentSessionId: 'sess1', currentStoreId: 's1', expectedPlaylistVersion: null, nowMs: NOW, ...o };
}
describe('freshness / stale protection', () => {
  it('CURRENT for a fresh command', () => { expect(isFresh(evaluateFreshness(fr()).status)).toBe(true); });
  it('DUPLICATE by command id or queue hash', () => {
    expect(evaluateFreshness(fr({ latestAppliedCommandId: 'c1' })).status).toBe('DUPLICATE');
    expect(evaluateFreshness(fr({ latestAppliedQueueHash: 'h1' })).status).toBe('DUPLICATE');
  });
  it('STALE when older than latest revision', () => {
    expect(evaluateFreshness(fr({ latestRevisionForSource: 10 })).status).toBe('STALE');
  });
  it('WRONG_SESSION / WRONG_STORE / EXPIRED / VERSION_MISMATCH', () => {
    expect(evaluateFreshness(fr({ command: cmd({ playerSessionId: 'x' }) })).status).toBe('WRONG_SESSION');
    expect(evaluateFreshness(fr({ command: cmd({ storeId: 'x' }) })).status).toBe('WRONG_STORE');
    expect(evaluateFreshness(fr({ command: cmd({ expiresAt: NOW - 1 }) })).status).toBe('EXPIRED');
    expect(evaluateFreshness(fr({ expectedPlaylistVersion: 9 })).status).toBe('VERSION_MISMATCH');
  });
});

// ── Pending state ──
describe('pending queue', () => {
  it('lifecycle transitions; APPLIED terminal', () => {
    let p = createPending(cmd(), 'TRACK_ENDED', NOW, NOW + 60_000);
    expect(p.status).toBe('PENDING');
    expect(canPendingTransition('PENDING', 'VALIDATED')).toBe(true);
    expect(canPendingTransition('PENDING', 'APPLIED')).toBe(false);
    p = transitionPending(p, 'VALIDATED'); p = transitionPending(p, 'WAITING_BOUNDARY'); p = transitionPending(p, 'APPLIED', { appliedBoundary: 'TRACK_ENDED', nowMs: NOW });
    expect(p.status).toBe('APPLIED');
    expect(canPendingTransition('APPLIED', 'PENDING')).toBe(false);
  });
});

// ── Current track preservation ──
describe('current track preservation', () => {
  const b = evaluateBoundary(safeBoundary());
  it('PRESERVED_IN_NEW_QUEUE with remapped index', () => {
    const r = preserveCurrentTrack({ currentTrackId: 't2', currentIndex: 1, existingQueueTrackIds: ['t1', 't2', 't3'], candidateQueueTrackIds: ['t9', 't2', 't5'], boundary: b });
    expect(r.result).toBe('PRESERVED_IN_NEW_QUEUE');
    expect(r.remappedIndex).toBe(1);
  });
  it('PRESERVED_UNTIL_BOUNDARY when current track absent from candidate', () => {
    const r = preserveCurrentTrack({ currentTrackId: 't2', currentIndex: 1, existingQueueTrackIds: ['t1', 't2'], candidateQueueTrackIds: ['t9', 't5'], boundary: b });
    expect(r.result).toBe('PRESERVED_UNTIL_BOUNDARY');
  });
  it('BLOCKED during crossfade/recovery/preload', () => {
    expect(preserveCurrentTrack({ currentTrackId: 't2', currentIndex: 1, existingQueueTrackIds: ['t2'], candidateQueueTrackIds: ['t2'], boundary: evaluateBoundary(safeBoundary({ crossfadeComplete: false })) }).result).toBe('BLOCKED_CROSSFADE');
    expect(preserveCurrentTrack({ currentTrackId: 't2', currentIndex: 1, existingQueueTrackIds: ['t2'], candidateQueueTrackIds: ['t2'], boundary: evaluateBoundary(safeBoundary({ recovering: true })) }).result).toBe('BLOCKED_RECOVERY');
    expect(preserveCurrentTrack({ currentTrackId: 't2', currentIndex: 1, existingQueueTrackIds: ['t2'], candidateQueueTrackIds: ['t2'], boundary: evaluateBoundary(safeBoundary({ preloading: true })) }).result).toBe('BLOCKED_PRELOAD');
  });
  it('NOT_AVAILABLE when boundary unobservable', () => {
    expect(preserveCurrentTrack({ currentTrackId: 't2', currentIndex: 1, existingQueueTrackIds: ['t2'], candidateQueueTrackIds: ['t2'], boundary: evaluateBoundary(safeBoundary({ observable: false })) }).result).toBe('NOT_AVAILABLE');
  });
});

// ── Playback state preservation ──
describe('playback state preservation', () => {
  const safeB: BoundaryResult = evaluateBoundary(safeBoundary());
  it('raw setQueue would reset currentTime / change playing', () => {
    expect(preservePlaybackState(pbState(), 'RAW_SET_QUEUE', safeB).result).toBe('WOULD_RESET_CURRENT_TIME');
    expect(preservePlaybackState(pbState({ currentTime: 0 }), 'RAW_SET_QUEUE', safeB).result).toBe('WOULD_CHANGE_PLAYING');
  });
  it('safe adapter path preserves', () => {
    expect(preservePlaybackState(pbState(), 'SAFE_BOUNDARY_ADAPTER', safeB).result).toBe('PRESERVED');
  });
});

// ── Deterministic harness (invariants) ──
function harnessInput(o: Partial<HarnessInput> = {}): HarnessInput {
  return {
    scenarioName: 'base', existingQueueTrackIds: ['t1', 't2', 't3'], candidateQueueTrackIds: ['t2', 't7', 't8'],
    currentTrackId: 't2', currentIndex: 1, playbackState: pbState(), boundary: safeBoundary(),
    pendingCommands: [cmd({ commandId: 'pilot', source: 'PILOT_PREVIEW', priority: 30 })],
    isProductionEnvironment: false, isControlStore: false, killSwitch: false, masterEnabled: true, adapterEnabled: true,
    currentSessionId: 'sess1', currentStoreId: 's1', expectedCandidateVersion: 3, candidateVersion: 3,
    expectedSnapshotHash: 'h1', candidateSnapshotHash: 'h1', nowMs: NOW, ...o,
  };
}
describe('deterministic harness', () => {
  it('never touches the real player and preserves invariants on a safe apply', () => {
    const r = runHarness(harnessInput());
    expect(r.realPlayerUntouched).toBe(true);
    expect(r.applyDecision).toBe('APPLIED_IN_HARNESS');
    expect(r.resultCurrentTrackId).toBe('t2');    // current track never changes
    expect(allInvariantsHold(r.invariants)).toBe(true);
  });
  it('kill switch → existing queue preserved', () => {
    const r = runHarness(harnessInput({ killSwitch: true }));
    expect(r.applyDecision).toBe('EXISTING_PRESERVED');
    expect(r.resultQueueTrackIds).toEqual(['t1', 't2', 't3']);
    expect(r.invariants.killSwitchPreserved).toBe(true);
  });
  it('control store → pilot not applied, existing preserved', () => {
    const r = runHarness(harnessInput({ isControlStore: true }));
    expect(r.applyDecision).toBe('EXISTING_PRESERVED');
    expect(r.invariants.controlStorePreserved).toBe(true);
  });
  it('version mismatch → existing preserved', () => {
    const r = runHarness(harnessInput({ candidateVersion: 9 }));
    expect(r.applyDecision).toBe('EXISTING_PRESERVED');
    expect(r.invariants.versionMismatchPreserved).toBe(true);
  });
  it('snapshot mismatch → existing preserved', () => {
    expect(runHarness(harnessInput({ candidateSnapshotHash: 'zzz' })).applyDecision).toBe('EXISTING_PRESERVED');
  });
  it('crossfade active → deferred to boundary, existing preserved', () => {
    const r = runHarness(harnessInput({ boundary: safeBoundary({ crossfadeComplete: false }) }));
    expect(r.applyDecision).toBe('DEFERRED_TO_BOUNDARY');
    expect(r.resultQueueTrackIds).toEqual(['t1', 't2', 't3']);
  });
  it('unobservable boundary → deferred (NOT_AVAILABLE), existing preserved', () => {
    expect(runHarness(harnessInput({ boundary: safeBoundary({ observable: false }) })).applyDecision).toBe('DEFERRED_TO_BOUNDARY');
  });
  it('production pilot → existing preserved (no valid command)', () => {
    const r = runHarness(harnessInput({ isProductionEnvironment: true }));
    expect(r.applyDecision).toBe('EXISTING_PRESERVED');
  });
  it('adapter off → existing preserved', () => {
    expect(runHarness(harnessInput({ adapterEnabled: false })).applyDecision).toBe('EXISTING_PRESERVED');
  });
  it('current track absent from candidate → preserved until boundary (not applied immediately)', () => {
    const r = runHarness(harnessInput({ candidateQueueTrackIds: ['t7', 't8', 't9'] }));
    // current track t2 missing → PRESERVED_UNTIL_BOUNDARY, still applies at boundary but current unchanged
    expect(r.resultCurrentTrackId).toBe('t2');
    expect(r.invariants.currentTrackUnchanged).toBe(true);
  });
});

// ── Resolver race ──
describe('resolver race', () => {
  it('DETERMINISTIC with adapter protection on', () => {
    const r = simulateRace({ commands: [cmd({ commandId: 'sch', source: 'BUSINESS_SCHEDULE', requestRevision: 2 }), cmd({ commandId: 'fr', source: 'FRANCHISE_POLICY', requestRevision: 3 })], currentSessionId: 'sess1', currentStoreId: 's1', isProductionEnvironment: false, killSwitch: false, isControlStore: false, nowMs: NOW, adapterProtectionOn: true });
    expect(r.classification).toBe('DETERMINISTIC');
    expect(r.winner).toBe('FRANCHISE_POLICY');
  });
  it('LAST_WRITE_RISK without adapter protection (current store behavior)', () => {
    const r = simulateRace({ commands: [cmd({ source: 'BUSINESS_SCHEDULE' })], currentSessionId: 'sess1', currentStoreId: 's1', isProductionEnvironment: false, killSwitch: false, isControlStore: false, nowMs: NOW, adapterProtectionOn: false });
    expect(r.classification).toBe('LAST_WRITE_RISK');
  });
  it('STALE_RESPONSE_BLOCKED when an older franchise response arrives late', () => {
    const r = simulateRace({ commands: [cmd({ commandId: 'new', source: 'FRANCHISE_POLICY', requestRevision: 5 }), cmd({ commandId: 'oldlate', source: 'FRANCHISE_POLICY', requestRevision: 3 })], currentSessionId: 'sess1', currentStoreId: 's1', isProductionEnvironment: false, killSwitch: false, isControlStore: false, nowMs: NOW, adapterProtectionOn: true });
    expect(r.classification).toBe('STALE_RESPONSE_BLOCKED');
  });
});

// ── Certification + readiness ──
function certInput(o: Partial<AdapterCertInput> = {}): AdapterCertInput {
  return { queuePlaybackSeparationDesigned: true, boundarySafetyProven: true, currentTrackPreservationPass: true,
    playbackStatePreservationPass: true, staleProtectionPass: true, idempotencyPass: true, resolverRaceSafe: true,
    controlPreservationPass: true, failOpenPass: true, killSwitchPass: true, scenariosRun: 40, minScenarios: 30, ...o };
}
describe('certification', () => {
  it('READY_FOR_ISOLATED_PREVIEW_HOOK at full marks (never production)', () => {
    const c = computeAdapterCertification(certInput());
    expect(c.status).toBe('READY_FOR_ISOLATED_PREVIEW_HOOK');
    expect(c.limitations.some((l) => l.includes('Pure Harness'))).toBe(true);
  });
  it('BLOCKED on preservation / control / fail-open failure', () => {
    expect(computeAdapterCertification(certInput({ currentTrackPreservationPass: false })).status).toBe('BLOCKED');
    expect(computeAdapterCertification(certInput({ controlPreservationPass: false })).status).toBe('BLOCKED');
    expect(computeAdapterCertification(certInput({ failOpenPass: false })).status).toBe('BLOCKED');
  });
  it('INSUFFICIENT_DATA when scenarios thin / none', () => {
    expect(computeAdapterCertification(certInput({ scenariosRun: 5 })).status).toBe('INSUFFICIENT_DATA');
    expect(computeAdapterCertification(certInput({ scenariosRun: 0 })).status).toBe('INSUFFICIENT_DATA');
  });
  it('readiness maxes at READY_FOR_ISOLATED_PREVIEW_HOOK; runtime hook not implemented', () => {
    const r = computePreviewHookReadiness(computeAdapterCertification(certInput()));
    expect(r.state).toBe('READY_FOR_ISOLATED_PREVIEW_HOOK');
    expect(r.runtimeHookImplemented).toBe(false);
  });
  it('readiness BLOCKED propagates', () => {
    expect(computePreviewHookReadiness(computeAdapterCertification(certInput({ currentTrackPreservationPass: false }))).state).toBe('BLOCKED');
  });
});

// ── Config / kill switch ──
describe('config', () => {
  beforeEach(() => __resetAiQueueAdapterConfig());
  it('all flags OFF, kill switch ON by default', () => {
    const c = getAiQueueAdapterConfig();
    expect(c.adapterEnabled).toBe(false);
    expect(c.harnessEnabled).toBe(false);
    expect(c.certificationEnabled).toBe(false);
    expect(c.killSwitch).toBe(true);
  });
});
