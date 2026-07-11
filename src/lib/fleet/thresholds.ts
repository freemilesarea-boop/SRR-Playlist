// WEB-OBS-6 — Store Fleet Monitoring thresholds & weights (single source of truth).
//
// Every operational threshold used by liveness / playback-health / queue / scheduler / network /
// repetition classification, the Fleet Health Score, store-incident detection, fleet blast radius and
// store recovery lives HERE as a named constant with a documented rationale. Nothing downstream
// hard-codes a magic number.
//
// Provenance & honesty:
//   • The store player emits a heartbeat every HEARTBEAT_INTERVAL_MS (mirrors the existing
//     useStoreHeartbeat 60s cadence — we do NOT introduce a faster ping). All "staleness" gates are
//     expressed as MULTIPLES of that interval so a single missed beat can never flip a store OFFLINE.
//   • Browser background-tab throttling is real: a hidden tab may skip timers. Hidden stores get a
//     confidence downgrade and a wider stale gate, never an OFFLINE verdict from missed beats alone.
//   • Silence can NOT be proven from the runtime (no AnalyserNode in the live player) — the only
//     honest verdict is SILENCE_SUSPECTED, never CONFIRMED. See silence.ts.
//   • Sample minimums are conservative operational guesses (ASSUMPTION) so a handful of events can
//     never mint an incident, a brand-wide failure, or a confident recovery.

// ── Heartbeat cadence (mirrors useStoreHeartbeat; the emit hook uses the same default) ──
export const HEARTBEAT_INTERVAL_MS = 60_000; // 60s — matches the existing store heartbeat cadence
export const HEARTBEAT_INTERVAL_SEC = HEARTBEAT_INTERVAL_MS / 1000;

// ── Liveness staleness gates (as multiples of the heartbeat interval) ───────
// last_seen age > STALE → STALE; > OFFLINE → OFFLINE. Hidden-tab stores multiply the gate by
// HIDDEN_STALE_MULTIPLIER before deciding, because a backgrounded kiosk legitimately throttles timers.
export const LIVENESS_STALE_MULTIPLIER = 2.5;    // ~2.5 missed beats → STALE (DEGRADED)
export const LIVENESS_OFFLINE_MULTIPLIER = 6;    // ~6 missed beats → OFFLINE candidate
export const LIVENESS_HIDDEN_STALE_MULTIPLIER = 2; // widen both gates ×2 while the tab is hidden
/** A store needs at least this many heartbeats in-window before we trust a non-UNKNOWN verdict. */
export const LIVENESS_MIN_HEARTBEATS = 2;

// ── Playback progress / stall / silence ─────────────────────────────────────
// Progress is inferred from currentTime deltas across heartbeats. "Frozen" = currentTime did not
// advance meaningfully while playback_state=playing. A single frozen sample is a suspicion; STALL_MIN
// consecutive frozen heartbeats are required to classify STALLED / SILENCE_SUSPECTED.
export const PROGRESS_MIN_DELTA_SEC = 3;         // < this advance between beats (while playing) = frozen
export const STALL_MIN_FROZEN_HEARTBEATS = 2;    // ≥2 consecutive frozen beats → STALLED
export const SILENCE_MIN_FROZEN_HEARTBEATS = 3;  // ≥3 → SILENCE_SUSPECTED (higher bar than stall)
/** Guard: a frozen sample within this distance of track end is a normal end-of-track, not a stall. */
export const TRACK_END_GUARD_SEC = 5;

// ── Queue health ────────────────────────────────────────────────────────────
export const QUEUE_LOW_LENGTH = 2;               // ≤2 upcoming tracks → LOW
// 0 remaining upcoming tracks → EMPTY. (Queue length itself is bucketed for privacy — see eventSchema.)

// ── Scheduler health ────────────────────────────────────────────────────────
// NO first-class "last scheduler refresh" timestamp exists in the runtime (audited). The only signal
// available without changing playback code is "how long has the SAME playlist context been active".
// This is a WEAK proxy and is treated as such: a long-lived playlist is at most STALE (suspicion),
// never FAILED, and below the min sample count → UNKNOWN. (ASSUMPTION — documented in docs.)
export const SCHEDULER_STALE_HOURS = 18;         // same playlist context > 18h → STALE (weak proxy)
export const SCHEDULER_MIN_HEARTBEATS = 3;

// ── Network / reconnect health ──────────────────────────────────────────────
// navigator.onLine only proves the OS thinks there's a link — never real reachability. A reconnect is
// an observed offline→online transition. A reconnect LOOP is many transitions in the window.
export const RECONNECT_LOOP_COUNT = 4;           // ≥4 reconnect transitions in window → loop
export const NETWORK_DEGRADED_RECONNECTS = 2;    // ≥2 → DEGRADED

// ── Repetition / duplicate ──────────────────────────────────────────────────
// Uses non-reversible track-id hashes only. Intended repeat (repeat='one', tiny playlist) is excluded.
export const REPEAT_WARNING_COUNT = 3;           // same track ≥3× in the recent window → WARNING
export const REPEAT_ANOMALY_COUNT = 5;           // ≥5× → ANOMALY
export const REPEAT_MIN_DISTINCT_TRACKS = 5;     // playlist too small → INSUFFICIENT_DATA (not anomaly)
export const REPEAT_MIN_TRANSITIONS = 8;         // need this many track transitions before judging

// ── Fleet Health Score component weights (sum = 100) ────────────────────────
// A component with no data contributes NO penalty (score 1). The overall INSUFFICIENT_DATA gate
// (min stores / min telemetry) guards the thin-fleet case. Offline/silence are weighted hardest.
export const FLEET_HEALTH_WEIGHTS = {
  offlineRate: 26,        // fraction of telemetry-stores OFFLINE
  staleRate: 12,          // fraction STALE
  stalledRate: 16,        // fraction with a stalled playback verdict
  silenceSuspectedRate: 14,
  queueEmptyRate: 10,
  networkDegradedRate: 8,
  recoveryFailedRate: 6,  // reserved (recovery events deferred — see docs) → usually no-data
  repetitionRiskRate: 4,
  releaseRegressionRate: 4,
} as const;

// ── Per-store health score component weights (sum need not be 100; renormalized over present) ──
// A per-store 0..100 score from that store's own signals. A component with no usable signal is
// dropped (weights renormalize) — absence of signal is never a penalty.
export const STORE_SCORE_WEIGHTS = {
  liveness: 34,
  playback: 30,
  queue: 12,
  network: 14,
  repetition: 10,
} as const;

// ── Per-store status bands (on the store's 0..100 score) ────────────────────
export const STORE_BAND_HEALTHY = 90;
export const STORE_BAND_WATCH = 75;
export const STORE_BAND_DEGRADED = 50;
// below DEGRADED → CRITICAL; liveness OFFLINE forces OFFLINE band regardless of score.

// ── Fleet Health status bands (on the 0..100 score) ─────────────────────────
export const FLEET_BAND_HEALTHY = 90;
export const FLEET_BAND_WATCH = 75;
export const FLEET_BAND_DEGRADED = 50;
// below DEGRADED → CRITICAL
/** Hard floor: this fraction of the fleet OFFLINE caps the status at CRITICAL regardless of score. */
export const FLEET_OFFLINE_CRITICAL_RATE = 0.3;

// ── Minimum-data gates ──────────────────────────────────────────────────────
// Below these we refuse to compute a fleet verdict and surface INSUFFICIENT_DATA. (ASSUMPTION.)
export const FLEET_MIN_STORES = 3;               // fewer telemetry-stores → INSUFFICIENT_DATA
export const FLEET_MIN_STORE_HEARTBEATS = 2;     // per-store min beats before a store verdict counts

// ── Store incident detection ────────────────────────────────────────────────
export const INCIDENT_MIN_AFFECTED_STORES = 1;   // a single-store incident is valid …
/** … but a BRAND-wide / ENTERPRISE-wide incident needs a real sample before it's asserted. */
export const INCIDENT_BRAND_MIN_STORES = 4;
export const INCIDENT_BRAND_MIN_AFFECTED_RATE = 0.5; // ≥50% of a brand's telemetry-stores affected
export const INCIDENT_RELEASE_MIN_STORES = 4;    // release-specific failure needs ≥4 stores on the release

// ── Fleet Blast Radius level thresholds (on affected-STORE rate) ─────────────
export const FLEET_BLAST_ISOLATED_MAX = 0.02;    // ≤2% of stores → ISOLATED
export const FLEET_BLAST_LIMITED_MAX = 0.1;      // ≤10% → LIMITED
export const FLEET_BLAST_MODERATE_MAX = 0.25;    // ≤25% → MODERATE
export const FLEET_BLAST_WIDESPREAD_MAX = 0.5;   // ≤50% → WIDESPREAD; above → CRITICAL
export const FLEET_BLAST_MIN_AFFECTED_STORES = 2;
export const FLEET_BLAST_MIN_TOTAL_STORES = 10;
/** CRITICAL also fires when this many stores are OFFLINE/severe regardless of rate. */
export const FLEET_BLAST_CRITICAL_SEVERE_STORES = 15;

// ── Store recovery tracking ─────────────────────────────────────────────────
// Recovery is only judged over a real observation window with enough heartbeats on BOTH the earlier
// and recent sub-windows. One heartbeat return never means RECOVERED; recurrence re-opens it.
export const RECOVERY_MIN_WINDOW_MINUTES = 30;   // shorter → NOT_STARTED
export const RECOVERY_MIN_HEARTBEATS_PER_SIDE = 3;
export const RECOVERY_STABLE_MIN_HEARTBEATS = 3; // consecutive healthy beats to call STABLE/RECOVERED
export const RECOVERY_RECURRENCE_MIN = 2;        // ≥2 fresh unhealthy beats after a dip → REGRESSED

// ── Fleet advisor escalation gates ──────────────────────────────────────────
export const ADVISOR_ESCALATE_AFFECTED_STORES = 10;  // ≥ → player-engineering escalation candidate
export const ADVISOR_EXEC_BLAST_STORE_RATE = 0.5;    // WIDESPREAD/CRITICAL → exec-visibility candidate
