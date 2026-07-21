# 02 — Full Feature Registry

> PLATFORM-AUDIT-1 · READ-ONLY · commit `0f3bb57`. Status per phase taxonomy (PASS/PARTIAL/FAIL/UNVERIFIED/DEAD/DUPLICATE/DEPRECATED/NOT_IMPLEMENTED).
> **Verification caveat:** No authenticated browser session or live DB was available. Almost all runtime behaviour is `UNVERIFIED` (code present + wired = "code-PASS", but live execution not observed). Only what was executed this phase (static build/lint/tests) is `PASS`.

## Legend
- **code-PASS** = implementation + wiring present and type/lint/test-clean, but not runtime-verified → recorded as `UNVERIFIED (code present)` where user-facing.
- `PASS` reserved for artifacts actually executed this phase.

## Registry (by domain)
| Feature ID | Domain | Feature | Role | Route/UI | Backend | DB/Storage | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| AUTH-001 | Auth | Email signup | public | LoginPage, auth/* forms | `authStore.signUp` | `users` +trigger | UNVERIFIED(code) | `authStore.ts:227`; PII log CH-F2 |
| AUTH-002 | Auth | Email login | public | LoginPage | `signInWithPassword` | `users` | UNVERIFIED(code) | `authStore.ts:215` |
| AUTH-003 | Auth | Logout | member | AppShell | `signOut` | — | UNVERIFIED(code) | `authStore.ts:273` |
| AUTH-004 | Auth | Email verify + resend | public | LoginPage | `resend` | auth | UNVERIFIED(code) | `authStore.ts:286` |
| AUTH-005 | Auth | Password reset request | member | — (admin-only) | edge `admin-trigger-password-reset` | auth | **PARTIAL** | no self-service (AUTH-F1) |
| AUTH-006 | Auth | Password change | member | AuthResetPasswordPage | `updateUser` | auth | UNVERIFIED(code) | raw error (AUTH-R5) |
| AUTH-007 | Auth | Google OAuth | public | LoginPage | `signInWithOAuth` + callback | trigger | UNVERIFIED(external config) | see 05; top failure = redirect whitelist |
| AUTH-008 | Auth | Kakao login (toggle) | public | LoginPage | Supabase provider | auth | UNVERIFIED(toggle) | `kakao.ts` gated |
| AUTH-009 | Auth | Session refresh / expiry | member | — | `onAuthStateChange` | — | UNVERIFIED(code) | `authStore.ts:102` |
| AUTH-010 | Auth | Account-state gate (withdrawn/disabled) | member | App shell screens | profile decision | `users` | UNVERIFIED(code) | `App.tsx:170-221` |
| USER-001 | Account | Profile view/edit | member | ProfilePage | profile RPCs | `users` | UNVERIFIED(code) | — |
| USER-002 | Account | Withdrawal / soft-delete | member | ProfilePage | RPC | `users` | UNVERIFIED(code) | — |
| USER-003 | Account | Admin role/state change | admin | AdminPage member tab | admin RPCs | `users`, `admin_users` | UNVERIFIED(code) | RBAC 0192 |
| ARTIST-001 | Artist | Artist apply/approve | member→artist | ArtistDashboard, admin | RPCs | `artist_profiles` | UNVERIFIED(code) | soft-gate |
| ARTIST-002 | Artist | Invite/sales code | artist | signup | `applyPendingSignup` | `artist_invite_codes` | UNVERIFIED(code) | — |
| ARTIST-003 | Artist | Contract + signature | artist | ArtistContractPage | contract RPCs, edge email | `artist_contracts` | UNVERIFIED(code) | — |
| ARTIST-004 | Artist | Payout account (PII/bank) | artist | ArtistDashboard | payout RPCs | `artist_payout_accounts` (RLS) | UNVERIFIED(code) | reveal-logged |
| TRACK-001 | Music | Track upload (audio/cover) | artist | ArtistDashboard/Batch | `artistApi`, buckets | `tracks`, `audio`/`covers` | UNVERIFIED(code) | FFmpeg client |
| TRACK-002 | Music | Quality gate (AUD-2) | artist | upload | `qualityGate` | `audio_quality` | UNVERIFIED(code) | blocking |
| TRACK-003 | Music | Dedupe (audio_sha256/fingerprint) | artist/admin | upload/admin | `_audio_fingerprint_similarity` | `audio_fingerprints` | UNVERIFIED(code) | ML-4 |
| TRACK-004 | Music | QC pipeline (auto + admin) | admin | admin QC tabs | pg_net→Modal, RPCs | `audio_qc_reports` | UNVERIFIED(code) | AUD-5 |
| TRACK-005 | Music | Admin review (approve/reject/rereview) | admin | TrackReviewList | admin RPCs | `track_moderation_events` | UNVERIFIED(code) | email dispatch |
| TRACK-006 | Music | Scheduled release | admin | admin | edge `process-scheduled-releases` | `tracks` | UNVERIFIED(code) | cron/secret |
| PLAYER-001 | Playback | Store player | store | StorePlayerPage | playlist RPCs | `stream_events` | UNVERIFIED(code) | Player.tsx God |
| PLAYER-002 | Playback | Brand player (audio/video/signage) | brand | BrandPlayerPage | brand RPCs, `brand-media` | `brand_*` | UNVERIFIED(code) | e2e specs (non-run) |
| PLAYER-003 | Playback | Heartbeat/liveness | store | player | `useStoreHeartbeat` | `store_monitoring_status` | UNVERIFIED(code) | VITE_APP_VERSION |
| PLAYER-004 | Playback | Reactions (👍/👎) | store | player | `upsert_store_track_reaction` | `store_track_reactions` | UNVERIFIED(code) | LRN-11 |
| PLAYER-005 | Playback | Scheduler (time-of-day swap) | store | player | `useBusinessAutoSwitch` | `business_music_schedules` | UNVERIFIED(code) | SCH-1 |
| PLAYLIST-001 | Playlist | CRUD + public/private | member | MyPlaylists/Playlist | playlist RPCs | `playlists` | UNVERIFIED(code) | RT-F1 (public detail) |
| PLAYLIST-002 | Playlist | Auto-placement | system | (release trigger) | `auto_place_track` | `playlist_tracks` | UNVERIFIED(code) | PLACE-1 auto-mutate |
| PLAYLIST-003 | Playlist | Daily refresh (cron) | system | — | `cron_daily_playlist_refresh` | `playlists` | UNVERIFIED(code) | SCH-2 auto-mutate |
| PLAYLIST-004 | Recommend | Personalized/cold-start/collab | member | Home | REC-1/2/3 RPCs | events | UNVERIFIED(code) | SS, no ML |
| PLAYLIST-005 | Curation | CLAP recommendations | admin | admin | ML-5 RPCs | `track_embeddings` | UNVERIFIED(code) | ML off-platform |
| PLAYLIST-006 | Curation | Fit-score engine | admin | admin | FIT-1..8 | `playlist_track_fit_scores` | UNVERIFIED(code) | SS |
| PLAYLIST-007 | Curation | Guardrails / genre policy | system/admin | admin | GRD-1..10 | `store_guardrails` | UNVERIFIED(code) | mostly review_needed |
| BRAND-001 | Brand | Brand/HQ accounts + policies | brand HQ | enterprise/* | enterprise RPCs | `enterprise_*`, `franchise_*` | UNVERIFIED(code) | RT-F3 (no client guard) |
| BRAND-002 | Brand | Media (image/video/signage) | brand | BrandPage | `brand-media` bucket | `brand_media_assets` | UNVERIFIED(code) | 0453 video |
| BRAND-003 | Brand | Announcements/emergency broadcast | brand HQ | enterprise | SCH-4, RPCs | `enterprise_announcements` | UNVERIFIED(code) | — |
| BRAND-004 | Brand | Billing (invoice/PDF/email) | super admin | admin | edge PDF+email | `enterprise_billing_*` | UNVERIFIED(code) | Resend |
| BRAND-005 | Brand | Contracts | super admin | admin | edge email | `enterprise_contracts` (private) | UNVERIFIED(code) | DB-F3 past-public |
| BRAND-006 | Brand | Fleet/NOC monitoring | admin | admin | RPCs | `noc_*`, `store_monitoring_status` | UNVERIFIED(code) | — |
| SETTLEMENT-001 | Settlement | Generate/version/finalize | settlement admin | admin | `admin_generate_monthly_settlement` | `artist_settlements` | code-PASS (tests) | SET-1; dry_run |
| SETTLEMENT-002 | Settlement | Carryover (tax-safe split) | settlement admin | admin/drawer | `0454/0455` | settlement cols | code-PASS (tests) | 129 tests |
| SETTLEMENT-003 | Settlement | Detail/summary/CSV/timeline | settlement admin | ArtistSettlements* | display RPC 0456 | — | code-PASS (tests) | UX-2D |
| SETTLEMENT-004 | Settlement | Artist settlement view | artist | ArtistSettlementsPage | `get_my_settlements` | `artist_settlements` | UNVERIFIED(code) | RLS |
| SETTLEMENT-005 | Settlement | Settlement V2 (shadow) | — | superOnly tab | v2 RPCs | `*_v2` (0 src refs) | **DEAD/shadow** | not wired |
| PAY-001 | Payment | Subscription create (PayApp) | member | Subscription | edge `create-payapp-subscription` | `subscriptions` | UNVERIFIED(code) | PG live |
| PAY-002 | Payment | Cancel/grace | member | Subscription | edge `cancel-payapp-subscription` | `subscriptions` | UNVERIFIED(code) | — |
| PAY-003 | Payment | Webhook (feedback) | webhook | — | edge `payapp-feedback` | `payapp_webhook_events` | UNVERIFIED(code) | idempotent |
| PAY-004 | Payment | Manual sync/import | admin | PaymentSyncTool | edge `sync-payapp-payments` | `payapp_*` | UNVERIFIED(code) | no list API |
| PAY-005 | Payment | Promotions / free trial | member | Subscription | RPCs | `promotion_codes`, free_trial | UNVERIFIED(code) | — |
| ADMIN-001 | Admin | Admin console (68 tabs, RBAC) | admin/super | AdminPage | admin RPCs | `admin_*` | UNVERIFIED(code) | RequireAdmin only |
| ADMIN-002 | Admin | Member/business/artist mgmt | admin | tabs | RPCs | multiple | UNVERIFIED(code) | — |
| ADMIN-003 | Admin | QC/content/audio-engine | admin/super | tabs | RPCs | qc tables | UNVERIFIED(code) | — |
| ADMIN-004 | Admin | AI operations / weights | admin | tabs | LRN-7/8 RPCs | ai_* | UNVERIFIED(code) | approval-gated |
| ADMIN-005 | Admin | Enterprise command/ops/settlement | super | tabs | RPCs | enterprise_* | UNVERIFIED(code) | superOnly |
| OPS-001 | Ops | Cron: daily-metrics | cron | api/cron | serverless | `daily_metrics` | UNVERIFIED(code) | API-F1 auth optional |
| OPS-002 | Ops | Cron: enterprise-ops (15min) | cron | api/cron | serverless | enterprise_* | UNVERIFIED(code) | secret required |
| OPS-003 | Ops | Cron: weekly weight-regression | cron | pg_cron | SQL | ai_weight_* | UNVERIFIED(code) | approval-gated |
| NOTIF-001 | Notify | Email (Resend) | system | — | dispatch-* edge | *_email_jobs | UNVERIFIED(code) | — |
| NOTIF-002 | Notify | Slack ops alerts | admin | — | dispatch-admin-notifications | admin_notifications | UNVERIFIED(code) | URL in admin_settings |
| NOTIF-003 | Notify | Web push | member | usePushSubscription | edge `send-push` | `push_subscriptions` | UNVERIFIED(code) | VAPID |
| NOTIF-004 | Notify | Kakao messaging | — | — | edge `dispatch-kakao-message` | — | **NOT_IMPLEMENTED** | returns 501 |
| PUBLIC-001 | Public | Landing/service/legal/support | public | HomePage, legal/* | — | — | UNVERIFIED(code) | no pricing/404/maint |
| SUPPORT-001 | Support | Inquiries | member/admin | SupportPage | RPCs (⚠ undefined) | `support_inquiries` | UNVERIFIED | API-F2 (RPC undefined) |

**Domain counts:** Auth 10 · Account 3 · Artist 4 · Music/Track 6 · Playback 5 · Playlist/Curation 7 · Brand/Enterprise 6 · Settlement 5 · Payment 5 · Admin 5 · Ops 3 · Notify 4 · Public 1 · Support 1 = **~65 top-level features** (excludes the 46 algorithms in `11-*` and 68 admin sub-tabs).

## Status tally (top-level features)
- `PASS` (executed this phase): 0 user-facing (settlement 001-003 are **code-PASS via 129 tests**, not runtime).
- `code-PASS/UNVERIFIED (code present, not runtime-verified)`: ~57
- `PARTIAL`: 2 (AUTH-005 no self-service reset; PUBLIC-001 missing pages)
- `NOT_IMPLEMENTED`: 1 (NOTIF-004 Kakao messaging 501)
- `DEAD/shadow`: 1 (SETTLEMENT-005 V2) + see `12-*` for code/DB dead candidates
- `FAIL`: 0 reproduced (no runtime access to reproduce)
- Under `UNVERIFIED` umbrella: AUTH-007 (external config), API-F2 (29 undefined RPCs), all live behaviour.
