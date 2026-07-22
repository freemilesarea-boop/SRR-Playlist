# 08 — Store Switching

`BrandPlayerPage` "다른 매장":
1. `clearBrandToken(currentBrandId)` (local),
2. `pause()` (official player stop),
3. `/brand` with `{ switchStore: true }` (no auto-entry back to the old store).
4. User enters a new store code → `verify_store_code` (new binding row) → new brand player.

## Isolation
- Bindings are per-brand keys (`srr.brand.binding.<brandId>`), so brand A's token can't be used for brand B.
- The new brand's `setQueue(...)` replaces the queue wholesale on load, so brand A's queue/media/visual state does not leak into brand B.
- The single global `<Player>` simply receives the new queue — no new audio element, no cloned queue.

## Guardrail
`BrandPage` does not auto-enter when arriving via `switchStore` / `deviceRevoked` / `fromPlayerReject` nav state (prevents an auto-bounce loop back into the store the user just left).
