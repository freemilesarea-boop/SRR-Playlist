# 15 — Production Apply Plan (NOT executed)
Machine-readable: `cluster-b-production-plan.json`. Production already HAS these objects; Cluster B needs **no security fix** (already safe) → apply = repo-history alignment.
1. Preflight: read-only metadata confirm objects + source hashes.
2. `create table if not exists` (no-op in prod) + `create or replace function` (identical bodies) + grant `revoke all from public` / regrant `authenticated`.
3. Verify: signatures match, no anon grant, RLS policies present, source hash unchanged (identical recovery).
4. Rollback: `create or replace` back to captured prior def; **no table drops in Production**.
Independent of the CRON_SECRET gate.
