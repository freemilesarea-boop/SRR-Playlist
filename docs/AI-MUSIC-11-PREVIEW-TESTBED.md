# AI-MUSIC-11 — Internal Preview Testbed Provisioning & Canary Environment Readiness (Preview)

> Phase status: **Preview only / provisioning tooling.** Nothing here is merged to production, deployed, or
> applied to the production database. **No migration is introduced** — the production migration head stays `0453`.
> **No real store/account/playlist is created; no Preview migration is applied; no queue/playback is changed; no
> canary runs.** All feature flags default **OFF** and the kill switch defaults **ON**. Rule-based (no LLM/ML).
> The environment audit found the app **shares the production Supabase** between Preview and Production
> (SHARED_PRODUCTION_DB) with no isolated Preview DB — so migration apply and fixture creation are **DEFERRED**
> and testbed readiness is capped at **BLOCKED/PARTIAL** this phase.

## 1. Baseline

- Base PR: **#359** (AI-MUSIC-10), branch `feat/ai-music-10-runtime-boundary-observability`, head `40f2686`, CI
  success + Preview READY, not merged.
- This phase branch: `feat/ai-music-11-preview-testbed`, created from PR #359 head (not default).
- Production migration head unchanged: `0453`. Migrations `0464`–`0470` remain validated-but-not-applied.

## 2. Preview environment audit (Task 1) — **SHARED_PRODUCTION_DB**

`list_projects` shows three Supabase projects in the org: **SRR Playlist** (`nsoesrvwkxqifjcxzvol`, production),
**STUDIOBODA** (`wxdlcjgvclyygjvimhgn`), and a generic project (`tyrhbiwvwmdybwaydvto`) — the latter two are
unrelated apps. The SRR Playlist client connects via `VITE_SUPABASE_URL` to `nsoesrvwkxqifjcxzvol` for **both**
Preview and Production Vercel builds; there is **no dedicated isolated Preview DB or Supabase branch** for the
app. `auditEnvironment` therefore returns **`SHARED_PRODUCTION_DB`** with `migrationApplyAllowed: false`. Per the
phase rules, a shared production DB **forbids** applying any Preview migration and **forbids** creating test data.

## 3. Preview database strategy

`recommendDbStrategy` returns **RECOMMENDED: B_SEPARATE_TEST_PROJECT** (or A_SUPABASE_BRANCH if branching is
enabled). Option **D (shared production + test rows) is always BLOCKED**. To proceed, a separate Supabase Test
Project (or a Supabase branch) must be provisioned and the Preview Vercel env re-bound to it — this is not done
this phase (cost: a separate project with its own Auth/Storage, or a branch with a bounded lifetime).

## 4. Preview migration plan (validation only; apply NOT RUN)

`validateMigrationPlan` over the `AI_MUSIC_MIGRATIONS` metadata (0464 Foundation → 0465/0466/0467/0468/0469 →
0470 Preview Canary, with dependency `0470 → {0468, 0469}`) confirms the dependency order is **VALID**. But
because the environment is not an isolated preview/local DB, the plan status is **BLOCKED** (`applied: false`).
The migrations are **never** applied to production, and are not applied anywhere this phase.

## 5. Internal test store contract

`validateTestStore` requires `environment='preview'`, `test_only`, an `INTERNAL_AI_CANARY_STORE_` name prefix
(no real brand/store name), a future expiry, `cleanup_required`, and rejects customer/enterprise/franchise
stores. **No store is created** this phase (shared prod DB) — the contract is validated against a synthetic
sample only.

## 6. Internal test account

`validateTestAccount` requires a test-alias email (rejects real personal/customer emails), `test_only`,
`production_access=false`, and an expiry. **NOT CREATED** — no account is created in production Auth.

## 7–9. Playlist fixtures · version/snapshot · rollback target

`validateExistingPlaylist` / `validateCandidatePlaylist` require ≥5 test-prefixed tracks, a candidate that
shares 2–3 tracks with the existing playlist (enabling a current-track-preservation scenario) plus new tracks,
and reject empty candidates and production-like track ids. `validateCandidateVersionSnapshot` pins the version
and verifies the snapshot hash with the **same deterministic FNV-1a algorithm as AI-MUSIC-7/8** (a mismatch
invalidates the approval). `validateRollbackTarget` requires an existing playlist + snapshot + resolver source —
rollback is modelled as **re-using the existing resolver**, not restoring a queue JSON. No fixtures are created.

## 10–11. Allowlist fixture · deployment binding

`validateAllowlist` requires a single store, `max_sessions=1`, `enabled=false` (never runtime-enabled this
phase), and an expiry. `evaluateDeploymentBinding` returns `NOT_AVAILABLE` when the deployment id can't be pinned
(canary activation is then forbidden); a new commit produces a new deployment id that invalidates the fixture.

## 12. Test window / operator plan

`validateTestWindow` requires start/end, operator, reviewer, rollback operator, and stop/rollback conditions
(the 10 stop conditions include double playback, unexpected pause, queue empty, current-time reset, current-track
change, crossfade error, recovery failure, media error, observer error, candidate snapshot mismatch). With no
real schedule it is a **DRAFT**.

## 13–14. Seeder & cleanup (dry-run tools)

`scripts/seed-ai-preview-testbed.mjs` and `scripts/cleanup-ai-preview-testbed.mjs` mirror the tested
`guardSeeder`/`guardCleanup` rules: they **HARD-REJECT** the production project ref (`nsoesrvwkxqifjcxzvol`,
exit 2), default to **dry-run** (write/delete nothing), require `--confirm-preview`/`--confirm` to act, the
cleanup only ever targets `AI_PREVIEW_TESTBED`-tagged rows in dependency order, and both **REFUSE to run** even
with confirmation because no isolated Preview DB is provisioned. Verified: dry-run produces a plan and writes
nothing; the production ref is rejected.

## 15. Isolation verification

`verifyIsolation` returns **UNSAFE** whenever the preview DB shares the production project ref (as now) —
`ISOLATED` (the only status that unblocks the single-store hook change request) requires a distinct DB ref,
separate auth/storage, no store/playlist id collisions, preview-only reachability, a single-store allowlist, a
session cap of 1, a pinned candidate, an expiry, and a cleanup path.

## 16. Testbed readiness certification

`computeTestbedReadiness` caps at **BLOCKED** when the preview DB is not isolated / migration apply is not
allowed / the kill switch is off / flags are on. This phase, with a shared production DB, the status is
**BLOCKED**; even with an isolated DB, missing core fixtures cap at **PARTIAL**, and only a fully-provisioned
testbed reaches `READY_FOR_SINGLE_STORE_CHANGE_REQUEST`. No runtime hook is implemented.

## 17. Single-store hook change request draft

`docs/AI-MUSIC-12-SINGLE-STORE-HOOK-CHANGE-REQUEST.md` is the pre-execution CR draft (scope: 1 internal preview
store, 1 candidate, 1 session; Go/No-Go criteria; activation/rollback/cleanup steps; Production Impact = None).
It is **not executed** this phase.

## 18. Feature flags / environment variables

`getAiPreviewTestbedConfig` inherits the AI-MUSIC master flag. `testbedEnabled` defaults **false**; `killSwitch`
defaults **true (ON)**; `previewProjectRef` / `previewDeploymentId` / `storeId` / `existingPlaylistId` /
`candidatePlaylistId` / `candidateVersion` / `candidateSnapshot` default **unset**; `maxSessions` is pinned to
**1**. Env vars: `VITE_AI_PREVIEW_TESTBED_ENABLED`, `VITE_AI_PREVIEW_PROJECT_REF`,
`VITE_AI_PREVIEW_DEPLOYMENT_ID`, `VITE_AI_PREVIEW_STORE_ID`, `VITE_AI_PREVIEW_EXISTING_PLAYLIST_ID`,
`VITE_AI_PREVIEW_CANDIDATE_PLAYLIST_ID`, `VITE_AI_PREVIEW_CANDIDATE_VERSION`,
`VITE_AI_PREVIEW_CANDIDATE_SNAPSHOT`, `VITE_AI_PREVIEW_MAX_APPLICATIONS`, `VITE_AI_PREVIEW_KILL_SWITCH`. **No
secret/credential is read into the repo**; the production ref is used only to *reject* it in the guards.

## 19. Admin dashboard — AI Preview Testbed

Super-admin, `설정`-group tab (`ai-preview-testbed`), gated behind master + `VITE_AI_PREVIEW_TESTBED_ENABLED`
(both default OFF). Fifteen subtabs (Overview / Environment / Database / Migrations / Test Store / Test Account /
Existing Playlist / Candidate Playlist / Version-Snapshot / Allowlist / Deployment / Test Window / Cleanup /
Readiness / Change Request). Allowed buttons: **Validate Environment / Dry-run Seeder / Dry-run Cleanup /
Validate Snapshot / Record Readiness / Export Change Request**. There are deliberately **no** Apply-Migration /
Create-Store / Activate-Hook / Start-Canary / Apply-Candidate / Production-Canary / Full-Rollout buttons.

## 20. Security / privacy

No test account credential, production secret, service-role key, or signed URL is stored or logged. The
production project ref is surfaced only to reject it. Track ids are validated by prefix; no audio URL / signed
URL / real customer data is used as a fixture. All test data (were it created in an isolated DB) carries the
`INTERNAL_AI_CANARY_STORE_`/`test-` prefixes, the `AI_PREVIEW_TESTBED` tag, and an expiry.

## 21. Data safety

No migration is introduced (production head stays `0453`). `git diff` vs baseline `40f2686` confirms the changes
are: the new `src/lib/aiPreviewTestbed/` module, the two dry-run `scripts/*.mjs`, the `AiPreviewTestbedDashboard`,
and AdminPage wiring (+8/−2). **Unchanged (verified empty diff):** `Player.tsx`, `playerStore.ts` (incl.
`setQueue`/`setPlaying`), `StorePlayerPage.tsx`, `useFranchisePolicySync.ts`, `useBusinessAutoSwitch.ts`. No
change to the playlist resolver, queue, playback, crossfade/recovery/preload, scheduler, audio, ranking,
settlement, streaming-quality semantics, governance, production environment file, or production migration state.
No destructive SQL, no production DROP/TRUNCATE/DELETE/UPDATE/auth-delete/storage-delete, no `play()`/`pause()`/
`load()`, no runtime `setQueue`, no candidate apply.

## 22. Tests & Manual QA

- `src/lib/aiPreviewTestbed/aiPreviewTestbed.test.ts` — **49 passing** unit tests (env audit incl. production-ref
  rejection, DB strategy, migration order/deps + blocked apply, snapshot hash, all fixture validators incl.
  customer/enterprise/franchise/production/real-name/real-email/empty/expired rejections, deployment binding,
  test window, seeder/cleanup guards incl. production-ref rejection, isolation, readiness capping). Full suite
  **839 passing** (29 files).
- `npm run build` (`eslint --max-warnings=0 && tsc -b && vite build`), `npm run lint:tones`,
  `npm run lint:migrations` pass clean. Seeder/cleanup dry-run + production-ref rejection verified by running them.
- **Runtime Manual QA:** **NOT RUN** — the testbed dashboard QA is possible in Preview with the flag enabled, but
  the actual single-store canary / queue hook / production runtime are NOT RUN (no isolated Preview DB, no hook).

## 23. Deferred work

- Actual **isolated Preview DB** provisioning (separate Supabase Test Project or a Supabase branch) + re-binding
  the Preview Vercel env.
- Actual **Preview migration apply** (0464–0470) to that isolated DB.
- Actual **internal test store / account / candidate playlist** creation (via the guarded seeder).
- The **single-store queue hook** itself (AI-MUSIC-12 CR) — still DEFERRED; this phase only prepared the testbed
  tooling and readiness model.
