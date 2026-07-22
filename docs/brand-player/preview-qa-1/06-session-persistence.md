# 06 — Session Persistence (design)

## Account session
Already handled by Supabase Auth (`persistSession` + `autoRefreshToken`). No change needed — the phase's "refresh keeps login / browser restart restores login / token auto-refresh" are already satisfied for the account.

## Kiosk binding persistence (to implement post-hardening)
Change the client store from `sessionStorage` to a persistent, server-reverified reference:

```
localStorage: srr.brand.binding.<brandId> = { token, storeLabel, deviceLabel, ts }
```

Access-state machine (single source, no duplicated guards):
```ts
type BrandPlayerAccessState =
  | 'AUTH_LOADING'        // waiting on isAuthReady
  | 'SIGNED_OUT'          // no session → /login
  | 'BINDING_CHECKING'    // calling verify_brand_device_binding
  | 'STORE_CODE_REQUIRED' // no/invalid binding → /brand
  | 'AUTHORIZED'          // enter player
  | 'REVOKED'             // binding revoked → message + /brand
  | 'ERROR';              // transient; retry, no infinite loading
```

Flow (per phase §8):
1. `AUTH_LOADING` until `isAuthReady`.
2. no session → `SIGNED_OUT`.
3. read persisted binding for the target brand.
4. `BINDING_CHECKING` → `verify_brand_device_binding(brandId, token)`.
5. `ok` → `AUTHORIZED` (load config + play).
6. `not_owner|revoked|expired|invalid|store_inactive` → clear local ref → `STORE_CODE_REQUIRED` (or `REVOKED` message).
7. network error → `ERROR` with retry (never infinite spinner).

Anti-flicker: the store-code screen is shown only in `STORE_CODE_REQUIRED`, never during `AUTH_LOADING`/`BINDING_CHECKING`.

## Scope of persistence
"Stay logged in and store-bound across normal refresh/restart unless the user logs out" — with explicit exceptions (browser data cleared, refresh token expiry/rotation, admin/self revocation, account/brand/store deactivation, security-policy change). **Never** described or built as "permanent login".
