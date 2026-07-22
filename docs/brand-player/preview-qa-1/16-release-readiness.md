# 16 — Release Readiness

## Completion checklist (§29)
- [x] Brand auth architecture confirmed (Supabase Auth + `RequireAuth`)
- [x] Official session persistence in use (`persistSession` + `autoRefreshToken`) — already present
- [x] Refresh keeps login / restart restores login / token auto-refresh — already satisfied (account)
- [x] First store-code auth flow understood (`verify_store_code`, authenticated-only, hashed token)
- [x] Store code never stored in plaintext (confirmed)
- [x] Trusted device binding located (`brand_player_sessions`, reused)
- [x] Security gaps identified (owner check, revocation, expiry)
- [x] Additive hardening migration authored (`0454`, drift-safe, RPC-hygiene)
- [x] Device-binding + persistence + logout/revoke/switch **designed**
- [x] Migration lint PASS; UX-5 automated gates unchanged
- [ ] Store-code re-entry actually removed (client rewire) — **NOT shipped** (gated on server hardening + browser cert)
- [ ] Test DB apply + RLS/RPC certification — **NOT run** (Test DB access declined)
- [ ] Test-bound Preview deploy + Preview URL/Deployment ID — **BLOCKED**
- [ ] Chrome / Safari / Edge QA — **BLOCKED**
- [ ] Long-run QA — **BLOCKED**
- [x] No Production DB change / no Production secret / no PII output

## What's shippable now
- `0454` migration file (apply to **Test only** after inspecting current `brand_player_sessions`/RPC bodies) + certification suite.
- Complete design + operator runbooks to finish the phase where the infra exists.

## Verdict
`BLOCKED` — the phase's core certification (Test-bound Preview + real-browser + long-run) and the safe server hardening apply require infrastructure/DB access not available in this environment. Investigation, security model, additive migration, and full implementation + certification plans are delivered so the phase can be completed in an environment that has a Test-bound preview and Test DB access.
