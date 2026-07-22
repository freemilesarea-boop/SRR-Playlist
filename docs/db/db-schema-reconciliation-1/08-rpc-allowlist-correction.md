# 08 — RPC Allowlist Correction

> Machine-readable: `rpc-allowlist-corrections.json`. No code change this phase (docs-only).

## Current
`scripts/rpc-remote-only-allowlist.json` — 31 entries (PLATFORM-HOTFIX-1).

## Decision
- **KEEP all 31 temporarily.** All are confirmed **PRESENT_PRODUCTION** → production runtime works (not a live PGRST202 in prod); the allowlist correctly reflects "called + no local def".
- **Not indefinite:** each entry is now tied to **RPC-MIGRATION-RECOVERY**. When a function's migration lands (local definition exists), `lint:rpc` will no longer flag it — remove it from the allowlist at that point (the guard reports "stale allowlist entries" to prompt this).
- **Remove now:** none. **Block now:** none (no ABSENT_BOTH, no security-blocker severe enough to disable a live prod function via lint).
- **Priority within recovery:** the 10 over-exposed readers (security fix).

## Recommended (for recovery phase, not applied now)
Add an expiry/owner pointer to the allowlist JSON (e.g. `"followup": "RPC-MIGRATION-RECOVERY"`) so entries don't linger silently.
