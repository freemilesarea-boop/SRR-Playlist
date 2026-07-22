# 07 — Logout & Revocation (design)

## Player exit vs brand logout (must stay separate)
| Action | Effect |
|---|---|
| **Exit fullscreen** | back to normal brand player screen; session + binding kept |
| **Leave player route / close browser** | binding kept (persistent) |
| **Brand logout** | Supabase `signOut()` + clear local binding refs; no auto-entry next time |
| **Disconnect this device** | `revoke_brand_device_by_token` + clear local ref; store code required next time |

Exiting fullscreen or closing the browser must **never** log out or delete the binding.

## Logout policy (default = safest, per §11)
```
Brand logout → remove auth session → also remove this browser's auto-entry binding refs
             → next login requires store code again
```
Implementation: hook `authStore.signOut()` to call `clearAllBrandBindings()` (localStorage refs). The server `brand_player_sessions` row is left intact (or optionally revoked) — but with local refs gone and (after hardening) owner-checked re-verify, a logged-out browser cannot auto-enter.

## Self device disconnect
`revoke_brand_device_by_token(brandId, token)` → sets `revoked_at/revoked_by` on the caller's own row → clear local ref → `/brand`. The device's next request fails closed (`revoked`) → store-code screen.

## Admin revoke (deferred)
Full device-management UI (list/revoke other devices) is deferred to a follow-up phase (§14). `list_my_brand_devices()` is provided for a minimal self view now.

## Session expiry / network
- Access token expiry → Supabase auto-refresh; refresh failure → no auto-entry, stop sensitive fetches, go to re-auth (fail-closed).
- Transient network error on an already-verified active player → follow existing offline policy (don't force-kill); **new** entry requiring server verification fails closed. Distinguish transient latency from revocation; never infinite-loading.
