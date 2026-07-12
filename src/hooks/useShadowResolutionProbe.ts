// AI-MUSIC-6 — Shadow Resolution Probe (fire-and-forget, fail-open, flag-gated OFF by default).
//
// This is the ONLY runtime hook of the shadow layer. It observes the RESULT of the existing resolver AFTER it
// has finalized a playlist (the effect is keyed on the resolved playlist id) and, only when explicitly enabled,
// best-effort computes + ingests a low-frequency, privacy-safe shadow decision event. It NEVER:
//   • awaits in the render/playback path (the effect body is synchronous; ingest is fire-and-forget),
//   • changes setQueue inputs, the queue, the resolved playlist, or any existing dependency array,
//   • affects polling, timeouts, or control flow.
// Any error is swallowed. With flags OFF (default/prod) the effect returns immediately — zero network, zero
// behavior change. The shadow result is never used for actual playback. Runtime pilot-binding lookup is not
// available in this phase, so the probe records the observed existing resolution (no-assignment) only.

import { useEffect, useRef } from 'react';
import { getAiShadowConfig, shadowEvaluationAllowed, type SelectionSource, type ShadowResolverInput } from '@/lib/aiShadow';
import { evaluateShadow, ingestShadowEventsBestEffort } from '@/lib/api/aiShadowApi';

interface Options {
  storeId: string | null;
  playlistId: string | null;
  source?: SelectionSource;
  enabled?: boolean;
}

export function useShadowResolutionProbe({ storeId, playlistId, source = 'STORE_PLAYLIST', enabled = true }: Options): void {
  // One opaque session token per mount (NOT a user id; used only as a hashed grouping key). No randomness in
  // any engine — this token is UI-only and never affects a resolution decision.
  const sessionRef = useRef<string>('');
  if (sessionRef.current === '') {
    try { sessionRef.current = (crypto?.randomUUID?.() ?? `s-${Date.now()}`); } catch { sessionRef.current = `s-${Date.now()}`; }
  }

  useEffect(() => {
    // Hard gate: master + resolution flag on, kill switch off, ingest flag on. Default = all OFF → no-op.
    if (!enabled || !storeId || !playlistId) return;
    const cfg = getAiShadowConfig();
    if (!shadowEvaluationAllowed(cfg) || !cfg.eventIngestEnabled) return;
    // Sampling (UI-side; never touches a resolution). Below the rate → skip.
    try { if (Math.random() > cfg.samplingRate) return; } catch { /* noop */ }

    // Fire-and-forget — no await here; the existing resolver has already finalized the playlist.
    try {
      const input: ShadowResolverInput = {
        storeId, resolvedAt: Date.now(),
        existing: { storeId, selectedPlaylistId: playlistId, selectionSource: source, version: null, reason: 'existing resolver result (observed)' },
        // Pilot binding lookup is not wired in this phase → no assignment → shadow returns the existing result.
        experimentId: null, pilotRunId: null, assignmentId: null, assignmentGroup: null,
        candidatePlaylistId: null, candidateVersion: null, expectedCandidateVersion: null,
        overrideStatus: null, overrideStart: null, overrideEnd: null, expiry: null,
        conflictingActivePilot: false, overrideFlagEnabled: false, shadowError: false,
      };
      const { event } = evaluateShadow(input, sessionRef.current);
      ingestShadowEventsBestEffort([event]);
    } catch { /* swallow — a shadow probe must never affect the store player */ }
    // Keyed on the resolved playlist id + store — fires once per resolution, isolated from playback.
  }, [playlistId, storeId, source, enabled]);
}
