# AI-MUSIC-10 — Runtime Boundary Observability Bridge & Safe State Export (Preview)

> Phase status: **Preview only. Observation, not control.** Nothing here is merged to production, deployed, or
> applied to the production database. **No migration is introduced** — the production migration head stays `0453`.
> All feature flags default **OFF** and the kill switch defaults **ON**. Rule-based (no LLM/ML/external SaaS/new
> WebSocket). The bridge in `src/lib/aiRuntimeBoundary/` is **read-only**: it publishes the player's runtime
> boundary state to a SEPARATE store + admin harness so a future safe-boundary decision could READ it. It NEVER
> changes the queue, playback, audio element, or any crossfade/recovery/preload logic. **No runtime queue hook,
> no candidate application, no canary is performed.** Max hook-readiness this phase is `BOUNDARY_OBSERVABILITY_READY`.

## 1. Baseline

- Base PR: **#358** (AI-MUSIC-9), branch `feat/ai-music-9-isolated-preview-hook`, head `1c5e5ca`, CI success +
  Preview READY, not merged.
- This phase branch: `feat/ai-music-10-runtime-boundary-observability`, created from PR #358 head (not default).
- Production migration head unchanged: `0453`. Migrations `0464`–`0470` remain validated-but-not-applied.

## 2. Runtime boundary signal deep audit (Task 1)

A read-only audit of `Player.tsx` (3004 lines) established exactly where boundary state lives and which discrete
transition seams can carry a fire-and-forget read-only publish (mirroring the existing `recordStreamingQuality` /
`audioDebugWarn` try/catch precedent):

| Signal | Availability | Where |
|---|---|---|
| Crossfade start/complete/cancel | **AVAILABLE** | the `crossfading` `useState` (set at `setCrossfading(true/false)`) |
| Crossfade fallback/stuck sub-state | **PARTIAL** | `completeSwap` reason discriminates it, but an effect on `crossfading` sees only ACTIVE/IDLE |
| Audio swap (`activeIdx`) | **AVAILABLE** | the single `setActiveIdx(swapToIdx)` inside `completeSwap` |
| Recovery enter/exit | **AVAILABLE** | the purpose-built `recoverAudioWithSession` wrapper (pre/post `recordSessionTransition`) |
| Recovery reason | **PARTIAL** | reason is a Player-internal type; only the state transition is observed |
| Preload ready/failed | **PARTIAL** | the existing `preload_ready` / `preload_failed` emit seams (REQUESTED/LOADING live in refs → unobserved) |
| playing / current-track / index / queue-length | **AVAILABLE** | store selector values, published from an additive effect |
| paused / ended / buffering / waiting / stalled | **NOT_AVAILABLE** | no reactive React state mirrors them in `Player.tsx` — published as `false` |
| rAF / timeout internals | **UNSAFE_TO_EXPORT** | only meaningful mid-animation; reading them as state needs control-flow hooks |

Confirmed (again): the player store has **no queue revision and no session id**; the only stable correlation
handles are `current.id`, `pev2SessionRef`, and `activeIdx`.

## 3. Read-only boundary state contract (`types.ts`)

`RuntimeBoundarySnapshot` carries a session id, `observedAt`, a monotonic `revision` (+ per-signal revisions),
`currentTrackIdHash` (hashed, never raw), index/queue-length, playing/paused/ended/buffering/waiting/stalled,
crossfade/recovery/preload/audio-swap enums, active/inactive audio indices, `boundaryCandidate`,
`stableForQueueChange`, `reasonCodes`, and a `dataStatus`. All discrete enums are read-only projections of
`Player.tsx` branches; they never drive the player.

## 4. Read-only observer store (`store.ts`)

`useRuntimeBoundaryStore` is SEPARATE from `usePlayerStore`. It exposes **only** observation intake
(`_startSession`, `_apply`, `_recordError`, `reset`) and read selectors — and **no** player-control method
(`setQueue`/`setPlaying`/`play`/`pause`/`next`/`previous`/`load`/`seek`/`setSinkId`/`recover`/`startCrossfade`
are all absent, asserted by a test). It keeps only the latest snapshot (no history). Publishing here never
re-renders the player (Player does not select from it) and never throws to the player.

## 5–7. Crossfade / Recovery / Preload / Audio-swap observers (`publish.ts` + `Player.tsx`)

`publish.ts` exposes the ONLY functions `Player.tsx` calls: `publishSession/publishCrossfade/publishRecovery/
publishPreload/publishAudioSwap/publishPlayerState`. Each one (1) checks the gate (master + observer flag +
per-signal flag + kill switch) and returns immediately when off — so a disabled observer does zero work and the
player behaves identically; (2) wraps the store update in try/catch and NEVER throws, awaits, retries, or returns
a value the player depends on. `Player.tsx` publication is publication-only (see §12 for the exact diff): the
crossfade/audio-swap observers are additive effects on the `crossfading`/`activeIdx` `useState`s; recovery is the
`recoverAudioWithSession` wrapper; preload is the existing ready/failed emit seams. Crossfade/recovery/preload/
audio-swap durations, gains, swaps, rAF, timeouts, conditions, and retry counts are **unchanged**.

## 8. Stable boundary engine (`stableBoundary.ts`)

From an OBSERVED snapshot it returns `SAFE` only when crossfade/recovery/preload/audio-swap show no conflict,
buffering/waiting/stalled are false, and the current track/index/queue/session are valid; otherwise a specific
`BLOCKED_*` / `INVALID_*` / `EMPTY_QUEUE` / `NO_SESSION`. **`SAFE` means "no observed conflict state" — NOT a
guarantee that a queue change would succeed**, and this engine never changes the queue.

## 9. Boundary revision / stale protection (`revision.ts` + `reducer.ts`)

Every event is checked against the current session, last revision, and last timestamp: `CURRENT` / `DUPLICATE` /
`STALE` / `WRONG_SESSION` / `OUT_OF_ORDER` / `INVALID`. A stale, duplicate, out-of-order, or wrong-session event
is dropped (counter bumped), never regressing the snapshot. Session change resets the snapshot and bumps the
session-revision namespace. StrictMode double-publication of the same session id is idempotent.

## 10. Session attribution

The observation session reuses the analytics-only `pev2SessionRef` (`anonId-timestamp`, page-load stable) — a
non-PII id. Raw user ids are never stored; track ids are published only as hashes. Session change / refresh
resets; before a session is established the status is `NO_SESSION`. The client store id is never used as a server
authorization basis.

## 11. Observer fail-open + Zero-control guarantee

Every publication path is isolated: flag check → try/catch → no await → no throw → no retry; a publication
failure is dropped (error counter bumped) and never reaches playback, the queue, crossfade, recovery, preload,
audio-swap, the scheduler, or the resolver. A test asserts the observer store exposes no player-control method,
and that with the observer disabled (default) the store never changes. The observer module contains no
`setQueue`/`setPlaying`/`play(`/`pause(`/`load(`/`currentTime =`/`volume =`/`muted =`/`setSinkId`/audio `src =`,
no queue/player-store mutation, and no resolver/RPC call.

## 12. `Player.tsx` diff context (publication-only)

The only changes to `Player.tsx` (+30 / −0), each additive and isolated, none touching existing logic/return/
condition/timeout/rAF/dependency-array:

1. **Import** of the six `publish*` helpers (with a read-only/observer comment).
2. **Recovery** (2 lines): `publishRecovery('ATTEMPTING')` right after the existing `recordSessionTransition('recovery:…')`, and `publishRecovery('RECOVERED')` in the existing `finally` after `recordSessionTransition('recovery-end:…')`.
3. **Four additive effects** after the existing unmount-cleanup effect: `publishSession(pev2SessionRef.current)` once; `publishPlayerState({…})` on `[current?.id, index, playing, queue.length, activeIdx]`; `publishCrossfade(crossfading ? 'ACTIVE' : 'IDLE', activeIdx)` on `[crossfading, activeIdx]`; and `publishAudioSwap('COMPLETED', prev, activeIdx)` on `[activeIdx]` (via a new observer-local ref).
4. **Preload** (2 lines): `publishPreload('READY'|'FAILED', nextTrack.id)` next to the existing `recordStreamingQuality` preload emits.

No existing state variable/type/branch/return was renamed, moved, or reordered; no async/await/Promise/timeout/rAF
was added to existing paths; audio/queue/player-store handling is unchanged. With the observer disabled every one
of these calls returns immediately, so **player behavior is identical**.

## 13–15. Evidence · Sequence validation · Coverage

`evidence.ts` builds low-frequency, hash-only, redacted events (session/store hashes, state, reason, revision,
duration bucket) with literal `false` redaction flags — no title/artist/URL/token/PII. `sequenceValidator.ts`
validates each transition against the legal map and records `INVALID_TRANSITION` (the observer never blocks the
player); session change / stale revision short-circuit. `coverage.ts` returns `NO_DATA` without a real browser
runtime — never a fabricated `SUFFICIENT`.

## 16. Runtime hook readiness re-evaluation

`readiness.ts` re-evaluates ONLY the boundary-observability No-Go condition from AI-MUSIC-9. With all observers +
stable-boundary + revision/stale + session-attribution + zero-control + fail-open + sequence-validation + coverage
in place but no internal test store / applied Preview migration, the maximum status is
**`BOUNDARY_OBSERVABILITY_READY`** (never a single-store CR). No runtime hook is implemented.

## 17. Feature flags (`config.ts`)

`getAiRuntimeBoundaryConfig` inherits the AI-MUSIC master flag. `observerEnabled`, `crossfadeObserverEnabled`,
`recoveryObserverEnabled`, `preloadObserverEnabled`, `audioSwapObserverEnabled`, `evidenceEnabled`,
`dashboardEnabled` default **false**; `killSwitch` defaults **true (ON)**. `isObserverActive` = master + observer
+ !killSwitch. With any of these off, publication is a no-op: **0 publications, 0 extra network/timer/polling,
minimal memory, player behavior identical.** Env vars: `VITE_AI_RUNTIME_BOUNDARY_OBSERVER_ENABLED`,
`VITE_AI_CROSSFADE_OBSERVER_ENABLED`, `VITE_AI_RECOVERY_OBSERVER_ENABLED`, `VITE_AI_PRELOAD_OBSERVER_ENABLED`,
`VITE_AI_AUDIO_SWAP_OBSERVER_ENABLED`, `VITE_AI_BOUNDARY_EVIDENCE_ENABLED`, `VITE_AI_BOUNDARY_DASHBOARD_ENABLED`,
`VITE_AI_RUNTIME_BOUNDARY_KILL_SWITCH`.

## 18. Admin dashboard — AI Runtime Boundary

Super-admin, `설정`-group tab (`ai-runtime-boundary`), gated behind master + `VITE_AI_BOUNDARY_DASHBOARD_ENABLED`
(both default OFF). Thirteen subtabs (Overview / Signal Audit / Crossfade / Recovery / Preload / Audio Swap /
Stable Boundary / Revisions / Sessions / Sequences / Coverage / Readiness / Trace). It reads the live snapshot the
real Player publishes (usually absent in an admin session → NOT_AVAILABLE) and runs synthetic sequences through
the pure reducer. Allowed buttons: **Run Synthetic Sequence / Run Full Sequence Suite / Reset Local Observer /
Record Local Certification**. There are deliberately **no** Apply Queue / Activate Hook / Start Canary /
Control-Stop Player / Trigger Crossfade-Recovery-Preload / Production Canary buttons.

## 19. Performance

- Flag OFF: **0** additional network / timer / polling; publications are early-return no-ops; queue-calculation and
  playback-latency impact **none**; player behavior identical.
- Flag ON: the observer store keeps only the latest snapshot (no history), publishes at existing transition points
  (low-frequency), and is a separate store so it never re-renders the player.
- No measured browser-runtime numbers are fabricated (see §20).

## 20. Migration & Data safety

No migration is introduced (production head stays `0453`); boundary snapshots are in-memory / admin-harness only.
`git diff` vs baseline `1c5e5ca` confirms the changes are: the new `src/lib/aiRuntimeBoundary/` module, the
`AiRuntimeBoundaryDashboard`, AdminPage wiring (+8/−2), and a publication-only `Player.tsx` (+30/−0).
**Unchanged (verified empty diff):** `playerStore.ts` (incl. `setQueue`/`setPlaying`), `StorePlayerPage.tsx`,
`useFranchisePolicySync.ts`, `useBusinessAutoSwitch.ts`. No change to the playlist resolver, business schedule,
franchise policy, scheduler, crossfade calculation/gain/duration, recovery execution/retry, preload execution,
audio element/output/sinkId/currentTime/volume/muted, ranking, settlement, streaming-quality semantics,
governance, service worker, cache/CDN, or ffmpeg/wasm. No destructive SQL, no `play()`/`pause()`/`load()`, no
audio-src mutation, no runtime `setQueue`.

## 21. Tests & Manual QA

- `src/lib/aiRuntimeBoundary/aiRuntimeBoundary.test.ts` — **37 passing** unit tests (config gate, freshness/stale,
  sequence valid+invalid, stable-boundary blockers, reducer session attribution/reset/invalid-transition-recorded/
  out-of-order-dropped, coverage NO_DATA, readiness capped, evidence redaction, zero-control + fail-open OFF).
  Full suite **790 passing** (28 files).
- `npm run build` (`eslint --max-warnings=0 && tsc -b && vite build`), `npm run lint:tones`,
  `npm run lint:migrations` pass clean.
- **Runtime Manual QA:** **NOT RUN** — requires a Preview deployment with the observer flag enabled to verify (Flag
  OFF behavior identical, Flag ON snapshot/sequence, no playback interruption / double-playback / unexpected pause
  / queue change / current-track change / audio-output change, and observer kill switch). The pure-harness
  dashboard QA is possible in Preview; the real Player runtime observation is NOT RUN this phase.
- **Queue hook / Preview store canary / Production runtime:** NOT RUN (out of scope; no hook this phase).

## 22. Deferred work

- A real browser-runtime Manual QA pass in Preview to move Coverage past `NO_DATA` and confirm Flag-OFF/ON parity.
- An internal test store + applied Preview migration (canary resolver RPCs) — still the blocker for a single-store
  runtime proof and beyond.
- The isolated single-store queue hook itself remains **DEFERRED** to a future Change Request; this phase only
  removed the boundary-observability blocker.
