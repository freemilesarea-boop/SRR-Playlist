# 21 — Certification Boundary (Static / Runtime / Production)

> PLATFORM-AUDIT-1B · READ-ONLY. Machine-readable: `certification-boundary.json`. Separates what was proven statically from what requires runtime/production evidence, and corrects over-certified wording.

## Levels
- **STATIC_CERTIFIED** — code present + wired; tsc/eslint/build/test-definitions pass; no runtime observed.
- **RUNTIME_CERTIFIED** — verified working in a Test/isolated runtime (browser or Test DB).
- **PRODUCTION_VERIFIED** — confirmed in Production (read-only or approved smoke).
- **UNVERIFIED** — external/config not confirmable from repo.
- **NOT_CERTIFIED** — a defect is confirmed.

## Boundary map
| Area | Level | Evidence |
|---|---|---|
| TypeScript typecheck | STATIC_CERTIFIED | `tsc --noEmit` PASS this phase |
| Lint (eslint/migrations/tones) | STATIC_CERTIFIED | all PASS this phase |
| Build | STATIC_CERTIFIED | `vite build` PASS (prior session) |
| Vitest suite (129) | **RUNTIME_CERTIFIED** | `vitest run` 129/129 (node+jsdom) this phase |
| Settlement compute logic | **RUNTIME_CERTIFIED** (Test-DB) | SQL + vitest; Test-DB verified in prior phases — **NOT Production-verified** |
| Email login | STATIC_CERTIFIED | code wired; no runtime login observed |
| Google OAuth | **UNVERIFIED** | depends on Supabase/Google external config |
| New-user profile provisioning | **UNVERIFIED** | DB trigger; live existence unconfirmed |
| Store player 24/7 | STATIC_CERTIFIED | code wired; no soak; no player tests |
| Payments (PayApp) | STATIC_CERTIFIED | idempotent webhook by design; no sandbox run |
| RLS enforcement | **UNVERIFIED** | 336 policies defined, not runtime-evaluated |
| Enterprise-contracts privacy | **NOT_CERTIFIED** | confirmed past public window `0383`→`0394` (R-04) |
| Signup PII console log | **NOT_CERTIFIED** | confirmed (R-05) |
| Production config alignment (env/schema/OAuth redirect/storage) | **UNVERIFIED** | no Production DB/dashboard access |

## Corrections to PLATFORM-AUDIT-1 wording
1. **Settlement Q13 "CERTIFIED (logic)" → RUNTIME_CERTIFIED (Test-DB), not Production-verified.** The logic is frozen + Test-DB-tested, but no Production execution was observed.
2. **Overall verdict "CONDITIONALLY CERTIFIED"** is restated precisely: **STATIC_CERTIFIED** across the codebase, **RUNTIME_CERTIFIED** for the vitest suite + settlement compute (Test-DB), **PRODUCTION_VERIFIED = none**, with two **NOT_CERTIFIED** confirmed defects (R-04, R-05) and multiple **UNVERIFIED** runtime items.
3. No statement should imply production certainty. All runtime/production items are explicitly UNVERIFIED unless listed RUNTIME_CERTIFIED above.

## Verdict
**CERTIFICATION BOUNDARY CORRECTED.** The platform is **STATIC_CERTIFIED** with a **RUNTIME_CERTIFIED** test suite; it is **NOT PRODUCTION_VERIFIED**, and carries 2 confirmed defects + several UNVERIFIED runtime dependencies.
