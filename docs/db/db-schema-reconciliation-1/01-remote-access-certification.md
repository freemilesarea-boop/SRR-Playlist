# 01 — Remote Access Certification

## Projects
| Role | Ref (masked) | Name | Region |
|---|---|---|---|
| Production | `nso…zvol` | SRR Playlist | ap-southeast-1 |
| Test | `hao…qorr` | SRR Playlist Test | ap-southeast-1 |

**Isolation confirmed:** distinct project refs (not equal) → Test and Production are separate databases.

## Method
- Read-only metadata via Supabase MCP `execute_sql` against `pg_catalog` / `information_schema` only.
- Functions used: `pg_get_function_identity_arguments`, `pg_get_function_result`, `pg_get_functiondef` (returned as **md5 hash only**, never raw source), `aclexplode(proacl)`, `to_regclass`.

## Prohibited operations — none performed
No function execution · no user/auth/profile/settlement/payment/track data reads · no DDL/DML · no trigger/cron runs · no grant/permission changes · no writes. Only catalog rows + booleans/hashes returned.

## Data-safety basis
- All queries are `SELECT` over system catalogs; `pg_get_functiondef` returns definition text (metadata), not a function invocation — no user function was called.
- Source text never printed: only `md5()` hashes and boolean heuristics (has-admin-check, uses-auth-uid, touches-money/pii) were surfaced.
- No secrets, passwords, or connection strings output; project refs masked.
