# WEB-OBS-6 — Store Fleet Monitoring & Player Health Control Plane

Extends the web-app observability (WEB-OBS-1…5) to the **store fleet**: near-real-time visibility into
each store's player operation — liveness, playback health, silence *suspicion*, queue, scheduler,
network, repetition, per-store incidents, fleet blast radius, an operational advisor and recovery
tracking. **Observation + recommendation ONLY.** Nothing is executed: no remote play/stop/refresh/
reboot/device-change, no notification, no auto-close. Rule-based, **NO ML/AI**. Additive. Preview PR
only — no production merge/deploy/migration apply. Base = `feat/web-obs-5-operational-advisor` (PR #344).

> Assumptions are flagged **(ASSUMPTION)**. Every threshold is a named constant in
> `src/lib/fleet/thresholds.ts`. Below the sample/confidence gates each engine returns
> INSUFFICIENT_DATA / UNKNOWN / NO_DATA — never a fabricated verdict.

## 1. Non-negotiable safety contract

- **No remote control.** The advisor emits *labels* (`CONTACT_STORE`, `VERIFY_AUDIO_OUTPUT`, …). No
  code path performs a remote action. `fleetActionSafety()` stamps `automated:false`,
  `requiresApproval:true`, **`remoteControl:false`** on every category (asserted by tests).
- **No Player.tsx / playback change.** The emit hook reads the zustand `playerStore`/
  `playbackHealthStore` snapshots only. Player.tsx, the audio element, the queue, crossfade, the
  scheduler and sinkId are untouched. Audio-internal signals (readyState/networkState/error-code/
  recovery/sinkId) are **NOT captured** — capturing them would require the forbidden Player.tsx edit —
  so they are honestly reported as **NO_DATA / deferred**.
- **Offline ≠ Silence; Player-alive ≠ Audio-out; Session ≠ Store; Browser-hidden ≠ Offline.** Each is
  a distinct verdict. A single missed heartbeat never means OFFLINE; a hidden tab widens the gate.
- **Silence is never CONFIRMED.** The live player has no `AnalyserNode`, so the strongest verdict is
  **SILENCE_SUSPECTED** (sustained frozen progress while "playing").
- **No fabricated fleet numbers.** Thin fleet → INSUFFICIENT_DATA; a small sample can never assert a
  BRAND-wide / RELEASE-specific failure; no store attribution → blast radius `NOT_AVAILABLE`.
- **Server-verified attribution.** `store_id = auth.uid()` (business user == store). The ingest RPC
  rejects a spoofed `store_id` and non-business accounts — the client can never claim another store.
- **Privacy.** No store name / user id / raw track id / artist / playlist / audio URL / UA / query
  string / token on the wire. Track ids are hashed; positions/queue/scheduler/reconnect are bucketed.

## 2. Architecture

```
Store player (StorePlayerPage) — reads playerStore/playbackHealthStore ONLY (no Player.tsx change)
  └─ useStorePlayerHealthTelemetry (opt-in, fail-open) → ingest_store_player_health RPC (auth.uid())
       → store_player_health_events (0459, RLS deny-all + super-admin read; store_id = auth.uid())
         ▼
admin_store_fleet_overview / _player_health / _release_compare  (super-admin · param-bound · SELECT)
         ▼
src/lib/fleet/*  (pure, unit-tested engines — the verdict truth)
   signals · storeHealth · fleet(overview/incidents/blast) · storeRecovery · fleetAdvisor
         ▼
fleetApi.getStoreFleetIntel()  (maps RPC rows → engines, client-side)
         ▼
Admin "매장 Fleet 관제" tab  (overview · advisor · incidents · store table · store detail — READ-ONLY)
```

## 3. Fleet telemetry event (`src/lib/fleet/eventSchema.ts`)

Dependency-free wire schema (mirrors `telemetry/schema.ts`). Event types: `player_heartbeat`,
`playback_stalled`, `silence_suspected`, `queue_empty`, `track_transition`, `network_disconnected`,
`network_reconnected`, `duplicate_track_detected`, `session_started`, `session_ended`. The envelope
carries **no store_id** (server stamps it from `auth.uid()`), an opaque `player_session_id`, a
non-reversible `current_track_hash`, and bucketed `position_bucket`/`queue_length_bucket`/
`scheduler_age_bucket`/`reconnect_bucket`. `parseFleetEvent`/`parseFleetBatch` rebuild from an
allow-list, dropping unknown fields and coercing enums.

### Method choice (작업 2)
**Method C — a new dedicated table** (`store_player_health_events`). Rejected: (A) extending the
anonymous `runtime_telemetry_events` (0454) would force store identity into a deliberately-anonymous
table with no attribution; (B) a new event type on that table has the same problem. The store channel
rides the `store_id = auth.uid()` pathway, completely separate from the anonymous RUM, and never
ALTERs any operational table.

## 4. Heartbeat (`useStorePlayerHealthTelemetry`)

Cadence **60s** (`HEARTBEAT_INTERVAL_MS`, matching the existing `useStoreHeartbeat`; bounded ≥30s so a
kiosk is never hammered). Fields per §3. The hook is **opt-in** (no-op unless
`VITE_FLEET_TELEMETRY_ENABLED`), **fully fail-open** (a transport error can never affect playback), and
**bounded** (a failed flush drops the batch — no retry-storm). Hidden vs background is preserved via
`visibility_state`; heartbeat failure never touches playback.

## 5. Liveness (`signals.computeLiveness`)

Status ONLINE/DEGRADED/STALE/OFFLINE/UNKNOWN/INSUFFICIENT_DATA from `lastSeenAgeSec` vs the heartbeat
interval × named multipliers (`LIVENESS_STALE_MULTIPLIER` 2.5, `LIVENESS_OFFLINE_MULTIPLIER` 6). Hidden
tabs widen both gates ×2 (`LIVENESS_HIDDEN_STALE_MULTIPLIER`) — a backgrounded kiosk throttles timers.
Below `LIVENESS_MIN_HEARTBEATS` → INSUFFICIENT_DATA. Multiple sessions per store: the RPC uses the most
recent heartbeat per `store_id` (`distinct on … order by received_at desc`); confidence is downgraded
for hidden tabs and never HIGH from a hidden sample.

## 6. Playback health & silence

`computePlaybackHealth` → HEALTHY/PLAYING/PAUSED_EXPECTED/STALLED/SILENCE_SUSPECTED/QUEUE_EMPTY/
NETWORK_DEGRADED/OFFLINE/UNKNOWN/INSUFFICIENT_DATA. Freeze is inferred from `currentTime` deltas across
heartbeats (`PROGRESS_MIN_DELTA_SEC`); `STALL_MIN_FROZEN_HEARTBEATS` (2) → STALLED,
`SILENCE_MIN_FROZEN_HEARTBEATS` (3) → SILENCE_SUSPECTED. A frozen sample within `TRACK_END_GUARD_SEC`
of track end is a normal end-of-track, not a stall. **paused is never asserted as a fault** (intent is
unknowable from the store → PAUSED_EXPECTED; autoplay-block vs user-pause is indistinguishable).
`computeSilence` never returns AUDIO_CONFIRMED (no analyser); audio-element error / output-device
channels are **NO_DATA** this phase (would need Player.tsx).

## 7. Queue & Scheduler

`computeQueueHealth` from the last queue-length bucket → HEALTHY/LOW/EMPTY/UNKNOWN. `computeSchedulerHealth`
is a **weak proxy**: the runtime exposes **no scheduler-refresh timestamp** (audited), so it is usually
**NO_DATA**, at most STALE (`SCHEDULER_STALE_HOURS`), never FAILED. Queue/scheduler behaviour is
observed only — never changed.

## 8. Network & reconnect

`computeNetworkHealth` → HEALTHY/DEGRADED/DISCONNECTED/RECONNECTING/RECOVERED/UNKNOWN from online state
+ observed offline→online transitions. `RECONNECT_LOOP_COUNT` (4) → loop (DEGRADED). `navigator.onLine`
only proves the OS link, never real reachability — documented and reflected in the verdict wording.

## 9. Repetition (`computeRepetition`)

Non-reversible hashes only. `repeat='one'` (intended loop) → NORMAL; a small playlist
(< `REPEAT_MIN_DISTINCT_TRACKS`) or too few transitions → INSUFFICIENT_DATA (never ANOMALY);
`REPEAT_WARNING_COUNT` (3) → WARNING, `REPEAT_ANOMALY_COUNT` (5) → ANOMALY. The emit hook additionally
suppresses `duplicate_track_detected` while `repeat='one'`.

## 10. Fleet Health Score (`fleet.computeFleetHealth`)

0..100 from named component weights (`FLEET_HEALTH_WEIGHTS`) over rates of offline/stale/stalled/
silence/queue-empty/network/repetition. Bands HEALTHY≥90 / WATCH≥75 / DEGRADED≥50 / else CRITICAL;
`FLEET_OFFLINE_CRITICAL_RATE` (0.3) hard-floors to CRITICAL. A no-data component adds no penalty; a
fleet below `FLEET_MIN_STORES` → INSUFFICIENT_DATA. The average never hides an outage — the **worst
stores** are always surfaced and offline stores are counted separately. 100 does not guarantee real
audio output (documented in the UI).

## 11. Store incidents (`detectStoreIncidents`)

Per-store: STORE_OFFLINE / PLAYER_STALE / PLAYBACK_STALLED / SILENCE_SUSPECTED / QUEUE_EMPTY /
SCHEDULER_STALE / NETWORK_DISCONNECTED / RECONNECT_LOOP / DUPLICATE_TRACK_ANOMALY. Aggregated:
BRAND_WIDE_FAILURE only when a brand has ≥ `INCIDENT_BRAND_MIN_STORES` telemetry-stores AND
≥ `INCIDENT_BRAND_MIN_AFFECTED_RATE` affected; RELEASE_SPECIFIC_PLAYER_FAILURE likewise. Never mints an
incident on INSUFFICIENT confidence. Each carries store/brand/release/browser attribution, evidence,
confidence and a `suggestedAction` (guidance only).

## 12. Fleet blast radius (`computeFleetBlastRadius`)

Affected-STORE rate → ISOLATED/LIMITED/MODERATE/WIDESPREAD/CRITICAL, with a severe-store CRITICAL floor.
Below `FLEET_BLAST_MIN_AFFECTED_STORES`/`FLEET_BLAST_MIN_TOTAL_STORES` → INSUFFICIENT_DATA. Session
count is **never** converted to store count. Store attribution is present (server-derived), so a rate is
provided; if it were absent the level is **NOT_AVAILABLE**.

## 13. Fleet operational advisor (`fleetAdvisor`)

Reuses the WEB-OBS-5 shape. Actions: MONITOR_RECOVERY / VERIFY_STORE_NETWORK / VERIFY_PLAYER_SESSION /
VERIFY_AUDIO_OUTPUT / VERIFY_QUEUE / VERIFY_SCHEDULER / VERIFY_BROWSER / VERIFY_RELEASE / CONTACT_STORE /
PREPARE_REMOTE_GUIDE / HOLD_RELEASE / PREPARE_ROLLBACK / ESCALATE_PLAYER_ENGINEERING / ESCALATE_INFRA.
Every one is `automated:false`, `requiresApproval:true`, `remoteControl:false`. Below the confidence
gate → MONITOR_RECOVERY (observe).

## 14. Store recovery (`computeStoreRecovery`)

Compares an EARLIER vs RECENT sub-window of a store's heartbeat health over a real observation window.
`RECOVERY_MIN_WINDOW_MINUTES` (30) gate; both sides need `RECOVERY_MIN_HEARTBEATS_PER_SIDE`. One
returning heartbeat is never RECOVERED (needs a trailing healthy streak + low unhealthy rate); a fresh
unhealthy run re-opens it as REGRESSED. `operatorCloseRequired` is **always true** — the operator
closes the incident, not the system.

## 15. Database & RPCs (migration 0459)

- **`store_player_health_events`** — additive, keyed by `store_id` (uuid, **no FK** — telemetry is
  purgeable and must never block a user delete). RLS `enable`+`force`, one policy (super-admin SELECT);
  no insert/update/delete policies → authenticated/anon fully blocked; inserts only via the
  security-definer RPC. Bucketed/hashed columns only. Indexes: `received_at`, `(store_id, received_at)`,
  `(player_session_id, sequence)`, `(event_type, received_at)`, `(release, received_at)`.
- **`ingest_store_player_health(p_events, p_store_id)`** — security definer; `v_store := auth.uid()`;
  rejects spoofed store_id and non-business accounts (super-admin exempt for synthetic tests); batch cap
  40; allow-list coercion; `on conflict (event_id) do nothing`.
- **`admin_store_fleet_overview` / `admin_store_player_health` / `admin_store_fleet_release_compare`** —
  super-admin gated (`_is_super_admin()`), param-bound (no dynamic SQL), window allow-list
  (`_obs_window_interval`), row aggregates only, minimal store-metadata joins for display.
- **`purge_store_player_health(p_days=14)`** — retention purge (service_role only).
- Store name uses `coalesce(franchise_stores.store_name, business_profiles.store_name, users.nickname)`
  — `users.business_name` does **not** exist in this DB (verified). Rollback = plain DROP.

## 16. Ingestion (작업 17)

**No new public edge function.** The existing runtime-telemetry edge fn is public/service-role and
cannot verify a store. Store attribution *requires* the authenticated session, so ingestion is the
**security-definer RPC** called via `supabase.rpc()` from the store's JWT — the RPC derives
`auth.uid()`, rejects spoofing, validates the account, caps the batch, and coerces every field. This is
strictly more secure than a public endpoint and reuses the established `store_heartbeat` (0353) pattern.

## 17. Feature flags & kill switch (`src/lib/fleet/config.ts`)

EMIT flags (`VITE_FLEET_*`) default **OFF** (opt-in): until enabled, no store emits anything — no new
traffic, no behaviour change. Dashboard flags default ON (admin-only, read-only). Kill switch OFF →
emit stops (fail-open); the existing runtime telemetry, the player, the queue and the scheduler are
unaffected; the dashboard shows a disabled notice; boot is never affected.

## 18. Privacy & data minimization (작업 21)

On the wire / in the table: store UUID (server-derived, not on the wire), opaque player-session UUID,
non-reversible track hash, browser/os/device buckets, release, normalized route, bucketed position/
queue/scheduler/reconnect, status codes. **Never**: store/customer/employee PII, UA, IP, audio URL,
track title, artist, playlist name, tokens/cookies/JWT, precise location, raw error stack, query string.

## 19. Retention & cost (작업 22)

Heartbeat volume ≈ 1 event/store/60s ≈ **1,440 heartbeats/store/day** plus sparse discrete events.
Exact fleet totals are **not fabricated** (store count unknown here). Policy: **raw heartbeat short
retention** via `purge_store_player_health` (default 14 days); incidents/rollups (a future phase) would
retain longer. A latest-state materialization is deferred (the overview RPC computes per-store latest
via `distinct on` over the indexed `(store_id, received_at)` — adequate for the current scale). Cold
storage is out of scope.

## 20. Query performance (작업 25)

Indexes cover the overview (`store_id, received_at`), detail (`player_session_id, sequence`) and
release-compare (`release, received_at`) access paths. **No production fleet data exists**, so no real
cost numbers are asserted — the rollback-txn validation exercised the query shapes against the real
schema with synthetic rows only. Index additions are justified by the RPC access paths, not guessed.

## 21. Tests & verification

- `src/lib/fleet/fleet.test.ts` — **50 tests** (liveness incl. hidden-tab & missed-heartbeat; playback;
  stall; silence-suspected & never-confirmed; queue; scheduler NO_DATA; network & reconnect-loop;
  duplicate/repetition; store score; fleet health incl. worst-store surfacing; incidents incl. small-
  sample-can't-mint-brand-wide; blast radius incl. NOT_AVAILABLE; recovery incl. one-beat-never-
  RECOVERED; advisor safety incl. remoteControl:false; event schema hashing/bucketing/sanitization).
  Full suite: **322 passing**.
- `typecheck` / `lint` / `lint:tones` / `lint:migrations` / `build` — all green.
- Migration validated vs production via `BEGIN … ROLLBACK` (nothing persisted): ingest accepted 1 of 2
  events (invalid type filtered), no-store rejected, admin RPC joins compiled against the real schema.

### Manual QA (NOT RUN in this environment — browser required)
The following require a running store player and are **NOT RUN** here (do not report as PASS): live
heartbeat emit with the flag on; stall/silence-suspected on a frozen stream; queue-empty; reconnect
loop on network toggle; the admin tab rendering with real fleet data; auto-refresh lifecycle; mobile/
tablet layout; hidden-tab polling pause. Engine logic is covered by unit tests; the emit hook and
dashboard wiring are typecheck/lint-verified.

## 22. Deferred work

- Audio-internal signals (readyState/networkState/error-code, recovery attempts, sinkId/output-device
  errors) — require an authorized Player.tsx emit; **deferred**. Reported as NO_DATA meanwhile.
- Scheduler freshness — no runtime refresh timestamp exists; a real signal needs a scheduler emit.
- Incident-state persistence & operator notes/close — deferred (no state table this phase; recovery is
  query-derived, operator-close-required).
- Latest-state materialization / rollups / cron purge scheduling — deferred.
