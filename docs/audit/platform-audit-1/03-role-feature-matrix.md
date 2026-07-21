# 03 — User Role × Feature Matrix

> PLATFORM-AUDIT-1 · READ-ONLY. Roles derived from `App.tsx` guards + in-page soft-gates + DB. Actual DB role column is coarse (`users.role` ∈ {`user`,`admin`}); finer roles are attributes (`account_type`, `is_curator`, `is_salesperson`, `is_franchise_admin`, `admin_users` RBAC, `is_super_admin`).

## Role model (as implemented)
| Audit role | How determined | Enforcement |
|---|---|---|
| Public (non-login) | no session | route allows |
| Member | session | `RequireAuth` |
| Artist | `account_type='artist'` + artist profile | page soft-redirect + RLS |
| Store (business) | `account_type='business'` / business profile | page + data |
| Brand/HQ | enterprise/franchise membership | RPC/RLS (no client guard) |
| Franchise admin | `is_franchise_admin` | client gate + RPC |
| Salesperson | `is_salesperson` | page soft-gate |
| Curator | `is_curator` | page soft-gate |
| Admin | `users.role='admin'` | `RequireAdmin` |
| Settlement/QC/Content admin | `admin_users` RBAC perms | in-panel checks |
| Super Admin | `is_super_admin` | `superOnly` tabs + in-fn |
| System/automation | `CRON_SECRET` / service_role | edge/cron |
| External webhook | signature/token | `payapp-feedback` |

## Matrix (✓ = has access; · = none; A = admin-mediated)
| Feature | Public | Member | Artist | Store | Brand HQ | Admin | Settlement Admin | Super Admin |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Browse public (home/charts/search/playlists) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Legal/support/service pages | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Signup / login / OAuth | ✓ | — | — | — | — | — | — | — |
| Profile view/edit | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Password reset (self) | · | ·(PARTIAL) | · | · | · | · | · | · |
| Library / my playlists | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Subscription / payment | · | ✓ | ✓ | ✓ | ✓ | A | · | A |
| Artist dashboard / upload | · | · | ✓ | · | · | A | · | A |
| Artist contract / payout | · | · | ✓ | · | · | A | · | A |
| Artist settlement view | · | · | ✓ | · | · | · | A | A |
| Store player + reactions | · | · | · | ✓ | ✓ | · | · | · |
| Business schedule | · | · | · | ✓ | ✓ | A | · | A |
| Brand player (audio/video/signage) | · | · | · | · | ✓ | A | · | ✓ |
| Enterprise HQ (me/ops/intel/notif) | · | · | · | · | ✓ | · | · | ✓ |
| Franchise HQ dashboard | · | · | · | · | ✓(is_franchise_admin) | · | · | ✓ |
| Salesperson dashboard | · | ✓(is_salesperson) | · | · | · | · | · | · |
| Curator studio | · | ✓(is_curator) | · | · | · | · | · | · |
| Admin console (68 tabs) | · | · | · | · | · | ✓ | ✓(scoped) | ✓ |
| Member/business/artist mgmt | · | · | · | · | · | ✓ | · | ✓ |
| QC / content / track review | · | · | · | · | · | ✓ | · | ✓ |
| AI operations / weight approval | · | · | · | · | · | ✓ | · | ✓ |
| Settlement generate/finalize/pay | · | · | · | · | · | A | ✓ | ✓ |
| Enterprise command/settlement center | · | · | · | · | · | · | · | ✓(superOnly) |
| Brand registry / streaming-v2 / settlement-v2 | · | · | · | · | · | · | · | ✓(superOnly) |
| Payment sync / billing | · | · | · | · | · | ✓ | · | ✓ |
| Cron / automation | system (`CRON_SECRET`/service_role) |||||||
| PayApp webhook | external (signature) |||||||

## Notes / findings
- **RM-F1:** DB `users.role` is only `user`/`admin`; all finer roles are attribute flags + `admin_users` RBAC. A single compromised `role='admin'` grants the whole `/admin` surface (super-only tabs additionally gated by `is_super_admin`).
- **RM-F2 (=RT-F3):** Brand-HQ enterprise routes have no client role guard — access control is entirely RPC/RLS; correctness `UNVERIFIED` here.
- **RM-F3:** "Settlement/QC/Content admin" are not separate login roles but RBAC permission sets within `admin_users`; the router treats them all as `admin`.
