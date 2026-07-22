# 20 — Final Readiness

## Completion checklist
- [x] Branch `claude/rpc-migration-recovery-1de-final` from `86e9225`; working tree clean at start
- [x] Test/Production isolation confirmed
- [x] 13 remaining RPC inventory (Cluster D 8, Cluster E 5)
- [x] Cluster D recovered (`0460`) + Cluster E recovered (`0461`)
- [x] Transitive deps recovered (2 tables, 2 helpers, 2 playlists columns)
- [x] Admin reader guard added (7); admin write guard verified (6)
- [x] Ownership guard (`artist_lifetime_streams` self_read) verified
- [x] Sensitive return minimized; raw payloads/actors not exposed
- [x] SECURITY DEFINER reviewed (all KEEP + safety checklist)
- [x] PUBLIC execute removed; anon execute none; authenticated minimized w/ guard
- [x] Test-only migration apply; all 15 functions + 2 tables + 2 columns verified
- [x] Anonymous blocked 13/13; non-admin blocked 13/13; admin access 7/7; write error paths correct
- [x] Raw-payload exposure blocked
- [x] RPC contract tests 13/13
- [x] RPC registry: undefined 13 → 0; allowlist empty
- [x] Typecheck / ESLint / Unit(85) / Build / Migration lint / RPC guard — PASS
- [x] Cluster A/B/C regression — PASS
- [ ] Live Preview integration — DEFERRED (no Test-bound Preview)
- [ ] Production apply — DEFERRED (`RPC-PRODUCTION-APPLY-1`)
- [x] Production unchanged; Production apply plan written

## Final recovery status
- **Tables: 5/5** (+ 2 dependency tables + 2 `playlists` columns)
- **RPCs: 31/31**
- **Undefined RPC: 0**
- **PUBLIC execute: 0** · **anon admin access: 0** · **Admin-guard-missing: 0** · **Ownership-guard-missing: 0** · **DEFINER search_path-missing: 0**

## Verdict
`FULL_TEST_SCHEMA_CERTIFIED`. Production untouched. Recommended next phase: **`RPC-PRODUCTION-APPLY-1`** (apply all clusters' staged reader security corrections + grant tightening to Production in one reviewed window).
