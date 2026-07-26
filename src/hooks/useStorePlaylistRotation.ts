/**
 * useStorePlaylistRotation — BRAND-PLAYLIST-ROTATION-4B.
 *
 * Completes runtime playlist-set rotation on top of the Phase-4 policy overlay. It:
 *   - fetches the STORE-SCOPED rotation pool (get_store_playlist_rotation_pool, 0461) only
 *     when the resolver says mode=play and the store is franchise-connected
 *   - validates the pool contract + rejects any cross-franchise leakage (§9)
 *   - reuses the certified selectRotationSet (via advanceRotationPlaylist) — no new algorithm
 *   - advances to the next set's playlist ONLY at QUEUE COMPLETION (a full pass of the current
 *     playlist), detected by subscribing to playerStore — WITHOUT modifying Player.tsx
 *   - persists rotation position per store so refresh continues the cycle (§12)
 *   - is fully inert for legacy/fallback/break/closed/error and for pools of size 0/1 (§16/§17)
 *
 * Role split (§14): useFranchisePolicySync owns the play-window's INITIAL slot playlist;
 * this hook owns the NEXT playlist at queue end. They don't fight because franchiseSync only
 * re-applies on a policy/slot KEY change, which rotation never triggers.
 */
import { useEffect, useRef } from 'react';
import { fetchStorePlaylistRotationPool } from '@/lib/api/franchiseApi';
import { fetchPlaylistTracks } from '@/lib/api';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { usePlayerStore } from '@/store/playerStore';
import type { PlaylistRow, TrackRow } from '@/types/db';
import {
  validateRotationPool,
  poolSignature,
  advanceRotationPlaylist,
  pickRotationAnchor,
  type RotationPoolRow,
  type RuntimeDecision,
} from '@/lib/storePlaybackRuntime';
import { shouldConsumeCycleEvent } from '@/lib/playerCycleCompletion';

interface Options {
  storeId: string | null;
  enabled: boolean;
  decision: RuntimeDecision;
}

interface RotPoolMemory {
  signature: string;
  franchiseId: string | null;
  lastSetId: string | null;
  lastPlaylistId: string | null;
  lastRotationOrder: number | null;
  updatedAt: number;
}

const MEM_PREFIX = 'srr.playback.rotpool.';

function loadMem(storeId: string): RotPoolMemory | null {
  try {
    const raw = localStorage.getItem(MEM_PREFIX + storeId);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<RotPoolMemory>;
    if (typeof p.signature !== 'string' || typeof p.lastSetId !== 'string') return null;
    return {
      signature: p.signature,
      franchiseId: typeof p.franchiseId === 'string' ? p.franchiseId : null,
      lastSetId: p.lastSetId,
      lastPlaylistId: typeof p.lastPlaylistId === 'string' ? p.lastPlaylistId : null,
      lastRotationOrder: typeof p.lastRotationOrder === 'number' ? p.lastRotationOrder : null,
      updatedAt: typeof p.updatedAt === 'number' ? p.updatedAt : 0,
    };
  } catch {
    return null;
  }
}

function saveMem(storeId: string, mem: RotPoolMemory): void {
  try {
    localStorage.setItem(MEM_PREFIX + storeId, JSON.stringify(mem));
  } catch {
    /* best-effort */
  }
}

export function useStorePlaylistRotation({ storeId, enabled, decision }: Options): void {
  // Latest inputs for the store subscription (which must not re-subscribe on every change).
  const decisionRef = useRef(decision);
  decisionRef.current = decision;
  const poolRef = useRef<RotationPoolRow[]>([]);
  const memRef = useRef<RotPoolMemory | null>(null);
  const poolFetchGenRef = useRef(0);
  const rotatingRef = useRef(false);
  // Highest cycle-completion sequence already acted on (idempotency across StrictMode).
  const lastHandledSeqRef = useRef(0);

  const active = enabled && !!storeId && decision.state === 'play';

  // ---- fetch + reconcile the rotation pool when entering play / set changes ----
  useEffect(() => {
    if (!active || !storeId) {
      poolRef.current = [];
      return;
    }
    const gen = ++poolFetchGenRef.current;
    let cancelled = false;

    (async () => {
      try {
        const resp = await fetchStorePlaylistRotationPool(storeId);
        if (cancelled || gen !== poolFetchGenRef.current) return; // stale / store changed

        const { rows, crossFranchise, dropped } = validateRotationPool(
          resp?.data,
          resp?.franchise_id ?? null,
        );
        if (crossFranchise) {
          // Security signal: never rotate on a pool that leaked another franchise (§9/§30).
          console.error('[rotation] cross-franchise rows in pool — rotation disabled for safety');
          poolRef.current = [];
          return;
        }
        if (dropped > 0) console.warn('[rotation] dropped malformed pool rows', { dropped });

        poolRef.current = rows;

        // Reconcile persisted memory (refresh continuity §12).
        const sig = poolSignature(rows, resp?.franchise_id ?? null);
        const persisted = loadMem(storeId);
        const usable =
          persisted &&
          persisted.signature === sig &&
          persisted.franchiseId === (resp?.franchise_id ?? null) &&
          rows.some((r) => r.playlistSetId === persisted.lastSetId);

        if (usable) {
          memRef.current = persisted;
        } else {
          const anchor = pickRotationAnchor(rows, decisionRef.current.playlistSetId);
          memRef.current = {
            signature: sig,
            franchiseId: resp?.franchise_id ?? null,
            lastSetId: anchor?.playlistSetId ?? null,
            lastPlaylistId: anchor?.playlistId ?? null,
            lastRotationOrder: anchor?.rotationOrder ?? null,
            updatedAt: Date.now(),
          };
          if (anchor) saveMem(storeId, memRef.current);
        }
      } catch (e) {
        if (cancelled || gen !== poolFetchGenRef.current) return;
        // Pool fetch failure → no rotation; resolver playlist keeps playing (§14/§16).
        console.warn('[rotation] pool fetch failed — using resolver playlist', e);
        poolRef.current = [];
      }
    })();

    return () => {
      cancelled = true;
    };
    // Re-fetch when the store, enablement, franchise, or resolver set changes.
  }, [active, storeId, decision.playlistSetId, decision.playlistId, decision.timezone]);

  // ---- explicit cycle-completion consumer → advance to the next set's playlist ----
  // (4C) Replaces the former queue-index-wrap heuristic. We act ONLY on the store's
  // cycleEvent (emitted by next({cause:'audio_ended'}) at a real last-track/single-track
  // end), so manual prev/next/jumpTo/setQueue and single-track queues are handled correctly.
  useEffect(() => {
    if (!enabled || !storeId) return;

    const advanceFor = async (playlistIdAtCompletion: string | null) => {
      const pool = poolRef.current;
      const mem = memRef.current;
      if (!mem) {
        rotatingRef.current = false;
        return;
      }
      // The completed playlist is authoritative for "where we are" in the rotation.
      const currentPlaylistId = playlistIdAtCompletion ?? mem.lastPlaylistId;
      const choice = advanceRotationPlaylist(pool, mem.lastSetId, currentPlaylistId);
      if (!choice || choice.playlistId === currentPlaylistId) {
        rotatingRef.current = false; // pool of 1 / all-dup → keep current playlist
        return;
      }
      try {
        const tracks = await fetchPlaylistTracks(choice.playlistId, storeId);
        const playable = filterPlayableTracks(tracks).playable;
        if (playable.length === 0) {
          // Empty playlist → skip this set; try the next distinct one, else keep current (§14).
          console.warn('[rotation] next set playlist empty — skipping', { setId: choice.set.playlistSetId });
          const alt = advanceRotationPlaylist(pool, choice.set.playlistSetId, choice.playlistId);
          if (alt && alt.playlistId !== currentPlaylistId && alt.playlistId !== choice.playlistId) {
            const altTracks = await fetchPlaylistTracks(alt.playlistId, storeId);
            const altPlayable = filterPlayableTracks(altTracks).playable;
            if (altPlayable.length > 0) applyRotationQueue(alt, altPlayable, storeId, memRef, saveMem);
          }
          return;
        }
        applyRotationQueue(choice, playable, storeId, memRef, saveMem);
      } catch (e) {
        console.warn('[rotation] failed to load next playlist — keeping current queue', e);
      } finally {
        rotatingRef.current = false;
      }
    };

    const unsub = usePlayerStore.subscribe((state, prev) => {
      const ev = state.cycleEvent;
      if (ev == null || ev === prev.cycleEvent) return; // only fire on a NEW cycle event
      const d = decisionRef.current;
      const decision = shouldConsumeCycleEvent(ev, {
        active: enabled && !!storeId && d.state === 'play',
        suppressed: state.scheduleSuppressed,
        currentQueueGeneration: state.queueGeneration,
        currentPlaylistId: state.playlist?.id ?? null,
        lastHandledSequence: lastHandledSeqRef.current,
        poolSize: poolRef.current.length,
        rotating: rotatingRef.current,
      });
      if (!decision.consume) return;
      // Mark handled + lock BEFORE the async load (idempotency + concurrency).
      lastHandledSeqRef.current = ev.sequence;
      rotatingRef.current = true;
      void advanceFor(ev.playlistId);
    });

    return () => unsub();
  }, [enabled, storeId]);
}

/** Load the chosen rotation playlist into the queue + persist memory. */
function applyRotationQueue(
  choice: { set: RotationPoolRow; playlistId: string },
  playable: TrackRow[],
  storeId: string,
  memRef: React.MutableRefObject<RotPoolMemory | null>,
  persist: (storeId: string, mem: RotPoolMemory) => void,
): void {
  const playlistRow: PlaylistRow = {
    id: choice.playlistId,
    title: choice.set.name,
    category: 'business',
    business_category: null,
    thumbnail_url: null,
    description: null,
    is_business_only: true,
    time_slot: null,
    sort_order: 0,
    created_at: new Date().toISOString(),
  };
  usePlayerStore.getState().setQueue(playable, 0, playlistRow, null, { dailySeedShuffle: true });
  const prev = memRef.current;
  if (prev) {
    memRef.current = {
      ...prev,
      lastSetId: choice.set.playlistSetId,
      lastPlaylistId: choice.playlistId,
      lastRotationOrder: choice.set.rotationOrder,
      updatedAt: Date.now(),
    };
    persist(storeId, memRef.current);
  }
  console.info('[rotation] advanced to next set', { set: choice.set.name });
}
