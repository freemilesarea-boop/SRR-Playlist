# 09 — Write / Status Mutation Review

Two write RPCs, both admin-only, both recovered verbatim (no AI-logic change).

## `apply_track_ai_predictions(uuid, bool×4)`
| Control | Status |
|---|---|
| Caller kind | Admin only — `unauthorized` guard first |
| Track ownership | N/A (global admin-moderated tracks) |
| Admin role | Checked via `public.users.role='admin'` |
| Actor | `auth.uid()` (server-side); no client actor param |
| Allowed columns | Only `tracks.energy_level/bpm/tempo_feel` + prediction `applied_at/applied_by` |
| Duplicate / idempotency | `already_applied` guard on `applied_at is not null` → re-apply is a no-op error |
| Overwrite condition | `p_overwrite_existing` gate; otherwise only fills null track fields |
| Not-found handling | `prediction_not_found`, `track_not_found` |
| Transaction | Single statement-level tx (function body); partial failure rolls back |
| Model result overwrite | Applies **stored** prediction only; never recomputes |

## `bulk_apply_high_confidence_ai_predictions(numeric, int)`
| Control | Status |
|---|---|
| Caller kind | Admin only — `unauthorized` guard first |
| Admin role | Checked |
| Actor | `auth.uid()` |
| Selection | pending + `energy_confidence >= threshold` + approved/non-removed track; ordered desc; `limit p_limit` |
| Idempotency | `coalesce`-fill (never overwrites non-null track fields); already-applied rows excluded by `applied_at is null` filter |
| Audit | stamps `applied_at`, `applied_by` per row |
| Return | count of applied rows |
| Transaction | Function body tx; loop is atomic within the call |

## Not present
No retry-count / review-status / moderation-status mutation RPC in Cluster C. No service-role writer. Client-supplied actor id: none accepted.
