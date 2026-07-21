# 04 — Auth Security

## PII / sensitive logging (fixed)
| Item | Before | After |
|---|---|---|
| Signup email + payload | `console.log('[auth] signUp request:', {email, data})` (unconditional) | **removed** |
| Signup response (user_id, …) | `console.log('[auth] signUp response:', {...})` | **removed** |
| Signup error (raw object) | `console.error('[auth] signUp error:', error)` | **DEV-gated**, logs only `status`/`name` |
| Supabase project URL/ref | `console.log('[SupabaseEnv]', {url, projectRef, …})` (prod) | **DEV-gated** → eliminated from prod bundle |
Verified absent from `dist` (production build).
No token/session/refresh-token/phone/account logging found elsewhere in auth.

## Redirect security
- Callback origin resolved by **fail-closed allowlist** (`authRedirect.getAuthRedirectOrigin`): unknown/injected origins fall back to canonical `https://www.deudda.com`.
- Same-origin preserved for legitimate origins → PKCE `code_verifier` not lost.
- `redirectTo` is never derived from user input — only from `window.location.origin` filtered by the allowlist.

## Open redirect
- `sanitizeAuthReturnPath()` restricts post-login return paths to internal absolute paths; blocks `//host`, `/\host`, absolute URLs, relative paths, control-char obfuscation. Wired into `LoginPage` `explicitReturn`. Unit-tested.

## Enumeration
- `requestPasswordReset` is enumeration-safe: returns the same generic UI ("이메일이 가입되어 있다면…") regardless of account existence; only re-throws rate-limit (429) to prompt retry.

## Session security
- `persistSession` (localStorage) + `autoRefreshToken`; single `onAuthStateChange` binding; explicit logout clears session + profile state; 25s request timeout avoids deadlock.

## Rate limiting
- Signup-email resend: 60s client cooldown. Password-reset: relies on Supabase server rate-limit (429 surfaced). No new endpoints added.

## Not changed (frozen)
- Role/permission model, RLS, SECURITY DEFINER functions, provider set. (Out of scope; see PLATFORM-AUDIT-1 R-07/R-08 for the separate SECURITY-HARDENING phase.)
