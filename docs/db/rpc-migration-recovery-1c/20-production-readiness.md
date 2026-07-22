# 20 — Production Readiness

## Completion checklist
- [x] Separate branch (`claude/rpc-migration-recovery-1c-track-ai`) from base `a4aba42`
- [x] Test/Production isolation confirmed
- [x] Cluster A regression: none
- [x] Cluster B regression: none
- [x] Cluster C object inventory accurate (1 table, 4 RPCs)
- [x] Production metadata-only access; no prediction/track/user/PII row read; no RPC executed on Production
- [x] Table definition captured exactly (22 cols, FK, unique, indexes, RLS)
- [x] RPC definitions captured exactly (signatures/returns preserved)
- [x] Call-site analysis (all admin; no client identity)
- [x] Data classification (admin-only; raw payload never returned)
- [x] Track ownership / subject isolation (admin-vs-all; no user reader)
- [x] Admin reader guard added (2 readers)
- [x] Admin write guard present (2 writes)
- [x] SECURITY DEFINER reviewed (all KEEP + safety checklist)
- [x] PUBLIC execute removed; anon execute none; authenticated minimized w/ internal guard
- [x] RLS enabled + policy verified
- [x] Migration applied to **Test only**; Prediction table + 4 RPCs created & verified
- [x] Anonymous blocked; Non-admin blocked; Admin access works
- [x] Raw payload exposure blocked
- [x] RPC contract tests
- [x] RPC registry updated (17 → 13 undefined; 0 new)
- [x] Typecheck / Lint / Unit(85) / Build / Migration lint / RPC guard — PASS
- [ ] Live Preview browser integration (deferred — see `16`/`19`)
- [ ] Production apply (deferred to post-D/E combined phase — see `18`)

## Recovery progress
- Tables recovered: **5/5**.
- RPCs recovered: **18/31**; undefined **13** remaining (Clusters D–E).

## Verdict
**Cluster C: recovered and Test-certified. Production untouched.** Ready to proceed to Cluster D recovery. Production security correction for the 2 readers is staged and will ship in the dedicated Production apply phase after D/E.
