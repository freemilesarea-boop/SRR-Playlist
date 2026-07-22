# RPC-MIGRATION-RECOVERY-1B — Executive Summary (Cluster B: Support Inquiries)

> Branch `claude/rpc-migration-recovery-1b-support` from `0515c69`. Read-only Production metadata; migration applied to **Test only**; **0 Production changes**. No Production RPC executed, no user data/PII read, no full source in reports. Cluster A/C/D/E unchanged.

## Result — Cluster B COMPLETE + VERIFIED on Test
- **2 tables recovered:** `support_inquiries` (25 cols, 5 checks, 4 FKs ON DELETE SET NULL, 4 indexes) + `support_inquiry_attachments` (FK CASCADE) → created on Test with RLS + policies.
- **7 RPCs recovered** (verbatim, exact Production signatures): `create_support_inquiry`, `list_my_inquiries`, `get_my_inquiry_detail` (user, `auth.uid()` ownership), `admin_list_support_inquiries`, `admin_get_support_inquiry_detail`, `admin_support_inquiry_summary`, `admin_update_inquiry` (admin-guarded).
- **Security fixes needed: 0** — all 7 were already correctly designed in Production (owner from `auth.uid()`, never client-supplied; admin functions have `users.role='admin'` guard). Recovered verbatim; grants hardened (revoke PUBLIC, **no anon**, authenticated + internal check).

## Functional security verified on Test (synthetic users, rolled back)
| Actor | Assertion | Result |
|---|---|---|
| Anonymous | create + admin_list | **blocked** (unauthorized) |
| User A | create → owner = `auth.uid()`; `list_my` = 1; admin_list blocked | ✅ |
| **User B** | read User A's inquiry → **not_found**; own list empty | ✅ (cross-user isolation) |
| Admin | list sees inquiry; update ok; invalid id → not_found | ✅ |

## Ownership / PII
Owner never trusted from client input (no `user_id`/`profile_id`/email param). RLS `self-or-admin` on both tables; attachments scoped via parent inquiry. No cross-user PII leak. **P3 observation:** `admin_note`/`assigned_admin_id` are returned on the caller's **own** inquiry (Production contract; `admin_note` likely the user-facing reply) — no cross-user exposure; left verbatim to preserve the client contract.

## Verification
migration-lint PASS (418 files) · **rpc-registry: 24→17 undefined (−7), 0 new, PASS** · tsc PASS · eslint PASS · vitest 85/85 · vite build PASS · Cluster A regression intact.

## Registry
7 Cluster B RPCs removed from remote-only allowlist (now local defs via 0458). Remaining allowlisted: 17 (clusters C/D/E).

## Verdict / next
**CLUSTER_B_READY_FOR_PRODUCTION_APPLY** (Test-verified). Next: **RPC-MIGRATION-RECOVERY-1C** (track AI predictions), continuing to D/E, then RPC-PRODUCTION-APPLY.
