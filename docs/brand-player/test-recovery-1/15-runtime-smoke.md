# 15 — Runtime Smoke Certification (Test, synthetic, rolled back)

Method: `DO` block on Test — `session_replication_role=replica` (bypass FK for transient sessions), JWT impersonation via `request.jwt.claims`, sentinel `raise` → full rollback. Persistent seed remains; runtime rows rolled back.

## Results — 19/19 PASS
| # | Check | Result |
|---|---|---|
| 1 | anon verify_store_code | PASS (not_authenticated) |
| 2 | anon get_config | PASS (unauthorized) |
| 3 | userA first-code → success + brand + token | PASS |
| 4 | wrong code → invalid_code | PASS |
| 5 | verify_brand_device_binding ok | PASS |
| 6 | get_config brand | PASS |
| 7 | playlist ≥10 | PASS (15) |
| 8 | media = 4 | PASS |
| 9 | signage fade | PASS |
| 10 | heartbeat success | PASS |
| 11 | cross-brand (uA token on brand B) | PASS (invalid session) |
| 12 | cross-user binding (uB uses uA token) | PASS (not_owner) |
| 13 | cross-user config | PASS (invalid session) |
| 14 | revoke | PASS |
| 15 | config post-revoke | PASS (invalid session) |
| 16 | heartbeat post-revoke | PASS (false) |
| 17 | expired config | PASS (session expired) |
| 18 | expired binding | PASS (expired) |
| 19 | rate-limit (6th) | PASS (rate_limited) |

Covers the phase §22 flow (first code / wrong / other-user / other-brand / anon / binding / config / playlist / media / heartbeat / revoke / expiry / rate-limit) and §23 cross-user/cross-brand.
