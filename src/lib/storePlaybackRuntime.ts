/**
 * storePlaybackRuntime — I/O-boundary adapter that turns a resolver RPC response
 * (`resolve_store_playback_policy` → StorePlaybackResolution) into a validated,
 * fail-safe runtime decision the Store Player can act on WITHOUT re-interpreting
 * the DB contract.
 *
 * Pure & framework-free apart from the clearly-marked localStorage helpers at the
 * bottom. It reuses the certified pure core in ./storePlaybackPolicy (rotation,
 * break/resume decisions) and never re-implements scheduling math. The DB resolver
 * stays the single source of truth for mode / next_transition_at / timezone
 * (spec §12); this module only:
 *   - validates the response contract (spec §4)
 *   - maps it to a runtime state incl. legacy fallback (spec §2, §5)
 *   - refuses to silently "play" on a bad/ambiguous contract (spec §20)
 *   - computes a safe setTimeout delay for the next transition (spec §11)
 *
 * Runtime state model (spec §2):
 *   legacy         — no franchise integration attempted; existing player owns playback
 *   policy_loading — first evaluation in flight; do not start/stop anything yet
 *   play           — franchise policy says play; existing playlist path may run
 *   break          — intentional silence window; audio must be paused
 *   closed         — outside operating hours; audio must be paused
 *   fallback       — resolver returned has_franchise_policy=false → legacy playback
 *   error          — RPC/contract failure → fail-safe (never forces closed)
 */
import type { StorePlaybackResolution, PlaybackMode, PolicySource } from '@/lib/api/franchiseApi';
import { selectRotationSet, type RotationSet } from '@/lib/storePlaybackPolicy';

export type PlayerRuntimeState =
  | 'legacy'
  | 'policy_loading'
  | 'play'
  | 'break'
  | 'closed'
  | 'fallback'
  | 'error';

export interface RuntimeDecision {
  state: PlayerRuntimeState;
  /** true when the existing (legacy) player owns playback: 'legacy' | 'fallback'. */
  useLegacyPlayback: boolean;
  /** true when the schedule requires audio to be silent right now: 'break' | 'closed'. */
  suppressPlayback: boolean;
  /** suppression reason for the playerStore gate; null unless break/closed. */
  suppressReason: 'break' | 'closed' | null;
  mode: PlaybackMode | null;
  source: PolicySource | null;
  playlistId: string | null;
  playlistSetId: string | null;
  timezone: string | null;
  /** validated next-transition instant as epoch ms, or null. */
  nextTransitionAtMs: number | null;
  /** raw ISO passthrough for display. */
  nextTransitionAtIso: string | null;
  /** non-fatal contract anomalies detected (for logs/telemetry, never shown raw to users). */
  anomalies: string[];
  reason: string;
}

const VALID_MODES: ReadonlySet<string> = new Set(['play', 'break', 'closed']);
const VALID_SOURCES: ReadonlySet<string> = new Set(['store_override', 'brand_schedule', 'fallback']);

/**
 * The runtime decision for a store with NO franchise integration attempted
 * (hook disabled or no storeId). Existing player owns playback; never suppresses.
 * A factory (not a shared const) so callers can never mutate the shared `anomalies` array.
 */
export function legacyDecision(): RuntimeDecision {
  return {
    state: 'legacy',
    useLegacyPlayback: true,
    suppressPlayback: false,
    suppressReason: null,
    mode: null,
    source: null,
    playlistId: null,
    playlistSetId: null,
    timezone: null,
    nextTransitionAtMs: null,
    nextTransitionAtIso: null,
    anomalies: [],
    reason: 'legacy',
  };
}

/** Parse an ISO/timestamptz string to epoch ms; returns null when empty/invalid. */
export function parseTimestampMs(s: string | null | undefined): number | null {
  if (s == null || s === '') return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export interface MapOptions {
  /** true before the first resolved response arrives (spec §2 policy_loading). */
  loading?: boolean;
}

/**
 * Validate + map a resolver response to a runtime decision. Pure.
 *
 * Contract rules enforced (spec §4/§5/§20):
 *  - has_franchise_policy=false ⇒ 'fallback' (legacy). The resolver's mode is
 *    IGNORED here — a store with no franchise policy must NEVER be forced closed.
 *  - unknown mode ⇒ 'error' (never guessed as play).
 *  - mode=play with null playlist_id ⇒ 'error' (never silently plays).
 *  - mode=break with a playlist_id ⇒ still a break; anomaly flagged only.
 *  - a bad/unparseable next_transition_at ⇒ treated as null + anomaly (no crash).
 */
export function mapResolutionToRuntimeState(
  resolution: StorePlaybackResolution | null | undefined,
  opts: MapOptions = {},
): RuntimeDecision {
  const base: RuntimeDecision = {
    state: 'policy_loading',
    useLegacyPlayback: false,
    suppressPlayback: false,
    suppressReason: null,
    mode: null,
    source: null,
    playlistId: null,
    playlistSetId: null,
    timezone: null,
    nextTransitionAtMs: null,
    nextTransitionAtIso: null,
    anomalies: [],
    reason: '',
  };

  if (resolution == null) {
    if (opts.loading) return { ...base, state: 'policy_loading', reason: 'loading' };
    return { ...base, state: 'error', reason: 'no_resolution' };
  }

  const anomalies: string[] = [];
  const timezone =
    typeof resolution.timezone === 'string' && resolution.timezone ? resolution.timezone : null;
  if (timezone == null) anomalies.push('missing_timezone');

  const nextIso = typeof resolution.next_transition_at === 'string' ? resolution.next_transition_at : null;
  const nextMs = parseTimestampMs(nextIso);
  if (nextIso != null && nextMs == null) anomalies.push('invalid_next_transition_at');

  const source = VALID_SOURCES.has(String(resolution.source)) ? (resolution.source as PolicySource) : null;
  if (resolution.source != null && source == null) anomalies.push('unknown_source');

  // (§5) Legacy fallback — existing player owns playback; resolver mode ignored.
  if (resolution.has_franchise_policy === false) {
    return {
      ...base,
      state: 'fallback',
      useLegacyPlayback: true,
      source,
      timezone,
      nextTransitionAtMs: nextMs,
      nextTransitionAtIso: nextIso,
      anomalies,
      reason: 'no_franchise_policy',
    };
  }

  // has_franchise_policy === true → honor the resolved mode, with validation.
  const mode = resolution.mode;
  if (!VALID_MODES.has(String(mode))) {
    return {
      ...base,
      state: 'error',
      mode: null,
      source,
      timezone,
      nextTransitionAtMs: nextMs,
      nextTransitionAtIso: nextIso,
      anomalies: [...anomalies, 'unknown_mode'],
      reason: `unknown_mode:${String(mode)}`,
    };
  }

  const playlistId =
    typeof resolution.playlist_id === 'string' && resolution.playlist_id ? resolution.playlist_id : null;
  const playlistSetId =
    typeof resolution.playlist_set_id === 'string' && resolution.playlist_set_id
      ? resolution.playlist_set_id
      : null;

  if (mode === 'play') {
    // (§4/§20) play + null playlist is a contract violation — never silently play.
    if (playlistId == null) {
      return {
        ...base,
        state: 'error',
        mode: 'play',
        source,
        timezone,
        nextTransitionAtMs: nextMs,
        nextTransitionAtIso: nextIso,
        anomalies: [...anomalies, 'play_without_playlist'],
        reason: 'play_without_playlist',
      };
    }
    return {
      ...base,
      state: 'play',
      mode: 'play',
      source,
      playlistId,
      playlistSetId,
      timezone,
      nextTransitionAtMs: nextMs,
      nextTransitionAtIso: nextIso,
      anomalies,
      reason: 'ok',
    };
  }

  if (mode === 'break') {
    if (playlistId != null) anomalies.push('break_with_playlist'); // informational; still a break
    return {
      ...base,
      state: 'break',
      mode: 'break',
      suppressPlayback: true,
      suppressReason: 'break',
      source,
      playlistSetId,
      timezone,
      nextTransitionAtMs: nextMs,
      nextTransitionAtIso: nextIso,
      anomalies,
      reason: 'break',
    };
  }

  // mode === 'closed'
  return {
    ...base,
    state: 'closed',
    mode: 'closed',
    suppressPlayback: true,
    suppressReason: 'closed',
    source,
    timezone,
    nextTransitionAtMs: nextMs,
    nextTransitionAtIso: nextIso,
    anomalies,
    reason: 'closed',
  };
}

// ---------------------------------------------------------------------------
// Transition scheduling (spec §11)
// ---------------------------------------------------------------------------

/** setTimeout's 32-bit signed ceiling (~24.8 days); longer delays must be chunked. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Delay (ms) until the next policy re-evaluation for a given transition instant.
 *  - null nextMs ⇒ null (no timer; rely on refresh triggers + low-frequency safety poll)
 *  - already past ⇒ 0 (re-evaluate immediately)
 *  - clamped to MAX_TIMEOUT_MS so an over-long delay fires early and reschedules
 * `bufferMs` nudges the fire just past the boundary so the resolver has crossed it.
 */
export function computeTransitionDelayMs(
  nextMs: number | null,
  nowMs: number,
  bufferMs = 1_000,
): number | null {
  if (nextMs == null) return null;
  const raw = nextMs - nowMs + Math.max(0, bufferMs);
  if (raw <= 0) return 0;
  return Math.min(raw, MAX_TIMEOUT_MS);
}

// ---------------------------------------------------------------------------
// Curated-set rotation memory (deterministic, refresh-stable). Reuses the
// certified selectRotationSet — never re-implements rotation (spec §7).
// ---------------------------------------------------------------------------

export interface RotationMemory {
  /** last selected franchise_playlist_set id, for deterministic anti-repeat rotation. */
  lastSetId: string | null;
  /** epoch ms of the last selection. */
  lastAtMs: number | null;
}

export const EMPTY_ROTATION_MEMORY: RotationMemory = { lastSetId: null, lastAtMs: null };

/**
 * Record that a play slot carrying `setId` is now active. Pure reducer used by the
 * hook to keep per-store rotation memory stable across refreshes (persisted to
 * localStorage). A null setId (slot has no curated set) leaves memory unchanged.
 */
export function recordSetPlay(memory: RotationMemory, setId: string | null, atMs: number): RotationMemory {
  if (setId == null) return memory;
  if (memory.lastSetId === setId) return { ...memory, lastAtMs: atMs };
  return { lastSetId: setId, lastAtMs: atMs };
}

/**
 * Deterministically pick the next curated set from a franchise pool, delegating to
 * the certified rotation core (selectRotationSet) and advancing memory. Pure.
 *
 * NOTE (spec §7, report §9 — BLOCKED sub-item): the store player CANNOT currently
 * read the franchise set pool — RLS scopes franchise_playlist_sets to admins and the
 * resolver returns only a single playlist_set_id per instant. This helper is exercised
 * by unit tests and is ready for a future store-scoped set-pool RPC; it is deliberately
 * NOT wired into the live hook, which plays the resolver-designated playlist_id instead.
 */
export function advanceRotation(
  pool: RotationSet[],
  memory: RotationMemory,
  atMs: number,
): { set: RotationSet | null; memory: RotationMemory } {
  const set = selectRotationSet(pool, memory.lastSetId, atMs);
  if (set == null) return { set: null, memory };
  return { set, memory: { lastSetId: set.id, lastAtMs: atMs } };
}

// ---- localStorage persistence (side-effecting; guarded, never throws) --------

const ROTATION_KEY_PREFIX = 'srr.playback.rotation.';

export function loadRotationMemory(storeId: string): RotationMemory {
  try {
    const raw = localStorage.getItem(ROTATION_KEY_PREFIX + storeId);
    if (!raw) return { ...EMPTY_ROTATION_MEMORY };
    const parsed = JSON.parse(raw) as Partial<RotationMemory>;
    return {
      lastSetId: typeof parsed.lastSetId === 'string' ? parsed.lastSetId : null,
      lastAtMs: typeof parsed.lastAtMs === 'number' ? parsed.lastAtMs : null,
    };
  } catch {
    return { ...EMPTY_ROTATION_MEMORY };
  }
}

export function saveRotationMemory(storeId: string, mem: RotationMemory): void {
  try {
    localStorage.setItem(ROTATION_KEY_PREFIX + storeId, JSON.stringify(mem));
  } catch {
    /* private-mode / quota — rotation memory is best-effort */
  }
}

// ===========================================================================
// BRAND-PLAYLIST-ROTATION-4B — store-scoped rotation POOL: validation, deterministic
// ordering, playlist-level rotation (reusing the certified selectRotationSet), and
// refresh-stable per-store persistence.
// ===========================================================================

/** A validated row from get_store_playlist_rotation_pool (0461). */
export interface RotationPoolRow {
  playlistSetId: string;
  playlistId: string;
  name: string;
  rotationOrder: number;
  validFrom: string | null;
  validUntil: string | null;
  franchiseId: string;
  createdAt: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PoolValidation {
  rows: RotationPoolRow[];
  /** true if any row belonged to a DIFFERENT franchise than expected — a security signal. */
  crossFranchise: boolean;
  /** number of malformed rows dropped (for logging). */
  dropped: number;
}

/**
 * Validate + normalize a raw rotation-pool payload (§9). Pure.
 *  - drops malformed rows (bad UUID / non-integer order / inactive)
 *  - dedupes by playlist_set_id
 *  - re-enforces deterministic order: rotation_order, created_at, id
 *  - if `expectedFranchiseId` is provided, a row from another franchise sets
 *    `crossFranchise=true` and is excluded — the caller MUST treat the whole pool as
 *    unusable (never silently rotate on it), per §9/§30.
 */
export function validateRotationPool(
  raw: unknown,
  expectedFranchiseId?: string | null,
): PoolValidation {
  const arr = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const rows: RotationPoolRow[] = [];
  let crossFranchise = false;
  let dropped = 0;

  for (const r of arr) {
    if (r == null || typeof r !== 'object') {
      dropped++;
      continue;
    }
    const o = r as Record<string, unknown>;
    const setId = o.playlist_set_id;
    const plId = o.playlist_id;
    const fid = o.franchise_id;
    const order = o.rotation_order;
    if (
      typeof setId !== 'string' || !UUID_RE.test(setId) ||
      typeof plId !== 'string' || !UUID_RE.test(plId) ||
      typeof fid !== 'string' || !UUID_RE.test(fid) ||
      typeof order !== 'number' || !Number.isInteger(order) ||
      o.is_active !== true
    ) {
      dropped++;
      continue;
    }
    if (expectedFranchiseId != null && fid !== expectedFranchiseId) {
      crossFranchise = true;
      continue;
    }
    if (seen.has(setId)) continue;
    seen.add(setId);
    rows.push({
      playlistSetId: setId,
      playlistId: plId,
      name: typeof o.name === 'string' ? o.name : '',
      rotationOrder: order,
      validFrom: typeof o.valid_from === 'string' ? o.valid_from : null,
      validUntil: typeof o.valid_until === 'string' ? o.valid_until : null,
      franchiseId: fid,
      createdAt: typeof o.created_at === 'string' ? o.created_at : null,
    });
  }

  rows.sort(
    (a, b) =>
      a.rotationOrder - b.rotationOrder ||
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '') ||
      a.playlistSetId.localeCompare(b.playlistSetId),
  );
  return { rows, crossFranchise, dropped };
}

/** A stable signature of a pool — used to invalidate persisted rotation memory (§12). */
export function poolSignature(pool: RotationPoolRow[], franchiseId: string | null): string {
  return `${franchiseId ?? ''}|${pool.map((s) => `${s.playlistSetId}:${s.rotationOrder}`).join(',')}`;
}

export interface RotationChoice {
  set: RotationPoolRow;
  playlistId: string;
}

/**
 * Choose the next set + playlist after `currentSetId`, REUSING the certified
 * selectRotationSet for ordering/anchor/immediate-repeat, then layering playlist-level
 * duplicate protection (§10/§13). Pure. Server already applied validity, so no time bounds
 * are passed to the core.
 *  - empty pool  → null (caller uses resolver playlist)
 *  - pool of 1   → that set (kept)
 *  - anchor absent from pool → first eligible (via the core)
 *  - skips a candidate whose playlist_id equals currentPlaylistId, scanning ≤ pool.length;
 *    if every candidate shares the playlist, returns the immediate next.
 */
export function advanceRotationPlaylist(
  pool: RotationPoolRow[],
  currentSetId: string | null,
  currentPlaylistId: string | null,
): RotationChoice | null {
  if (pool.length === 0) return null;
  const sets: RotationSet[] = pool.map((p) => ({
    id: p.playlistSetId,
    rotationOrder: p.rotationOrder,
    isActive: true,
  }));

  let lastId = currentSetId;
  let firstChoice: RotationPoolRow | null = null;
  for (let i = 0; i < pool.length; i++) {
    const next = selectRotationSet(sets, lastId, 0);
    if (next == null) break;
    const row = pool.find((p) => p.playlistSetId === next.id);
    if (row == null) break;
    if (firstChoice == null) firstChoice = row;
    if (row.playlistId !== currentPlaylistId) {
      return { set: row, playlistId: row.playlistId };
    }
    lastId = next.id; // same playlist as current → advance again (dup protection)
  }
  // every candidate shares currentPlaylistId (or pool of 1) → keep the first choice.
  return firstChoice ? { set: firstChoice, playlistId: firstChoice.playlistId } : null;
}

/**
 * Pick the rotation anchor when (re)seeding memory: the resolver-designated set if it's
 * in the pool, else the first eligible set. Pure. Returns null for an empty pool.
 */
export function pickRotationAnchor(
  pool: RotationPoolRow[],
  resolverSetId: string | null,
): RotationPoolRow | null {
  if (pool.length === 0) return null;
  if (resolverSetId) {
    const hit = pool.find((s) => s.playlistSetId === resolverSetId);
    if (hit) return hit;
  }
  return pool[0];
}
