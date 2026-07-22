# RPC-MIGRATION-RECOVERY-1DE — Executive Summary

> Branch `claude/rpc-migration-recovery-1de-final` from Cluster C tip `86e9225`.
> Migrations `0460` (Cluster D) + `0461` (Cluster E) applied to **Test only** (`hao…qorr`).
> **0 Production changes.** No Production DB/migration/function/table/grant/RPC change; no Production row/PII read; no RPC executed on Production; no settlement/AI/playlist logic changed; no full function source or real data in any deliverable.

## Scope
Final cluster of the Production-only RPC/table drift recovery. Recovers the last **13 undefined RPCs** (Cluster D: 8 admin-track/QC; Cluster E: 5 CLAP-curation) plus their transitive Production-only dependencies, hardens the 7 over-exposed admin readers, applies to Test, and certifies with synthetic security tests. Clusters A/B/C untouched.

## Recovered
**Cluster D (`0460`):** `get_admin_track_detail`, `list_admin_tracks_with_ai`, `ai_correction_stats`, `list_severe_metadata_mismatches` (readers, security-fixed) + `admin_hard_delete_track`, `admin_purge_all_tracks`, `admin_update_track_metadata_full`, `bulk_delete_severe_mismatches` (writes, verbatim).
**Cluster E (`0461`):** `list_clap_curation_playlists`, `list_clap_recommendations`, `list_clap_auto_approved` (readers, security-fixed) + `rollback_clap_auto_attach`, `set_playlist_auto_attach` (writes, verbatim).
**Transitive dependencies (Production-only, recovered for Test):** tables `ai_metadata_corrections`, `artist_lifetime_streams`; internal helpers `_log_ai_correction`, `snapshot_artist_lifetime_streams`; columns `playlists.auto_attach_enabled` / `auto_attach_threshold`.

## Security outcome
- **7 over-exposed readers fixed.** All were `SECURITY DEFINER` + `language sql` granted to `authenticated` with no admin check → any logged-in user could read internal admin/QC/curation data. Converted to `plpgsql` + canonical admin guard; signatures/return contracts preserved (no client change). `list_clap_recommendations` required explicit `::text`/`::numeric` casts to satisfy its declared return contract against Test's integer columns — contract unchanged.
- **6 writes verbatim** — already admin-guarded, actor = `auth.uid()`; no settlement/AI/playlist logic altered.
- **Grants fail-closed:** `revoke all from public`, **no anon execute** on any of the 15 functions; internal helpers carry **no client grant**; `service_role` dropped (a no-op behind the `auth.uid()` guard). Recovered tables get `authenticated` SELECT only (RLS enforces admin/self); no anon, no direct write grants (writes go through DEFINER functions).

## Certification (Test, synthetic, auto-rolled-back)
- Anonymous → **13/13 blocked**; non-admin authenticated → **13/13 blocked** (over-exposure fix confirmed).
- Admin readers → **7/7 succeed**; admin write error paths → `track_not_found`, `confirmation_required`, `not_found`, `threshold must be 0-100`, `energy_level must be 1-5` — all correct.
- Ownership (RLS on `artist_lifetime_streams`): user sees only own row; admin sees all; anon denied (no grant).

## Regression
`lint:rpc` (**0 undefined**, down from 13), `lint:migrations`, `typecheck`, `eslint`, `vitest` (85), `build` — all PASS. Clusters A/B/C intact.

## Final recovery status
- **Tables: 5/5** (+ 2 dependency tables + 2 playlists columns recovered).
- **RPCs: 31/31.** Undefined **0**. PUBLIC execute 0. anon admin access 0. Admin-guard-missing 0. SECURITY DEFINER search_path-missing 0.

## Verdict
`FULL_TEST_SCHEMA_CERTIFIED`. Production unchanged; apply staged for a dedicated later phase (`18-production-apply-plan.md`).
