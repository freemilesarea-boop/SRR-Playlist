# 02 — Production Source Certification

## Method
All definitions captured **read-only** from Production (`nso…zvol`):
- Functions: `pg_get_functiondef` (source used to reconstruct migrations; **never printed in deliverables**), `pg_get_function_identity_arguments`, `pg_get_function_result`, `pg_proc` (`prosecdef`, `provolatile`, `prolang`, `proconfig`, `proacl`).
- Tables: `pg_attribute`, `pg_constraint`/`pg_get_constraintdef`, `pg_indexes`, `pg_policies`, `information_schema.role_table_grants`.

## Isolation
Test (`hao…qorr`) and Production (`nso…zvol`) are distinct isolated projects. Every `apply_migration`/`execute_sql` write targeted **Test**. Production was accessed for metadata only.

## Prohibited actions — none performed
No Production DDL/DML; no migration executed on Production; no function/grant change; no prediction/track/user/PII/settlement/review row read; no RPC executed; no AI model re-run; no full function source / real data / secret in any deliverable.

## Fidelity
- 6 writes reproduced **verbatim** from `pg_get_functiondef` (settlement/AI/playlist logic unchanged).
- 7 readers reproduced with **identical signature and return columns**; only `language sql`→`plpgsql`, an added admin guard, and (for `list_clap_recommendations`) explicit output-type casts differ — documented security/compat corrections, not contract changes.
- 2 dependency tables + 2 helpers + 2 playlists columns reproduced 1:1 from catalog (types, constraints, indexes, RLS policies, defaults).
