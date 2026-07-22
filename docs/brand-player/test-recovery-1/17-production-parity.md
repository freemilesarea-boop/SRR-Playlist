# 17 — Production Parity

| Object | Production | Test | Parity | Difference | Risk |
|---|---|---|---|---|---|
| enterprise_accounts | full | minimal (0454) | Functional | fewer columns (no manager_*/invite rotation) | P2 |
| brand_accounts | full | minimal (0454) | Functional | fewer columns (no code_hash/slug/logo_url) | P2 |
| brand_player_sessions | + 0454 cols | same + 0454 | Exact | — | — |
| brand_media_assets | full | recovered | Exact | — | — |
| brand_music_policies | full | recovered | Exact | — | — |
| brand_signage_settings | full | recovered | Exact | — | — |
| brand_audit_logs | full | recovered | Exact | — | — |
| _brand_signage_json | — | verbatim | Exact | — | — |
| _brand_audit | — | verbatim | Exact | — | — |
| _brand_generate_playlist | complex ML scoring | simplified | Functional | policy filter + basic scoring; omits audio-features/ai-metadata weighting | P1 |
| verify_store_code | 1-arg, no expiry/rate-limit | 2-arg hardened | Functional+ | adds expiry/device_label/rate-limit; overload note for prod-apply | P1 |
| get_brand_player_config | no user/revoke/expiry check | hardened | Functional+ | adds binding guard | P1 (prod-apply) |
| brand_player_heartbeat | token-only | hardened (0454) | Functional+ | binding guard | — |

Full Production schema was **not** copied. Deferred ops objects: admin UI, settlement, contracts, real storage, real recommendation ML depth.
