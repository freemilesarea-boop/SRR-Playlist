# 02 — Current Session Behavior

## Brand account (Supabase Auth)
- Refresh → session restored (persistSession).
- Browser restart → session restored from persistent storage (refresh token) until it expires/rotates.
- Access token auto-refreshed before expiry (autoRefreshToken).
- Explicit `signOut()` → session removed.
- Unrecoverable session → `RequireAuth` sends to `/login` (fail-closed).

## Brand kiosk session (store-code token)
- `verify_store_code` returns an opaque token; client stores it in **`sessionStorage`** keyed `srr.brand.token.<brandId>` (`brandSession.ts`).
- **Refresh** → sessionStorage survives → player reverifies via `get_brand_player_config` → keeps playing.
- **Tab close / browser restart** → sessionStorage cleared → **token gone → store code re-entered** ← the friction this phase removes.
- Recent brand `{id, name}` stored in localStorage (non-sensitive, display only).
- Plaintext store code: **never stored** (used once for `verify_store_code`).

## Multi-tab
Supabase Auth syncs the account session across tabs. The kiosk token is per-tab (sessionStorage) today; making it a persistent per-browser reference (localStorage) is part of the fix.

## Gap summary
Account auth is already persistent and correct. The kiosk binding is correct server-side (hashed, user-bound) but ephemeral client-side, and the server verify path has the three gaps in `05-security-model.md`.
