# 07 — Production Checklist (operator, external)

> Everything below is **external configuration** the operator must verify before production apply. Report only presence/format/fingerprint — never secret values.

## Supabase — Authentication → URL Configuration
- [ ] **Site URL** = `https://www.deudda.com`
- [ ] **Redirect URLs** include (all `/**`):
  - [ ] `https://www.deudda.com/**`
  - [ ] `https://deudda.com/**`
  - [ ] each active preview `https://<branch>-git-*.vercel.app/**`
  - [ ] `http://localhost:5173/**` (dev)
- [ ] Reset link lands on `/auth/reset`; email confirm lands on `/auth/callback`.

## Supabase — Authentication → Providers
- [ ] Google **Enabled**, Client ID + Secret present (format/fingerprint only)
- [ ] Kakao provider matches `VITE_ENABLE_KAKAO_LOGIN` intent
- [ ] Email confirmation setting matches product expectation
- [ ] JWT expiry / refresh settings as intended

## Google Cloud — OAuth client
- [ ] Authorized redirect URIs include `https://<project-ref>.supabase.co/auth/v1/callback`
- [ ] Authorized JavaScript origins as needed
- [ ] Consent screen **Published** (or test users cover QA accounts)

## Profile trigger (read-only DB check)
- [ ] `on_auth_user_created` trigger exists on live DB
- [ ] `handle_new_user()` function exists
- [ ] (query in `03-profile-provisioning.md`)

## Environment (names/pair only)
- [ ] `VITE_SUPABASE_URL` project ref matches the intended environment (Test vs Prod)
- [ ] `VITE_SUPABASE_ANON_KEY` pairs with that same project (fingerprint)
- [ ] Preview scope points at a **Test** Supabase, not Production (see settlement preview-env phases)
- [ ] `APP_PUBLIC_URL` (server) = production canonical for reset/confirm emails

## Email provider
- [ ] Resend (or Supabase SMTP) configured for auth emails
- [ ] Sender domain verified; reset/confirm templates present

## Rate limit / logging
- [ ] Supabase auth rate limits acceptable (signup/reset)
- [ ] Production build strips DEV logs (verified: PII/env logs absent from `dist`)

## Rollback
- [ ] Auth change is display/client-layer + additive store method → revert the PR; no DB/migration to undo
- [ ] Redeploy prior production build via Vercel if needed

## Sign-off
- [ ] Authenticated Preview QA (`05-auth-test-matrix.md`) all PASS
- [ ] Operator approval to apply
