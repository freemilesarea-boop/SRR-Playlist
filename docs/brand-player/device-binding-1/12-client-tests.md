# 12 — Client Tests

## Unit (`src/lib/brandDeviceBinding.test.ts`, 15)
- `resolveBrandAccessState`: AUTH_LOADING, SIGNED_OUT, STORE_CODE_REQUIRED, BINDING_CHECKING (pre-attempt + pending → no flicker), ERROR on network, AUTHORIZED on ok, REVOKED/EXPIRED mapping, `not_owner/invalid/store_inactive → STORE_CODE_REQUIRED`, `not_authenticated → SIGNED_OUT`.
- `shouldClearStoredBinding`: clears on invalid/revoked/expired; keeps otherwise.
- `deviceLabelFromUA`: Chrome·macOS, Edge·Windows, Safari·iPad, Chrome·iPhone, Firefox·Linux, Safari·macOS; safe fallbacks.
- `accessStateMessage`: safe copy, no internal detail.

## Storage / integration behavior (design-verified; browser QA next phase)
- `brandSession`: token persists in localStorage; legacy `sessionStorage` migrated once; `clearBrandToken`/`clearAllBrandBindings` remove refs. Plaintext store code never written (only `saveBrandToken(token)`).
- Logout (`authStore.signOut`) → `clearAllBrandBindings()` → no auto-entry.
- Entry re-verify (`BrandPlayerPage`) → fail-closed clear + `/brand`.
- Auto-entry (`BrandPage`) guarded against redirect loops via nav state.

## Not unit-tested here
DOM/storage-event/multi-tab and full page-flow behaviors are covered by the browser QA runbook (`13-browser-qa` in the preview-qa phase / next phase). The pure logic that gates those flows is unit-tested above.
