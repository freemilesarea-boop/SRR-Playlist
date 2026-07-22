# 04 — RPC Recovery

All 4 recovered in `0459`. Signatures/return contracts preserved for every RPC.

## `ai_predictions_summary()` → `table(total_predictions int, pending_count int, applied_count int, avg_energy_confidence numeric, high_conf_pending int)`
- **Change:** `language sql` → `plpgsql`; prepended admin guard (`raise exception 'unauthorized'` if caller not admin). `stable security definer set search_path=public`.
- Body: counts total/pending/applied, avg energy confidence, and pending rows with `energy_confidence >= 0.6`. No AI computation.

## `list_pending_ai_predictions(p_limit integer default 50)` → `table(16)`
- **Change:** `language sql` → `plpgsql` + admin guard. Signature/return unchanged.
- Body: joins `track_ai_predictions` (applied_at is null) to `tracks` (visibility_status='approved', removed_at is null); returns current + predicted energy/bpm/tempo, confidence, model_version, created_at; ordered by confidence desc nulls last, created_at desc; `limit p_limit`.
- **Minimal return:** no jsonb payloads (`prediction_scores`, `energy_label_scores`), no `applied_by`, no storage/model-internal fields.

## `apply_track_ai_predictions(p_prediction_id uuid, p_apply_energy boolean default true, p_apply_bpm boolean default true, p_apply_tempo_feel boolean default true, p_overwrite_existing boolean default false)` → `void`
- **Verbatim** (already admin-guarded). Flow: admin guard → load prediction (`prediction_not_found`) → guard `already_applied` → load track (`track_not_found`) → conditionally set track energy/bpm/tempo (respecting `p_apply_*` and `p_overwrite_existing`/null-only) → stamp `applied_at=now()`, `applied_by=auth.uid()`. No AI logic; applies stored values only.

## `bulk_apply_high_confidence_ai_predictions(p_confidence_threshold numeric default 0.6, p_limit integer default 500)` → `integer`
- **Verbatim** (already admin-guarded). Flow: admin guard → loop pending predictions with `energy_confidence >= threshold` on approved/non-removed tracks, confidence desc, limit → `coalesce`-fill track fields (never overwrite non-null) → stamp applied → count. Returns applied count.

## Overloads
None — each name has exactly one signature (verified on Test).
