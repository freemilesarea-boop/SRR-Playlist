# 10 — Production Apply Plan (NOT executed)

> Machine-readable: `production-apply-plan.json`. Production already HAS all 31 functions + 5 tables → apply = **align repo history + apply the 10 security fixes (grant/guard)**, not recreate.

## Key insight
- Tables already exist in Production → `create table if not exists` = no-op (safe). Do **not** drop.
- Functions already exist → `create or replace` = safe replacement. The **real Production remediation** is replacing the 10 over-exposed readers with the admin-guarded versions.

## Apply order (after CRON_SECRET set — PLATFORM-HOTFIX-1 gate)
1. Preflight: read-only metadata confirm each object's current state (source hash).
2. 0457 → 0461 in order; tables `if not exists`, functions `create or replace`.
3. Grant correction: `revoke all from public` + minimal re-grant per cluster.
4. Security fix: replace the 10 readers with guarded versions (Cluster A's `admin_list_site_notices` already designed; B–E pending authoring).
5. Verify: re-run read-only metadata; confirm guard present + grants tightened; source hash changed only for fixed functions.
6. Smoke: app calls succeed (Preview → then prod); PGRST202 absent.

## Rollback
`create or replace` each fixed function back to its captured prior definition; **no table drops** in Production. Grants revert to prior ACL (captured).

## Existing-object handling
Because prod objects exist, treat 0457–0461 as **reconciliation** migrations (idempotent). Optionally split: a baseline "already-in-prod" marker migration + a "security-fix" migration that only alters the 10 readers + grants.
