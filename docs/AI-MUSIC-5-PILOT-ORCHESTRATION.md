# AI-MUSIC-5 — Approval-Gated Pilot Execution & Safe Rollout Orchestration (Preview)

> Phase status: **Preview only.** Nothing in this phase is merged to production, deployed, or applied to the
> production database. Migration `0468` is **validated but NOT applied** — the production migration head stays
> at `0453`. All feature flags default **OFF**.

## 1. What this phase is (and is not)

AI-MUSIC-5 lets an operator take an **already-approved** AI-MUSIC-4 Experiment Plan and run it, by hand and
behind an approval gate, on a limited set of **Pilot Stores**. It is an *orchestration* layer: it has real
state and real actions, but **every action is an explicit operator step** with a confirmation dialog. It is
rule-based — **no LLM, no ML, no external experiment SaaS, no new WebSocket dependency.**

It is **NOT** an automation system. The AI never:

- starts a pilot automatically
- assigns a store to a group automatically
- deploys / updates a playlist
- expands the store set or performs a full rollout
- stops or rolls back a pilot automatically

…and it never modifies an original playlist, controls the Player, or interrupts playback.

### Absolute safety invariants

| Invariant | How it is enforced |
|---|---|
| No production merge / deploy / migration apply / direct DB change | Preview branch only; `0468` validated via rollback-txn, never applied; prod head stays `0453` |
| No automatic start / assign / deploy / expand / rollout / rollback / stop | State machine allowlist + each action is a distinct operator RPC behind a confirm dialog |
| No execution without operator approval | `record_ai_pilot_approval` stores APPROVED but creates **no** override; activation is a separate call |
| No change beyond the approved scope of stores | Overrides are created only for the run's own treatment assignments |
| No applying a playlist version other than the approved one | Version is pinned at approval; the preview resolver refuses a version-pin mismatch (fails open) |
| No control-group playlist change | Control stores are **never** given an override (control preserved), in both SQL and the resolver |
| No direct UPDATE of an existing store playlist | No RPC writes to `playlists` / `playlist_tracks`; rollback/complete only flip override *state* |
| No change to Player / Queue / Crossfade / Preload / Recovery / Scheduler / Ranking / Settlement / Governance / AI-MUSIC-1~4 | None of those files are touched (see §6 data-safety scan) |

## 2. Runtime integration is DEFERRED (proven, not assumed)

Per the phase's overriding principle — *"first prove whether a safe Override Layer is possible; if not proven,
do not force runtime integration"* — the existing playlist-delivery path was audited first:

- A store is a business user; its queue is generated **client-side** in `playerStore.setQueue`.
- Franchise policy is delivered via `get_store_active_music_policy` (polled ~60s, applied at track boundary,
  fail-open) in `useFranchisePolicySync`; business schedules via `useBusinessAutoSwitch`.
- There is **no existing override hook** and **no base-playlist versioning** in that path.

Wiring a live pilot override into that path would require modifying forbidden runtime files
(`Player.tsx`, `useFranchisePolicySync`, `playerStore`, the `get_*` RPC) and would only function if the
migration were applied to production — both forbidden. **Decision: build the orchestration + override table +
preview resolver, and DEFER runtime integration.** The override table exists but **no runtime code reads it**;
`resolveStorePlaylist` is a pure *preview* resolver used for operator display only.

## 3. Components

### Engines — `src/lib/aiPilot/`
- **`stateMachine.ts`** — 14-state machine (`DRAFT → REVIEW_REQUIRED → APPROVED → SCHEDULED → ACTIVE ⇄ PAUSED →
  STOP_REQUESTED → STOPPED → ROLLBACK_REQUESTED → ROLLED_BACK`, plus `COMPLETED / CANCELLED / FAILED / EXPIRED`).
  Strict allowlist; everything else rejected; terminal states cannot re-activate; same-state rejected.
- **`approvalGate.ts`** — prerequisite + safety checks. Storing an approval never activates (`executed:false`).
  Missing streaming-guardrail source → `NEEDS_INVESTIGATION` (honest NOT_AVAILABLE), not a fake pass.
- **`assignmentSnapshot.ts`** — immutable snapshot with a deterministic FNV-1a hash (no randomness, no clock).
  Control snapshots never carry a candidate. `verifyImmutable` detects any mutated field or forged hash.
- **`overrideResolver.ts`** — **preview-only** priority resolver: `pilot override → store → brand → fallback`.
  Control preserved; version-pin enforced; fails **open** to the existing path on any miss / expiry / mismatch.
- **`guardrailMonitor.ts`** — recommendation only (`PASS / WARNING / STOP_RECOMMENDED / BLOCKED /
  NOT_AVAILABLE / INSUFFICIENT_DATA`); never acts.
- **`observation.ts` / `progress.ts` / `completion.ts` / `expansion.ts`** — window classification, read-only
  rollups, capped confidence (never certainty), operator-confirmed completion, expansion that is **always a new
  experiment version** and **never** a full production rollout.
- **`config.ts`** — 7 flags, all default OFF, gated behind the AI-MUSIC master flag.

### Migration — `supabase/migrations/0468_ai_music_pilot_orchestration.sql`
6 isolated tables (`ai_music_pilot_runs`, `ai_music_pilot_assignments`, `ai_music_playlist_overrides`,
`ai_music_pilot_observations`, `ai_music_pilot_guardrails`, `ai_music_pilot_actions`) + 20 SECURITY DEFINER
functions. Super-admin gated, writes via RPC only, `search_path` pinned, params bounded, `auth.uid()` actor
recorded, no dynamic SQL. The SQL state helper `_ai_pilot_can_transition` mirrors the client allowlist 1:1;
`ai_music_playlist_overrides` has a partial unique index enforcing one live (ACTIVE) override per store.

### Client API — `src/lib/api/aiPilotApi.ts`
Reads (overview/detail/progress/observations/guardrails) + approval-gated writes (approval → activate →
pause/resume → stop → rollback → complete + observation/guardrail records). Computes the deterministic
snapshot hashes client-side before recording approval. Each write is an explicit call; nothing auto-executes.

### Dashboard — `src/components/admin/AiPilotOperationsDashboard.tsx`
Super-admin `설정` tab (`ai-pilot-operations`), 12 tabs. Every action button opens a confirm dialog that
requires a typed reason (≥3 chars), shows an impact summary, and carries an explicit **"자동 실행 없음 (No
Automatic Execution)"** notice. Actions are state-driven; stop and rollback are request→confirm; there is
**no Full Rollout button**.

## 4. Feature flags (all default OFF)

| Env var | Controls |
|---|---|
| `VITE_AI_MUSIC_ENABLED` | Master (inherited) |
| `VITE_AI_PILOT_ORCHESTRATION_ENABLED` | Pilot Operations dashboard visibility |
| `VITE_AI_PILOT_ACTIVATION_ENABLED` | Manual Activate visibility |
| `VITE_AI_PILOT_OVERRIDE_ENABLED` | Override preview resolver visibility |
| `VITE_AI_PILOT_OBSERVATION_ENABLED` | Observation snapshots visibility |
| `VITE_AI_PILOT_GUARDRAIL_ENABLED` | Live guardrail monitor visibility |
| `VITE_AI_PILOT_PAUSE_RESUME_ENABLED` | Pause/Resume/Stop visibility |
| `VITE_AI_PILOT_ROLLBACK_ENABLED` | Rollback request/confirm visibility |

A flag OFF (kill switch) only hides UI/orchestration — it can never touch Player, Playback, Queue, real
Playlist, ranking, or settlement.

## 5. Migration validation (rollback-transaction, NOT applied)

`0468` was validated against production inside a `BEGIN … RAISE 'VALIDATION_OK' … (abort)` transaction with a
stubbed `_is_super_admin()`, exercising 24 synthetic scenarios with synthetic UUIDs:

```
VALIDATION_OK :: assignments=5 treat=3 ctrl=0 stopped=3 rb=3 completed=1 forbidden=t
```

- 5 assignments stored; **control carried 0 candidates** (control preserved)
- approval left state `APPROVED` and created **0 overrides** (approval ≠ activation)
- activation created **3 treatment overrides, 0 control overrides**
- null candidate version rejected; re-activation rejected; expired approval blocked activation
- pause→3 paused, resume→3 active, stop(request→confirm)→3 stopped, rollback(request→confirm)→3 rolled back
- terminal state rejected further transitions; complete expired the override
- guardrail record caused **no** state change (recommendation only)

A post-abort read confirmed **0 tables and 0 functions persisted** and the real `_is_super_admin` intact.

## 6. Data-safety scan

`git diff --name-only <base>..HEAD` touches only: `src/lib/aiPilot/*`, `src/lib/api/aiPilotApi.ts`,
`src/components/admin/AiPilotOperationsDashboard.tsx`, `src/pages/AdminPage.tsx` (additive tab wiring only),
and `supabase/migrations/0468_ai_music_pilot_orchestration.sql`. **No** `Player.tsx`, `useFranchisePolicySync`,
`useBusinessAutoSwitch`, `playerStore`, `StorePlayerPage`, `get_playlist_tracks`, crossfade/preload/scheduler,
ranking, or settlement file is modified. Original playlists and the queue-generation path are unchanged.

## 7. Verification

- `npm run build` (lint + `tsc -b` + vite) — clean
- `npm run lint:tones` — clean
- `npm run lint:migrations` — clean
- `npx vitest run src/lib/aiPilot/` — 54 tests pass
- Rollback-txn validation vs production — `VALIDATION_OK`, nothing persisted
