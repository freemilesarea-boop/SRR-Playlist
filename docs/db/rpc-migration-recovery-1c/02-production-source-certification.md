# 02 — Production Source Certification

## Method
Exact definitions were captured **read-only** from Production (`nso…zvol`) via catalog introspection:
- Table: `pg_attribute` (columns/types/nullability), `pg_constraint` (`pg_get_constraintdef`), `pg_index`/`pg_get_indexdef` (indexes), `pg_policies` (RLS).
- Functions: `pg_get_functiondef` (source captured to reconstruct the migration; **full source never printed to console or reports**), `pg_get_function_identity_arguments` (signature), `pg_proc` (`prosecdef`, `provolatile`, `prolang`, `proacl`).

## Isolation confirmed
Test (`hao…qorr`) and Production (`nso…zvol`) are **distinct, isolated projects**. All apply/verify/test operations in this phase targeted **Test only**. Production was accessed for metadata read only.

## Prohibited actions — none performed
- No Production DDL/DML, no `apply_migration` on Production, no function/grant change.
- No Production prediction/track/user/PII row selected.
- No RPC executed on Production; no AI model re-run.
- No full function source, real prediction payload, or track data reproduced in any deliverable.

## Fidelity
- Table columns/types/constraints/indexes reproduced 1:1 from catalog.
- `apply_*` and `bulk_apply_*` reproduced **verbatim** from `pg_get_functiondef` (logic unchanged; AI scoring is off-platform and untouched).
- `ai_predictions_summary` / `list_pending_ai_predictions` reproduced with the **same signature and return columns**; only the language (`sql`→`plpgsql`) and an added admin guard differ — an intentional, documented security correction (see `08-admin-reader-hardening.md`).
