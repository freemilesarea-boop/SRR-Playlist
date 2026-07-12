// AI-MUSIC-5 — Treatment Override Layer + Preview Resolver. This is an ISOLATED, FAIL-OPEN, EXPIRING preview
// resolver ONLY — it computes which playlist a store *would* resolve to under a pilot, WITHOUT touching the
// Player, Queue, playback, or the original playlist. Runtime integration is DEFERRED (see delivery audit).
//
// Priority: [1] live treatment override (version-pinned, not expired) → [2] store playlist → [3] brand/
// enterprise playlist → [4] fallback. Control stores get NO override (control preserved). Any lookup failure
// or version mismatch fails OPEN to the store's existing path — a pilot must never break normal delivery.

import type { PilotOverride, StoreResolutionInput, StoreResolution } from './types';

function overrideLive(o: PilotOverride, nowMs: number): boolean {
  if (o.state !== 'ACTIVE') return false;                          // PAUSED/STOPPED/ROLLED_BACK/EXPIRED → not live
  if (o.expiry != null && o.expiry <= nowMs) return false;         // expired → excluded (fail toward existing path)
  if (o.start != null && o.start > nowMs) return false;            // not yet started
  if (o.end != null && o.end <= nowMs) return false;               // window closed
  return true;
}

// Resolve to the existing (non-pilot) delivery path. Used both for control stores and for every fail-open case.
function existingPath(input: StoreResolutionInput, base: Partial<StoreResolution>): StoreResolution {
  if (input.storePlaylistId) {
    return { storeId: input.storeId, source: 'STORE_PLAYLIST', playlistId: input.storePlaylistId, version: null,
      reason: '기존 Store Playlist 사용', conflict: false, controlPreserved: false, failOpen: false, ...base };
  }
  if (input.brandPlaylistId) {
    return { storeId: input.storeId, source: 'BRAND_ENTERPRISE', playlistId: input.brandPlaylistId, version: null,
      reason: 'Brand/Enterprise Playlist 사용', conflict: false, controlPreserved: false, failOpen: false, ...base };
  }
  if (input.fallbackPlaylistId) {
    return { storeId: input.storeId, source: 'FALLBACK', playlistId: input.fallbackPlaylistId, version: null,
      reason: 'Fallback Playlist 사용', conflict: false, controlPreserved: false, failOpen: false, ...base };
  }
  return { storeId: input.storeId, source: 'NONE', playlistId: null, version: null,
    reason: '해결 가능한 Playlist 없음 (NO_DATA)', conflict: false, controlPreserved: false, failOpen: false, ...base };
}

export function resolveStorePlaylist(input: StoreResolutionInput): StoreResolution {
  const o = input.override;

  // No override at all → plain existing path (not a control-preservation event, just no pilot here).
  if (!o) return existingPath(input, {});

  // Control store carrying an override binding → NEVER apply it. Control is preserved on the existing path.
  if (o.group === 'control') {
    return existingPath(input, { controlPreserved: true, reason: 'Control Store — Override 미적용 (Control 보존)' });
  }

  // Treatment override present but not live (paused/stopped/expired/out-of-window) → fail open to existing path.
  if (!overrideLive(o, input.nowMs)) {
    return existingPath(input, { failOpen: true, reason: 'Override 비활성/만료 — 기존 경로로 Fail-Open' });
  }

  // Version pin verification: the live override must match the operator-approved candidate version exactly.
  // A mismatch means an unapproved version would be served → refuse the override, fail open.
  if (input.expectedCandidateVersion != null && o.candidateVersion !== input.expectedCandidateVersion) {
    return existingPath(input, { failOpen: true, conflict: true,
      reason: `Version Pin 불일치 (기대 ${input.expectedCandidateVersion} ≠ ${o.candidateVersion}) — Fail-Open` });
  }

  // Missing candidate playlist on a live treatment override → nothing safe to serve, fail open.
  if (!o.candidatePlaylistId) {
    return existingPath(input, { failOpen: true, reason: 'Override candidate Playlist 없음 — Fail-Open' });
  }

  // All checks pass → the pilot override is what this store WOULD resolve to (preview only, not applied).
  return {
    storeId: input.storeId, source: 'PILOT_OVERRIDE',
    playlistId: o.candidatePlaylistId, version: o.candidateVersion,
    reason: 'Pilot Treatment Override (version-pinned, preview only)',
    conflict: false, controlPreserved: false, failOpen: false,
  };
}
