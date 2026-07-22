# 05 — Device Binding QA

## Status: BLOCKED / NOT RUN (no Test-bound preview; player backend absent from Test)

## Runbook (on a Test-bound preview)
- First store-code entry → server verify → binding created → auto-enter player.
- Verify (DevTools): plaintext store code NOT in localStorage / sessionStorage / URL / console / analytics; stored value is an opaque token only.
- Refresh / tab-restart / **full browser restart** → auto-enter WITHOUT re-entering the code, only after `verify_brand_device_binding` succeeds (server-verified, not storage-only).
- Confirm same brand + same store; queue intact; no duplicate audio; heartbeat resumes.

Note: the binding SECURITY logic (owner/revoke/expiry/cross-user/cross-brand/anon) was already server-certified on Test in BRAND-DEVICE-BINDING-1 (18/18, synthetic). This doc is the BROWSER-level end-to-end flow, which remains BLOCKED.
