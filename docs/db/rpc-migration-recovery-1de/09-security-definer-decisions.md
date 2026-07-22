# 09 — SECURITY DEFINER Decisions

All 15 functions: **KEEP_SECURITY_DEFINER**.

| Reason | Functions |
|---|---|
| Admin aggregation/read above RLS, guarded | 7 readers |
| Admin write to shared objects, guarded | 6 writes |
| Internal helper invoked in definer context | `_log_ai_correction`, `snapshot_artist_lifetime_streams` |

## Why not INVOKER
No user reader exists; every function legitimately acts above RLS as an admin operation or an internal helper. INVOKER would break cross-row aggregation and the write paths and diverge from Production. The one user-facing surface (`artist_lifetime_streams` self-read) is a **table with RLS**, not a function, so it needs no DEFINER function at all.

## DEFINER safety checklist (all 15)
- `SET search_path = public` ✔ (verified on Test for all 15)
- Schema-qualified objects (`public.…`) ✔
- Authentication check ✔ (13 client fns; `snapshot_*` guarded; `_log_ai_correction` internal-only, no grant)
- Admin/ownership authorization before data access ✔
- Explicit input validation ✔ (energy/bpm/threshold/confirm token)
- Explicit return columns ✔ (no `select *` to client)
- No dynamic SQL ✔
- Minimal grants ✔ (revoke public, no anon, helpers ungranted, service_role dropped)
- No PII/payload in error messages ✔ (fixed tokens only)
