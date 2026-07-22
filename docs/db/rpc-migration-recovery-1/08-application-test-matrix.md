# 08 — Application Test Matrix

| Feature | Unit | SQL | Integration | Preview | Result | Evidence |
|---|---|---|---|---|---|---|
| RPC registry guard (7 recovered, 24 allowlisted) | ✅ | — | — | — | PASS | `lint:rpc` |
| Migration lint (0457) | ✅ | — | — | — | PASS | `lint:migrations` |
| Cluster A schema on Test | — | ✅ | — | — | PASS | Test metadata verify |
| Cluster A security guard | — | ✅ | — | — | PASS | Test `do $$` test |
| typecheck / vitest / (build) | ✅ | — | — | — | PASS | tsc, vitest 85 |
| Cluster A app calls (siteNoticesApi/siteSettingsApi) | — | — | ☐ | ☐ | UNVERIFIED | needs Preview + Test-bound app |
| Clusters B–E | — | ☐ | ☐ | ☐ | NOT RUN | not applied |

Application integration (frontend → RPC) UNVERIFIED — requires the app pointed at the Test DB (Preview env), not available headlessly. Contract is verified at the SQL layer (signatures match the client wrappers).
