# WEB-OBS-1 — Server Runtime Telemetry Pipeline & Persistent RUM

Persist the WEB-OPT-11 client RUM (session-only ring buffers) to a server sink so operators can
compare performance across users, stores, browsers, releases, and routes. This document is the
design + retention + operations reference. **No production apply / merge / deploy is performed in
this phase — Preview PR only.**

## 1. Architecture

```
Browser (WEB-OPT-11 collector)
  └─ collect.ts emits PII-free "raw emits" to an optional sink
      └─ transport.ts  (sampling · batching · beacon/keepalive · retry · offline)
          └─ POST /api/telemetry/runtime   (same-origin edge fn — validate · sanitize · rate-limit)
              └─ service-role RPC ingest_runtime_telemetry (dedup on event_id)
                  └─ public.runtime_telemetry_events   (RLS deny-all; super_admin read only)

Admin dashboard (super_admin)
  └─ supabase.rpc('admin_query_runtime_telemetry')  (security-definer, allow-list filters)
      └─ aggregates + bounded paginated page of sanitized rows
```

**Failure isolation.** Every layer fails open. The collector's emit is wrapped so a broken sink
cannot affect collection. The transport swallows all errors (no toast/alert/throw, single throttled
console warn). The edge function returns fast, coarse errors; the client treats any non-2xx as
"drop" — a telemetry failure is never a service failure. Boot is never blocked: the transport defers
all work to `requestIdleCallback`/timeout after first paint.

## 2. Event schema (single source of truth: `src/lib/telemetry/schema.ts`)

Discriminated union on `event_type` with a per-type `payload`. No `any`. The **same** `parseEnvelope`
runs on client (pre-send) and server (pre-insert) — "double sanitization". `parseEnvelope` REBUILDS
each event from an allow-list: unknown fields dropped, strings re-sanitized, enums collapsed to safe
defaults, numbers clamped.

| event_type   | payload fields                         | sample policy       | severity source                    |
|--------------|----------------------------------------|---------------------|------------------------------------|
| `error`      | kind, message (redacted)               | **never sampled**   | react/chunk = critical, else warn  |
| `route`      | duration (dwell ms)                    | 100%                | info                               |
| `vital`      | name, value, rating                    | 100%                | rating → info/warn/critical        |
| `api`        | name (host+path), kind, duration, transferKb | base rate     | ≥1000ms critical, ≥200ms warn      |
| `longtask`   | duration, startTime                    | base rate           | ≥1000ms critical, ≥200ms warn      |
| `interaction`| kind, duration                         | base rate           | ≥1000ms critical, ≥200ms warn      |
| `memory`     | usedMb, totalMb, limitMb               | base rate           | used/limit ≥0.9 crit, ≥0.7 warn    |

Envelope dimensions (low-cardinality buckets only): `release`, `environment`, `route`,
`previous_route`, `browser_family`, `browser_major`, `os_family`, `device_class`, `viewport_bucket`,
`network_type`, `hardware_concurrency_bucket`, `device_memory_bucket`, `sample_rate`, `session_id`
(anonymous), `sequence`, `occurred_at`, `duration_ms`, `severity`.

## 3. Privacy contract

**Never stored / never transmitted:** access/refresh token · JWT · Authorization header · cookie ·
email · phone · UUID · long numeric id · payment/settlement/contract/artist id · store invite code ·
search query · user input · filename · signed URL · Supabase object path · query string · hash
fragment · request/response body · music title / artist PII.

Enforced structurally: the envelope has no field for any of these; `sanitizeRoute` strips
query+hash and collapses id segments to `:id`; `sanitizeMessage` redacts email/JWT/uuid/long-number
and truncates to 300 chars; `sanitizeApiName` keeps `host/path` only. Error stacks are **not**
stored — only the redacted, truncated message. Tests: `schema.test.ts` asserts extra top-level
fields (access_token/email/user_id) are dropped and strings are re-sanitized.

## 4. Database (`supabase/migrations/0454_runtime_telemetry_events.sql`)

**Additive only** — one new table + three new functions. No existing table/column/RPC/view is
altered. Rollback = pure `DROP` of the new objects (no data loss, they are all new).

- **Table** `public.runtime_telemetry_events`: `event_id` PK (dedup key), bucketed dimensions,
  `payload jsonb`. Constraints: event_type/severity/environment/device_class allow-list CHECKs,
  `sample_rate ∈ (0,1]`, `pg_column_size(payload) ≤ 8192`.
- **Indexes**: `received_at desc`; `(release|route|browser_family|event_type, received_at desc)`;
  `(session_id, sequence)`; partial `(payload->>'name')` where `event_type='vital'`. No indiscriminate
  indexing.
- **RLS**: `enable` + `force`. Only policy is `super_admin SELECT`. No insert/update/delete policy →
  anon/authenticated fully blocked. Inserts happen only via the service-role RPC.
- **RPCs**: `ingest_runtime_telemetry(jsonb)` (service_role; dedup `on conflict do nothing`);
  `admin_query_runtime_telemetry(...)` (super_admin gate, parameterized allow-list filters,
  percentile_cont for p50/p75/p95, pagination, ≤500 row cap); `purge_runtime_telemetry(days)`
  (service_role/super_admin; retention delete of the NEW table only).

### Destructive-SQL scan
The migration contains no `DROP`/`TRUNCATE`/`DELETE`/`UPDATE`/`revoke`/`disable RLS` against any
existing operational table. The only `delete` is in `purge_runtime_telemetry`, scoped exclusively to
`runtime_telemetry_events` (the new table). Rollback SQL is documented at the bottom of the migration.

## 5. Sampling

Session-stable: `decideSampling(session_id, type, base)` derives a stable `u ∈ [0,1)` from
`FNV-1a(session_id:type)`; a session is either fully IN or fully OUT of a type's sampled stream — no
per-event flicker. `sample_rate` is stamped on every event so the server can reconstruct true counts.
Errors/route/vital → rate 1 (never sampled). `api/longtask/interaction/memory` → configured base.
Defaults: **production 0.25**, preview/dev **1.0** (override `VITE_TELEMETRY_SAMPLE_RATE`). Missing
env → safe default applied; app never fails to boot.

## 6. Ingestion API — `POST /api/telemetry/runtime`

Accepts `{events:[…]}`, a bare array, or a single event. Limits: ≤50 events/batch, ≤64 KB body,
≤4 KB payload/event. Validates content-type (415), body size (413), event count (413), JSON (400),
per-event schema (rebuild+sanitize, partial-accept). Rate limit: **best-effort in-memory**, 12
batches/session/minute, keyed by a hashed session id (never raw IP). Response `202 {accepted,
rejected, duplicate}`. Rejection reasons are coarse (no schema leak).

**Rate-limit limitation (reported honestly):** Vercel edge instances are ephemeral and regionally
distributed, so the in-memory counter is per-instance, not a global quota. It blunts a single hot
client against one instance but is not a hard global cap. A durable cross-instance limiter (KV/Redis)
is deferred; the dedup `unique(event_id)` + client bounded-retry already prevent infinite reinsert.

## 7. Client transport

Batch size 20 (flush at) · flush interval 20s · buffer cap 200 · `sendBeacon` first, `fetch(keepalive)`
fallback · retry ≤3 for 5xx/429/network only (4xx never retried) · exponential backoff + full jitter ·
offline pause / online resume · flush on `visibilitychange→hidden` and `pagehide` · dedup by event_id ·
memory-first (no unbounded localStorage). Session-tail loss on tab close is accepted (stability > 
completeness). Health counters (queued/sent/accepted/rejected/dropped/retries/last*/transportType)
are surfaced read-only in the dashboard; transport errors are **not** re-emitted as telemetry
(self-referential-loop guard).

## 8. Feature flags / kill switch (all `VITE_*`, non-secret)

| var | default | effect |
|-----|---------|--------|
| `VITE_TELEMETRY_ENABLED` | true | master collection switch |
| `VITE_TELEMETRY_TRANSPORT_ENABLED` | true | server transmission only (collection can stay on) |
| `VITE_TELEMETRY_ENDPOINT` | `/api/telemetry/runtime` | same-origin sink |
| `VITE_TELEMETRY_SAMPLE_RATE` | prod 0.25 / else 1 | base sample rate |
| `VITE_TELEMETRY_BATCH_SIZE` | 20 | flush threshold |
| `VITE_TELEMETRY_FLUSH_MS` | 20000 | periodic flush |
| `VITE_TELEMETRY_MAX_BUFFER` | 200 | outbound buffer cap |

Server failure → app unaffected. Transport OFF → session dashboard still works, nothing transmitted.
Dashboard shows `OFF (kill switch)` when disabled. Rollback needs no code deletion — flip env + rebuild.

## 9. Release attribution

`release = BUILD_ID` (`VITE_BUILD_ID`), the **same** value Sentry uses as its release — so telemetry
and Sentry releases line up. Missing → `unknown`; boot never fails.

## 10. Retention & growth (⚠ ASSUMPTIONS — not measured)

Raw retention **30 days** via `purge_runtime_telemetry(30)`. A scheduler (Vercel cron / pg_cron) is
**not** added this phase; the function exists and is documented for a later retention job.

Rough monthly volume, **assumed** inputs (mark clearly as estimates, not observed):

- Assume ~15 sampled events/session after sampling (errors 100%, high-freq at base 0.25).
- Assume ~1 KB/row stored (bucketed dims + small jsonb).

| scale (assumed) | sessions/day | events/day | rows/30d | ~storage/30d |
|-----------------|-------------|-----------|----------|--------------|
| 100 stores      | ~1,000      | ~15k      | ~450k    | ~0.45 GB     |
| 1,000 stores    | ~10,000     | ~150k     | ~4.5M    | ~4.5 GB      |
| 10,000 users    | ~10,000     | ~150k     | ~4.5M    | ~4.5 GB      |

These are order-of-magnitude planning figures only; real values depend on session length, sampling,
and actual event mix, and must be re-derived from Preview data before trusting them. Index cost grows
with row count; the partial vital index and time-desc composites are the main contributors. If volume
exceeds comfort, tighten `VITE_TELEMETRY_SAMPLE_RATE`, shorten retention, or add the daily rollup
below.

### Deferred: daily rollup
If raw queries become expensive, add `runtime_telemetry_daily_rollups` (date, event_type, route,
release, browser_family, device_class, sample_count, avg/p50/p75/p95/p99, worst, error/critical
counts) built by a daily job from raw, retained 180–365 days. Not added now — raw + the aggregate RPC
is sufficient for the initial phase.

### Retention job / rollback / audit (design)
- Job: nightly `select purge_runtime_telemetry(30)` (service role). Idempotent; deletes only the new
  table.
- Rollback: disable the cron; the table simply stops shrinking. To remove the feature entirely, run
  the migration's documented `DROP` block (new objects only).
- Audit: `purge_runtime_telemetry` returns `{deleted, older_than_days}`; wire into the existing
  `admin_log_operation` audit if a scheduler is added.

## 11. Manual Preview QA (browser — NOT RUN in this environment)

No browser/Preview access here (no Playwright, proxy blocks live fetch), so the following are
**NOT RUN** and must be verified on the Preview deployment. Type-safety + unit tests + build pass.

1. Load the Preview app → DevTools Network → confirm `POST /api/telemetry/runtime` fires after ~20s
   or on tab hide, returns `202 {accepted,…}`.
2. Navigate a few routes, trigger an API call, throw a handled error → confirm event counts rise.
3. Tab hide / close → confirm a final beacon flush (Network "sendBeacon").
4. Go offline (DevTools) → confirm sends pause, no user error; go online → confirm resume.
5. Admin → 런타임 텔레메트리 → 서버 히스토리 → confirm KPI cards + tables populate for 1h/24h; verify
   filters (event type/browser) and 60s polling (pauses in background).
6. Set `VITE_TELEMETRY_TRANSPORT_ENABLED=false` → confirm no network posts and dashboard shows
   `OFF (kill switch)`; session dashboard still renders.
7. Confirm no PII in any request body (only bucketed dims + sanitized route/message).
