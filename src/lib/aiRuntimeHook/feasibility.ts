// AI-MUSIC-9 — Runtime hook feasibility + Go/No-Go (PURE, from re-audited facts). Encodes the AI-MUSIC-9 Go
// gate: a runtime hook may be implemented ONLY when every Go condition holds. The re-audit of the latest code
// established the hard No-Go facts for this phase: no internal test store is configured, the Preview canary
// migration is not applied (the runtime resolver is uncallable), and the crossfade/recovery/preload boundary
// state lives in Player.tsx component-local refs — NOT observable from store state without modifying the
// forbidden Player.tsx. Given any No-Go, the hook is DEFERRED. Deterministic.

import type { GoNoGoResult, HookFeasibility } from './types';

export interface GoNoGoInput {
  ci357Success: boolean;
  preview357Ready: boolean;
  certificationReadyForHook: boolean;      // AI-MUSIC-8 cert == READY_FOR_ISOLATED_PREVIEW_HOOK
  internalTestStoreConfigured: boolean;
  candidatePlaylistConfigured: boolean;
  previewMigrationApplied: boolean;        // canary resolver RPCs exist in a Preview DB
  boundaryStateObservableAtRuntime: boolean; // crossfade/recovery/preload observable WITHOUT touching Player.tsx
  currentTrackPreservationProvable: boolean;
  playbackStatePreservationProvable: boolean;
  controlStoreSeparable: boolean;
  previewVsProductionDistinguishable: boolean;
  rollbackTargetPresent: boolean;
}

export function evaluateGoNoGo(i: GoNoGoInput): GoNoGoResult {
  const satisfied: string[] = [];
  const failed: string[] = [];

  const check = (ok: boolean, label: string) => { (ok ? satisfied : failed).push(label); return ok; };

  check(i.ci357Success, 'PR #357 CI success');
  check(i.preview357Ready, 'PR #357 Preview READY');
  check(i.certificationReadyForHook, 'Adapter Certification READY_FOR_ISOLATED_PREVIEW_HOOK');
  check(i.internalTestStoreConfigured, 'Internal Test Store 구성');
  check(i.candidatePlaylistConfigured, 'Candidate Playlist 구성');
  check(i.previewMigrationApplied, 'Preview Migration 적용 (Resolver 호출 가능)');
  check(i.boundaryStateObservableAtRuntime, 'Crossfade/Recovery/Preload Runtime 관측 가능');
  check(i.currentTrackPreservationProvable, 'Current Track Preservation 증명 가능');
  check(i.playbackStatePreservationProvable, 'Playback State Preservation 증명 가능');
  check(i.controlStoreSeparable, 'Control Store 분리 가능');
  check(i.previewVsProductionDistinguishable, 'Preview/Production 환경 구분 가능');
  check(i.rollbackTargetPresent, 'Rollback Target 존재');

  const go = failed.length === 0;

  let feasibility: HookFeasibility;
  let deferredReason: string | null = null;
  if (go) {
    feasibility = 'SAFE_HOOK_AVAILABLE';
  } else if (!i.boundaryStateObservableAtRuntime || !i.currentTrackPreservationProvable || !i.playbackStatePreservationProvable) {
    // The design is safe to MODEL, but the runtime hook cannot be proven safe without touching Player.tsx.
    feasibility = 'SAFE_ADAPTER_ONLY';
    deferredReason = 'Crossfade/Recovery/Preload 상태가 Player.tsx component-local 로 Runtime 관측 불가 (Player.tsx 변경 금지) + Internal Test Store/Preview Migration 미구성 → Runtime Hook DEFERRED';
  } else if (!i.internalTestStoreConfigured || !i.previewMigrationApplied) {
    feasibility = 'NOT_AVAILABLE';
    deferredReason = 'Internal Test Store / Preview Migration 미구성 → Resolver 호출 불가 → Runtime Hook DEFERRED';
  } else {
    feasibility = 'DEFERRED';
    deferredReason = 'Go 조건 미충족';
  }

  return { decision: go ? 'GO' : 'NO_GO', feasibility, satisfied, failed, runtimeHookImplemented: false, deferredReason };
}
