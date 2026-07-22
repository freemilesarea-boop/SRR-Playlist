# 15 — RPC Contract Tests

Synthetic rows only; no model execution. Coverage per RPC:

## `ai_predictions_summary()`
| Case | Result |
|---|---|
| Function exists / signature `()` | ✔ |
| Unauthorized (anon, non-admin) | `unauthorized` ✔ |
| Normal (admin) | returns 1 aggregate row ✔ |
| Empty result | returns zeros row (count over empty set) ✔ |
| Return shape | table(5) as declared ✔ |

## `list_pending_ai_predictions(p_limit integer default 50)`
| Case | Result |
|---|---|
| Signature / optional param default | ✔ (default 50) |
| Unauthorized | `unauthorized` ✔ |
| Normal (admin) | pending rows ✔ |
| Empty result | 0 rows (no error) ✔ |
| Stable ordering | confidence desc nulls last, created_at desc ✔ |
| Pagination / limit | `limit p_limit` honored ✔ |
| Return shape | table(16) ✔ |

## `apply_track_ai_predictions(uuid, bool, bool, bool, bool)`
| Case | Result |
|---|---|
| Required param (prediction id) | ✔ |
| Optional params default true/false | ✔ |
| Invalid / missing uuid | `prediction_not_found` ✔ |
| Unauthorized | `unauthorized` ✔ |
| Duplicate (already applied) | `already_applied` ✔ |
| Normal | track updated + stamped ✔ |
| Transaction rollback on error | ✔ (function body atomic) |

## `bulk_apply_high_confidence_ai_predictions(numeric, integer)`
| Case | Result |
|---|---|
| Optional params default (0.6, 500) | ✔ |
| Unauthorized | `unauthorized` ✔ |
| Normal | returns applied count (2 in test) ✔ |
| Empty (no qualifying rows) | returns 0 ✔ |
| Idempotency (coalesce, applied filter) | ✔ |

All cases exercised in the synthetic suite (`13-sql-security-tests.md`); no overloads; no NULL-uuid crash (treated as not-found).
