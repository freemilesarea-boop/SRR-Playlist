# AI-MUSIC-9 — Isolated Preview Queue Hook & Single-Store Runtime Proof (Preview)

> Phase status: **Preview only / pure model. Runtime hook DEFERRED.** Nothing here is merged to production,
> deployed, or applied to the production database. **No migration is introduced** — the production migration head
> stays `0453`. **No runtime hook is wired** into the player, the store, or any page. All feature flags default
> **OFF** and the kill switch defaults **ON**. Rule-based (no LLM/ML/external SaaS/new WebSocket). Everything in
> `src/lib/aiRuntimeHook/` is a PURE data/decision model + test harness; it **never** touches the real player
> store queue, the audio element, or playback. Certification cannot exceed **NOT_RUN** without real single-store
> runtime evidence, which does not exist this phase.

## 1. Baseline

- Base PR: **#357** (AI-MUSIC-8), branch `feat/ai-music-8-safe-queue-boundary`, head `232692e9`, CI success +
  Preview READY, not merged.
- This phase branch: `feat/ai-music-9-isolated-preview-hook`, created from PR #357 head (not from default).
- Production migration head unchanged: `0453`. Migrations `0464`–`0470` remain validated-but-not-applied.

## 2. Go / No-Go — decision: **NO-GO → Runtime Hook DEFERRED**

The Go gate requires every condition (PR #357 green + Preview READY, adapter certification
`READY_FOR_ISOLATED_PREVIEW_HOOK`, an internal test store, a candidate playlist, an applied Preview migration,
runtime-observable boundary state, provable current-track/playback preservation, control-store separability,
preview/production distinguishability, a rollback target). Three independent No-Go conditions hold this phase:

1. **No internal test store is configured** — the AI-MUSIC-7 allowlist migration (`0470`) is not applied, so no
   `store_id` / candidate playlist / version / snapshot exists anywhere. (Also no candidate playlist, no rollback
   target.)
2. **Preview migration not applied** → the canary resolver RPCs do not exist in the DB → the runtime resolver is
   uncallable.
3. **Boundary state is not observable at runtime** — the re-audit found crossfade/recovery/preload state lives in
   `Player.tsx` component-local refs (299 occurrences) and is **absent** from the player store (0 occurrences).
   Without modifying the **forbidden** `Player.tsx`, a runtime hook cannot distinguish a safe boundary, so
   current-track and playback-state preservation cannot be proven at runtime.

Feasibility = **SAFE_ADAPTER_ONLY**: the design is safe to *model and unit-test*, but the runtime hook is
deferred to a future Change Request. Per the phase spec, we therefore build the full pure model + dashboard +
synthetic validation + tests, and implement **no** runtime hook (Commit 3 skipped).

## 3. Runtime hook feasibility re-audit (Task 1)

Confirmed against the latest code (`playerStore.ts`, `Player.tsx`, `StorePlayerPage.tsx`, resolver hooks):

- `setQueue(tracks, startIndex=0, …)` sets `playing:true`, `currentTime:0`, `duration:0` — it is effectively a
  **play command**; every resolver caller uses `startIndex=0`.
- The store queue carries **no** source/revision/session/version — unprotected last-writer-wins.
- Crossfade/recovery/preload/audio-swap are **component-local to `Player.tsx`** → not observable from the store.
- `StorePlayerPage` already mounts fail-open hooks (`useShadowResolutionProbe`, `useFranchisePolicySync`, store
  heartbeat, health telemetry), so a one-line fail-open hook mount there *would* be consistent — but the boundary
  state a hook needs is not reachable without touching `Player.tsx`. **Insertion point exists; safe observation
  does not.** → DEFERRED.

## 4. Single test store contract (`storeContract.ts`)

`validateTestStore` accepts exactly one internal, non-customer, non-enterprise/franchise store: no wildcard, no
multiple stores, no auto-add; must be enabled, non-expired, deployment-pinned, candidate/version/snapshot-pinned,
approved, `maxSessions=1`, `maxQueueApplications` minimal, `killSwitchRequired=true`. Any miss → a specific
`TestStoreValidity` reason.

## 5. Runtime hook contract (`hookContract.ts`)

`evaluateRuntimeHook` runs the full gate chain (flags → kill switch → control store → preview env → deployment →
store allowlist → session/application caps → version/snapshot → boundary safety) and, only at a confirmed safe
boundary, composes the queue-only adapter. Decisions: `NO_ACTION` / `WAITING_BOUNDARY` / `CANDIDATE_READY` /
`APPLIED_AT_BOUNDARY` / `CONTROL_PRESERVED` / `FLAG_DISABLED` / `KILL_SWITCHED` / `STORE_NOT_ALLOWED` /
`DEPLOYMENT_MISMATCH` / `SESSION_LIMIT` / `VERSION_MISMATCH` / `SNAPSHOT_MISMATCH` / `STALE_COMMAND` /
`UNSAFE_BOUNDARY` / `FAIL_OPEN` / `ERROR`. The result is the existing queue unless `APPLIED_AT_BOUNDARY` (in-model
only). Every result carries `actualPlayerControl:false`, `directAudioMutation:false`, `automated:false`,
`previewOnly:true`, and `realPlayerUntouched:true`.

## 6. Queue-only mutation adapter (`queueOnlyAdapter.ts`)

`computeQueueOnlyMutation` is a **pure reducer over a snapshot** — never the real Zustand store. It replaces
only the queue array + current index while preserving every playback field, and its result object asserts
`setQueueCalled:false`, `setPlayingCalled:false`, `audioApiCalled:false`, and `playing/currentTime/
activeAudioIndex/currentTrack` unchanged. Current track in candidate → remap index; current track missing → hold
it as the head item and append the candidate tail (never cut mid-play); empty/invalid/non-observable → BLOCKED,
existing queue unchanged. This is the concrete proof that a queue swap can be modelled without calling `setQueue`.

## 7. Boundary reservation (`reservation.ts`)

A candidate is never applied immediately; it is RESERVED and consumed only at a safe boundary. Legal state
machine (`RESERVED→VALIDATED→WAITING_BOUNDARY→APPLYING→APPLIED`, plus SUPERSEDED/EXPIRED/REJECTED/CANCELLED) with
expiry/cap guards. Every reservation asserts `persistedToProductionDb:false` — Preview-session memory only.

## 8. Runtime arbitration (`runtimeArbitration.ts`)

Existing resolvers and safety conditions win: kill switch / session change / deployment change / version change →
`CANDIDATE_CANCELLED`; recovery active → `CANDIDATE_DEFERRED`; a policy/schedule/existing-queue revision change
after the reservation → `CANDIDATE_STALE`; application cap → `EXISTING_WINS`; otherwise `CANDIDATE_MAY_APPLY`. A
candidate never permanently replaces the existing resolver.

## 9. Current-track & playback-state preservation (`preservation.ts`)

`checkCurrentTrackPreservation` / `checkPlaybackStatePreservation` compare before/after snapshots. A safe hook may
change only queue metadata / next candidate / revision / resolver source; any change to playing, paused,
currentTime, volume, muted, sinkId, activeAudioIndex, current track, or audio source → `CHANGED_BLOCKED` /
`FORBIDDEN_CHANGE`. Non-observable before/after → `NOT_OBSERVABLE` (never a false PASS).

## 10. Fail-open wrapper (`failOpen.ts`)

Models the gate chain + short-timeout, no-retry body + try/catch. Any gate miss short-circuits; any thrown error
is dropped (summary only, never a raw stack) → existing queue + existing player state preserved; `threwToPlayer`
is always `false`.

## 11. Control-store zero-overhead

Control and general stores short-circuit before any work: `CONTROL_PRESERVED` in the hook, `SHORT_CIRCUIT_CONTROL`
in fail-open. No canary RPC, no candidate fetch, no snapshot, no evidence, no extra timer/polling/memory. (And
because no hook is wired this phase, control stores incur literally zero additional calls.)

## 12. Runtime evidence (`evidence.ts`)

Low-frequency, hash-only, redacted. Records store/session/deployment/playlist/queue/current-track **hashes**,
boundary, result, reason code, and a duration bucket — and every event asserts `containsAudioUrl:false`,
`containsTrackTitle:false`, `containsArtist:false`, `containsRawQueue:false`, `containsRawError:false`,
`containsToken:false`, `containsPii:false`. No real evidence is produced this phase (hook DEFERRED).

## 13. Immediate kill switch & 14. Manual rollback (`rollback.ts`)

Kill switch ON: no new reservation, cancel waiting reservations, cancel pre-apply candidates, reserve a return to
the existing resolver at the next safe boundary — never a forced mid-track stop, never an audio API call, re-run
needs a new approval. `evaluateRollback` is operator-initiated only (`automatic:false`): requires an existing
playlist, a rebuildable queue, same session + deployment, a preserved current-track snapshot, and a safe boundary
→ `ROLLED_BACK_AT_BOUNDARY`; unsafe boundary → reserved; missing target → `TARGET_MISSING`.

## 15. Guardrails (`guardrails.ts`)

Any dangerous runtime signal (current track changed, current time reset, unexpected play/pause, double playback,
empty queue, invalid index, crossfade/recovery state change, preload conflict, audio-output change, repeated
fetch/race failure, unexpected queue rewrite, runtime error) → `STOP_RECOMMENDED` with `automaticStop:false`.
Never an automatic stop.

## 16. Single-store certification (`certification.ts`)

`computeSingleStoreCertification`: **without real runtime evidence → `NOT_RUN`** (this phase). With evidence, any
preservation / control / fail-open / kill-switch / rollback failure caps at `BLOCKED`; the top status is only
`CERTIFIED_FOR_SINGLE_INTERNAL_STORE`. "Production Ready" is never used.

## 17. Production canary CR readiness

`computeProductionCrReadiness`: `NOT_RUN` cert → `NOT_RUN`; certified → `MORE_SINGLE_STORE_EVIDENCE_REQUIRED`.
`actualProductionCanaryRun` is always `false` — no production canary is run this phase (or by this module).

## 18. Migration decision — none this phase

No migration is introduced. The AI-MUSIC-7 Preview canary tables (`0470`) are not applied and are not required by
the pure model. All evidence/certification is local. Production migration head stays `0453`. A queue-command /
reservation / evidence schema is deferred to the same future Change Request that would implement the isolated
Preview hook.

## 19. Feature flags (`config.ts`)

`getAiRuntimeHookConfig` inherits the AI-MUSIC master flag. `hookEnabled`, `queueOnlyAdapterEnabled`,
`boundaryReservationEnabled`, `runtimeEvidenceEnabled`, `runtimeGuardrailEnabled`, `runtimeRollbackEnabled`
default **false**; `killSwitch` defaults **true (ON)**; `isolatedStoreId` / `isolatedDeploymentId` default
**unset**; `maxSessions` is hard-pinned to **1**; `maxQueueApplications` defaults to the **minimum (1)**. Env
vars: `VITE_AI_ISOLATED_PREVIEW_HOOK_ENABLED`, `VITE_AI_QUEUE_ONLY_ADAPTER_ENABLED`,
`VITE_AI_BOUNDARY_RESERVATION_ENABLED`, `VITE_AI_RUNTIME_EVIDENCE_ENABLED`, `VITE_AI_RUNTIME_GUARDRAIL_ENABLED`,
`VITE_AI_RUNTIME_ROLLBACK_ENABLED`, `VITE_AI_ISOLATED_PREVIEW_HOOK_KILL_SWITCH`,
`VITE_AI_ISOLATED_PREVIEW_STORE_ID`, `VITE_AI_ISOLATED_PREVIEW_DEPLOYMENT_ID`,
`VITE_AI_ISOLATED_PREVIEW_MAX_QUEUE_APPLICATIONS`.

## 20. Admin dashboard — AI Runtime Proof

Super-admin, `설정`-group tab (`ai-runtime-proof`), gated behind master + `VITE_AI_ISOLATED_PREVIEW_HOOK_ENABLED`
(both default OFF). Twelve subtabs (Hook Readiness / Single Store / Reservations / Boundaries / Runtime Evidence /
Current Track / Playback State / Guardrails / Kill Switch / Rollback / Certification / CR Readiness) run a
built-in synthetic scenario suite entirely in the browser. It shows the fixed **Go/No-Go = NO-GO** banner and an
honest **Certification = NOT_RUN**. Allowed operator buttons (Approve Hook / Arm Single Store / Activate Session /
Pause / Request·Confirm Stop / Request·Confirm Rollback / Enable Kill Switch / Record Certification) update
**local simulation state only**. There are deliberately **no** Add-Multiple-Stores / Production-Canary /
Full-Rollout / Automatic-Expand / Customer-Store-Apply buttons.

## 21. Performance

- General stores: **0** additional calls (no hook wired).
- Control stores: **0** additional calls.
- No new timer/polling/memory/dependency-array changes anywhere in the runtime.
- The dashboard suite is a synchronous, in-memory computation over ~22 scenarios; no network.

## 22. Data safety

`git diff` vs baseline `232692e9` confirms the only changes are the new `src/lib/aiRuntimeHook/` module, the
`AiRuntimeProofDashboard`, and the AdminPage wiring (+8/−2). **Unchanged (verified empty diff):** `playerStore.ts`
(incl. `setQueue`/`setPlaying`), `Player.tsx`, `StorePlayerPage.tsx`, `useFranchisePolicySync.ts`,
`useBusinessAutoSwitch.ts`. No change to existing resolvers, business schedule, franchise policy, scheduler,
crossfade/preload/recovery, audio element/output/sinkId/currentTime/volume/muted, ranking, settlement, streaming
quality, governance, production config, service worker, cache/CDN, or ffmpeg/wasm. No destructive SQL, no
`play()`/`pause()`/`load()`, no audio-src mutation, no `setQueue` change.

## 23. Absolute constraints honored

- No production merge/deploy/migration-apply/DB change; head stays `0453` (no migration added).
- No real Preview/Production store queue change; no customer/enterprise/franchise/general/multi-store hook; no
  wildcard/auto-allowlist/auto-activate/auto-apply/auto-playback/auto-pause/auto-stop/auto-rollback/auto-expand.
- No `Player.tsx` change; no audio-element mutation; no `play()`/`pause()`/`load()`; no `currentTime`/`volume`/
  `muted`/`sinkId` change; no `setQueue`/`setPlaying` semantic change; no crossfade/preload/recovery/scheduler/
  policy/schedule/polling/retry/timeout/cleanup/dependency-array change.
- Runtime hook **not** implemented (DEFERRED); certification max `NOT_RUN` this phase; no production canary.
- All flags default OFF; kill switch default ON.

## 24. Tests & QA

- `src/lib/aiRuntimeHook/aiRuntimeHook.test.ts` — **61 passing** unit tests (gates, boundary safety, queue-only
  preservation proof, store contract, reservation state machine, arbitration, preservation checks, fail-open,
  guardrails, evidence redaction, rollback, certification `NOT_RUN` without evidence, Go/No-Go `NO_GO`).
- `npm run build` (`eslint --max-warnings=0 && tsc -b && vite build`) and `npm run lint:tones` pass clean.
- **Runtime Manual QA:** **NOT RUN / DEFERRED** — no internal test store, no applied Preview migration, and no
  runtime hook exists this phase. Pure-harness dashboard QA is possible in a Preview deployment with the flags
  enabled (all client-side simulation).

## 25. Deferred work

- Isolated Preview runtime hook implementation (Change Request) — gated on the failed Go conditions below.
- An internal test store + applied Preview migration (canary resolver RPCs) so the resolver is callable.
- Runtime observability of crossfade/recovery/preload **without** modifying `Player.tsx` (or an explicit,
  separately-approved decision to expose that state) — the current blocker for provable preservation.
- Real single-store runtime evidence → single-store certification → multi-session internal preview → production
  canary Change Request.
