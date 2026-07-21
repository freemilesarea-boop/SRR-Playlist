# 01 — Auth Architecture (post-stabilization)

> Files: `src/store/authStore.ts`, `src/lib/supabase.ts`, `src/lib/authRedirect.ts` (new), `src/pages/LoginPage.tsx`, `src/pages/AuthCallbackPage.tsx`, `src/pages/AuthResetPasswordPage.tsx`. Client: `persistSession + autoRefreshToken + detectSessionInUrl`; 25s fetch timeout wrapper.

## Email signup
LoginPage form → `authStore.signUpWithPassword` → `supabase.auth.signUp({options:{data, emailRedirectTo: getOAuthCallbackUrl()}})` → (email-confirm) → `on_auth_user_created` trigger → `users` row → `onAuthStateChange` → `loadProfile` → account-state gate → `firstRouteFor(account_type)`.
- **Change:** removed email/payload console.log; `emailRedirectTo` now via safe resolver.
- Silent-duplicate detection preserved (empty `identities` → "이미 가입된 이메일").

## Email login
LoginPage → `signInWithPassword` → session → `onAuthStateChange` → `loadProfile` → route guard. Failure surfaces via `friendlyError`. Unchanged.

## Google / Kakao OAuth
Button (in-app/PWA pre-check → warning modal) → `signInWithOAuth({provider, options:{redirectTo: getOAuthCallbackUrl()}})` → provider consent → `/auth/callback` (SDK auto code-exchange via `detectSessionInUrl`) → session → `loadProfile` → `AuthCallbackPage` routes by `account_type`; provider error / 20s timeout → `/login?error=oauth_callback_failed`.
- **Change:** `redirectTo` is now allowlist-resolved (fail-closed), same-origin preserved for PKCE.

## Session recovery
Refresh → client init → `getSession()` → set session → `loadProfile` → `RequireAuth` resolves. `TOKEN_REFRESHED` → silent `refreshProfile` (no loader flicker). Network failure → settle as logged-out (never infinite spinner; 25s timeout). Unchanged.

## Profile provisioning
DB trigger `on_auth_user_created → handle_new_user()` (`0021`). Google user → `account_type='individual'`, `signup_completed=false`, `role` DB-default. Failure → `profile_missing`/`profile_error` screens with retry/logout (App.tsx). No code change; live trigger existence UNVERIFIED.

## Password reset (new)
`LoginPage` "비밀번호를 잊으셨나요?" → `forgot` mode → `authStore.requestPasswordReset(email)` → `resetPasswordForEmail(email,{redirectTo: getPasswordResetUrl()})` (enumeration-safe) → email link → `/auth/reset` → recovery session → `updateUser({password})`.

## Failure points (per flow)
- Signup: duplicate email, weak pw, email-confirm required, link expired, network.
- Login: bad pw, unknown/unconfirmed/blocked account, session expiry, refresh failure.
- OAuth: redirect not whitelisted (external), provider disabled (external), in-app UA block, empty profile (trigger absent), 20s timeout, PKCE verifier lost (origin hop), provider error/cancel.
- Recovery: expired/reused link, no recovery session.
