# AI-MUSIC-12 — Isolated Preview Backend Provisioning & Vercel Environment Rebinding

> **Phase decision: `MANUAL_PROVISIONING_REQUIRED`.**
> No isolated Preview backend was created; no Vercel environment variable was
> changed; no migration was applied; Production scope (Project Ref / DB / Auth /
> Storage / URL / Keys) is **untouched**. This phase ships **pure audit + planning
> tooling only** and defers all cost-bearing resource creation to a manual,
> explicitly-approved step.

---

## 1. Objective

Prepare — but do **not** execute — an isolated Preview backend for the future
Single-Store Runtime Hook proof (AI-MUSIC-13+). "Isolated" means the Preview
environment differs from Production on **all four** of: Project Ref, Database,
Auth, and Storage. Until that is true and *verified*, the Preview DB must never
be reported as isolated and the Runtime Hook / Testbed Seeder must not run.

This phase delivers the machinery to audit the current infrastructure, choose a
provisioning strategy, plan the Vercel Preview-scope rebinding, dry-run the
migration graph, and compute readiness — **without creating anything**.

## 2. Infrastructure audit (as of this phase)

| Fact | Value |
| --- | --- |
| Supabase org | `dsugddwldpqycyrmuxhg`, plan = **pro** |
| Production project | SRR Playlist — `nsoesrvwkxqifjcxzvol` (ap-southeast-1) |
| Other projects | STUDIOBODA, freemilesarea-boop's Project — **unrelated, never reused** |
| SRR-dedicated Preview/Test project | **none exists** |
| Supabase branches | **cost-bearing** on pro (~$0.32/hr) |
| Vercel project | `srr-playlist` (team `seunghyun-lees-projects-...`) |
| Vercel env-var mutation tool | **not available** in this environment |

### Strategy evaluation (Options A–D)

- **A. Reuse an existing project** → rejected. The only SRR project is
  Production; the others are unrelated. Reuse would violate isolation.
- **B. Supabase branch** → cost-bearing on the pro plan and not auto-approved →
  **deferred**.
- **C. New Supabase Test project** (`srr-playlist-preview`) → cost/region/plan
  must be confirmed first and creation is not auto-approved → **deferred**.
- **D. Local-only** → viable for schema validation but cannot host a Vercel
  Preview deployment on its own.

**Conclusion:** with no cost-free path clearly confirmed and no env-mutation
capability, the correct outcome is `MANUAL_PROVISIONING_REQUIRED`. The tooling
produces the full provisioning plan and manual procedure; a human performs the
actual creation and binding after cost/approval is confirmed.

## 3. What shipped (pure, provisioning-planning only)

### Engines — `src/lib/aiPreviewBackend/`

| File | Responsibility |
| --- | --- |
| `types.ts` | All phase types (relation, audit, strategy, isolation, schema baseline, migration graph/runner, env rebinding, connection, invariance, rebinding state machine, rollback, readiness). |
| `config.ts` | Feature flags (master + backend-dashboard, default **OFF**; kill switch default **ON**; preview ref/deployment default `null`; `costApproved` default `false`). Exports `PRODUCTION_PROJECT_REF`, `ORG_ID`. |
| `infrastructure.ts` | `auditInfrastructure` + `classifyProject` (PRODUCTION / SRR_TEST / UNRELATED / UNKNOWN). Unrelated projects are never reusable. |
| `strategy.ts` | `selectBackendStrategy` — existing SRR test → select; cost-bearing branch/project without approval → `MANUAL_PROVISIONING_REQUIRED` with manual steps. |
| `isolation.ts` | `validateBackendIsolation` — `ISOLATED` **only** when Project Ref, DB, Auth, and Storage are all distinct from Production; any shared axis blocks. |
| `schemaBaseline.ts` | `decideSchemaBaseline` — full schema from migration source, **empty data**; never a Production dump. |
| `migrationGraph.ts` | `AI_MUSIC_MIGRATION_GRAPH` (BASE → 0464 → {0465..0469} → 0470) + `validateMigrationGraph`. |
| `migrationRunner.ts` | `guardMigrationRunner` — rejects prod ref / shared DB / non-isolated; dry-run default; confirm required. |
| `vercelEnv.ts` | `planEnvRebinding` — Preview-scope-only plan; `productionScopeUntouched: true`; blocks unless `ISOLATED`. |
| `connection.ts` | `verifyConnection` — `PRODUCTION_BOUND` if refs equal Production; `CONNECTED_ISOLATED` only when all good. |
| `productionInvariance.ts` | `checkProductionInvariance` — any before/after diff → `CHANGED`. |
| `rebindingStateMachine.ts` | Legal transition map; forbids illegal jumps (e.g. `ENV_BOUND→VERIFIED`, `BLOCKED→VERIFIED`). |
| `rollback.ts` | `buildRollbackPlan` — `PRODUCTION_FAILOVER_FORBIDDEN` if it would touch Production scope; `productionUntouched: true`. |
| `readiness.ts` | `computeProvisioningReadiness` — `ISOLATED_BACKEND_READY` only with created + connected + invariant; else `MANUAL_ACTION_REQUIRED`. |
| `index.ts` | Barrel export. |
| `aiPreviewBackend.test.ts` | 36 tests (all pass). |

### Admin surface — `src/components/admin/AiPreviewBackendDashboard.tsx`

15-subtab read-only audit/planning dashboard (infra, projects, strategy,
isolation, schema, migration graph, dry-run runner, vercel env, rebinding state
machine, connection, invariance, auth, storage, rollback, readiness). Gated
behind master + backend-dashboard flags (default OFF). Only **safe** actions are
exposed: Re-run Audit, Validate Isolation, Generate Provisioning Plan, Dry-run
Migration, Validate Environment Scope, Generate Rollback Plan, Record Readiness.
No forbidden action (Modify Production Environment, Apply Production Migration,
Copy Production Data, Create Customer Store, Activate Hook, Start Canary, Full
Rollout) is present.

### Scripts & manifest

- `scripts/apply-ai-preview-migrations.mjs` — DRY-RUN planner. Hard-rejects the
  Production project ref (exit 2), refuses shared/non-isolated DB, applies
  nothing, and refuses to apply this phase (no isolated backend exists).
- `scripts/verify-ai-preview-schema.mjs` — read-only verifier. Hard-rejects the
  Production ref (exit 2); reports `NOT_DEPLOYED`.
- `config/ai-preview-testbed.example.json` — **secret-free** manifest template
  (preview scope, testbed disabled, kill switch on, Production ref reject).

## 4. Manual provisioning procedure (deferred — human, post-approval)

1. Confirm cost/region/plan for a cost-free-or-approved isolated backend
   (Option B branch **or** Option C `srr-playlist-preview` project).
2. Create the isolated backend (distinct Project Ref / DB / Auth / Storage).
3. Build schema from migration source (BASE → 0470) with **empty data** — no
   Production dump, no customer/auth/storage/contract/settlement/revenue copy.
4. Run `apply-ai-preview-migrations.mjs --project-ref <preview> --isolation ISOLATED`
   (dry-run) then, once truly isolated, apply.
5. Bind the Preview-scope Vercel env vars only (never Production scope);
   redeploy Preview.
6. `verify-ai-preview-schema.mjs --project-ref <preview>` → expect
   `CONNECTED_ISOLATED`.
7. Record readiness; only then does AI-MUSIC-13 (Testbed Seeding & Single-store
   Runtime Proof) become eligible.

## 5. Safety invariants (all held)

- Production Project Ref / DB / Auth / Storage / URL / Anon Key / Service Role
  Key / env vars: **unchanged**.
- No Supabase project/branch created; no cost incurred.
- No Vercel env var mutated; no deploy/merge to Production.
- No migration applied; **Production migration head stays 0453**; no new
  migration file added.
- No Runtime Hook / Queue / Candidate / Canary / Player / Store / Resolver /
  Ranking / Settlement / Streaming-quality / Governance change.
- No real customer/auth/storage/contract/settlement/artist-revenue data copied.
- No secret committed; no raw Service Role Key emitted; Project Ref exposure
  minimized.
- A not-created backend is reported as **not created**; an unverified Preview DB
  is **never** reported as isolated.

## 6. Verification

`eslint src --max-warnings=0` ✓ · `tsc -b` ✓ · `vite build` ✓ ·
`lint:tones` ✓ · `lint:migrations` ✓ (433 files, 0 violations) ·
`aiPreviewBackend.test.ts` 36/36 ✓.

## 7. Next phase

**AI-MUSIC-13 — Preview Testbed Seeding & Single-store Runtime Proof.** Blocked
until an isolated Preview backend is manually provisioned, verified
(`CONNECTED_ISOLATED`), and readiness is recorded. The Single-Store Runtime Hook
remains **forbidden** to execute against Production (see
`AI-MUSIC-12-SINGLE-STORE-HOOK-CHANGE-REQUEST.md`).
