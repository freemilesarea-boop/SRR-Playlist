# ENTERPRISE-HQ-OPS-1-PREVIEW — Test DB seed & manual deploy/QA guide

> **Test Supabase only.** Production (`nsoesrvwkxqifjcxzvol`) was never accessed or modified.
> All synthetic ids are prefixed **`da7a`** for marker-based cleanup. No Production records copied.
> **Browser PASS / Merge Ready is NOT claimed here** — browser QA is performed manually by the requester.

## 1. Test project ref
- **Project ref:** `haojpuhztegecbrwqorr` — "SRR Playlist Test"
- **API URL:** `https://haojpuhztegecbrwqorr.supabase.co`
- (Production `nsoesrvwkxqifjcxzvol` — off-limits, untouched.)

## 2. Applied migrations / objects (in order, on the Test DB)
1. `01_schema.sql` — prerequisite schema (exact objects from repo migrations) + `/enterprise/me` additions
   (enterprise_accounts columns, `franchise_stores.enterprise_region_id`, `enterprise_business_profiles`,
   `enterprise_settlement_profiles`).
2. `supabase/migrations/0456_hq_ops_heartbeat_accuracy.sql` (unchanged) — `last_heartbeat_at`, `_store_heartbeat_state`,
   `store_heartbeat`, `store_now_playing`/`store_monitoring_status` views, `_noc_store_health_score`.
3. `supabase/migrations/0457_hq_ops_fleet_center.sql` (unchanged, post-verify fix) — `_store_operational_status`,
   `get_my_enterprise_ops_fleet`, `get_my_enterprise_ops_store_detail`.
4. `02_hq_rpcs.sql` — `get_my_enterprise_role`, `get_my_enterprise_store_info`, `get_my_enterprise_dashboard`
   (entry-path RPCs so `/enterprise/me` renders the operations-center CTA).
5. `03_seed.sql` — synthetic QA data.

## 3. Seeded object counts (verified)
| Object | Count |
|---|---|
| enterprise_accounts (synthetic) | 2 (A, B) |
| auth.users (synthetic) | 41 (2 HQ + 30 A-healthy + 6 A-special + 3 B) |
| franchise_stores | 39 (36 A + 3 B) |
| store_policy_sync_status | 39 |
| enterprise_billing_invoices | 3 (A: 1 paid · B: 1 overdue + 1 issued) |
| enterprise_contracts | 2 (A: active non-expiring · B: active D-15 expiring) |
| franchises / enterprise_franchises / enterprise_regions | 2 / 2 / 2 |
| business + settlement profiles | 2 + 2 |

## 4. Synthetic account identifiers (emails only — passwords NOT stored)
- **Primary HQ (Enterprise A — distinct operational states):** `qa-hq-a@test.invalid`
- **Secondary HQ (Enterprise B — billing states):** `qa-hq-b@test.invalid`

The seed creates these auth users **with email confirmed but no password** (no secret is stored anywhere).
Before logging in, **set a password as the project owner**: Supabase Dashboard → Authentication → Users →
select the user → set/update password (or use the Auth Admin API). Emails are `@test.invalid` (no mail delivery),
so set the password directly rather than via a recovery email.

## 5. Expected values (for QA comparison)
**Enterprise A** (`qa-hq-a`): store_count **36**. Operational badges: **HEALTHY 30 · WARNING 3 · CRITICAL 1 · OFFLINE 1 · UNKNOWN 1**.
KPI cards: total **36**, 정상재생(normal) **31**, 경고(warning) **3**, 오프라인(offline) **2**, Incident **1**,
업데이트필요(update) **1**, 미납(unpaid) **0**, 계약만료예정(contract expiring) **0**.
- Note: the update-required store is online & error-free, so it appears in **both** "정상" and "업데이트필요"
  KPIs (KPI buckets are independent, not mutually exclusive). The no-data (UNKNOWN badge) store counts in the
  **offline** KPI (null last-seen), which is why offline KPI = 2 while OFFLINE badge = 1.
- Contract: active, D-300 (not expiring). Billing: paid (no unpaid/overdue).

**Enterprise B** (`qa-hq-b`): store_count **3**. All stores online → operational badge **CRITICAL** (enterprise is overdue).
KPI: total **3**, 미납(unpaid) **3**, 계약만료예정 **3**. billing.is_overdue **true**, unpaid_invoice_count **2**,
contract.is_expiring **true**, days_to_end **15**.

Store filters map to monitoring flags: `정상/경고/오프라인/Incident/업데이트필요` are per-store; `미납/연체/계약만료예정` are enterprise-level.

## 6. Cleanup script path
- **`docs/hq-ops-1-preview/99_cleanup.sql`** — idempotent; removes ONLY harness objects + `da7a`-marked rows +
  the enterprise_accounts columns this QA added. It never deletes non-`da7a` (pre-existing) rows and never drops
  pre-existing objects. Run it against the Test DB after QA.

## 7. Vercel Preview environment variables (Preview scope only; values masked)
| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://haojpuhztegecbrwqorr.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Test project anon/publishable key — get the full value from Supabase Dashboard → Project **SRR Playlist Test** → Settings → API. (legacy anon `eyJhbGci…CBos` · or publishable `sb_publishable__pu09…t6U`) |

Use the **Test** project's keys only. Never set Production keys on this Preview.

## 8. Exact manual deployment steps (requester performs — I cannot deploy from this environment)
This session's environment blocks all outbound HTTPS (egress policy 403 to `vercel.com` and Supabase), and the
Vercel MCP can only upload an inline file tree (infeasible for this 1,133-file / 36 MB-dist app) with no build-time
env-var support. So the Preview must be created by you:
1. In Vercel, **New Project → Import Git Repository** → `freemilesarea-boop/srr-playlist`.
2. Set the production branch to your default, and ensure branch **`claude/enterprise-audit-report-aufypa`** builds as a **Preview** deployment (push/PR triggers it).
3. Framework: Vite. Build: `npm run build` (or `npm run build:no-lint`). Output: `dist`.
4. **Environment Variables (Preview scope):** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from §7 (Test values).
5. Deploy the branch as **Preview** (do NOT deploy Production).
6. In Supabase (Test) Auth → URL configuration, add the Preview origin to allowed redirect URLs if Google/Kakao OAuth is used (email/password login for the synthetic HQ users needs no redirect config).
7. Set passwords for `qa-hq-a@test.invalid` / `qa-hq-b@test.invalid` (see §4).
8. Confirm the deployment reaches **READY**, then run the QA checklist (§9).

## 9. Manual browser QA checklist (perform in the Preview)
Log in as **`qa-hq-a@test.invalid`** for items 1–9 (operational states), and **`qa-hq-b@test.invalid`** for the billing parts of items 2–3.

1. **/enterprise/me CTA** — After login go to `/profile`; the enterprise card appears → open **내 엔터프라이즈** (`/enterprise/me`). Confirm the **가맹점 운영 센터** CTA card is present and navigates to `/enterprise/operations/stores`.
2. **Fleet KPI cards** — On `/enterprise/operations/stores`, confirm 8 KPI cards match §5 (A: 36 / 31 / 3 / 2 / 1 / 1 / 0 / 0). Log in as B to confirm 미납 **3**, 계약만료예정 **3**.
3. **Store list data** — Rows show 매장명, 브랜드(QA 프랜차이즈 A), 업종, 지역(서울), online/heartbeat badge + "n초 전", 현재 재생 곡, Health score, operational badge. Confirm all five badges appear (HEALTHY/경고/심각/오프라인/수집전).
4. **Status filters** — Chips 정상/경고/오프라인/Incident/업데이트필요 filter the list correctly (e.g., Incident → the 재생오류 store; 오프라인 → offline + no-data stores; 업데이트필요 → the 1.9.0 store). 미납/연체/계약만료예정 filters: as A return empty; as B return the 3 stores.
5. **Search** — Search "베이커리"(업종), "유휴"(store name), "서울"(region), "프랜차이즈 A"(brand) each narrow results.
6. **Pagination** — A has 36 stores; page 1 shows 30, "다음" reveals the remaining 6; "이전" returns.
7. **Store detail** — Click a store → `/enterprise/operations/stores/:id`. Confirm Overview (operational status + reasons), Playback (current track / player status / heartbeat), Health (score + breakdown + heartbeat badge), Billing (본사 단위: 미납/연체/계약 D-day/정산), Device (Player version / model / OS / 마지막 접속). Open the 재생오류 store and the 수집전 store to see CRITICAL / UNKNOWN.
8. **Unsupported / data-empty labels** — On store detail confirm **현재 미지원** for Queue/다음곡, Scheduler 상세, Streaming Quality, Heartbeat Timeline; **미지원** for Store Code; **데이터 없음 / 수집 전** where a value is absent (e.g., the 수집전 store's device/heartbeat). Verify NO fabricated values.
9. **Responsive** — Resize to mobile width: KPI grid reflows (2-col), filter chips wrap, list rows stay readable, detail cards stack, no horizontal overflow.
10. **Console & Network** — DevTools: no console errors / unhandled rejections / React errors; no 5xx; RPC calls resolve 200; verify no repeated/duplicate RPC storms or N+1 request bursts; only the **Test** Supabase host is contacted (never the Production host).
