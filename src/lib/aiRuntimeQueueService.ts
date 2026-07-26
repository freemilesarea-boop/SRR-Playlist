/**
 * aiRuntimeQueueService.ts — Phase AI-RUNTIME-CONNECTION-1
 *
 * Orchestrates the store runtime queue decision. NEVER THROWS — the store player
 * must always receive a usable queue.
 *
 * Flow (spec §4):
 *   1. Static queue is obtained by the CALLER first (passed in as `staticTracks`).
 *   2. Read effective mode (server-authoritative, cached per store to avoid RPC storms).
 *   3. OFF     → return static (byte-identical legacy behavior).
 *   4. SHADOW  → compute AI candidate comparison for telemetry, but RETURN STATIC.
 *   5. PREVIEW → fetch AI candidate queue, re-rank static tracks; on empty/error →
 *                immediate static fallback (the already-obtained static list).
 *
 * Refresh (spec §10): mode is cached for a short TTL; the queue is rebuilt only on
 * the caller's existing triggers (initial entry, rotation, manual change, refresh),
 * never per-track or per-reaction. No polling here.
 */
import type { TrackRow } from '@/types/db';
import {
  composeRuntimeQueue,
  staticRuntimeQueue,
  computeShadowComparison,
  type RuntimeQueueResult,
  type AiRuntimeModeInfo,
} from '@/lib/aiRuntimeResolver';
import { fetchStoreAiRuntimeMode, fetchStoreAiRuntimeQueue } from '@/lib/api/aiRuntimeApi';

const MODE_TTL_MS = 5 * 60 * 1000; // 5 min — admin changes are rare; avoids per-rotation RPC.

interface CacheEntry {
  info: AiRuntimeModeInfo;
  at: number;
}
const modeCache = new Map<string, CacheEntry>();

/** Clear the mode cache (admin refresh / tests). */
export function invalidateRuntimeModeCache(storeId?: string): void {
  if (storeId) modeCache.delete(storeId);
  else modeCache.clear();
}

async function getMode(storeId: string): Promise<AiRuntimeModeInfo> {
  const now = Date.now();
  const cached = modeCache.get(storeId);
  if (cached && now - cached.at < MODE_TTL_MS) return cached.info;
  const info = await fetchStoreAiRuntimeMode(storeId);
  modeCache.set(storeId, { info, at: now });
  return info;
}

export interface ResolveRuntimeQueueArgs {
  storeId: string;
  playlistId: string;
  staticTracks: TrackRow[];
  currentTrackId?: string | null;
}

/**
 * Resolve the runtime queue for a store. Returns the tracks to install plus
 * whether the caller should apply the legacy daily-seed shuffle. Never throws.
 */
export async function resolveStoreRuntimeQueue(
  args: ResolveRuntimeQueueArgs,
): Promise<RuntimeQueueResult> {
  const { storeId, playlistId, staticTracks, currentTrackId } = args;
  const staticResult = staticRuntimeQueue(staticTracks);

  try {
    if (!storeId || !playlistId || staticTracks.length === 0) return staticResult;

    const info = await getMode(storeId);
    if (info.mode === 'off') return staticResult;

    // Both preview & shadow need the candidate queue.
    let candidates;
    try {
      candidates = await fetchStoreAiRuntimeQueue(storeId, playlistId, info.maxAiTracks);
    } catch (e) {
      // disabled / permission / network → static (fallback for preview, plain static for shadow)
      if (import.meta.env.DEV) console.debug('[aiRuntime] candidate fetch failed', (e as Error)?.message);
      return info.mode === 'preview'
        ? { ...staticResult, source: 'static_fallback', fallbackUsed: true, fallbackReason: 'candidate_fetch_failed' }
        : staticResult;
    }

    const composeOpts = {
      minimumFitScore: info.minimumFitScore,
      maxAiTracks: info.maxAiTracks,
      currentTrackId: currentTrackId ?? null,
    };

    if (info.mode === 'shadow') {
      // SHADOW: never affects playback — compute comparison telemetry, return static.
      if (import.meta.env.DEV) {
        const cmp = computeShadowComparison(staticTracks, candidates, composeOpts);
        console.debug('[aiRuntime:shadow]', {
          static: cmp.staticCount, candidate: cmp.candidateCount,
          blocked: cmp.blockedCount, penalized: cmp.penalizedCount,
          topDiff: cmp.topTrackDiffers, orderDiff: cmp.orderDiffCount,
        });
      }
      return staticResult;
    }

    // PREVIEW: apply the AI re-rank, with immediate static fallback on empty/short.
    return composeRuntimeQueue(staticTracks, candidates, composeOpts);
  } catch (e) {
    // Any unexpected error → never break playback.
    if (import.meta.env.DEV) console.debug('[aiRuntime] resolve failed → static', (e as Error)?.message);
    return staticResult;
  }
}
