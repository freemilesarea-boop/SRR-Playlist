# 16 — Application Integration Test Matrix

## Preview → Supabase binding
Live Preview browser integration was **not executed** in this phase (no confirmed Preview→Test binding available in this environment; per phase rule, integration testing is skipped and the reason recorded rather than run against an unverified/Production-bound Preview). Instead, integration correctness is established at the contract layer:

| Path | Component | Basis of verification |
|---|---|---|
| Admin prediction list | `TrackAiMetadataPanel` (`listPendingAiPredictions`) | RPC exists on Test with matching signature; return shape matches `PendingAiPrediction` interface; contract test PASS |
| Admin summary/status | `TrackAiMetadataPanel` (`aiPredictionsSummary`) | Return matches `AiPredictionsSummary`; empty-state default present |
| Admin apply (single) | `TrackAiMetadataPanel` (`applyTrackAiPredictions`) | Params match RPC; error → throw → toast; contract test PASS |
| Admin bulk apply | `TrackAiMetadataPanel` + `ContentManagement` (`bulkApplyHighConfidence`) | Params/return (number) match; contract test PASS |
| Permission error | all | admin guard → `unauthorized` surfaces as thrown error |
| Empty state | list/summary | 0 rows / zeros default — no crash |
| PGRST202 (undefined RPC) | all | Eliminated on Test — all 4 now defined; `lint:rpc` shows 0 new undefined |
| Console payload/PII leak | all | Readers return no jsonb payload/actor; nothing sensitive to log |

## PGRST202 resolution
Before recovery these 4 RPCs were Production-only → Preview/Test calls would return `PGRST202` (function not found). With `0459` applied to Test, Test/Preview can now resolve all 4. Type contracts in `trackAiPredictionsApi.ts` align with the recovered return columns.

## Follow-up
When a Test-bound Preview deployment is available, run the live admin-panel walkthrough (list → apply → bulk → empty/permission states) to close the browser-level integration gap. Tracked in `19-risk-register.md`.
