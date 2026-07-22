# 13 — Data Exposure Tests

Verified structurally (explicit return column lists — no `select *`) plus the synthetic run.

## User return
**N/A** — no user-facing RPC. The only user-readable surface is `artist_lifetime_streams` self-read, which exposes only that artist's own aggregate counts (no other user's data, no internal ops fields).

## Admin reader return — NOT exposed
- Raw AI payloads (`track_ai_predictions.prediction_scores`, `energy_label_scores`) — not selected.
- `ai_metadata_corrections` internals beyond the aggregate (individual admin_value/artist_value rows) — `ai_correction_stats` returns aggregates only.
- Storage/model input paths, prompts, signed-URL info — not columns / not selected (except `admin_hard_delete_track` which returns storage refs **to the admin** for post-delete cleanup — by design, admin-only).
- Other users' ids, retry counts, operational flags — not present/selected.

## Admin reader return — intentionally exposed (operational)
Track detail/list fields, QC mismatch reasons, CLAP scores + statuses, curation counts, auto-attach config. All admin-scoped.

## Error surface
Fixed tokens only (`unauthorized`, `track_not_found`, `not_found`, `not_auto_approved`, `confirmation_required`, `threshold must be 0-100`, `energy_level must be 1-5`, `bpm must be 0-400`) — no row data / PII / payload in messages.

No real data used; assertions are structural + synthetic.
