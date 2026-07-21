# 06 — Auth Risk Register (post-stabilization)

| ID | Sev | Scenario | Evidence | Status | Fix | Regression test |
|---|---|---|---|---|---|---|
| A-01 | P1→**mitigated (code)** | Google login fails/loops on non-canonical origin | `authStore` used `window.location.origin` | **FIXED (code)** + external pending | `getOAuthCallbackUrl` fail-closed allowlist | `authRedirect.test.ts` |
| A-02 | **P1 (external)** | New user hangs — profile trigger absent on live DB | `0021` trigger; live existence unconfirmed | **UNVERIFIED** | operator read-only check (`03-*`); retry UI already present | — |
| A-03 | P2→**FIXED** | Signup email/payload logged to browser console | `authStore.ts:226/239` | **FIXED** | removed + guard test; DEV-gate error | `authLogging.guard.test.ts` |
| A-04 | P2→**FIXED** | No self-service password reset | admin-only before | **FIXED** | `requestPasswordReset` + `forgot` UI | (code-PASS; manual QA pending) |
| A-05 | P2→**mitigated** | Open redirect via return path | `explicitReturn` unsanitized | **FIXED** | `sanitizeAuthReturnPath` | `authRedirect.test.ts` |
| A-06 | P3→**FIXED** | Prod console prints Supabase project URL/ref | `supabase.ts:20` | **FIXED** | DEV-gated | guard test + `dist` grep |
| A-07 | **P2 (external)** | Redirect URLs / Google URIs not whitelisted for all origins | external dashboards | **UNVERIFIED** | operator checklist (`07-*`) | — |
| A-08 | **P2 (UNVERIFIED)** | OAuth callback / profile / reset runtime behaviour | no auth browser/Test DB | **UNVERIFIED** | Preview manual QA | `05-*` matrix |
| A-09 | P3 | 20s callback timeout < 25s fetch budget (rare false-negative) | `AuthCallbackPage:89` | **OPEN (not changed)** | align in AUTH-STABILIZATION-2 if observed | — |

## Severity summary (post-phase)
- **P1:** 1 code item **fixed** (A-01, external config still pending), 1 external **UNVERIFIED** (A-02 trigger).
- **P2:** 3 fixed (A-03/A-04/A-05), 2 external/UNVERIFIED (A-07/A-08).
- **P3:** 2 fixed (A-06 + return-path hardening), 1 open-minor (A-09).
- No new P0. No regression to role/permission model.
