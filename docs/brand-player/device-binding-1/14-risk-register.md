# 14 — Risk Register (P0/P1/P2)

| ID | Risk | Severity | Status / Mitigation |
|---|---|---|---|
| DB1-R1 | `verify_store_code` has no rate-limit / brute-force defense | **P1** | Documented (`09`); not silently passed. Recommend attempt-throttling in a follow-up. Binding hardening is independent and complete. |
| DB1-R2 | `get_brand_player_config` / `verify_store_code` not yet hardened (owner check / `expires_at` on create) | **P1** | Their subsystems are absent from Test; blind-rewrite avoided. Auto-entry security enforced by `verify_brand_device_binding` + hardened `brand_player_heartbeat` (identical checks). Guard-prepend staged for Production-apply after inspecting live bodies. |
| DB1-R3 | Client auth-flow not yet browser-certified | **P2** | Pure logic unit-tested (15); page wiring is conservative (fail-closed, loop-guarded). Real-browser QA is the next phase. |
| DB1-R4 | Device token stored in localStorage | **P2** | Opaque, hashed server-side, revocable, owner-bound, expiring; never trusted alone (server re-verify on entry). Cleared on logout/revoke/expiry/invalid. No plaintext code, no Supabase token copy. |
| DB1-R5 | Test brand schema is a minimal bootstrap (not full Production parity) | **P2** | Sufficient for binding certification; Production keeps its full schema (create-if-not-exists is a no-op there). |

## Compliance held
- No Production DB change; no Production deploy; Test identity proven before any write; Production accessed read-only (metadata, no rows).
- No plaintext store code stored; no token/hash/secret/UUID in logs, URLs, or analytics.
- No Service Role usage; no anon grant; RPCs `authenticated`-only + `SECURITY DEFINER` + `search_path` pinned.
- Cross-user and cross-brand blocked; revoked/expired auto-recovery blocked (fail-closed).
- No audio/queue/scheduler/crossfade/heartbeat/analytics/recovery change; no existing test deleted or weakened.
