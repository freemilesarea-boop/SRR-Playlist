# 04 — Route × Code × Guard Traceability

> PLATFORM-AUDIT-1 · READ-ONLY · commit `0f3bb57`. Router = `src/App.tsx` (`<Routes>`/`<Route>`, react-router-dom); `BrowserRouter` in `src/main.tsx`.

## Guards
- `RequireAuth` (`App.tsx:86`) — login-only; redirects `/login`.
- `RequireAdmin` (`App.tsx:103`) — `profile.role==='admin'`; else `/`. **Only true router-level role guard.**
- Global account-state gate (`App.tsx:170-221`): `withdrawn` / `disabled` / `profile_error` / `profile_missing` screens intercept before routes render.
- Artist/store/HQ/curator/salesperson roles are **soft-gated inside the page** + enforced server-side (RPC/RLS), not at the router.

## Route table
| Route | Page file | Guard/Role | Status |
|---|---|---|---|
| `/login` | LoginPage | public | PASS(code) |
| `/auth/callback` | AuthCallbackPage | public | PASS(code) |
| `/auth/reset` | AuthResetPasswordPage | public | PASS(code) |
| `/` | HomePage | public | PASS(code) |
| `/charts` | ChartPage | public | PASS(code) |
| `/search` | SearchPage | public | PASS(code) |
| `/playlist/:id` | PlaylistPage | public | PASS(code) |
| `/playlists` | ExplorePlaylistsPage | public | PASS(code) |
| `/track/:id` | TrackSharePage | public (share) | PASS(code) |
| `/curator/:handle` | CuratorProfilePage | public | PASS(code) |
| `/curators` | CuratorsListPage | public | PASS(code) |
| `/terms` | legal/TermsPage | public | PASS(code) |
| `/privacy` | legal/PrivacyPage | public | PASS(code) |
| `/notice` | legal/NoticePage | public | PASS(code) |
| `/support` | legal/SupportPage | public | PASS(code) |
| `/service` | ServicePage | public | PASS(code) |
| `/service/preview` | ServicePreviewPage | public | PASS(code) |
| `/sales-partners` | SalesPartnersPage | public | PASS(code) |
| `/payment/success` | PaymentSuccessPage | member | PASS(code) |
| `/payment/fail` | PaymentFailPage | member | PASS(code) |
| `/artist` | ArtistDashboardPage | artist (soft-redirect) | PASS(code) |
| `/artist/contract` | ArtistContractPage | artist | PASS(code) |
| `/artist/settlements` | ArtistSettlementsPage | artist | PASS(code) |
| `/business` | BusinessPage | member/store | PARTIAL — no page-level role redirect |
| `/business/player` | StorePlayerPage | store (login) | PASS(code) |
| `/brand` | BrandPage | member/brand | PASS(code) |
| `/brand/player/:brandId` | BrandPlayerPage | brand (login) | PASS(code) |
| `/library` | LibraryPage | member | PASS(code) |
| `/subscription` | SubscriptionPage | member | PASS(code) — not in any nav |
| `/profile` | ProfilePage | member | PASS(code) |
| `/curator/studio` | CuratorStudioPage | curator (soft) | PASS(code) |
| `/my/playlists` | MyPlaylistsPage | member | PASS(code) |
| `/my/playlist/:id` | UserPlaylistDetailPage | **public (no RequireAuth)** | ⚠ PARTIAL — see RT-F1 |
| `/sales` | SalespersonDashboardPage | salesperson (soft) | PASS(code) |
| `/enterprise/hq` | FranchiseHqDashboardPage | franchise_admin (client + RPC) | PASS(code) |
| `/enterprise/me` | EnterpriseHqMePage | brand-HQ (login only; RPC/RLS) | PARTIAL — no client role guard |
| `/enterprise/ops` | EnterpriseHqOpsPage | brand-HQ (login only; RPC/RLS) | PARTIAL |
| `/enterprise/intel` | EnterpriseHqIntelPage | brand-HQ (login only; RPC/RLS) | PARTIAL |
| `/enterprise/notifications` | EnterpriseHqNotificationsPage | brand-HQ (login only; RPC/RLS) | PARTIAL |
| `/admin` | AdminPage | **RequireAdmin** | PASS(code) |
| `*` | Navigate→`/` | public | ⚠ no 404 page (RT-F2) |

40 page files under `src/pages/**`, all imported/routed (2 eager + 38 `lazyWithRetry`). **No orphan pages. No dead-nav** (Sidebar/BottomNav/Footer destinations all resolve).

## Admin surface
Single `/admin` route; **68 internal tabs** (`AdminPage.tsx:184-250`) in 7 groups + 6 enterprise sub-groups; **9 `superOnly` tabs** (brand-player, enterprise-command-center, enterprise-operations, enterprise-settlement-center, brand-registry, streaming-v2, settlement-v2, audio-engine-diagnostics, admins). Panels lazy-loaded from `src/components/admin/*`.

## Public-website gaps
Present: `/`, `/service`, `/service/preview`, `/terms`, `/privacy`, `/notice`, `/support`, `/sales-partners`.
**Missing:** dedicated pricing page (pricing is behind login in `/subscription`), how-to/help, contact page (contact = mailto/Kakao in Footer), **404/NotFound**, maintenance page. Only "app-unavailable" screen is `ConfigMissingScreen` (env-missing only).

## Findings
- **RT-F1 (P2, security):** `/my/playlist/:id` is not wrapped in `RequireAuth` while `/my/playlists` is — verify it does not leak private user playlists (likely intended for sharing; confirm RLS scoping).
- **RT-F2 (P3, UX):** Wildcard `*` silently redirects to `/` — no real 404; hides broken deep links.
- **RT-F3 (P2, security):** Enterprise HQ routes (`/enterprise/me|ops|intel|notifications`) have no client-side role guard beyond login; rely entirely on RPC/RLS. Correctness of that server enforcement is `UNVERIFIED` here.
- **RT-F4 (P3):** `/subscription` reachable only by direct URL (not in nav) — pricing discoverability gap.
