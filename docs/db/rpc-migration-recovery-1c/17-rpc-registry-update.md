# 17 — RPC Registry Update

## Change
Removed the 4 Cluster C RPCs from `scripts/rpc-remote-only-allowlist.json`:
- `ai_predictions_summary`
- `list_pending_ai_predictions`
- `apply_track_ai_predictions`
- `bulk_apply_high_confidence_ai_predictions`

They now resolve to local `CREATE FUNCTION` definitions in `0459`, so they no longer need allowlisting.

## Allowlist state
- Before: 17 entries (Clusters C–E).
- After: **13 entries** (Clusters D–E only).

## `lint:rpc` result
```
RPC registry: 725 call-names, 964 local defs, 13 undefined (13 allowlisted).
✓ rpc registry lint passed — no new undefined RPC calls.
```
- Undefined RPCs: 17 → **13** ✔
- New undefined: **0** ✔
- Cluster A regression: no change (still defined) ✔
- Cluster B regression: no change (still defined) ✔

## Migration lint
```
scanned 419 migration files … ✓ migration lint passed — 0 violations, 0 new duplicate prefix
```
`0459` introduces no duplicate prefix.
