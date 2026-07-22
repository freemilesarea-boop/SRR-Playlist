# 19 — Risk Register

| ID | Risk | Severity | Status / Mitigation |
|---|---|---|---|
| C-R1 | Production readers still over-exposed (`authenticated`, no admin check) | P2 | **Open in Production by design of this phase** — fix staged in Test + `18-production-apply-plan.md`; applied in the later combined Production phase. Data is internal AI-ops (no PII/money). |
| C-R2 | Production reader source differs from repo (intended security delta) | Low | Documented in `12` / `18`; not accidental drift. Writes match 1:1. |
| C-R3 | Live Preview browser integration not executed | Low | Contract-level verification done; live walkthrough deferred (`16`). No code path unverified at the RPC contract layer. |
| C-R4 | `sql`→`plpgsql` conversion could alter behavior | Low | Return columns + ordering preserved; verified identical signature/return on Test; only guard + language changed. |
| C-R5 | Bulk apply could mass-mutate tracks if mis-called | Medium | Admin-guarded; `coalesce` never overwrites non-null; `limit` cap; approved/non-removed filter. |
| C-R6 | Raw jsonb payloads exist on table | Low | Never projected by readers; RLS admin-only on direct table access. |
| C-R7 | FK to `auth.users` blocks synthetic tests | Info | Handled with `session_replication_role=replica` inside a rolled-back tx; no residue. |

## Absolute-condition compliance
No Production DB/migration/function/table/grant/RPC change; no Production prediction/track/user/PII read; no AI model/algorithm/scoring/prompt/threshold change; no model re-run; no full function source or real prediction/track data in any deliverable. Cluster A/B/D/E unchanged.
