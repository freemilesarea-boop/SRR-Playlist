# 01 — Platform Architecture

> PLATFORM-AUDIT-1 · READ-ONLY · commit `0f3bb57`.

## Stack
- **Frontend:** React 18 + TypeScript 5.6 + Vite 5, react-router-dom 6 (`src/App.tsx` `<Routes>`), Zustand 5 state, Tailwind, Recharts, dnd-kit, PWA (vite-plugin-pwa, `src/sw.ts`). 443 ts/tsx files, 40 page components.
- **Backend:** Supabase (Postgres + Auth + Storage + Edge Functions + RPC). 419 migrations (`0001`–`0456`), ~205 tables, ~1,356 function statements (distinct far fewer), 89 triggers, 336 RLS policies. 20 Supabase edge functions + 3 Vercel serverless (`api/`).
- **Auth:** Supabase Auth — email/password + Google OAuth (PKCE, auto code-exchange via `detectSessionInUrl`) + optional Kakao (toggle). Profile provisioning by DB trigger `on_auth_user_created`.
- **Storage:** 7 buckets — `audio`, `covers`, `brand-assets`, `brand-media`, `enterprise-announcements` (public), `enterprise-documents`, `enterprise-contracts` (private).
- **Deployment:** Vercel (single project `srr-playlist` serving `deudda.com`/`www.deudda.com` + per-PR previews). Cron via `vercel.json` (daily-metrics, enterprise-ops).
- **Monitoring:** Sentry (prod-only, DSN-gated, masks PII). No PostHog/GA/Mixpanel.
- **Payments:** PayApp (Korean PG) — recurring billing via edge functions + idempotent webhook. Only PG present.
- **Email:** Resend (all transactional). **Ops alerts:** Slack incoming webhook (URL in `admin_settings`).
- **Push:** Web Push / VAPID (`send-push` edge fn, service-role-only).
- **Audio:** client-side FFmpeg.wasm transcode + WebWorker DSP (loudness/features); off-platform Python (Modal GPU) for CLAP embeddings + QC-v2 DSP.

## Layers
```
Browser (React SPA, PWA)
 ├─ Routing: App.tsx (RequireAuth / RequireAdmin + in-page soft role gates)
 ├─ State: Zustand stores (authStore, toastStore, themeStore, …)
 ├─ Data access: src/lib/*Api.ts → supabase.rpc()/from()  (710 distinct RPC names)
 ├─ Player: components/player/Player.tsx (2970 LOC) + hooks/useAudio*  (HTMLAudioElement)
 └─ Audio analysis: WebWorker (loudness/features), FFmpeg.wasm transcode
        │
        ▼  HTTPS (25s timeout wrapper)
Supabase
 ├─ Auth (email + Google OAuth PKCE + Kakao toggle) → trigger handle_new_user()
 ├─ Postgres: ~205 tables, RLS (self-scope) + SECURITY DEFINER RPCs (admin writes)
 ├─ Storage: 7 buckets (signed URLs for private enterprise docs/contracts)
 ├─ Edge Functions (20): PayApp, Resend email, PDF gen, push, audio-health, releases
 └─ pg_cron (1 job: weekly weight-regression) + pg_net triggers (QC, embeddings)
        │
        ▼
External: PayApp (billing) · Resend (email) · Slack (alerts) · Sentry (errors) ·
          Web Push · Modal GPU (CLAP/DSP, off-platform, operator-driven) · Kakao (toggle)
Vercel: static host + serverless cron (api/cron/*, api/admin/*)
```

## Data flow (representative)
- **Signup/login:** LoginPage → `authStore` → Supabase Auth → DB trigger creates `users` row → `loadProfile` → account-state gate → route by `account_type`.
- **Upload:** ArtistDashboard → client FFmpeg transcode + WebWorker DSP (AUD-1/3) → quality gate (AUD-2) → `artistApi` upload to `audio`/`covers` buckets → `tracks` row → QC queue (pg_net → Modal) → admin review → release trigger → auto-placement (PLACE-1).
- **Store playback:** StorePlayerPage → store-code auth → playlist RPCs → `Player.tsx` (HTMLAudioElement) → heartbeat/reactions RPCs → `stream_events`.
- **Settlement:** admin generate RPC (`_settlement_compute`, dry_run) → `artist_settlements` → admin finalize/pay → audit log.
- **Billing:** PayApp webhook → `payapp-feedback` edge fn (idempotent) → `subscriptions`/`payment_orders` → Realtime → UI.

## Key dependencies & risks (detail in later docs)
- **Player.tsx** God component (2970 LOC) concentrates player state + leak surface.
- **CLAP ML** off-platform, operator-driven backfill (not automated).
- **29 client RPC calls** lack committed definitions (out-of-band or dead).
- **Single Vercel project** serves Production + previews → env-scope separation is the key operational safety question (see settlement preview-env phases).
