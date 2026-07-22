# 05 — Client Storage

`src/lib/brandSession.ts`.

## Change
`sessionStorage` (`srr.brand.token.<brandId>`, ephemeral) → **`localStorage`** (`srr.brand.binding.<brandId>`, persistent).

- The stored value is the **opaque device token** — a server-reverified reference (allowed per the phase). It is hashed server-side; the hash is never on the client.
- **Plaintext store code is never stored** (used once for `verify_store_code`).
- **Supabase access/refresh tokens are not separately stored** (Supabase official storage only).
- Per-brand keys prevent cross-brand collision.
- One-time **legacy migration**: `getBrandToken` moves any surviving `sessionStorage` token to `localStorage`.

## Lifecycle
- Saved on successful `verify_store_code`.
- `clearBrandToken(brandId)` on invalid/expired/revoked verify or device disconnect / store switch.
- `clearAllBrandBindings()` on brand logout (`authStore.signOut`).

## Never trust the stored value alone
On entry the app calls `verify_brand_device_binding` (server) before auto-connecting; a stored token that fails server re-verification is cleared and the store-code screen is shown.
