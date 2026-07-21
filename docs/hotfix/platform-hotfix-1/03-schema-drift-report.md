# 03 — Schema Drift Report

> Machine-readable: `schema-drift.json`, `rpc-remote-status.json`. Remote DB **not accessed** this phase (read-only metadata query not run → all remote states UNVERIFIED).

## Repository (base `acebedd`)
- Migrations: 416, max `0453`; `CREATE FUNCTION` defs: 946; `rpc()` call names: 725.
- (Settlement branch adds 0454–0456; none define the 31 functions.)

## Drift
| Aspect | Status |
|---|---|
| RPC called-but-undefined-locally | **31** |
| Classification | DEFINED_REMOTE_ONLY? / UNVERIFIED_REMOTE |
| Signature drift | UNVERIFIED (no remote) |
| Permission (execute grant) drift | UNVERIFIED |
| Source drift | UNVERIFIED |

## Operator read-only verification (proposed, NOT executed)
```sql
select proname, pronargs, prosecdef,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = any($1)   -- the 31 names
order by proname;
```
Run against **Test** and **Production**. For each present-remote / absent-local function → export into a committed migration (or remove the call). This is the DB-SCHEMA-RECONCILIATION deliverable.

## Note
No repository schema change was made. Drift is documented, not resolved (resolving it safely requires the remote metadata that is unavailable here).
