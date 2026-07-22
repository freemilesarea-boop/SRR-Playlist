# BRAND-PLAYER-PREVIEW-QA-1 — Executive Summary

> Branch `claude/brand-player-preview-qa-1` from `claude/brand-player-ux-5-final-controls` (`0d98172`).
> **Status: BLOCKED** on the certification pipeline (Test-bound Preview deploy + real Chrome/Safari/Edge QA + long-run) which cannot run in this environment. No Production change; no Test DB mutation performed this phase.

## Key architectural finding
The brand player is **already** behind Supabase Auth (`<RequireAuth>` on `/brand` and `/brand/player/:brandId`), with `persistSession: true` + `autoRefreshToken: true`. A **trusted device binding already exists** server-side: `verify_store_code` (authenticated-only) issues an opaque token and stores its **sha256 hash** in `brand_player_sessions` bound to `user_id = auth.uid()`, brand, and enterprise. The plaintext store code is **never stored** on the client.

**The only friction** is that the client keeps that token in `sessionStorage`, which dies on tab close → the store code is re-entered on browser restart. Making it persistent is the fix — but only after closing real security gaps.

## Security gaps found (must be fixed before persisting the token)
1. `get_brand_player_config` validates the token hash but **not `user_id = auth.uid()`** → a token works for any authenticated user (violates "다른 User Binding 사용 금지").
2. No `revoked_at` → a device can't be disconnected.
3. No enforced `expires_at` → the 30-day expiry is returned but not enforced.

Persisting the token in `localStorage` **without** these fixes would be a security regression, so the client change is deliberately **not shipped** this phase.

## Delivered (safe, no side effects)
- Full architecture + security investigation (docs 01–09).
- **Additive** Test-only migration `0454_brand_device_binding_hardening.sql` (committed, **not applied**): adds `revoked_at/revoked_by/expires_at/device_label` to the existing `brand_player_sessions` (no duplicate table), and adds strict additive RPCs `verify_brand_device_binding` (owner + not-revoked + not-expired + active-brand), `revoke_brand_device_by_token` (self-revoke), `list_my_brand_devices` — all `authenticated`-only, `SECURITY DEFINER`, `search_path` fixed. It intentionally does **not** blind-rewrite `verify_store_code`/`get_brand_player_config` (their latest bodies must be inspected on Test first).
- Client persistence + access-state + logout/revoke/switch **design** (doc 06–08) ready to implement once the server hardening is applied and certified.
- Operator runbook for Preview + browser + long-run QA (docs 11–13).

## Not done (BLOCKED / declined this phase)
- Test DB apply + RLS/RPC certification — **not run** (live Test DB access was declined; the current `brand_player_sessions` body/columns have drifted since 0407 and must be inspected before a safe apply).
- Client auth-flow rewire — **not shipped** (would regress security without the server fix; also un-browser-testable here).
- Test-bound Preview deploy, Chrome/Safari/Edge QA, 30 min–2 hr long-run — **BLOCKED** (no Test-bound preview infra, no Safari/Edge, no long sessions in this environment).

## Automated gates (this branch)
Migration lint ✅. Typecheck/ESLint/Unit(112)/Build unchanged from UX-5 (no source code changed this phase) — re-run recorded in `10-test-results.md`.

## Verdict
`BLOCKED` — the phase's certification requires a Test-bound Preview + real browsers + live Test DB, none available here. A precise, safe implementation + certification plan is provided for the environment that has them.
