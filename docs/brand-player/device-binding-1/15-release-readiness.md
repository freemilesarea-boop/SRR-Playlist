# 15 — Release Readiness

## Completion checklist (§25)
- [x] Test environment confirmed / Production isolated
- [x] Migration `0454` reviewed
- [x] Test DB migration applied
- [x] `user_id = auth.uid()` enforced (verify + heartbeat)
- [x] Revocation supported
- [x] Expiration enforced
- [x] Binding server re-verification
- [x] Anonymous access blocked
- [x] Cross-user access blocked
- [x] Cross-brand access blocked
- [x] Store code plaintext never stored
- [x] Persistent binding storage (localStorage, opaque, reverified)
- [x] Browser-restart auto-connect structure (auto-entry + entry re-verify)
- [x] Access state machine (single pure resolver)
- [x] Loading flicker prevented
- [x] Brand logout (clears bindings)
- [x] Logout blocks auto-entry
- [x] This device disconnect (self-revoke)
- [x] Store switch
- [x] Expiry handling / revocation handling (fail-closed)
- [x] No playback engine / queue / scheduler / crossfade change
- [x] Typecheck / ESLint / Unit 127 / Build PASS; Migration lint PASS
- [ ] `verify_store_code` rate-limit — **P1 open** (`09`/`14`)
- [ ] `get_brand_player_config` / `verify_store_code` guard-prepend — staged for Production-apply (`02`/`04`)
- [ ] Preview deploy + real-browser QA — **next phase**
- [x] No Production DB change / secret / PII output

## Changed files
- `supabase/migrations/0454_brand_device_binding_hardening.sql` (applied to Test)
- `src/lib/brandDeviceBinding.ts` (new) + `.test.ts` (new)
- `src/lib/brandSession.ts` (persistent binding + migration + clear-all)
- `src/lib/api/brandPlayerApi.ts` (binding RPC wrappers)
- `src/store/authStore.ts` (logout clears bindings)
- `src/pages/BrandPlayerPage.tsx` (entry re-verify + disconnect + switch)
- `src/pages/BrandPage.tsx` (guarded auto-entry + notices)
- `docs/brand-player/device-binding-1/*`

## Verdict
`READY_FOR_PREVIEW_QA` — server hardening applied + certified on Test; client implemented + unit-tested; Production untouched. Open items (rate-limit P1, config/verify guard-prepend, browser QA) are documented for the next phases.
