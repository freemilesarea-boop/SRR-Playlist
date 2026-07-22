# 05 — Application Call-site Analysis

Wrapper module: `src/lib/trackAiPredictionsApi.ts`. All consumers are admin-only components.

| RPC | Wrapper fn | Call site | Caller role | Params | Return | Client user_id/actor_id? |
|---|---|---|---|---|---|---|
| `list_pending_ai_predictions` | `listPendingAiPredictions(limit=50)` | `TrackAiMetadataPanel.tsx:41` | Admin | `{p_limit}` | `PendingAiPrediction[]` | No |
| `ai_predictions_summary` | `aiPredictionsSummary()` | `TrackAiMetadataPanel.tsx:42,64` | Admin | none | `AiPredictionsSummary` (data[0]) | No |
| `apply_track_ai_predictions` | `applyTrackAiPredictions(id, opts)` | `TrackAiMetadataPanel.tsx:58` | Admin | `{p_prediction_id, p_apply_*}` | void | No |
| `bulk_apply_high_confidence_ai_predictions` | `bulkApplyHighConfidence(t, limit)` | `TrackAiMetadataPanel.tsx:76`, `ContentManagement.tsx:285` | Admin | `{p_confidence_threshold, p_limit}` | number | No |

## Findings
- **No user / track-owner call site.** Both components live under `src/components/admin/` and are reached only from admin surfaces. There is no consumer that reads a prediction for a track owner.
- **No client-supplied identity.** No call passes `user_id` or `actor_id`; the server derives actor from `auth.uid()`. Client-trust risk = none.
- **Error handling:** every wrapper does `if (error) throw error;` → surfaced to the admin panel's catch/toast. `aiPredictionsSummary` also has an empty-state default (`data?.[0] ?? {…zeros}`).
- **Service worker / cron:** none. No background caller.

## Contract decision
**Keep existing signatures** for all 4. The security fix (admin guard on the 2 readers) is invisible to the client because the return columns are unchanged and the caller is already admin. No wrapper RPC, no user/admin split, no client edit needed.
