# 12 — Browser QA

## Status: BLOCKED (not executed)
No Test-bound preview and no Chrome/Safari/Edge automation with a live auth flow in this environment. Per the phase, **no browser is marked PASS**.

## Runbook (run once `11-preview-environment.md` is unblocked)
Browsers: Chrome, Safari, Edge. Sizes: 1920×1080, 1366×768; tablet landscape/portrait; mobile landscape/portrait.

### Auth scenarios
1. Brand (account) login → `/brand`.
2. First store-code entry → player launches.
3. Refresh → still in player, no code re-entry.
4. Close tab → reopen `/brand/player/...` → auto-enters (binding reverified).
5. Restart browser → auto-enters.
6. Navigate away → return → still bound.
7. Brand logout → return requires login; after login, store code required (default policy).
8. Disconnect this device → store code required next time.
9. Switch to another store code → new store loads, no A/B state bleed.
10. Wrong / inactive / expired / other-brand code → safe error, no internal info leak.
11. Revoked binding (admin/self) → fail-closed → store-code screen.

### Player scenarios (UX-4/5 regression)
Brand media/logo/artwork/blur/fade; progress; seek (click/drag/touch/keyboard); volume/mute; queue search + select; next/prev; `F`/`Q`/Space/arrows; auto-hide; 10+ consecutive tracks; background↔foreground; **no duplicate audio**.

### Security spot-checks (DevTools)
- localStorage holds only an opaque token + non-sensitive labels (no plaintext store code, no Supabase access token copy, no UUIDs).
- No token/hash/store code in Console, Network URLs (query/params), analytics, or error monitoring.

Record per-browser results; mark only what was actually observed. Screenshots → `docs/screenshots/brand-player-preview-qa-1/` (no secrets/PII).
