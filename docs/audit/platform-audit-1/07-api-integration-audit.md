# 07 — API / RPC / Edge Functions / External Integrations / Env

> PLATFORM-AUDIT-1 · READ-ONLY · commit `0f3bb57`. Secret **names** only.

## A. Vercel serverless (`api/`, runtime edge)
| File | Method | Auth | Role | Purpose | External |
|---|---|---|---|---|---|
| `api/cron/daily-metrics.ts` | GET | `CRON_SECRET` Bearer — **optional (only enforced if set)** | cron | Expire trials, trial reminders, compute daily_metrics | edge `dispatch-trial-reminders` |
| `api/cron/enterprise-ops.ts` | GET | `CRON_SECRET` **required** (500 if unset, 401 mismatch) | cron | 15-min: policy automation, billing overdue, NOC sync, dispatch | edge `dispatch-admin-notifications` |
| `api/admin/enterprise-ops-run.ts` | POST | user token→`getUser`→`role='admin'` + 60s debounce | admin | Proxy that attaches `CRON_SECRET` server-side | self-call cron |
Cron (`vercel.json`): daily-metrics `0 1 * * *` (10:00 KST), enterprise-ops `*/15 * * * *`.
- **API-F1 (P2, security):** `daily-metrics` runs **unauthenticated if `CRON_SECRET` unset**, yet calls service_role RPCs (`expire_free_trials`, `admin_compute_daily_metrics`). Contrast `enterprise-ops` which hard-fails. Enforce the secret.

## B. Supabase edge functions (20)
No `[functions]` block in `config.toml` → `verify_jwt` not declared in-repo; each fn self-authenticates. Summary:
- **Payment (PayApp):** `create-payapp-subscription`, `cancel-payapp-subscription`, `payapp-feedback` (webhook, 4-field verify + idempotent via `event_key`), `sync-payapp-payments`, `get-my-subscription`.
- **Email (Resend):** `dispatch-admin-notifications` (+Slack), `dispatch-contract-emails`, `dispatch-moderation-emails`, `dispatch-trial-reminders`, `dispatch-enterprise-billing-invoice`, `notify-new-inquiry`, `notify-inquiry-reply`.
- **Enterprise:** `generate-enterprise-billing-pdf` (→Storage), `generate-enterprise-intel-report` (PDF bytes).
- **Ops/content:** `check-audio-health` (HEAD audio URLs), `process-scheduled-releases`, `admin-apply-analytics-db` (**direct Postgres DDL apply**, admin-gated), `admin-trigger-password-reset`.
- **Push:** `send-push` (web-push/VAPID; **service_role-only** auth).
- **Stub:** `dispatch-kakao-message` — **returns 501** (not built).

## C. Client RPC surface
- **710 distinct** `supabase.rpc('…')` names called from `src`; **949** `CREATE FUNCTION` defs across SQL.
- **API-F2 (P1):** **29 RPC names called from `src` with NO `CREATE FUNCTION` in committed migrations** — clustered: site-notices (`admin_list_site_notices`, `list_active_site_notices`, `get_site_settings`, …), support-inquiries (`create_support_inquiry`, `admin_list_support_inquiries`, …), AI-predictions (`ai_predictions_summary`, `apply_track_ai_predictions`, …), CLAP (`list_clap_recommendations`, `rollback_clap_auto_attach`, …), track-admin (`admin_hard_delete_track`, `admin_purge_all_tracks`, `get_admin_track_detail`). Siblings exist in `0284`/`0304`/`0221` but not these names → **applied to the DB out-of-band or dead calls**; genuinely-absent ones fail at runtime (`PGRST202`). **Requires live-DB verification** — mark `UNVERIFIED` until confirmed present on the deployed DB.
- **270 defined but never called from `src`:** 147 `_`-prefixed internal/trigger helpers (expected), 123 non-underscore of which many are server-only (cron/edge/trigger) and some are dead-endpoint candidates (`admin_backfill_audio_features`, `admin_list_store_aliases`, `admin_list_worker_secret_keys`, …). See `12-dead-deprecated-candidates.md`.
- Caveat: grep catches only string-literal RPC names; dynamically-composed names inflate both lists.

## D. External integrations
| Service | Purpose | Env var names | Side | Failure/fallback |
|---|---|---|---|---|
| **Supabase** | DB/Auth/Storage/Edge/RPC | VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (client); SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (server) | both | config guard + 25s fetch timeout |
| **Vercel** | host + cron | CRON_SECRET, APP_URL, VERCEL_URL | server | per-task try/catch |
| **PayApp** (only PG) | subscriptions/rebill; webhook | PAYAPP_USERID, PAYAPP_LINKKEY, PAYAPP_LINKVAL, PAYAPP_API_URL, … | server | 4-field verify; idempotent; webhook = source of truth |
| **Resend** | all transactional email | RESEND_API_KEY, RESEND_FROM | server | key unset → skip/mark `failed`, never blocks |
| **Slack** | ops alerts | webhook URL in **`admin_settings`** (DB, not env) | server | empty → skip |
| **Sentry** | prod error tracking | VITE_SENTRY_DSN, VITE_APP_ENV | client | inits only if DSN+PROD; masks keys/emails |
| **Web Push/VAPID** | push | VITE_VAPID_PUBLIC_KEY (client); VAPID_PUBLIC_KEY/PRIVATE_KEY/SUBJECT (server) | both | UI hides push if key absent |
| **Kakao** | login toggle + share; messaging stub | VITE_KAKAO_JS_KEY, VITE_KAKAO_CHANNEL_PUBLIC_ID, VITE_ENABLE_KAKAO_LOGIN (client); KAKAO_REST_API_KEY, KAKAO_ADMIN_KEY (server) | both | login behind toggle; messaging 501 |
| **FFmpeg.wasm** | client audio transcode | — (self-hosted `public/ffmpeg/`) | client | no CDN; throws if local asset missing |
| **GitHub Actions** | CI lints + DB provision test | CI secrets | CI | — |
| **Postgres direct** | DDL apply | ANALYTICS_DB_URL/POSTGRES_URL/DATABASE_URL | server | admin-gated, fixed SQL |

**Not present (checked):** No Cloudflare/R2/S3/AWS; no Stripe/Toss/PortOne/IamPort (`toss` hits are in-app-browser/identity detection); no PostHog/Mixpanel/GA.

## E. Environment variables (values NOT printed)
Full matrix in `13-remediation-roadmap.md` inputs / `environment-registry.json`. Key flags:
- **API-F3 (P3):** `VITE_APP_VERSION` used (`useStoreHeartbeat.ts`) but **missing from `.env.example`**.
- **API-F4 (P3):** `src/lib/supabase.ts:20` unconditional `console.log('[SupabaseEnv]', {url, projectRef, anonKeySet})` — prints project URL/ref in production browser console (anon key value not printed, only boolean). Vite strips `console.log` only when `NODE_ENV==='production'` at build — verify.
- **Secret hygiene GOOD:** no true secret carries a `VITE_` prefix (anon key, VAPID *public* key, Kakao *JS* key, Sentry DSN are public-by-design). Private VAPID/Kakao REST/Admin keys, service-role, Resend, PayApp keys are server-only.
- `scripts/check-env.mjs` validates only the two client-critical vars (URL format, anon key length≥40, demo-audio warning, anon REST probe). Does not check server secrets or `VITE_APP_VERSION`.

## Findings summary
- **API-F1 (P2):** `daily-metrics` cron auth optional → unauthenticated service_role execution possible.
- **API-F2 (P1):** 29 client RPC calls with no committed definition — runtime `PGRST202` risk; `UNVERIFIED` against live DB.
- **API-F3 (P3):** `VITE_APP_VERSION` undocumented.
- **API-F4 (P3):** production env console.log of project URL/ref.
