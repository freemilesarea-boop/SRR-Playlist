# 10 — Defect & Risk Register

> PLATFORM-AUDIT-1 · READ-ONLY. Severity P0..P4; Confidence Confirmed/Strong/Suspected/Unverified. **No fix applied this phase.**

| ID | Sev | Domain | Feature | Symptom | Root cause / evidence | Confidence | Recommended fix | Regression tests |
|---|---|---|---|---|---|---|---|---|
| R-01 | **P1** | Auth | AUTH-007 | Google login fails / loops on some origins | `redirectTo=window.location.origin` (`authStore.ts:254`) → each preview/apex-vs-www origin must be whitelisted in Supabase; external config unverifiable | Strong (code) / Unverified (external) | Pin `redirectTo` to `https://www.deudda.com/auth/callback` or whitelist all origins + `/**` | OAuth callback e2e per origin |
| R-02 | **P1** | Auth | AUTH-007 | New Google user stuck "가입 정보를 불러오지 못했어요" | Profile provisioning relies on DB trigger `on_auth_user_created`; if absent/failed on live DB, no `users` row | Suspected (Unverified live) | Verify trigger on live DB (`diagnose_signup_trigger.sql`); add client fallback insert | signup-trigger test |
| R-03 | **P1** | API/DB | SUPPORT-001 + admin | 29 client RPC calls have no committed definition → `PGRST202` at runtime | grep: called in `src`, 0 `CREATE FUNCTION` in migrations (site-notices, support-inquiries, AI-predictions, CLAP, track-admin) | Strong (code) | Reconcile: commit the missing migrations or remove dead calls; verify against live DB | RPC-existence CI check |
| R-04 | **P1** | Security | BRAND-005 | Confidential enterprise contracts may have been publicly readable | `enterprise-contracts` bucket shipped public in `0383`, locked in `0394` | Confirmed (migration diff) | Audit access logs for the public window; rotate any leaked signed paths | storage-policy test |
| R-05 | **P2** | Security/PII | AUTH-001 | Signup email + full payload logged to browser console every signup | `authStore.ts:226,239` unconditional `console.log` | **Confirmed** | Remove or `import.meta.env.DEV`-gate | lint rule no-console in auth |
| R-06 | **P2** | Ops/Security | OPS-001 | daily-metrics cron runs unauthenticated if `CRON_SECRET` unset, calls service_role RPCs | `api/cron/daily-metrics.ts` optional auth | Strong (code) | Hard-require `CRON_SECRET` like enterprise-ops | — |
| R-07 | **P2** | Security | DB (RLS) | Possible over-permissive RLS policies | 336 policies not line-verified; `0388` lockdown implies prior gap | Unverified | Line-by-line RLS review on money/PII tables | RLS pgTAP suite |
| R-08 | **P2** | Security | DB functions | 5 SECURITY DEFINER fns without `set search_path` (incl. recent `0374`) | grep | Strong (code) | Add `set search_path=public`; review `0374` | migration lint rule |
| R-09 | **P2** | Security | RT-F1 | `/my/playlist/:id` public (no RequireAuth) may leak private playlists | `App.tsx:271` unguarded vs guarded `/my/playlists` | Suspected | Confirm RLS scoping or add guard | route-guard test |
| R-10 | **P2** | Security | RT-F3/RM-F2 | Enterprise HQ routes rely only on RPC/RLS (no client role guard) | `App.tsx` enterprise routes login-only | Unverified | Verify server-side enforcement per RPC | enterprise-access test |
| R-11 | **P2** | Curation | PLACE-1/SCH-2/SCH-3 | Algorithms auto-mutate live catalog / deploy store policies without per-action confirm | `auto_place_track` release trigger; `cron_daily_playlist_refresh`; policy automation `dry_run=false` | Strong (code) | Add explicit confirm or keep observe-mode; audit toggles | algorithm dry-run tests |
| R-12 | **P2** | Stability | PLAYER-001 | Player.tsx God component (2970 LOC, 32 effects, 36 timers/listeners) = leak/regression risk | file metrics | Strong | Extract audio-lifecycle hooks (partly done) | player leak/e2e tests |
| R-13 | **P2** | Tests | all | Auth, OAuth, player, payment, admin, AI have zero automated tests | test inventory | Confirmed | Add unit/e2e for critical journeys | — |
| R-14 | **P2** | Deps | build | react-router moderate advisory (prod); vitest/vite/esbuild critical/high (dev only) | `npm audit` | Confirmed | Patch react-router; bump Vite/Vitest | — |
| R-15 | **P2** | Auth | AUTH-005 | No self-service password reset for users | reset only via admin edge fn | Confirmed | Add public reset flow | — |
| R-16 | **P2** | Algorithm | LRN-8 | Regression weight optimizer statistically invalid (independent per-sub-score regressions) | agent finding | Strong | Statistician review; keep approval-gated | — |
| R-17 | P3 | Hygiene | RT-F2 | No 404 page — wildcard silently redirects home, hides broken links | `App.tsx:281` | Confirmed | Add NotFound page | — |
| R-18 | P3 | Env | API-F3 | `VITE_APP_VERSION` used but not in `.env.example` | grep | Confirmed | Document var | — |
| R-19 | P3 | Security | API-F4 | Production console.log of Supabase project URL/ref | `supabase.ts:20` | Strong | Gate behind DEV | — |
| R-20 | P3 | DB | DB-F4/F5 | Dead/orphan tables + `0421-0451` migration-number void | migration scan | Strong | Confirm rollout state; plan cleanup (DB-CLEANUP phase) | — |
| R-21 | P3 | Algorithm | ALG-F3 | CLAP ML ingestion not automated (`embed_backend_url` empty) → stale/absent embeddings; AI boost=0 | code | Strong | Wire embedding cron or document manual SOP | — |
| R-22 | P3 | Hooks | CH-F1 | 54 `react-hooks/exhaustive-deps` suppressions = stale-closure surface | grep | Strong | Audit high-risk effects (Player) | — |
| R-23 | P4 | Curation | ML-2 | CLAP classifier self-documented overfitting (happy 59%, boutique 100% skew), unversioned prompts | code comments | Strong | MIR/ML expert review; version prompts | — |

## Severity tally
- **P0:** 0 confirmed. *(No P0 reproduced — but R-01..R-04 are P1 items that could escalate to P0 in production; runtime unverifiable here.)*
- **P1:** 4 (R-01 OAuth redirect, R-02 profile trigger, R-03 undefined RPCs, R-04 contract exposure window)
- **P2:** 12 (R-05..R-16)
- **P3:** 6 (R-17..R-22)
- **P4:** 1 (R-23)

## Most dangerous features (ranked)
1. **Google OAuth** (R-01/R-02) — highest user-facing failure probability; external-config dependent.
2. **Undefined RPC surface** (R-03) — 29 calls may 500 at runtime.
3. **Enterprise contract storage** (R-04) — confirmed past public window.
4. **Auto-mutating curation** (R-11) — silent catalog/policy changes.
5. **Player.tsx** (R-12) — stability of the core 24/7 playback path.
