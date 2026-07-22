# 16 — RPC Registry Finalization

## Change
Removed the last 13 RPCs from `scripts/rpc-remote-only-allowlist.json` → **`allow: []`** (empty). All 13 now resolve to local `CREATE FUNCTION` definitions in `0460`/`0461`.

## `lint:rpc` result
```
RPC registry: 725 call-names, 979 local defs, 0 undefined (0 allowlisted).
✓ rpc registry lint passed — no new undefined RPC calls.
```
- Undefined RPCs: 13 → **0** ✔
- New undefined: 0 ✔
- Duplicate RPC: 0 ✔
- Signature drift: 0 ✔
- Allowlist: empty array (no remaining intended exceptions) ✔
- Cluster A/B/C regression: unchanged (still defined) ✔

## Migration lint
```
scanned 421 migration files … ✓ migration lint passed — 0 violations, 0 new duplicate prefix
```
`0460`/`0461` introduce no duplicate prefix.

## Cumulative
Undefined RPC across the whole recovery program: **31 → 0**. Allowlist fully drained.
