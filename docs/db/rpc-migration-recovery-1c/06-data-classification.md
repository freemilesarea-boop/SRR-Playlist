# 06 — Prediction Data Classification

## User-visible
**None.** No user/track-owner reader exists by design. Predictions are internal operations metadata applied to global track fields; end users only ever see the *applied* result on `tracks` (energy_level/bpm/tempo_feel), never the prediction rows.

## Admin-only (returned by admin readers)
- Processing status (`applied_at` null vs set → pending/applied counts).
- Predicted labels: `predicted_energy_level`, `predicted_bpm`, `predicted_tempo_feel`.
- Confidence scalars: `energy_confidence` (and aggregate `avg_energy_confidence`, `high_conf_pending`).
- `model_version`, `created_at`.
- Joined track display fields (title, artist, cover_url, genres, current energy/bpm/tempo) for the review UI.

## Sensitive — stored but NOT returned by any reader
- `energy_label_scores` (jsonb raw label distribution).
- `prediction_scores` (jsonb raw model output).
- `applied_by` (audit actor uuid).
- `bpm_confidence`, per-facet confidences, and the genre/mood/store/daypart prediction arrays — retained for future admin tooling but excluded from the current reader return.

## Rationale
The readers deliberately project a **minimal column set**: labels + confidence + status, no raw payload, no actor, no storage/model-internal path. There is no PII and no monetary data in this table. Direct table reads are admin-only via RLS. This satisfies "user return minimizes raw prediction/ops info" (trivially — there is no user return) and "admin return minimizes unnecessary sensitive fields."
