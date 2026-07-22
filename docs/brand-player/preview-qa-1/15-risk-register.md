# 15 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status / Mitigation |
|---|---|---|---|
| PQ1-R1 | `get_brand_player_config` doesn't enforce `user_id = auth.uid()` | **P1** | Real gap in the current server path. The client token is **kept in sessionStorage (not persisted)** this phase to avoid a regression; the strict `verify_brand_device_binding` RPC is designed, and the config RPC must be patched on Test before any localStorage persistence ships. |
| PQ1-R2 | No revocation / expiry enforcement on bindings | **P1** | Additive columns + strict re-verify + self-revoke RPC designed in `0454` (not yet applied). Fail-closed on revoked/expired. |
| PQ1-R3 | Certification pipeline (Test apply, RLS cert, Preview, browser, long-run) not runnable here | **P1** | Reported BLOCKED with precise operator runbooks (`09`, `11`, `12`, `13`). Nothing marked PASS that wasn't run. |
| PQ1-R4 | `verify_store_code` has no evident rate-limit / brute-force defense | **P2** | Noted; recommend attempt throttling in the hardening phase. Codes resolve only within the caller's enterprise, limiting blast radius. |
| PQ1-R5 | Shipping a persistent auth/binding change without browser certification | **P2** | Avoided — client rewire deliberately not shipped; migration committed but not applied. Work stays on a feature branch, un-deployed. |

## Compliance held this phase
- No plaintext store code stored anywhere; no token/secret/UUID in logs, URLs, analytics.
- No Service Role usage; no anon privilege grant; additive RPCs `authenticated`-only, `SECURITY DEFINER` + `search_path` pinned.
- No Production DB change, no Production secret change, no Production deploy; no Preview pointed at Production.
- No existing test deleted or weakened; existing auth/admin/store-player logic untouched.
