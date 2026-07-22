# 07 — Logout & Revoke

## Player exit vs logout (separate)
- **Exit fullscreen / leave route / close browser** → binding kept, session kept.
- **Brand logout** (`authStore.signOut`) → `clearAllBrandBindings()` (local) + `supabase.auth.signOut()`. Next login requires the store code again (no auto-entry after logout). Server rows are left intact but a logged-out browser has no local token and, on re-login, must re-enter the code.

## This device disconnect
`BrandPlayerPage` "연결 해제":
1. `revoke_brand_device_by_token(brandId, token)` (server: sets `revoked_at/revoked_by` on the caller's own row),
2. `clearBrandToken(brandId)` (local),
3. `pause()` (official player stop),
4. `/brand` with `{ deviceRevoked: true }` → shows "이 기기의 매장 연결이 해제되었습니다."
The device's next request fails closed (`revoked`).

## Expiry / network
- Expired binding → `verify_brand_device_binding` returns `expired` → EXPIRED state → clear + code screen.
- Transient network error on an already-active player → not force-stopped (existing offline policy); the entry re-verify swallows transient errors (no infinite loading, no false auto-kill).

## Admin revoke (deferred)
Full device-management UI (revoke other devices) is a follow-up; `list_my_brand_devices()` provides the caller's own list now.
