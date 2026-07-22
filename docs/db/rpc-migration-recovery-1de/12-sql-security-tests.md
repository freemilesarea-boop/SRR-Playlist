# 12 — SQL Security Tests (synthetic, auto-rolled-back)

Method: `DO` block / transaction on Test with `set local session_replication_role = replica` (bypass FK to `auth.users`), synthetic admin + non-admin users, JWT impersonation via `set_config('request.jwt.claims', …)`, and either a terminal sentinel `raise exception` or explicit `rollback` — no synthetic data persists. Only synthetic values (no real tracks/predictions/PII).

## Guard matrix
| Caller | RPCs | Expected | Result |
|---|---|---|---|
| Anonymous (`{}`) | all 13 | blocked | **13/13 PASS** (`unauthorized` / no grant) |
| Non-admin authenticated | all 13 | blocked | **13/13 PASS** — over-exposure fix confirmed for the 7 readers |
| Admin | 7 readers | succeed | **7/7 PASS** |

## Admin write error handling
| Case | Expected | Result |
|---|---|---|
| `admin_hard_delete_track(bad uuid)` | `track_not_found` | PASS |
| `admin_purge_all_tracks('wrong')` | `confirmation_required` | PASS |
| `rollback_clap_auto_attach(bad uuid)` | `not_found` | PASS |
| `set_playlist_auto_attach(_, _, 150)` | `threshold must be 0-100` | PASS |
| `admin_update_track_metadata_full(_, energy=9)` | `energy_level must be 1-5` | PASS |

## Ownership (RLS on `artist_lifetime_streams`, real role switch)
| Role | Rows visible | Result |
|---|---|---|
| authenticated userB | 1 (own only, `only_own=true`) | PASS |
| admin | 2 (all) | PASS |
| anon | permission denied (no grant) | PASS (fail-closed) |

## Direct table access
`ai_metadata_corrections` / `artist_lifetime_streams`: no anon grant; authenticated SELECT is RLS-filtered (admin/self). Writes only via DEFINER functions.

## Notes
Synthetic non-admins use `role='user'` (the `users_role_check`-valid non-admin role; `artist` is an `account_type`, not a role). The admin-read RLS policy's subquery on `users` required a test-only (rolled-back) `grant select on users to authenticated` to evaluate as it does in Production.
