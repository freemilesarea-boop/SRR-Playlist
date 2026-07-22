# 06 — Access State Machine

`src/lib/brandDeviceBinding.ts` — a single pure `resolveBrandAccessState()` (unit-tested), so pages don't duplicate guards.

```ts
type BrandPlayerAccessState =
  | 'AUTH_LOADING' | 'SIGNED_OUT' | 'BINDING_CHECKING'
  | 'STORE_CODE_REQUIRED' | 'AUTHORIZED' | 'REVOKED' | 'EXPIRED' | 'ERROR';
```

## Resolution (no flicker)
```
!authReady            → AUTH_LOADING
!hasSession           → SIGNED_OUT
!hasStoredBinding     → STORE_CODE_REQUIRED
!verifyAttempted      → BINDING_CHECKING
networkError          → ERROR
verify pending        → BINDING_CHECKING
verify.ok             → AUTHORIZED
reason=revoked        → REVOKED
reason=expired        → EXPIRED
reason=not_authenticated → SIGNED_OUT
otherwise             → STORE_CODE_REQUIRED
```
The store-code screen is never shown during `AUTH_LOADING`/`BINDING_CHECKING`.

## Helpers
- `shouldClearStoredBinding(state)` → true for STORE_CODE_REQUIRED/REVOKED/EXPIRED (clean invalid tokens).
- `accessStateMessage(state)` → safe Korean copy, no internal detail.
- `deviceLabelFromUA(ua)` → coarse `"Chrome · macOS"` (no fingerprinting).

## Wiring
- `BrandPlayerPage` re-verifies on entry (`verify_brand_device_binding`); failure → clear token + `/brand` (fail-closed).
- `BrandPage` auto-enters when a stored binding exists (guarded against redirect loops via nav state).
- Unit tests cover every transition (15 assertions).
