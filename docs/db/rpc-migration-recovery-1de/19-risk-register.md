# 19 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status / Mitigation |
|---|---|---|---|
| DE-R1 | Production's 7 readers remain over-exposed to `authenticated` (no admin check) | **P2** | Open in Production **by design of this phase** (Test-only apply). Fix staged in Test + `18-production-apply-plan.md`; ships in `RPC-PRODUCTION-APPLY-1`. Data is internal admin/QC/curation (no PII/money). |
| DE-R2 | Production tables `ai_metadata_corrections` / `artist_lifetime_streams` grant anon+authenticated full CRUD (Supabase default) | **P2** | RLS backstops (no write policy; SELECT filtered by admin/self). Recovery target (authenticated SELECT only, no anon) staged as a reviewed Production grant-tightening step (`18`). `artist_lifetime_streams` self-read exposes only own aggregate. |
| DE-R3 | `admin_purge_all_tracks` / `bulk_delete_severe_mismatches` are destructive | **P1** | Admin-guarded; purge requires exact confirm token; hard-delete is revenue-safe (soft-hide when settlement/revenue rows exist). No logic changed. |
| DE-R4 | Live Preview browser integration not executed | P2 | Contract-level verified; live walkthrough deferred (`15`). |
| DE-R5 | `list_clap_recommendations` output casts differ from Production's exact body | P2 | Return types unchanged (contract preserved); casts only make Test's integer columns satisfy the declared numeric/text outputs — same values Production returns. |

## Absolute-condition compliance
No Production DB/migration/function/table/grant/RPC change; no Production row/PII/settlement/review read; no RPC executed on Production; no AI/settlement/playlist/queue/scheduler logic changed; no full function source / real data / secret in any deliverable; client-supplied `user_id`/`actor_id`/`admin_id` never trusted; every admin RPC has an internal role guard; every DEFINER function has `search_path=public`; no dynamic SQL with un-allowlisted input. Clusters A/B/C migrations unchanged.
