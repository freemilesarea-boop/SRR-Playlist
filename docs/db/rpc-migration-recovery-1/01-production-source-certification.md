# 01 — Production Source Certification

- **Access:** read-only `pg_catalog`/`information_schema`; `pg_get_functiondef` used to capture exact function bodies for migration authoring only (**not printed to reports/logs**); `pg_get_constraintdef`/`pg_get_indexdef` + `pg_attribute`/`pg_policies` for table DDL.
- **No function executed on Production**; no user rows read; no writes; no DDL/DML on Production.
- **Secret scan:** captured function bodies (Cluster A) reviewed — no hardcoded credentials/tokens/connection strings; only `auth.uid()` + `users.role` checks and table DML.
- **Integrity:** source hashes captured in DB-SCHEMA-RECONCILIATION-1; Cluster A functions recovered match those signatures/return types (verified on Test).
- **Isolation:** Test `hao…qorr` ≠ Production `nso…zvol` (distinct refs). Migrations applied to Test only.
