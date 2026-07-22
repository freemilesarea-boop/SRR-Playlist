# 17 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status |
|---|---|---|---|
| PQ2-R1 | Test project lacks the brand player backend (verify_store_code / get_brand_player_config / config subsystem absent) → end-to-end player flow cannot run on Test | **P1** | Open. Requires recovering the brand product subsystem to Test + synthetic seed (runbook in 03). |
| PQ2-R2 | Cannot set Vercel Preview env to the Test pair / cannot deploy safely → risk of preview hitting Production host | **P1** | Open. No deploy attempted (avoids the P0 Production-host trigger). Operator must set Test env (runbook in 02). |
| PQ2-R3 | Real Chrome/Safari/Edge + long-run cannot be executed here | **P1** | Open. Runbooks provided (04-14); nothing marked PASS. |
| PQ2-R4 | verify_store_code rate-limit still open (from prior phase) | **P2** | Carried; documented in device-binding-1/09. |

No P0 observed (no Production connection, no secret/token exposure — because no runtime QA was run).

## Compliance held
No Production DB connection; no deploy; no Test DB mutation; no secret/token/store-code output; Test/Production isolation certified; no existing test deleted or weakened.
