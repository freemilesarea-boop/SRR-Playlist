# 20 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status |
|---|---|---|---|
| RR2-R1 | No Vercel env-var control / no linked project → cannot bind Preview to Test here | **P1** | Open. Operator sets Preview env (03) + deploys (04). |
| RR2-R2 | Real Chrome-matrix / Safari / Edge / true browser-restart / 30min+ long-run not runnable here | **P1** | Open. Runbooks 06-17; nothing marked PASS. |
| RR2-R3 | QA user browser-login password not set (must not be stored/reported) | **P2** | Operator sets on Test dashboard (02). |
| RR2-R4 | Production hardening of verify_store_code/get_brand_player_config still pending (from recovery phase) | **P1** | Test-only; staged for a Production-apply phase. |

No P0 observed (no deploy, no Production connection, no secret/token exposure — no runtime run).

## Compliance held
No Production DB connection; no deploy; no Test DB mutation; no secret/token/store-code/password output; Test/Production isolation certified; no existing test deleted/weakened; playback engine untouched.
