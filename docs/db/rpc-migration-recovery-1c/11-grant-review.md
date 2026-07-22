# 11 — Grant Review

## Applied in `0459` (all 4)
```
revoke all on function <fn> from public;
grant execute on function <fn> to authenticated;   -- + internal admin guard
```
No `anon` grant on any Cluster C function. No `service_role` grant (no service caller).

## Verified on Test (`aclexplode(proacl)`)
| RPC | Grantees | anon? |
|---|---|---|
| `ai_predictions_summary()` | authenticated, postgres | **no** |
| `list_pending_ai_predictions(integer)` | authenticated, postgres | **no** |
| `apply_track_ai_predictions(uuid,bool,bool,bool,bool)` | authenticated, postgres | **no** |
| `bulk_apply_high_confidence_ai_predictions(numeric,integer)` | authenticated, postgres | **no** |

(`postgres` is the owner default — not a client-reachable role.)

## Checklist
- PUBLIC execute remaining: **none** (revoked).
- anon execute remaining: **none**.
- authenticated over-permission: mitigated — `authenticated` alone grants nothing usable because every function additionally enforces the admin guard.
- Admin guard missing on reader: **fixed** (2 readers).
- Admin guard missing on write: **none** (both writes guarded).
- Default function privilege impact: functions are locked down explicitly at creation; the migration does not rely on `ALTER DEFAULT PRIVILEGES`.

## Table-level
`track_ai_predictions` has RLS enabled with an admin-only SELECT policy; no anon/authenticated table grants are added by the migration, so direct table access outside the DEFINER functions is admin-only.
