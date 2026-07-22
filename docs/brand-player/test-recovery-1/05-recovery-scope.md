# 05 — Recovery Scope

## Recovered (required for Preview QA)
Store-code verify, brand ownership, device binding, player config, media, signage, music policy, synthetic playlist, heartbeat, RLS, RPC grants, synthetic auth user + seed.

## Deferred (ops-only; P1/P2 risk, not required for QA)
Admin management UI, real settlement/contract data, full store management, long-term analytics, full operational audit, real media storage replication, Production playlist/store-code copy, Production recommendation-ML depth (track_audio_features/track_ai_metadata scoring). Recorded in `19-risk-register.md`.

Full Production schema deliberately NOT copied.
