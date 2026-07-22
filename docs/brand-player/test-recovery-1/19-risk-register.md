# 19 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status |
|---|---|---|---|
| TR1-R1 | `_brand_generate_playlist` on Test is a functional-parity simplification (omits audio-features/AI-metadata scoring) | **P1** | Acceptable for QA (returns valid playable queue, same contract). Production keeps its full algorithm. |
| TR1-R2 | verify_store_code / get_brand_player_config Production hardening (2-arg overload drop + guard) deferred to a Production-apply phase | **P1** | Test-only this phase. Overload/guard notes in 06/17. |
| TR1-R3 | enterprise_accounts / brand_accounts on Test are minimal vs Production | **P2** | Sufficient for the runtime contract; documented. |
| TR1-R4 | IP-based rate limiting not implemented (auth.uid()-only) | **P2** | RPC is authenticated-only; auth.uid() keying sufficient for now. |
| TR1-R5 | Synthetic media/audio are public test fixtures (external hosts) | **P2** | Fine for Test QA; no PII/secrets. |

No P0. No Production write; no Production data copied; no secret/token/store-code/PII in docs.
