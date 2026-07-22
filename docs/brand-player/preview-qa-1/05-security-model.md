# 05 — Security Model

## Two separated states
- **Brand Authentication** — who the user is (Supabase Auth session; `RequireAuth`).
- **Trusted Store Device Binding** — which store this browser is bound to (`brand_player_sessions` row + client token reference).
Neither implies the other: an authenticated user is not auto-entered into an arbitrary store, and a stored binding never grants admin/brand-settings access without a valid auth session.

## Gaps found in the current server path
| # | Gap | Impact | Fix |
|---|---|---|---|
| 1 | `get_brand_player_config` doesn't check `user_id = auth.uid()` | any authenticated user with the token hash (e.g. another profile on the same browser reading localStorage) can load config | strict re-verify RPC checks owner; also patch config RPC on Test after inspecting latest body |
| 2 | no `revoked_at` | device can't be disconnected | additive column + `revoke_brand_device_by_token` |
| 3 | `expires_at` not enforced | 30-day expiry meaningless | additive column + enforced in re-verify; set on creation in `verify_store_code` (Test) |

**Because of gap 1, the client token must NOT be persisted to localStorage until the owner check is enforced.** Hence the client change is not shipped this phase.

## Guarantees (target, after hardening)
- Anonymous: blocked (all RPCs `authenticated`-only; both routes `RequireAuth`).
- Cross-brand: token bound to `brand_id`; re-verify scopes by brand.
- Cross-user: `user_id = auth.uid()` enforced.
- Revoked/expired binding: fail-closed → store-code screen.
- Store-code-only entry: impossible — `verify_store_code` requires `authenticated`.
- No plaintext store code stored; no token/hash/UUID in logs, URLs, analytics, or error monitoring.
- Token stored server-side as hash only; client holds the opaque token as a reverified reference.

## RPC hygiene (additive RPCs in 0454)
`SECURITY DEFINER` + `search_path` pinned; `revoke all from public, anon`; `grant execute to authenticated`; returns only non-sensitive display fields.
