# 01 — Auth Architecture

## Provider
Supabase Auth. Client: `src/lib/supabase.ts:77`
```ts
createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }, global: { fetch: fetchWithTimeout } })
```
All Supabase requests carry a 25s hard timeout (storage excepted) to avoid infinite-loading deadlocks.

## Session lifecycle
- `src/store/authStore.ts` holds `session` + `isAuthReady`; subscribes to `onAuthStateChange`.
- `RequireAuth` (`App.tsx:86`) renders a loader until `isAuthReady`, then redirects to `/login` only if there's no session — **no flicker, no premature redirect**.
- `signOut()` (`authStore.ts:273`) → `supabase.auth.signOut()`.

## Brand account
There is **no separate brand login page**. The "brand account" is a normal authenticated user; brand access is authorized by data relationships:
- `enterprise_accounts.auth_user_id` links a Supabase user to an enterprise (HQ).
- `enterprise_accounts.store_invite_code` is the store code.
- `brand_accounts.enterprise_account_id` links a brand to an enterprise.

Both brand routes are wrapped in `<RequireAuth>` (`App.tsx:258-259`), so reaching the store-code page already requires a persistent Supabase session.

## Role determination
Server-side only — brand/store authorization is enforced in the `SECURITY DEFINER` RPCs (`verify_store_code`, `get_brand_player_config`) via `auth.uid()` and the enterprise→brand→store relationships. No client role string is trusted for brand access.
