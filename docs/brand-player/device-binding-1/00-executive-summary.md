# BRAND-DEVICE-BINDING-1 — Executive Summary

> Branch `claude/brand-device-binding-1` from `claude/brand-player-preview-qa-1` (`ba861e2`).
> Migration `0454_brand_device_binding_hardening.sql` **applied to Test only** (`hao…qorr`, "SRR Playlist Test"). **No Production change.**

## Outcome
Store code is now entered **once**; the browser is remembered as a trusted store device (server-verified) so a browser restart auto-connects to the same brand player — **without** the previously-declined-then-now-authorized Test DB work, which is completed and certified.

## Environment certified
Test = `haojpuhztegecbrwqorr` ("SRR Playlist **Test**", ap-southeast-1); Production = `nsoesrvwkxqifjcxzvol` ("SRR Playlist"). Distinct refs/hosts/names → isolated. All DB ops targeted Test only.

## Key discovery
Test had **no brand subsystem at all** (Production-only drift; Test is a curated settlement+recovery replica). So `0454` was made **idempotent & self-sufficient**: `create table if not exists` (no-op on Production, bootstraps Test) + additive columns + binding RPCs + a faithfully-hardened `brand_player_heartbeat` (reproduced from the exact Production body plus the ownership/revoke/expiry guard).

## Server hardening (applied + certified on Test)
`brand_player_sessions` reused (no duplicate table); added `revoked_at/revoked_by/expires_at/device_label` + partial indexes + RLS self-read policy. New/hardened RPCs (all `SECURITY DEFINER`, `search_path` pinned, `authenticated`-only, **no anon**):
- `verify_brand_device_binding` — owner (`user_id=auth.uid()`) + not-revoked + not-expired + active brand; returns display-only fields.
- `revoke_brand_device_by_token` — self-revoke (own row only).
- `list_my_brand_devices` — caller's own devices, display-only.
- `brand_player_heartbeat` — same binding guard added.

**18/18 synthetic security assertions PASS** (anon blocked ×4; owner ok; revoked/expired/cross-brand/inactive rejected; cross-user `not_owner`/heartbeat-fail/revoke-`not_found`; `list_my` scoped; self-revoke → revoked), fully rolled back.

## Client (persistent binding + state machine)
- Token moved from `sessionStorage` → **`localStorage`** (persistent, opaque, server-reverified), with one-time legacy migration; **plaintext store code never stored**; clear on logout/revoke/expiry/invalid.
- Pure `resolveBrandAccessState()` machine (`AUTH_LOADING → BINDING_CHECKING → AUTHORIZED / STORE_CODE_REQUIRED / REVOKED / EXPIRED / ERROR`) — unit-tested, no flicker.
- Entry re-verifies via `verify_brand_device_binding` (fail-closed → clear + code screen). Auto-entry on `/brand` (guarded against redirect loops). Logout clears all bindings. "이 기기 연결 해제" + "다른 매장 연결" actions use the official player-stop path.

## Playback safety
No audio element / queue / scheduler / crossfade / heartbeat-payload / analytics / recovery change. Stop/switch use existing `pause()` + navigation.

## Gates
Migration lint ✅ · Typecheck ✅ · ESLint ✅ · Unit **127** (112 baseline + 15 new) ✅ · Build ✅. No test deleted/weakened.

## Verdict
`READY_FOR_PREVIEW_QA` — Test DB hardening applied + certified; client implemented + unit-tested; Production untouched. Preview deploy + real-browser QA is the next phase.
