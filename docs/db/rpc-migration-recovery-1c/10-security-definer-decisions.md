# 10 — SECURITY DEFINER Decisions

| RPC | Decision | Justification |
|---|---|---|
| `ai_predictions_summary` | **KEEP_SECURITY_DEFINER** | Aggregates across all predictions; needs to bypass the admin-only RLS policy for the admin caller. Guarded by explicit admin check. |
| `list_pending_ai_predictions` | **KEEP_SECURITY_DEFINER** | Joins predictions+tracks for the admin queue; DEFINER + explicit admin guard is the intended pattern. |
| `apply_track_ai_predictions` | **KEEP_SECURITY_DEFINER** | Writes to `tracks` on behalf of the admin operator; admin-guarded. |
| `bulk_apply_high_confidence_ai_predictions` | **KEEP_SECURITY_DEFINER** | Same as above, batched. |

## Why not SECURITY INVOKER
A user reader over RLS would be the case for INVOKER, but **no user reader exists** — all 4 are admin operations that legitimately act above RLS. Converting to INVOKER would break the admin aggregate/apply (the admin's own RLS SELECT policy would still pass, but the write path and cross-row aggregation are cleaner and match Production under DEFINER + guard).

## DEFINER safety checklist (all 4)
- `set search_path = public` ✔
- Schema-qualified objects (`public.…`) ✔
- Authentication check (`auth.uid()`) ✔
- Admin authorization check before data access ✔
- No dynamic SQL ✔
- Explicit input (typed params; numeric limit/threshold) ✔
- Explicit return columns (no `select *` leaking to client; table returns enumerate columns) ✔
- Minimal grants (revoke public, no anon, authenticated + internal guard) ✔
- No PII/payload in error messages (errors are fixed tokens: `unauthorized`, `prediction_not_found`, `already_applied`, `track_not_found`) ✔
