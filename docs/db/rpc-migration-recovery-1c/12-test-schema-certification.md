# 12 — Test Schema Certification

Applied `0459_track_ai_predictions_recover` to Test (`hao…qorr`). Verified via catalog.

## Table
| Check | Result |
|---|---|
| `track_ai_predictions` exists | ✔ |
| Column count | 22 ✔ |
| RLS enabled | ✔ (`relrowsecurity=true`) |
| Policies | 1 (`track_ai_predictions_admin_read`, SELECT) ✔ |
| Indexes | 8 (PK + unique + 6 named) ✔ |
| Unique (track_id, model_version) | present ✔ |
| FK track_id→tracks CASCADE, applied_by→users | present ✔ |

## RPCs
| RPC | Language | secdef | Identity args | Return |
|---|---|---|---|---|
| `ai_predictions_summary` | plpgsql | true | `()` | table(5) ✔ |
| `list_pending_ai_predictions` | plpgsql | true | `(p_limit integer)` | table(16) ✔ |
| `apply_track_ai_predictions` | plpgsql | true | `(p_prediction_id uuid, p_apply_energy boolean, p_apply_bpm boolean, p_apply_tempo_feel boolean, p_overwrite_existing boolean)` | void ✔ |
| `bulk_apply_high_confidence_ai_predictions` | plpgsql | true | `(p_confidence_threshold numeric, p_limit integer)` | integer ✔ |

- `search_path=public` on all 4 ✔.
- Execute grants: authenticated (+owner), **no anon** ✔.
- No unexpected overloads ✔.
- Admin reader guard present on both readers ✔.

## Repo / Test / Production comparison
- **Repo:** now defines table + 4 RPCs (`0459`).
- **Test:** matches repo (applied + verified).
- **Production:** table + 4 RPCs present; readers differ **intentionally** (Prod = sql/no-guard; Repo/Test = plpgsql/guarded). This intended delta is the security correction to be applied to Production in a later phase (`18-production-apply-plan.md`). Writes match Production 1:1.
