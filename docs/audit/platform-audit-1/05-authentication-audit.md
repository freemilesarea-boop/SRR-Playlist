# 05 — Authentication Audit (Email + Google OAuth)

> PLATFORM-AUDIT-1 · READ-ONLY · commit `0f3bb57` · No secret values printed (variable names only).
> Evidence = repository code. External provider config (Supabase Auth dashboard, Google Cloud OAuth) is **not** in the repo and is marked `UNVERIFIED` with the exact manual check.

## 0. Client setup
- Supabase client created once in `src/lib/supabase.ts:77-90` with `persistSession:true, autoRefreshToken:true, detectSessionInUrl:true`.
- **OAuth code exchange is automatic** via `detectSessionInUrl:true`; the app never calls `exchangeCodeForSession` manually.
- All non-storage requests wrapped in a 25s `fetchWithTimeout` (`supabase.ts:43,62-74`) → no infinite-pending promises.
- Auth state centralised in `src/store/authStore.ts`.

## 1. Email auth — coverage matrix
| Flow | Call / Location | Status | Notes |
|---|---|---|---|
| Session restore | `getSession()` `authStore.ts:62` | PASS (code) | never blocks; on failure session=null, ready flags set |
| Auth listener | `onAuthStateChange()` `authStore.ts:91-162` | PASS (code) | double-bind guard `window.__srrAuthSubBound` |
| Login | `signInWithPassword()` `authStore.ts:215` → `LoginPage.tsx:217` | UNVERIFIED (needs live) | friendly error "이메일 또는 비밀번호가 올바르지 않습니다." |
| Signup | `signUp({options:{data}})` `authStore.ts:227-248` | UNVERIFIED (needs live) | silent-duplicate detection via empty `identities`; **console.log of email+metadata** `:226,239` (P3 PII-log) |
| Email verify resend | `resend({type:'signup'})` `authStore.ts:286` | UNVERIFIED | 60s cooldown |
| Logout | `signOut()` `authStore.ts:273` | PASS (code) | never redirects during restore |
| Password reset **request** | `resetPasswordForEmail()` **server-only** `supabase/functions/admin-trigger-password-reset/index.ts:87` | **PARTIAL** | ⚠ **No user-facing self-service "forgot password"** — only admin can trigger a reset link |
| Password change | `updateUser({password})` `AuthResetPasswordPage.tsx:57` | UNVERIFIED | raw `err.message` shown — **not** run through `friendlyError` (P3 inconsistency) |
| Session expiry / refresh | `TOKEN_REFRESHED` via listener `authStore.ts:102` | PASS (code) | silent profile refresh; timeout wrapper prevents hang |
| Logout→protected route / direct URL | `RequireAuth` `App.tsx:86-101` | PASS (code) | loader until `isAuthReady`, then `/login` |

**Finding AUTH-F1 (P2):** No self-service password reset for end users — `resetPasswordForEmail` is reachable only through the admin edge function. Users who forget their password cannot recover it without admin action.

## 2. Google OAuth — full flow trace
1. **Button** — `LoginPage.tsx:463-481`, shown in signin/signup modes.
2. **Call** — `authStore.ts:251-257`: `signInWithOAuth({provider:'google', options:{redirectTo:`${window.location.origin}/auth/callback`}})`. **No scopes/queryParams/explicit PKCE**; PKCE implicit (supabase-js default `flowType:'pkce'`). `redirectTo` is **dynamic** from `window.location.origin`.
3. **Pre-flight guard** — `onGoogleSignIn` `LoginPage.tsx:165-193` blocks in-app/PWA browsers → `InAppBrowserWarningModal`.
4. **Callback** — `/auth/callback` → `AuthCallbackPage` (`App.tsx:230`, public). SDK auto-exchanges code.
5. **Session** — persisted to localStorage.
6. **New-user provisioning** — **DB trigger** `on_auth_user_created AFTER INSERT ON auth.users → handle_new_user()` (`0021_signup_metadata_trigger.sql:105`). Google user has no `account_type` → defaults `'individual'`, `signup_completed=false`; `role` unset → DB default `'user'` (`0001_init.sql:12`).
7. **Identity linking / email-duplicate** — **none in code**; delegated to Supabase provider setting (UNVERIFIED).
8. **Role init** — DB default `'user'`; admin promotion is manual SQL.
9. **Terms consent** — **none** on OAuth path (0 hits for terms/consent/약관/동의 in `src/components/auth/*`).
10. **Invite / sales-code linkage** — best-effort from localStorage post-login: `applyPendingSignupOnLogin` `authStore.ts:112`, `applyPendingEnterpriseClaimOnLogin` `:131`. Pure Google login with no cached pending data = no-op.
11. **Post-login redirect** — `AuthCallbackPage.tsx:40-73`, first login routed by `account_type`; error → `/login?error=oauth_callback_failed` (friendly render `LoginPage.tsx:91`).
12. **Preview vs Production** — production pinned host `srr-playlist.vercel.app` force-redirects to `https://www.deudda.com` **before** React mounts (`productionRedirect.ts:22-46`, `main.tsx:12`). Branch previews `*-git-*.vercel.app`, `deudda.com` apex, localhost are **not** redirected → each origin's `/auth/callback` must be individually whitelisted in Supabase.

## 3. Google-login failure / hang paths (ranked)
| # | Symptom | Trigger | Files | Env/config | Recoverable | Verification |
|---|---|---|---|---|---|---|
| 1 | Lands on `?error=oauth_callback_failed` / redirect loop | Current `${origin}` (new preview host, apex-vs-www) not in Supabase Redirect URLs, or Supabase ref not in Google Authorized URIs | `authStore.ts:254`, `productionRedirect.ts` | `VITE_SUPABASE_URL` + external | Config fix only | **UNVERIFIED** — Supabase → Auth → URL Configuration; Google Cloud → Credentials |
| 2 | `signInWithOAuth` throws immediately | Google provider disabled / bad client secret | `authStore.ts:251`→`LoginPage.tsx:181` | external | Config fix | **UNVERIFIED** — Supabase → Providers → Google |
| 3 | Google 403 `disallowed_useragent` | In-app/PWA webview slips past UA detection | `LoginPage.tsx:171`, `inAppBrowser.ts:115-169` | — | Open in Chrome/Safari | Best-handled; residual UA-miss risk |
| 4 | "가입 정보를 불러오지 못했어요", stuck | `public.users` row never created (trigger absent/failed) | `App.tsx:170-185,356-419`; `0021_*.sql` | — | Retry/relogin; hard-stuck if trigger truly absent | **UNVERIFIED** — confirm `on_auth_user_created` on live DB (`supabase/diagnose_signup_trigger.sql`) |
| 5 | Spinner up to 20s → error | PKCE exchange slower than 20s callback timeout (< 25s fetch budget) | `AuthCallbackPage.tsx:89-97` | — | Retry | Timeout mismatch (P3) |
| 6 | Immediate `?error=oauth_callback_failed` | `access_denied` / PKCE `code_verifier` lost (private mode, origin hop) | `AuthCallbackPage.tsx:76-86` | — | Retry same browser | — |
| 7 | `profile_error` screen | `select` on `users` fails (RLS/network) | `authStore.ts:180`, `App.tsx:210` | — | Retry | — |
| 8 | `ConfigMissingScreen` | `VITE_SUPABASE_*` missing at build | `supabase.ts:3-6`, `App.tsx:164` | `VITE_SUPABASE_URL/ANON_KEY` | Set env + rebuild | — |

**Top-3 most likely Google-OAuth failures:** (1) redirect URL not whitelisted for the current origin (previews / apex-vs-www drift), (2) Google provider misconfigured/disabled in Supabase, (3) in-app-browser/PWA `disallowed_useragent`. All three are external-config-dependent → `UNVERIFIED` from code.

## 4. Recommended fixes (defer to AUTH-STABILIZATION phase — no change this phase)
- **AUTH-R1 (P1):** Pin OAuth `redirectTo` to canonical `https://www.deudda.com/auth/callback` (or add every deployed origin + `/**` to Supabase Redirect URLs) to remove preview/apex-vs-www drift.
- **AUTH-R2 (P1):** Verify `on_auth_user_created` trigger exists on the live DB (empty-profile hang otherwise).
- **AUTH-R3 (P2):** Add user-facing self-service password reset.
- **AUTH-R4 (P3):** Align 20s callback timeout with 25s fetch budget.
- **AUTH-R5 (P3):** Route `AuthResetPasswordPage` errors through `friendlyError`.
- **AUTH-R6 (P3, security/PII):** Remove `console.log` of signup email+metadata (`authStore.ts:226,239`).
- **AUTH-R7 (P2):** Add explicit terms-consent capture on the OAuth path.

## 5. Env var names in auth (values NOT printed)
| Name | Client/Server | Where |
|---|---|---|
| `VITE_SUPABASE_URL` | client | `supabase.ts:3`, `.env.example`, `LoginPage.tsx:257` |
| `VITE_SUPABASE_ANON_KEY` | client | `supabase.ts:4`, `.env.example`, `LoginPage.tsx:258` |
| `VITE_ENABLE_KAKAO_LOGIN` | client | `src/lib/kakao.ts` (Kakao button gate only) |
| `VITE_KAKAO_CHANNEL_PUBLIC_ID` | client | `src/lib/kakao.ts` (support chat) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` / `APP_PUBLIC_URL` | **server/edge only** | `admin-trigger-password-reset/index.ts:41-44,88` — not browser-exposed |

No dedicated client site-URL/OAuth-redirect env var exists — `redirectTo` is computed at runtime; canonical host hardcoded `www.deudda.com` (`productionRedirect.ts:22`). Supabase "Site URL"/"Redirect URLs" are external dashboard config → **UNVERIFIED**.
