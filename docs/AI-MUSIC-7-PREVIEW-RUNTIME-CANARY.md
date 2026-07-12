# AI-MUSIC-7 — Preview Runtime Canary & Internal Test Store Certification (Preview)

> Phase status: **Preview only.** Nothing here is merged to production, deployed, or applied to the production
> database. Migration `0470` is **validated but NOT applied** — the production migration head stays `0453`. All
> feature flags default **OFF** and the kill switch defaults **ON**. Rule-based (no LLM/ML/external SaaS/new
> WebSocket). **This is not a production pilot** — it targets internal test stores in a Preview deployment only.

## 1. Architecture

Connects an approved pilot candidate to the REAL runtime resolution path, but ONLY when ALL of the following
hold, and ONLY as a **decision** (actual queue application is DEFERRED — see §9):

1. **Preview environment** (client + server enforced),
2. **Allowed Deployment ID** matches the current deployment id,
3. an **explicit internal-test-store allowlist** entry (super-admin, preview, non-expired, in-scope),
4. an **operator-approved ACTIVE canary session** for a **treatment** store.

It never runs in production, never touches a general/franchise/enterprise store, never changes a control store,
never controls the Player (no play/pause/load/currentTime/volume), never force-stops a playing track, and never
changes an original playlist. Every failure fails **OPEN** to the existing playlist result.

## 2. Environment enforcement

`import.meta.env.MODE` is `production` for **both** Preview and Production Vercel builds, so a single client
flag or host string is never trusted. The gate (`evaluateEnvironmentGate`) requires `appEnv === 'preview'` +
`allowedDeploymentId === currentDeploymentId` + not-a-production-host → **ENFORCED** (else PARTIAL/UNSAFE/
NOT_AVAILABLE; a production host is always UNSAFE). The server RPCs enforce the same **independently**:
`_ai_canary_require_preview` rejects any write with `environment != 'preview'`; the allowlist accepts only
`environment='preview'`; approval binds a deployment id; `resolve_ai_preview_canary_candidate` rejects
non-preview and deployment-mismatch. **Strongest guarantee (structural):** the migration is not applied to
production, so the canary RPCs do not exist there.

## 3. Internal test store allowlist

Explicit, super-admin-created, `preview`-scoped, non-expired, enabled entries only. No wildcards, no
auto-inclusion of general/enterprise stores. Each entry pins the allowed candidate playlist + version and a
per-store max-session cap (`checkAllowlist`). A unique index enforces one enabled entry per store.

## 4. State machine & approval gate

14 states with **Approval, Arm, and Activate as separate hops**
(`DRAFT→REVIEW_REQUIRED→APPROVED→ARMED→ACTIVE`; `DRAFT→ACTIVE` is forbidden). Stop and rollback are
request→confirm; terminal states cannot re-activate. The approval gate blocks unless the environment is
ENFORCED, the store is an allowlisted internal test store, the assignment is treatment, shadow certification is
≥ `READY_WITH_WARNINGS`, control divergences are 0, fail-open is verified, a rollback target exists, and the
candidate version matches. Approval never touches the runtime queue (`executed:false`).

## 5. Candidate queue snapshot & 6. Existing queue snapshot

`validateCandidateQueue` pre-validates the candidate as a queue input (playlist exists, version pin, min
tracks, duplicates, blocked tracks — no-audio/unsupported/disabled/QC-failed/industry-unsuitable, item-type
compatibility, change ratio) and computes a **deterministic snapshot hash** over the track-id set (+version) —
storing **no** audio URLs, artist PII, tokens, signed URLs, or full metadata. `buildExistingQueueSnapshot`
records the existing queue at activation as **hashes only**, for audit — restore always uses the existing
resolution path, never this snapshot.

## 7. Canary resolver

`resolveCanary` (client) + `resolve_ai_preview_canary_candidate` (server) return `USE_CANARY_CANDIDATE` only
when EVERY gate passes; a control store is always `CONTROL_PRESERVED`; env/flag/kill-switch/allowlist/session/
version/snapshot/queue/expiry/conflict/offline/incident/error all fail open to `USE_EXISTING`. A
`USE_CANARY_CANDIDATE` result is a **decision only** — `actualPlaybackUnchanged` is an invariant.

## 8. Safe runtime hook — DEFERRED, and 9. Next-boundary application — DEFERRED

Actual runtime **queue application (setQueue) is DEFERRED** and not implemented this phase. A safe next-boundary
application cannot be cleanly proven because: (a) `playerStore.setQueue` sets `playing:true` — a play
side-effect the phase forbids; (b) a parallel canary hook calling `setQueue` at track boundaries would race with
the existing `useFranchisePolicySync` / `useBusinessAutoSwitch` boundary application (queue-thrashing risk); and
(c) no internal test store exists and the migration is not applied to production, so the resolve RPC cannot
function at runtime. Per the phase fallback ("억지로 setQueue 주변 코드를 바꾸지 않는다"), only the Preview
Canary Resolver (server + client engine, decision-only) ships; no `Player.tsx`/`playerStore`/`setQueue` code is
touched and no runtime hook is added.

## 10. Control preservation & 11. Runtime evidence & 12. Playback guardrails

Control stores always keep the existing result; a single control divergence caps certification at BLOCKED.
Runtime evidence and playback guardrails are shaped by rule engines from real/telemetry signals when a canary
runs. `evaluateGuardrails` is **recommendation only**: current-track/player-state/double-playback/reload/pause/
empty-queue → BLOCKED; TTFA/gap/recovery → STOP_RECOMMENDED/WARNING. It never stops/pauses/rolls back — the
operator must approve. Missing signals → NOT_AVAILABLE / INSUFFICIENT_DATA.

## 13. Manual disable / rollback

Kill switch or operator stop halts new candidate resolution and uses the existing playlist resolution; the
current track is never force-stopped; the existing queue is used at the next safe boundary; the session ends and
the audit + rollback result are recorded. No automatic rollback.

## 14-16. Certification & production readiness

`computePreviewCertification`: control divergence / unenforced environment / fail-open failure / guardrail
BLOCKED → BLOCKED; advisory capped score (internal preview only — never "production ready"); NOT_RUN /
INSUFFICIENT_DATA honest. `computeProductionReadiness` maxes at **READY_FOR_PRODUCTION_CANARY_CHANGE_REQUEST**
(`actualProductionCanary:false`). No production canary is executed.

## 17-18. Database / RPC (0470, NOT applied)

7 isolated tables (`ai_music_preview_canary_allowlist/runs/sessions/queue_snapshots/events/certifications/
actions`) + 22 SECURITY DEFINER functions. Super-admin gated; writes via RPC only; `auth.uid()` actor +
attribution; `search_path` pinned; params bounded; batch/row/time caps; state-transition allowlist; expiry
required; no wildcard allowlist; production-environment writes rejected; RLS super-admin read. The migration
does not read or write any existing table. Rollback SQL is in the migration footer.

## 19. Feature flags (all OFF; kill switch ON)

| Env var | Default |
|---|---|
| `VITE_AI_MUSIC_ENABLED` (master) | OFF |
| `VITE_AI_PREVIEW_CANARY_ENABLED` | OFF |
| `VITE_AI_PREVIEW_CANARY_RESOLUTION_ENABLED` | OFF |
| `VITE_AI_PREVIEW_CANARY_QUEUE_ENABLED` | OFF |
| `VITE_AI_PREVIEW_CANARY_EVENTS_ENABLED` | OFF |
| `VITE_AI_PREVIEW_CANARY_GUARDRAILS_ENABLED` | OFF |
| `VITE_AI_PREVIEW_CANARY_DASHBOARD_ENABLED` | OFF |
| `VITE_AI_PREVIEW_CANARY_KILL_SWITCH` | **ON** |
| `VITE_AI_PREVIEW_CANARY_ALLOWED_DEPLOYMENT_ID` | unset |
| `VITE_AI_PREVIEW_CANARY_ENV` | unset (must be `preview`) |
| `VITE_AI_PREVIEW_CANARY_MAX_SESSIONS` | 1 |

Execution requires all three: Preview environment + Allowed Deployment ID match + explicit store allowlist.

## 20. Dashboard

`AI Preview Canary` — 13 subtabs (Overview / Environment / Allowlist / Approvals / Canary Runs / Sessions /
Queue Validation / Runtime Evidence / Playback Guardrails / Disable-Rollback / Certification / Audit /
Readiness). Every action is behind a confirmation dialog showing Environment=preview, Deployment ID, Target
Store, Candidate Version, Run State + "Production 에 적용되지 않음 / 현재 Track 미중단 / setQueue 적용 DEFERRED"
and requires a typed reason. **No production-canary button, no full-rollout button.**

## 21. Migration validation (rollback-transaction, NOT applied)

`BEGIN … stub _is_super_admin + set_config JWT sub … 30 scenarios … RAISE 'VALIDATION_OK' … (abort)`:
production-env writes rejected; expiry + allowlist + candidate-scope enforced; approval→arm→activate separated
(DRAFT→ACTIVE rejected); resolve returns USE_CANARY_CANDIDATE / CONTROL_PRESERVED / ENVIRONMENT_BLOCKED
(deployment + prod) / VERSION_MISMATCH / SNAPSHOT_MISMATCH / SESSION_INACTIVE correctly; stop request→confirm;
batch cap 60→50; invalid status/readiness coerced; expired allowlist blocks approval. Post-abort read confirmed
**0 tables and 0 functions persisted**, real `_is_super_admin` intact.

## 22-25. Tests / performance / data safety

Full gate: `typecheck` / `lint` / `lint:tones` / `lint:migrations` clean; **647 unit tests pass** (48
aiPreviewCanary; no regressions); `npm run build` clean. **Runtime performance:** with all flags OFF (default)
and no runtime hook, general/control/production stores incur **zero** additional calls. **Data safety:** the diff
touches only `src/lib/aiPreviewCanary/*`, `aiPreviewCanaryApi.ts`, `AiPreviewCanaryDashboard.tsx`,
`src/pages/AdminPage.tsx` (additive tab wiring), and `0470_*.sql`. **No** `Player.tsx`, `playerStore`,
`useFranchisePolicySync`, `useBusinessAutoSwitch`, `StorePlayerPage`, `get_playlist_tracks`, `setQueue`,
crossfade/preload/recovery/scheduler, ranking, settlement, streaming, governance, service worker, or CDN config
is changed. No destructive SQL against existing tables.

## 26. Manual Preview QA — NOT RUN / DEFERRED

No internal test store exists and the migration is not applied, so runtime QA on a Preview test store is **NOT
RUN / DEFERRED**. Production runtime and general-store runtime are **NOT RUN**. No un-run browser/player test is
reported as PASS.

## Deferred (out of scope)

Actual runtime queue application (setQueue at a safe boundary), production migration, production canary, external
customer store, automatic guardrail action, full rollout.
