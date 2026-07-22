# 18 — Production Apply Plan (NOT executed this phase)

Production apply is deferred to a dedicated phase after Clusters D–E are recovered. This is the prepared runbook only. **No Production change was made in RPC-MIGRATION-RECOVERY-1C.**

## Preflight
1. Confirm target ref = Production (`nso…zvol`), not Test.
2. `track_ai_predictions` table: **already exists in Production** → do **not** recreate; treat migration table block as baseline/no-op (guarded by `if not exists`). Verify column set matches before proceeding.
3. All 4 functions: already exist → this apply is `CREATE OR REPLACE` for the 2 readers only.
4. Snapshot current `pg_get_functiondef` of both readers (rollback source).

## Changes to apply (readers only)
- `CREATE OR REPLACE FUNCTION ai_predictions_summary()` — plpgsql + admin guard (security correction).
- `CREATE OR REPLACE FUNCTION list_pending_ai_predictions(integer)` — plpgsql + admin guard (security correction).
- **Writes** (`apply_*`, `bulk_*`) already match Production → **no change** (skip, or re-assert identical body — no-op).

## Grant correction
- `revoke all … from public` + `grant execute … to authenticated` for the 2 readers.
- Confirm **no anon** grant remains on any of the 4.

## RLS / policy
- Verify `track_ai_predictions` RLS enabled and `track_ai_predictions_admin_read` policy present; add if missing (should already exist in Prod).

## Apply order
1. Preflight snapshots. 2. `CREATE OR REPLACE` the 2 readers. 3. Grant correction. 4. RLS/policy verify. 5. Smoke tests. 6. Grant re-verify.

## Lock risk
`CREATE OR REPLACE FUNCTION` takes a brief lock on the function only; no table rewrite (table unchanged). Negligible.

## Rollback
Re-apply the snapshotted prior `pg_get_functiondef` for the 2 readers and re-run their original grants. Writes/table untouched → nothing to roll back there.

## Smoke tests (Production, post-apply, non-destructive)
- Track-owner smoke: **N/A** (no owner reader).
- Admin reader smoke: an admin calls `ai_predictions_summary` / `list_pending_ai_predictions` → returns; a non-admin call → `unauthorized` (the fix's whole point).
- Write RPC smoke: verify `apply_*` still admin-only (do **not** apply real predictions during smoke; use a read-only guard probe or a throwaway/reversible check).
- Data exposure check: confirm reader output carries no jsonb payload/actor.

## Sequencing
Execute only in the combined Production grants-tightening phase after D/E, so all over-exposed readers across clusters are corrected together.
