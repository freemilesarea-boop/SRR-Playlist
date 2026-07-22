# 14 — Data Exposure Tests

Objective: confirm no raw/internal fields leak through the RPC return surface. Verified by inspecting each function's explicit return column list (Test) — no `select *`, no jsonb payload projection.

## User return
**N/A** — no user-facing reader exists. End users never receive prediction rows; they only see applied results on `tracks`.

## Admin return — fields NOT exposed
| Sensitive field | Exposed by summary? | Exposed by list_pending? |
|---|---|---|
| Raw prediction payload (`prediction_scores` jsonb) | no | no |
| Raw label scores (`energy_label_scores` jsonb) | no | no |
| Internal/model debug fields | no | no |
| Prompt / model input path / storage path | no (column doesn't exist) | no |
| Internal model metadata beyond `model_version` label | no | no |
| Other user id | no | no |
| Audit actor (`applied_by`) | no | no |
| Retry count / operational flags | no (no such column) | no |

## Admin return — fields intentionally exposed (minimal, operational)
- `summary`: total/pending/applied counts, avg energy confidence, high-confidence pending count.
- `list_pending`: prediction id, track id, track display fields (title/artist/cover/genre), current vs predicted energy/bpm/tempo, energy confidence, model_version, created_at.

## Error surface
Errors are fixed tokens (`unauthorized`, `prediction_not_found`, `already_applied`, `track_not_found`) — no row data, payload, or PII embedded in exception messages.

No real prediction data was used; assertions are structural (column list) plus the synthetic functional run in `13-sql-security-tests.md`.
