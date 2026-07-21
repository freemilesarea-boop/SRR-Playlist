# 07 — Risk Register

> Machine-readable: `hotfix-risk-register.json`.

| ID | Sev | Item | Resolution | Remaining |
|---|---|---|---|---|
| H-01 | P1 | 31 client RPCs undefined locally (PGRST202 risk) | DOCUMENT_REMOTE_ONLY + PGRST202 mapping + CI guard; not created | UNVERIFIED_REMOTE → DB-SCHEMA-RECONCILIATION |
| H-02 | P2 | daily-metrics fail-open (unauth service_role exec) | **FIXED** — verifyCronAuth fail-closed | set CRON_SECRET in prod |
| H-03 | P2 | Undefined-function error leaked name / infinite load | **FIXED** — safe mapping; wrappers throw | none (code) |
| H-04 | P3 | No guard vs NEW undefined RPCs | **FIXED** — lint:rpc + CI + allowlist | none |
| H-05 | P2 | Destructive undefined RPCs (purge/hard-delete/bulk-delete) | DEFER — fail closed if absent; verify auth/RLS if present-remote | UNVERIFIED_REMOTE |
| H-06 | P3 | Repo↔remote schema drift (extent unknown) | DOCUMENTED | DB-SCHEMA-RECONCILIATION |

## Severity summary
P0 0 · P1 1 (deferred, mitigated) · P2 3 (2 fixed, 1 deferred) · P3 2 (fixed/documented).
