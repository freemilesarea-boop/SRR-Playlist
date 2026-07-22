# 02 — Production Source Certification
- Read-only `pg_get_functiondef` (function bodies for migration authoring only, not printed) + catalog metadata for table DDL.
- **No Production execution / no user rows / no writes / no DDL** on Production.
- Secret scan: recovered bodies reviewed — only `auth.uid()`/`users.role` checks + table DML + an `admin_notifications` insert; no hardcoded credentials.
- Isolation: Test `hao…qorr` ≠ Production `nso…zvol`; migration applied to Test only.
