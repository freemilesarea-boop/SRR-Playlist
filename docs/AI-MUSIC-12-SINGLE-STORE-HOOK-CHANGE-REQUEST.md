# AI-MUSIC-12 — Single-store Preview Queue Hook Change Request (DRAFT — NOT EXECUTED)

> This is a **pre-execution draft**. It is NOT executed in AI-MUSIC-11. It describes what a future, separately
> approved phase would do to run a single-store runtime proof of the safe queue boundary hook in an **isolated
> Preview** environment. It touches **no production** system. It must not be run until every Go criterion below
> holds — in particular, an **isolated Preview DB** must exist (AI-MUSIC-11 found the app currently shares the
> production Supabase, so this CR is BLOCKED until that is provisioned).

## Change ID

`AI-MUSIC-12-SINGLE-STORE-HOOK`

## Scope

- Exactly **one** internal Preview test store (`INTERNAL_AI_CANARY_STORE_01`), **one** candidate playlist, **one**
  player session, **one** (or a minimal cap of) queue application at a safe boundary.
- **No** customer / enterprise / franchise / production store. **No** production migration, deploy, or merge.
- Certification target: `CERTIFIED_FOR_SINGLE_INTERNAL_STORE` (AI-MUSIC-9 model) — never "production ready".

## Preconditions (all REQUIRED)

| Item | Source | Status now |
|---|---|---|
| Isolated Preview DB (separate Supabase project or branch) | AI-MUSIC-11 §2–3 | **MISSING** (shared prod DB) |
| Preview migrations 0464–0470 applied to that isolated DB | AI-MUSIC-11 §4 | NOT APPLIED |
| Internal test store (preview, test_only, expiry, cleanup) | AI-MUSIC-11 §5 | NOT CREATED |
| Internal test account (test alias, no prod access, expiry) | AI-MUSIC-11 §6 | NOT CREATED |
| Existing playlist fixture + rollback target | AI-MUSIC-11 §7–9 | NOT CREATED |
| Candidate playlist + pinned version + snapshot | AI-MUSIC-11 §7–8 | designed (validated) |
| Single-store allowlist (max_sessions=1, enabled=false→true at activation) | AI-MUSIC-11 §10 | NOT CREATED |
| Deployment binding (pinned deployment id) | AI-MUSIC-11 §11 | NOT BOUND |
| Test window + operator + reviewer + rollback operator | AI-MUSIC-11 §12 | DRAFT |
| Boundary observability (crossfade/recovery/preload/audio-swap) | AI-MUSIC-10 | **READY** |
| Kill switch ON, feature flags OFF by default | AI-MUSIC-9/11 | READY |

## Go criteria

1. Isolated Preview DB confirmed (project ref ≠ production ref; auth/storage separate) — AI-MUSIC-11 isolation = `ISOLATED`.
2. Preview migrations applied to the isolated DB (canary resolver RPCs exist).
3. Internal test store + account + existing/candidate playlists created (guarded seeder, dry-run first).
4. Candidate version + snapshot pinned and matching (hash verified).
5. Rollback target present (existing resolver re-use).
6. Single-store allowlist present; deployment id pinned and matched.
7. Boundary observability READY (AI-MUSIC-10) with a real browser-runtime coverage pass.
8. Test window + operator + reviewer + rollback operator assigned.
9. Kill switch ON; approval by operator + reviewer.

## No-Go criteria

- Shared production DB (current state) or any production-ref target.
- Candidate/snapshot mismatch, missing rollback target, deployment mismatch.
- Boundary state not observable at runtime, or coverage NO_DATA.
- Any customer/enterprise/franchise store or real customer data involved.

## Activation steps (manual, no automation)

1. Provision isolated Preview DB; apply migrations 0464–0470 there (validated first).
2. Run `scripts/seed-ai-preview-testbed.mjs --project-ref <preview-ref> --environment preview` (dry-run), review, then `--confirm-preview`.
3. Create the single-store allowlist entry (`enabled=false`).
4. Bind the pinned Preview deployment id.
5. Operator **Approve → Arm → Activate** (one session) — separate manual hops (AI-MUSIC-9 state machine).
6. Enable the allowlist entry for the one treatment session only.

## Runtime QA (manual, in Preview only)

Verify (AI-MUSIC-9 §22 / AI-MUSIC-10 §21): current track preserved, current time preserved, playing/paused
preserved, no double playback, no unexpected pause, no queue empty, crossfade/preload/recovery normal, candidate
applied only at a safe boundary, kill switch returns to the existing resolver, manual rollback works.

## Stop conditions

Double playback · unexpected pause · queue empty · current-time reset · current-track change · crossfade error ·
recovery failure · media error · runtime observer error · candidate snapshot mismatch → **STOP_RECOMMENDED**
(manual stop; never automatic).

## Rollback steps

Operator requests rollback → validate (same session/deployment, current-track snapshot present, safe boundary) →
at the next safe boundary, restore via the **existing resolver result** (not a queue JSON restore). Never a
forced mid-track stop.

## Cleanup steps

Run `scripts/cleanup-ai-preview-testbed.mjs --project-ref <preview-ref>` (dry-run), review, then `--confirm` —
deletes only `AI_PREVIEW_TESTBED`-tagged rows (allowlist, canary run/session, candidate/existing playlist, store,
test account, audit/evidence, storage) in dependency order. Never touches production or untagged rows.

## Evidence required

Preview environment confirmation, deployment id match, store allowlist match, single session, candidate version/
snapshot match, safe boundary confirmation, current-track & playback preservation, existing-queue fail-open, kill
switch, manual rollback, control-store unchanged, no double playback / unexpected pause / queue empty / runtime
error (hash-only redacted evidence per AI-MUSIC-9/10).

## Production impact

**None.** No production merge, deploy, migration, DB change, store, account, queue, or playback change. This CR
runs entirely in an isolated Preview environment against a single internal test store.

## Approval required

Operator + reviewer sign-off, kill switch ON at rest, and explicit activation for one session only.

---

## AI-MUSIC-12 status update — backend prerequisite NOT met (Hook execution still forbidden)

The Single-Store Runtime Hook described in this CR **cannot be executed** yet. Its
hard precondition — a verified isolated Preview backend (distinct Project Ref / DB /
Auth / Storage from Production, `CONNECTED_ISOLATED`) — is **not satisfied**.

AI-MUSIC-12 audited the infrastructure and concluded **`MANUAL_PROVISIONING_REQUIRED`**:
the org is on the pro plan (branches are cost-bearing), no SRR-dedicated Preview/Test
project exists, unrelated projects may not be reused, and no Vercel env-mutation
capability is available. No backend was created, no env var was bound, and no migration
was applied (Production migration head stays 0453).

**Therefore, at the close of AI-MUSIC-12:**

- Hook activation remains **FORBIDDEN** — kill switch ON at rest, `testbed_enabled=false`.
- The Testbed Seeder **must not run** (no isolated backend to seed).
- Production scope (Ref / DB / Auth / Storage / URL / Keys / env vars) is **untouched**.

**Unblocking sequence:** follow the manual provisioning procedure in
`AI-MUSIC-12-ISOLATED-PREVIEW-BACKEND.md` §4 → verify `CONNECTED_ISOLATED` → record
readiness. Only then does AI-MUSIC-13 (Preview Testbed Seeding & Single-store Runtime
Proof) become eligible, and only under this CR's per-session operator + reviewer sign-off.
