# 05 — Auth Test Matrix

> Executed this phase: tsc, eslint, **vitest 87/87**, build. New auth tests: 15.

| Scenario | Unit | Integration | Browser | Manual | Result | Evidence |
|---|---|---|---|---|---|---|
| Redirect origin allowlist (allow/deny) | ✅ | — | — | — | PASS | `authRedirect.test.ts` |
| Callback/reset URL builders | ✅ | — | — | — | PASS | `authRedirect.test.ts` |
| Return-path sanitizer (open-redirect) | ✅ | — | — | — | PASS | `authRedirect.test.ts` |
| PII-logging regression guard | ✅ | — | — | — | PASS | `authLogging.guard.test.ts` + `dist` grep |
| Email signup (happy/dup/weak/confirm) | — | — | — | ☐ | UNVERIFIED | needs Test DB / Preview |
| Email login (bad pw/unknown/unconfirmed/blocked) | — | — | — | ☐ | UNVERIFIED | Preview |
| Logout + protected-route block + multi-tab | — | — | — | ☐ | UNVERIFIED | Preview |
| Session refresh / expiry | — | — | — | ☐ | UNVERIFIED | Preview |
| Google OAuth initiation | — | — | — | ☐ | UNVERIFIED | Preview manual |
| OAuth callback success/error | — | — | ☐ | ☐ | UNVERIFIED | Preview manual (Google automation blocked) |
| Profile provisioning (new/delayed/missing) | — | — | — | ☐ | UNVERIFIED | Test DB / Preview |
| Password reset request → callback → set | — | — | — | ☐ | UNVERIFIED (code-PASS path) | Preview + Sandbox email |
| Mobile viewport / in-app block | — | — | — | ☐ | UNVERIFIED | Preview manual |

## Safe-to-run classification
- New unit tests: **Safe Local / Safe CI** (node, no network/DB).
- Browser/OAuth/profile/reset e2e: **Requires Preview + seeded/Test accounts** (not runnable headlessly; Google automation blocked by policy → Manual QA).
- Real password-reset email: **Requires approved Sandbox/Test email provider** → **UNVERIFIED** (code + callback tested; actual send not performed).

## Integration-test note
Store-level mocked integration tests (signup/login/OAuth-init/callback/reset) were **not** added this phase to avoid over-mocking Supabase; the pure resolver/sanitizer logic (the actual new code) is fully unit-tested, and the guard test prevents PII-log regression. Recommended as a follow-up in TEST-COVERAGE.
