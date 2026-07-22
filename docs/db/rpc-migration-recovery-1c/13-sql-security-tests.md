# 13 — SQL Security Tests (synthetic, auto-rolled-back)

All tests ran inside a `DO` block on Test: `set local session_replication_role = replica` (bypass FK to `auth.users`), synthetic admin/user/track/prediction rows, JWT impersonation via `set_config('request.jwt.claims', …)`, and a terminal `raise exception` sentinel so the **entire transaction rolls back** — no synthetic data persists. Only synthetic values (no real audio, prediction, or PII).

## Results
| Role | RPC | Expected | Result |
|---|---|---|---|
| Anonymous (`{}` claims) | ai_predictions_summary | blocked | **PASS** (`unauthorized`) |
| Anonymous | list_pending_ai_predictions | blocked | **PASS** (`unauthorized`) |
| Anonymous | apply_track_ai_predictions | blocked | **PASS** (`unauthorized`) |
| Anonymous | bulk_apply_high_confidence | blocked | **PASS** (`unauthorized`) |
| Non-admin user | ai_predictions_summary | blocked | **PASS** (`unauthorized`) — over-exposure fixed |
| Non-admin user | list_pending_ai_predictions | blocked | **PASS** (`unauthorized`) — over-exposure fixed |
| Non-admin user | apply_track_ai_predictions | blocked | **PASS** (`unauthorized`) |
| Non-admin user | bulk_apply_high_confidence | blocked | **PASS** (`unauthorized`) |
| Admin | ai_predictions_summary | rows | **PASS** (total returned) |
| Admin | list_pending_ai_predictions | rows | **PASS** (pending row returned) |
| Admin | apply (invalid uuid) | `prediction_not_found` | **PASS** |
| Admin | apply (already-applied) | `already_applied` | **PASS** |
| Admin | apply (valid) | track updated + stamped | **PASS** (energy=4, bpm=128, tempo=fast, applied_by=admin) |
| Admin | bulk_apply_high_confidence | count applied | **PASS** (applied=2) |

## Direct table access
Non-admin/anon SELECT on `track_ai_predictions` is blocked by the `track_ai_predictions_admin_read` RLS policy (admin-only). No table grant to anon/authenticated.

## Notes on synthetic data validity
Initial runs surfaced two real domain constraints (`tracks_energy_level_check` 1–5, `tracks_tempo_feel_check` ∈ {slow,medium,fast}); the suite was re-run with conforming values. These were **test-data** corrections, not RPC-logic failures — the apply/bulk logic behaved correctly once inputs were valid.
