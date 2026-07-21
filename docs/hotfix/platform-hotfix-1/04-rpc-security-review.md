# 04 — RPC Security Review

> No RPC created or modified. Review is of the *call sites* + forward requirements for reconciliation.

## This phase (no SQL authored)
- **SECURITY DEFINER:** none added (no functions written).
- **`GRANT EXECUTE TO authenticated`:** none applied.
- **search_path:** n/a (no functions written).

## Requirements for the reconciliation phase (when these RPCs are committed)
For each of the 31, before committing a migration:
- Confirm exact input signature + return type from the remote definition (`pg_get_functiondef`, admin-only).
- Prefer NOT SECURITY DEFINER; if required, document why + `SET search_path = public` + schema-qualify all objects + restrict `EXECUTE` to the minimal role (not blanket `authenticated`).
- **Writes** (`create_support_inquiry`, `admin_update_*`, `apply_*`, `bulk_*`, `*_delete_*`, `set_playlist_auto_attach`, `rollback_*`): verify actor role check, IDOR protection (scope to caller/target), idempotency, transaction + audit log, and (for destructive `admin_hard_delete_track` / `admin_purge_all_tracks` / `bulk_delete_severe_mismatches`) explicit confirm + super-admin gate.
- **Reads:** pagination/limit, role-based column restriction, PII masking (support inquiries may contain user contact info), stable ordering.

## PII note
`support_inquiries` and admin-track/user RPCs may return contact info → reconciliation must confirm RLS/role scoping and masking. Not verifiable here (no remote/DB access).
