# 13 — Application Test Matrix
| Feature | Unit | SQL | Integration | Preview | Result | Evidence |
|---|---|---|---|---|---|---|
| RPC registry (7 recovered, 17 allowlisted) | ✅ | — | — | — | PASS | lint:rpc |
| Migration lint (0458) | ✅ | — | — | — | PASS | lint:migrations |
| Cluster B schema on Test | — | ✅ | — | — | PASS | metadata verify |
| Ownership + admin security | — | ✅ | — | — | PASS | 10-assert suite |
| tsc / eslint / vitest / build | ✅ | — | — | — | PASS | 85 tests, build |
| Cluster A regression | ✅ | — | — | — | PASS | lint:rpc (A still local) |
| Frontend supportInquiryApi calls | — | — | ☐ | ☐ | UNVERIFIED | needs Preview bound to Test DB |

App integration (frontend→RPC) UNVERIFIED — requires the app pointed at Test (Preview), unavailable headlessly. SQL-layer contract verified (signatures match wrappers).
