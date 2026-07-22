# 15 — Application Integration Test Matrix

## Preview → Supabase binding
Live Preview browser integration was **not executed** (no confirmed Preview→Test binding available in this environment; per phase rule, integration is skipped and the reason recorded rather than run against an unverified/Production-bound Preview). Correctness is established at the contract layer.

| Path | Component | Basis |
|---|---|---|
| Admin track detail / list | ContentManagement, adminTrackApi | RPCs exist on Test, signatures/returns match TS interfaces; contract tests PASS |
| Metadata edit / AI-correction log | adminTrackApi | params match; `_log_ai_correction` recovered; PASS |
| Hard delete / purge / bulk delete | ContentManagement | error paths verified (`track_not_found`, `confirmation_required`); PASS |
| CLAP curation overview / recs / auto-approved | ClapRecommendationPanel, clapCurationApi | RPCs exist; return shapes match; casts fix type contract; PASS |
| Rollback / set auto-attach | ClapRecommendationPanel | error paths verified; PASS |
| Empty / permission / network error | all | admin guard → thrown error; empty-state defaults present |
| PGRST202 | all 13 | Eliminated on Test — all defined; `lint:rpc` 0 undefined |
| Console PII/payload leak | all | readers omit raw payloads/actors; nothing sensitive logged |

## PGRST202 resolution
Before recovery all 13 were Production-only → Preview/Test calls returned `PGRST202`. With `0460`/`0461` on Test, all 13 resolve. `adminTrackApi.ts` / `clapCurationApi.ts` TS interfaces align with recovered return columns (typecheck PASS).

## Follow-up
Live admin-panel walkthrough deferred until a Test-bound Preview is available (tracked in `19-risk-register.md`).
