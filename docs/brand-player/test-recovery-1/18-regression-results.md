# 18 — Regression Results

| Gate | Result |
|---|---|
| Migration lint | PASS (418 files, 0 violations) |
| Migration apply to Test (0455) | PASS |
| Schema verify (Test) | PASS (tables/functions/grants/RLS) |
| Dependency verify | PASS (generator returns 15) |
| RLS / RPC grants | PASS (no anon; helpers internal) |
| Runtime smoke (19/19) | PASS |
| Cross-user / cross-brand / revoked / expired / rate-limit | PASS |
| Typecheck | PASS |
| ESLint | PASS |
| Unit (existing baseline) | PASS — 127 |
| Production build | see build log (no client source changed) |

No existing test deleted or weakened. No client source changed (contract preserved). Playback engine untouched.
