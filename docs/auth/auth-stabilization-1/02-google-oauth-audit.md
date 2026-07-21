# 02 — Google OAuth Audit (three layers)

## A. Application code (verified + stabilized)
| Item | State |
|---|---|
| Button handler | `LoginPage.onGoogleSignIn` — in-app/PWA pre-check → `InAppBrowserWarningModal` |
| provider / redirectTo | `signInWithOAuth({provider:'google', options:{redirectTo: getOAuthCallbackUrl()}})` — **now allowlist-resolved, fail-closed** |
| callback path | `/auth/callback` (public route) |
| code exchange | SDK auto (`detectSessionInUrl:true`) — no manual `exchangeCodeForSession` |
| error param handling | `AuthCallbackPage` detects `?error=` → `/login?error=oauth_callback_failed` |
| StrictMode double-run | `onAuthStateChange` bound once (`window.__srrAuthSubBound`) |
| callback timeout | 20s → error redirect |
| PKCE verifier | supabase-js default (localStorage); **same-origin preserved by resolver** |
| success redirect | account_type-based, first-login only |
| in-app detection | `inAppBrowser.ts` heuristics |

**Change:** dynamic `window.location.origin` → `getOAuthCallbackUrl()` (allowlist: prod apex/www, `*.vercel.app`, localhost; else canonical). This blocks arbitrary/injected origins while keeping legitimate origins same-origin (PKCE safe).

## B. Supabase configuration — UNVERIFIED (external)
Operator must confirm in Supabase Dashboard → Authentication:
- Google provider **Enabled**, valid Client ID + Secret.
- **URL Configuration → Site URL** = `https://www.deudda.com`.
- **Redirect URLs** include: `https://www.deudda.com/**`, `https://deudda.com/**`, each active `https://*-git-*.vercel.app/**` preview, `http://localhost:5173/**`.
- Email confirmation + JWT/session expiry as intended; PKCE flow compatible (default).

## C. Google Cloud configuration — UNVERIFIED (external)
Operator must confirm in Google Cloud Console → APIs & Services → Credentials (OAuth client):
- Client type = Web application.
- **Authorized redirect URIs** include the Supabase callback `https://<project-ref>.supabase.co/auth/v1/callback`.
- Authorized JavaScript origins include deployed origins as needed.
- OAuth consent screen **Published** (not Testing, or test users added).

## Error scenarios (ranked, unchanged from audit + mitigations)
1. Redirect URL not whitelisted for current origin → external fix (B/C). Code now fail-closes unknown origins to canonical.
2. Provider disabled / bad secret → external fix (B).
3. In-app/PWA `disallowed_useragent` → pre-check modal (best handled).
4. Empty profile / trigger absent → retry UI; verify trigger (see `03-*`).
5. 20s timeout on slow PKCE exchange → retry.
6. Provider error / PKCE verifier lost → retry same origin.

## Manual QA (operator, Preview)
New Google account · existing Google account · same-email-as-existing · consent cancel/deny · callback re-entry · direct `/auth/callback` hit · session created · profile created · dashboard redirect. Record per `05-auth-test-matrix.md`. **Cannot run headlessly → UNVERIFIED here.**
