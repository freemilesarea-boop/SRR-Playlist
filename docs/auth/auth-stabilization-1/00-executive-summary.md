# AUTH-STABILIZATION-1 — Executive Summary

> Auth-only stabilization. Branch `claude/auth-stabilization-1` from default/production `acebedd`. No production/DB/deploy/merge. No Playlist/Player/Settlement/AI/Brand changes.

## Auth status after this phase
| Area | Status |
|---|---|
| Email signup | STATIC_CERTIFIED — PII console.log removed; `emailRedirectTo` now via safe resolver |
| Email login | STATIC_CERTIFIED (unchanged logic) |
| Logout | STATIC_CERTIFIED (unchanged) |
| Google OAuth | STATIC_CERTIFIED (code) — redirect now fail-closed via allowlist resolver; external config UNVERIFIED |
| Profile provisioning | UNVERIFIED (live trigger) — existing 3× retry + error UI confirmed; no code change |
| Session recovery | STATIC_CERTIFIED (unchanged; 25s fetch timeout already prevents infinite hang) |
| Password reset | **IMPLEMENTED** — self-service request flow added (enumeration-safe) |
| Route guards | STATIC_CERTIFIED (unchanged; return-path now sanitized) |
| Production readiness | **READY_FOR_PREVIEW_QA** (pending external Supabase/Google config verification) |

## Changes made
1. **PII log removal (R-05, CONFIRMED fix):** deleted signup email/payload `console.log` (`authStore.ts`); DEV-gated the signup-error log; DEV-gated the `[SupabaseEnv]` project-URL log (`supabase.ts`). Verified absent from the production bundle.
2. **Redirect stabilization (R-01, code portion):** new `src/lib/authRedirect.ts` — `getOAuthCallbackUrl()` / `getPasswordResetUrl()` resolve the callback origin from a **fail-closed allowlist** (prod apex/www, `*.vercel.app`, localhost) and fall back to canonical `https://www.deudda.com` for unknown/injected origins. Legitimate origins keep their own origin so the **PKCE verifier round-trip is preserved** (apex↔www hop deliberately not forced — that is an external Supabase-whitelist item). Wired into Google/Kakao OAuth + email resend + signup.
3. **Open-redirect guard:** `sanitizeAuthReturnPath()` restricts post-login return paths to internal absolute paths; wired into `LoginPage` `explicitReturn`.
4. **Self-service password reset (R-15):** `authStore.requestPasswordReset()` (enumeration-safe: never reveals account existence, only re-throws rate-limit) + a minimal `forgot` mode in `LoginPage` (email → generic success). Recovery callback (`/auth/reset`) already existed.
5. **Tests:** `authRedirect.test.ts` (12) + `authLogging.guard.test.ts` (3) = 15 new.

## Verification (this phase)
tsc PASS · eslint PASS · **vitest 87/87 PASS** (incl. 15 new) · vite build PASS · PII logs absent from `dist`.

## Remaining (external, UNVERIFIED)
- Supabase Auth → URL Configuration: Site URL + Redirect URLs must include every deployed origin (apex, www, each preview, localhost) — see `07-production-checklist.md`.
- Google Cloud OAuth client: authorized redirect URIs must include the Supabase callback.
- Live existence of `on_auth_user_created` profile trigger.
- Authenticated Preview browser QA (cannot run headlessly).

## Next phase
**PLATFORM-HOTFIX** — reconcile the 31 undefined client RPCs and require `CRON_SECRET` on daily-metrics (R-03, R-06), the remaining P1/P2 code items outside auth.
