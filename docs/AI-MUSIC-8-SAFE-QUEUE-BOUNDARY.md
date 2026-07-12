# AI-MUSIC-8 — Safe Queue Boundary Adapter & Deterministic Runtime Harness (Preview)

> Phase status: **Preview only / pure model.** Nothing here is merged to production, deployed, or applied to the
> production database. **No migration is introduced this phase** — the production migration head stays `0453`.
> **No runtime hook is implemented** (deferred to a future Change Request). All feature flags default **OFF** and
> the kill switch defaults **ON**. Rule-based (no LLM/ML/external SaaS/new WebSocket). Everything in
> `src/lib/aiQueueAdapter/` is a PURE data/decision model + test harness; it **never** touches the real player
> store queue, the audio element, or playback. Certification reaches at most **READY_FOR_ISOLATED_PREVIEW_HOOK**.

## 1. Purpose

A future Preview canary would eventually need to hand an approved candidate queue to the *existing* player at a
*safe* boundary — without restarting the current track, resetting playback, or racing the resolver. Before any
such runtime hook is written, this phase builds the **decision model** and a **deterministic harness** that
proves — in simulation only — how that hand-off would preserve the current track and playback state, fail open
to the existing queue, keep control stores unchanged, honor the kill switch, and stay deterministic under
concurrent resolver responses. No production/preview store queue is ever changed; no `play()`/`pause()`/
`load()`/`currentTime`/`volume` is ever called.

## 2. Queue mutation audit (findings that drive the design)

A read-only audit of the real runtime (`playerStore.setQueue`, `Player.tsx`, the resolver hooks) established
the hard facts this model is built on — none of these files are modified:

- `setQueue(tracks, startIndex, playlist, context, opts)` writes `{ queue, index (= remapped startIndex target,
  **not** the current track), playlist, playlistContext, playing: **true**, currentTime: **0**, duration: 0,
  pendingSeekSec: null, shuffleOrder }`. It is effectively a **play command** (`canplay → attemptPlay →
  audio.play()`), and every resolver caller uses `startIndex = 0`, so a naive swap would restart playback from
  the top.
- The store queue carries **no** source, revision, version, session, or `requested_at` — it is unprotected
  last-writer-wins, so a late async resolver response can silently overwrite a newer queue.
- Franchise policy wins over business schedule on the store player.
- Crossfade / recovery / preload / ended-reason live in **component-local refs** and are **not observable** from
  store state — so the boundary model marks them `NOT_AVAILABLE` rather than pretending to see them.

These findings are surfaced verbatim in the dashboard's **Queue Audit** tab.

## 3. Queue command contract

`QueueCommand` models a queue-change **request** (not a playback command): `commandId`, `storeId`,
`playerSessionId`, `source`, `priority`, `playlistId/Version`, `queueSnapshotHash`, `requestedAt`, `expiresAt`,
`boundaryPolicy`, `preserveCurrentTrack`, `preservePlaybackState`, `requestRevision`, and experiment/canary/
assignment ids. `boundaryPolicy` is `NEXT_SAFE_BOUNDARY` or `IMMEDIATE_UNSAFE_FORBIDDEN` — **immediate is never
allowed**. `validateCommand` blocks immediate-unsafe, wrong-store (INVALID), wrong-session (STALE), expired
(EXPIRED), and pilot commands in production / on a control store / under the kill switch (BLOCKED).

## 4. Queue ⁄ playback command separation

The contract deliberately separates a *queue* change from a *playback* change. A safe adapter would only ever
enqueue a candidate at a boundary and preserve the current track + playback state; it would never carry a
play/pause/seek/volume instruction. This separation is the core design output that a future hook would build on
— it is documented and modelled here, not wired to the player.

## 5. Safe boundary model

`evaluateBoundary` returns `SAFE` **only** at a confirmed track boundary with crossfade complete, no recovery,
no preload, audio-swap complete, and a stable index/player-state. Crossfade / recovery / preload / audio-swap /
player-state in flight each yield the corresponding `UNSAFE_*`. When the signals are not observable (the audited
component-local refs), it returns `NOT_AVAILABLE` — the model never fabricates a safe boundary it cannot see.

## 6. Arbitration

`arbitrate` filters by scope (store/session), expiry, staleness (older revision than the latest seen for the
source), and pilot-safety (production / control / kill-switch), then the highest **audited** priority wins
(`MANUAL_REFRESH > RECOVERY > FRANCHISE_POLICY > BUSINESS_SCHEDULE > STORE_DEFAULT > PILOT_PREVIEW > UNKNOWN`;
pilot is lowest and never wins in production). Ties break to the newest revision then `requestedAt`; a
same-priority cross-source tie is a `CONFLICT` requiring review — never a silent pick.

## 7. Idempotency / stale protection

`evaluateFreshness` models the protection the real store lacks: it rejects `WRONG_STORE`, `WRONG_SESSION`,
`EXPIRED`, `DUPLICATE` (same command id or same resulting queue hash), `STALE` (older revision than the latest
for its source), and `VERSION_MISMATCH`, so a late out-of-order response can never overwrite a newer queue.

## 8. Current track & playback state preservation

`preserveCurrentTrack` returns `BLOCKED_CROSSFADE/RECOVERY/PRELOAD` at an unsafe boundary; otherwise, if the
current track is present in the candidate it returns `PRESERVED_IN_NEW_QUEUE` with the **remapped index**, else
`PRESERVED_UNTIL_BOUNDARY` (the swap waits), and `CURRENT_TRACK_MISSING` only when the candidate drops the
current track (still deferred, never a restart). `preservePlaybackState` shows that a **raw `setQueue`** would
`WOULD_RESET_CURRENT_TIME` / `WOULD_CHANGE_PLAYING`, whereas the **safe boundary adapter** path is `PRESERVED`
— the concrete argument for why the naive swap is unsafe.

## 9. Deterministic harness

`runHarness` composes arbitration + boundary + preservation into a single deterministic decision:
`APPLIED_IN_HARNESS` (simulation only, when a pilot winner is valid at a safe boundary), `DEFERRED_TO_BOUNDARY`,
`REJECTED`, or `EXISTING_PRESERVED`. It computes eight invariants — current-track-unchanged,
playback-state-unchanged, audio-state-unchanged, existing-queue-preserved-on-failure, control-store-preserved,
kill-switch-preserved, stale-never-overwrites, version-mismatch-preserved — and always reports
`realPlayerUntouched: true`. The result "queue" is the candidate **only** when applied to a pilot winner in the
harness; otherwise it is the existing queue, and `resultCurrentTrackId` is always the input current track.

## 10. Resolver race simulation

`simulateRace` classifies concurrent resolver responses: `DETERMINISTIC` (priority + revision decide),
`STALE_RESPONSE_BLOCKED` (the adapter rejects the late response), `CONFLICT_REQUIRES_REVIEW`, or —
critically — `LAST_WRITE_RISK` when adapter protection is off, which is exactly the current store's real
exposure. This makes the value of the revision/priority protection explicit.

## 11. Certification & preview-hook readiness

`computeAdapterCertification` caps at **BLOCKED** on any current-track / playback-state preservation, control,
fail-open, or kill-switch failure; returns `INSUFFICIENT_DATA` below the minimum scenario count; and reaches at
most `READY_FOR_ISOLATED_PREVIEW_HOOK` (never a production-ready verdict). The advisory score is capped and
carries an explicit "Pure Harness — not real Preview runtime application" limitation. `computePreviewHookReadiness`
returns `runtimeHookImplemented: false` and lists the next required action (an isolated Preview Hook Change
Request + internal test store + Preview migration) as **future** work.

## 12. Admin dashboard — AI Queue Adapter Lab

A super-admin, `설정`-group tab (`ai-queue-adapter-lab`), gated behind the master flag +
`VITE_AI_QUEUE_ADAPTER_HARNESS_ENABLED` (both default OFF). Twelve subtabs (Overview / Queue Audit / Commands /
Boundaries / Arbitration / Current Track / Playback State / Race Simulation / Fail-open / Certification /
Readiness / Trace) run a built-in synthetic scenario suite **entirely in the browser** via the pure engines.
Allowed actions: **Run Scenario Suite**, **Trace** (single scenario), **Reset Local Harness**, **Record
Certification** (local state only, no DB). There are deliberately **no** Apply Queue / Activate Canary / Modify
Store / Start Playback / Stop Playback / Production Hook buttons.

## 13. Feature flags & kill switch

`getAiQueueAdapterConfig` inherits the master `VITE_AI_MUSIC_ENABLED`; `adapterEnabled` / `harnessEnabled` /
`certificationEnabled` default **false**; `killSwitch` defaults **true (ON)**. With the master or harness flag
off, the dashboard renders only an opt-in notice and runs nothing.

## 14. Migration decision — none this phase

No migration (`0471` was considered and **skipped**). This phase persists nothing: certification is recorded in
local dashboard state only, and there are no runtime queue commands, pending queues, or boundary events to
store. Introducing a table would contradict the "no DB change" constraint for zero benefit. The production
migration head remains `0453`. A queue-command / pending-queue schema is deferred to the same future Change
Request that would implement the isolated Preview hook.

## 15. Absolute constraints honored

- No production merge / deploy / migration apply / DB change; production migration head stays `0453`.
- No real Preview/Production store queue change; no auto canary / queue-swap / playback / pause / stop /
  rollback.
- No `play()` / `pause()` / `load()` calls added; no `currentTime` / `volume` / `muted` / `sinkId` change; no
  crossfade / preload / recovery / queue-order / scheduler calculation change.
- `setQueue` / `setPlaying` / `usePlayerStore` / `Player.tsx` / `StorePlayerPage` runtime hook are **UNCHANGED**
  (verified by `git diff` against the phase baseline — empty).
- No fabricated boundary event / queue-apply success / current-track preservation; no un-run browser/player
  test reported as PASS.
- The runtime hook is **not** implemented this phase; certification maxes at `READY_FOR_ISOLATED_PREVIEW_HOOK`.
- All flags default OFF; kill switch defaults ON.

## 16. Test & QA status

`src/lib/aiQueueAdapter/aiQueueAdapter.test.ts` — 45 passing unit tests over the contract, boundary,
arbitration, freshness, preservation, harness, race, and certification engines. `npm run build`
(`eslint --max-warnings=0 && tsc -b && vite build`) and `npm run lint:tones` pass clean.

- **Pure Harness Dashboard Manual QA:** possible in a Preview deployment with the flags enabled (Run Scenario
  Suite / Trace / Reset / Record Certification) — all client-side simulation.
- **Player / Preview runtime / Production runtime QA:** **NOT RUN** — no runtime hook exists this phase, by
  design.
