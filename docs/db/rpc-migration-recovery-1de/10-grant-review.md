# 10 — Grant Review

## Function grants (verified on Test — `aclexplode(proacl)`)
| Function group | anon | authenticated | Note |
|---|---|---|---|
| 13 client RPCs (D+E) | **no** | yes | + internal admin guard |
| `_log_ai_correction` | **no** | **no** | internal only (definer-context) |
| `snapshot_artist_lifetime_streams` | **no** | **no** | internal only (admin-guarded) |

`revoke all from public` applied to all 15. `service_role` **not** granted (dropped from Production's set — a no-op behind the `auth.uid()` admin guard). `postgres` (owner) retains implicit rights.

## Table grants
| Table | anon | authenticated | Writes |
|---|---|---|---|
| ai_metadata_corrections | none | SELECT | none (via `_log_ai_correction` definer) |
| artist_lifetime_streams | none | SELECT | none (via `snapshot_*` definer) |

Production granted full CRUD to anon+authenticated (Supabase default, RLS-backstopped). Recovery is **more restrictive**: authenticated SELECT only, no anon, no direct writes — RLS (`admin_read`/`self_read`) filters rows; all writes go through DEFINER functions. `playlists` columns added to the existing (already-granted) table; RLS on `playlists` unchanged.

## Checklist
- PUBLIC execute remaining: **none**.
- anon execute remaining: **none**.
- authenticated over-permission: mitigated (admin guard inside every function; tables RLS-filtered).
- Admin-guard-missing readers/writes: **0**.
- Default function privilege reliance: none (grants set explicitly at creation).
