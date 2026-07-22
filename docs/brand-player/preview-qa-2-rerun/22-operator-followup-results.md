# BRAND-PLAYER-PREVIEW-QA-2-RERUN — Operator Follow-up Results

> Operator confirmed: Vercel Preview env vars (Test Supabase URL + Test anon key on Preview scope) and the Test Auth User password are configured; Production env untouched; Preview branch `claude/brand-player-preview-qa-2-rerun`.
> This document records what could and could not be verified **from inside this automation session**, mapped 1:1 to the operator's 15-item request.
>
> **Final status: `BLOCKED`** — automated in-browser certification cannot run in this session because the session's **egress policy denies the browser's connection to the Test Supabase host** (`403` at the agent proxy). This is an environment/network constraint, **not** a code or backend defect. Backend is certified ready and the client is verified Test-bound.

---

## What this session CAN and CANNOT reach

| Channel | Reaches Test Supabase? | Notes |
|---|---|---|
| Supabase **MCP** tools (`execute_sql`, …) | ✅ Yes | Privileged control-plane channel. Used for backend re-verification below. |
| **Browser / curl** outbound (data plane) | ❌ No — `403` policy denial | Agent proxy relay log repeatedly shows `connect_rejected :: haojpuhztegecbrwqorr.supabase.co:443 :: gateway answered 403 to CONNECT (policy denial)`. Per the proxy README, org egress policy denials must be reported, not routed around. |

Because the **browser data plane cannot reach Supabase**, every step that requires a live in-browser login/RPC (items 4–12) **cannot be executed here** and is marked `OPERATOR_REQUIRED` — it must be run against the deployed Preview (which does have Supabase egress). None of these are marked PASS.

---

## Local automated harness (item 13 — attempted)

A Test-bound automated browser harness was built and executed:
- Local build of the **actual branch code** with Test env (`VITE_SUPABASE_URL=https://haojpuhztegecbrwqorr.supabase.co`, Test anon key), served via `vite preview` on `127.0.0.1:4173` (HTTP 200).
- Playwright + system Chromium (`/opt/pw-browsers/chromium`), persistent context (for browser-restart simulation), with a **network guard** that (a) records every Supabase host contacted and (b) fails the run on any request to the Production host `nsoesrvwkxqifjcxzvol.supabase.co`.
- Scripts: `qa_main.js` (full flow), `qa_shell.js` (shell + isolation), `qa_debug_login.js` (auth-response probe). Ready to run unmodified on any host that has Supabase egress.

**Result:** the harness reached the login screen and submitted credentials, but the auth request (and all subsequent RPCs) were rejected by the egress proxy (`403 CONNECT`), so the app never advanced past auth restore. Screenshot: `docs/screenshots/brand-player-preview-qa-2-rerun/00_app_shell_auth_loader.png` (app held on the auth-restore loader — expected when Supabase is unreachable).

---

## Isolation certification (items 2 & 3 — VERIFIED at attempt level)

The one P0 gate that IS verifiable here — and it passes:

- **Only the Test host is ever contacted.** Network guard across the local runs: `SUPABASE_HOSTS = haojpuhztegecbrwqorr.supabase.co`; `PROD_ATTEMPT = false`.
- **Zero Production-host attempts.** The agent-proxy relay-failure log (which records every attempted CONNECT) contains **no** `nsoesrvwkxqifjcxzvol.supabase.co` entry — only `haojpuhztegecbrwqorr…`. The login/player flow never targets Production.
- The 2 Production-host strings present in the JS bundle are **static, non-connecting**: a source comment in `src/lib/supabase.ts` and a Kakao-share OG-image fallback URL in `src/lib/kakao.ts` (used only in share flows, not login/player). Neither produced a network request in the observed flow.

→ Item 3 ("stop immediately if a Production-host request occurs"): no such request occurred; nothing to stop. Full **response-level** confirmation on the live Preview remains `OPERATOR_REQUIRED`.

---

## Backend readiness (re-verified live via MCP, Test project, read-only)

The exact flow the browser would drive is served correctly server-side:

| Check | Expected | Actual |
|---|---|---|
| Brands (A/B) | 2 | **2** |
| Active stores (A/B) | 2 | **2** |
| Brand A media (active) | 4 | **4** |
| Brand B media | 0 (none seeded) | **0** |
| Synthetic tracks | 15 | **15** |
| `_brand_generate_playlist(A)` | 15 | **15** |
| `_brand_generate_playlist(B)` | 15 | **15** |
| RPCs present (verify_store_code, get_brand_player_config, verify/revoke/list binding, heartbeat) | 6 | **6** |
| QA auth user (password + email confirmed) | ready | **ready** |
| QA `public.users` profile (not withdrawn/disabled) | ready | **ready** |

This matches the BRAND-TEST-RECOVERY-1 **19/19** SQL certification (synthetic, rolled back). Server-side logic for auto-entry, cross-brand/cross-user denial, revoke, expiry, and rate-limit is certified. **The browser-rendering / persistence behaviour of these is not certified here** and stays `OPERATOR_REQUIRED`.

---

## Operator's 15 items — status matrix

| # | Item | Status | Basis |
|---|---|---|---|
| 1 | Preview URL + Deployment ID | `OPERATOR_REQUIRED` | Operator's Vercel project is not linked/visible via this session's Vercel MCP and there is no env-var management tool; I cannot redeploy or read the operator's Preview. Operator has the URL/ID from their Vercel dashboard. |
| 2 | All Supabase requests hit Test host | `PASS (attempt-level)` / live confirmation `OPERATOR_REQUIRED` | Client attempts only `haoj…qorr`; zero `nso…zvol`. Response-level confirm needs the reachable Preview. |
| 3 | Stop if Production host observed | `PASS` | No Production-host request observed anywhere (guard + proxy log). |
| 4 | Login + first store-code connect | `OPERATOR_REQUIRED` | Browser cannot reach Supabase here (403). Backend path certified. |
| 5 | Refresh auto-entry | `OPERATOR_REQUIRED` | Same. |
| 6 | Tab-close auto-entry | `OPERATOR_REQUIRED` | Same. |
| 7 | Real browser-restart auto-entry | `OPERATOR_REQUIRED` | Same (harness simulates via persistent context; needs egress). |
| 8 | Logout blocks auto-entry | `OPERATOR_REQUIRED` | Same. `signOut` clears all brand bindings (code verified). |
| 9 | Device disconnect | `OPERATOR_REQUIRED` | Same. Server `revoke_brand_device_by_token` certified. |
| 10 | Store A → B switch | `OPERATOR_REQUIRED` | Same. Both stores/playlists certified server-side. |
| 11 | Tampered / revoked / expired binding block | `OPERATOR_REQUIRED` (browser) / server-side certified | `get_brand_player_config` + `verify_brand_device_binding` fail-closed on non-owner/revoked/expired (19/19). Browser fail-closed UI needs egress. |
| 12 | Player controls + visual QA | `OPERATOR_REQUIRED` | Requires rendered player, which needs Supabase config. |
| 13 | Automated browser tests | `ATTEMPTED — BLOCKED by egress` | Harness built + run; blocked at auth by 403 policy denial. Scripts ready for a host with egress. |
| 14 | Separate operator-required items | `DONE` | This matrix. |
| 15 | Don't mark unverified as PASS | `HONORED` | Only isolation (2/3) + backend readiness are marked verified; all in-browser runtime items are `OPERATOR_REQUIRED`. |

---

## To unblock (operator, ~minutes on the deployed Preview)

The blocker here is purely this session's browser egress. On the **deployed Preview** (which the operator has already env-configured and which does have Supabase egress), run the harness or the manual runbook (docs 05–17):

1. Open the Preview URL; confirm `[SupabaseEnv]` / Network shows `haoj…qorr` only, never `nso…zvol`.
2. Login `qa-brand-user@test.invalid` (operator-set password) → `/brand` → store code `QA-STORE-ALPHA-7X3K9` → player should show **15-track queue, 4 media**.
3. Refresh / new tab / full browser restart → auto-entry to the player (no code re-entry).
4. Logout → auto-entry blocked. Disconnect → re-entry blocked. Switch to `QA-STORE-BETA-4M8P2` → player (15 tracks, 0 media).
5. Tamper localStorage `srr.brand.binding.<brandId>` → fail-closed. (Revoked/expired can be forced via Test SQL on `brand_player_sessions.revoked_at` / `expires_at`.)
6. Player controls + visual/media + long-run + browser matrix (Safari/Edge/mobile) → `OPERATOR_REQUIRED` regardless (real hardware/browsers).

Synthetic store codes and seed live in `supabase/seed/brand_player_synthetic_test.sql`. The Playwright harness in this branch can drive steps 2–5 automatically once pointed at a URL with egress.

---

## Verdict

`BLOCKED` — backend certified ready and client verified Test-bound (no Production connection), but the automated in-browser login/data/player certification **cannot execute in this session** because the egress policy denies the browser's connection to the Test Supabase host. All in-browser runtime items are separated as `OPERATOR_REQUIRED`; none are falsely marked PASS.
