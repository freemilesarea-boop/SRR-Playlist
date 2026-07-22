# RPC-MIGRATION-RECOVERY-1C — Executive Summary

> Branch `claude/rpc-migration-recovery-1c-track-ai` from Cluster B tip `a4aba42`.
> Migration `0459_track_ai_predictions_recover.sql` applied to **Test only** (`hao…qorr`).
> **0 Production changes.** No Production DB / migration / function / table / grant / RPC change; no Production prediction/track/user/PII row read; no AI model/algorithm/scoring/prompt/threshold change; no model re-run; no full function source or real prediction data printed.

## Scope
Cluster C — Track AI Predictions. Recovered the Production-only `track_ai_predictions` table and its 4 Production-only RPCs into a committed migration, hardened the 2 over-exposed admin readers, applied to Test, and certified with synthetic-data security tests. Cluster A/B/D/E untouched.

## What was recovered
- **1 table:** `public.track_ai_predictions` (22 columns, PK, FK→tracks CASCADE, FK→users, unique(track_id,model_version), 6 indexes, RLS + admin-read policy).
- **4 RPCs:**
  - `ai_predictions_summary()` → summary stats — **SECURITY FIXED** (Production was `language sql` + no admin check → converted to `plpgsql` + admin guard; signature/return preserved).
  - `list_pending_ai_predictions(p_limit int)` → pending queue — **SECURITY FIXED** (same over-exposure correction).
  - `apply_track_ai_predictions(uuid, bool, bool, bool, bool)` → void — recovered **verbatim** (already admin-guarded, actor = `auth.uid()`).
  - `bulk_apply_high_confidence_ai_predictions(numeric, int)` → int — recovered **verbatim** (already admin-guarded).

## Security outcome
- **P2 over-exposure (2 readers) fixed.** In Production both readers were `SECURITY DEFINER` granted to `authenticated` with no in-function admin check → any logged-in user could read internal AI-ops data. The Test recovery adds the canonical admin guard while keeping the exact signature and return contract (no client change).
- **No user/track-owner reader exists.** All 4 call sites are admin components; predictions are internal operational metadata applied to global tracks. Subject isolation is therefore admin-guard + RLS, not per-owner scoping. No client-supplied `user_id`/`actor_id` is trusted — actor is always `auth.uid()`.
- **Grants fail-closed:** `revoke all from public`, **no anon**, `authenticated` + internal admin guard on all 4.
- **Raw payload minimized:** the jsonb columns (`energy_label_scores`, `prediction_scores`) are stored but **never returned** by either reader — only labels/confidences/model_version surface.

## Certification (Test, synthetic, auto-rolled-back)
- Anonymous → all 4 blocked.
- Non-admin authenticated → all 4 blocked (**confirms the over-exposure fix**).
- Admin → summary + list succeed; `apply` with invalid id → `prediction_not_found`; already-applied → `already_applied`; valid apply updates track energy/bpm/tempo + stamps `applied_at`/`applied_by=admin`; bulk applies matching rows.

## Regression
`lint:rpc` (13 undefined, 0 new — down from 17), `lint:migrations`, `typecheck`, `eslint`, `vitest` (85), `build` — all PASS. Cluster A/B regression intact.

## Recovery progress
- Tables: **5/5** recovered (A:2, B:2, C:1).
- RPCs: **18/31** recovered (A:7, B:7, C:4). Undefined 17 → **13** (Clusters D–E remain).

## Verdict
**Cluster C recovered & Test-certified. Production unchanged.** Production apply deferred to a dedicated post-D/E phase (plan in `18-production-apply-plan.md`).
