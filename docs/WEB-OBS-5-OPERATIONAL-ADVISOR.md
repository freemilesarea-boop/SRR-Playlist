# WEB-OBS-5 — Operational Advisor, Incident Playbook & Recovery Tracking

Turns the WEB-OBS-1…4 analysis (root cause · release gate · rollback advisor) into a single
operator-facing **recommended next action** — plus an incident **playbook**, **blast radius**,
**impact**, **recovery tracking**, **escalation**, **incident lifecycle** and a **verification
checklist**. Everything is **recommendation + tracking only**. **NOTHING is executed** — no rollback,
no deploy-block, no DB change, no Slack/Email/Pager notification, no auto-incident-close.
Rule-based, **NO ML / NO AI / NO LLM**. Additive. Preview PR only — no production merge / deploy /
migration apply. Base = `feat/web-obs-4-root-cause` (PR #343).

> Assumptions flagged **(ASSUMPTION)**. Every threshold is a named constant in
> `src/lib/observability/thresholds.ts`. Below the sample/confidence gates each engine returns an
> **INSUFFICIENT_DATA / OBSERVE** verdict — never a confident action on a thin sample. **Every
> recommended action is `automated=false`, `requiresApproval=true`.**

## 1. Non-negotiable safety contract

- **No execution.** The advisor produces *labels* (`ROLLBACK_RECOMMENDED`, `HOLD_PROMOTION`, …). No
  code path performs a rollback, cancels a Vercel deployment, changes GitHub state, mutates the DB,
  or sends a notification. `actionSafety()` stamps `automated:false` + `requiresApproval:true` on
  **every** category (asserted by unit tests).
- **No auto-close.** `deriveLifecycle()` **never** returns `RESOLVED`; a recovered incident is
  surfaced as `MONITORING` with an operator-close note. `computeRecovery().operatorCloseRequired` is
  **always `true`**.
- **Session ≠ user, event ≠ session.** `sessionsAreNotUsers()` is a labelled helper the UI renders so
  the two are never silently equated. Rates use deduped session denominators; with no denominator no
  rate is asserted (`affectedSessionRate: null`).
- **No fabricated business impact.** `computeImpact()` returns
  `businessImpact: 'BUSINESS_IMPACT_NOT_AVAILABLE'` — runtime telemetry cannot size
  revenue/store/settlement/playback-loss, so it is reported as unavailable, not invented.
- **No new data.** One additive SELECT-only RPC (0458). No incident-state table (persistence of
  operator status/notes is deferred). Telemetry collector / event schema untouched. No forbidden
  runtime areas touched (Player, Queue, Crossfade, Scheduler, Settlement, Service Worker, CDN, …).
- **No sensitive exposure.** Only aggregates + sanitized fingerprints from WEB-OBS-1…4 flow through;
  no user input, raw query strings, tokens/cookies/JWT, commit messages or full raw stacks.

## 2. Architecture

```
WEB-OBS-1..4 (persistent RUM, root cause, gate, rollback advisor — all read-only)
  └─ 0458 admin_incident_recovery RPC (super_admin · param-bound · allow-list · SELECT-only)
       → window_totals (denominator) + EARLIER vs RECENT sub-windows + 6-bucket recurrence series
         ▼
src/lib/observability/*  (pure, unit-tested — the recommendation truth)
   blastRadius.ts  → computeBlastRadius · computeImpact · sessionsAreNotUsers
   recovery.ts     → computeRecovery (+ recurrence detection)
   playbook.ts     → getPlaybook · playbookKeyFor  (static per-type checklists)
   operationalAdvisor.ts → computeOperationalAdvice · computeEscalationDetail · deriveLifecycle
         ▼
observabilityApi.ts  getIncidentRecovery() + composeOperationalIntel()  (maps → engines, client-side)
         ▼
ObservabilityDashboard "Operations" tab  (advisor · blast · escalation · lifecycle · impact ·
                                          recovery · playbook — READ-ONLY display, no action buttons)
```

All verdicts are computed **client-side** from documented thresholds — deterministic, reproducible,
auditable. The RPC only supplies the recovery sub-window split + denominator the earlier phases
didn't expose.

## 3. Operational Advisor (`operationalAdvisor.ts`)

`computeOperationalAdvice(input)` → a single `recommendedAction` (`ActionCategory`, 20 values), with
`urgency` (CRITICAL/HIGH/MEDIUM/LOW/NONE → P0..P3), `reason`, `evidence[]`, `verificationSteps[]`,
`escalationTarget`, `confidence`, `safety`, and an always-on `safetyWarning`. Precedence:

1. `confidence === INSUFFICIENT` → **OBSERVE** (`insufficientDataReason` set) — never a confident action.
2. Recovering (`RECOVERED`/`IMPROVING`) and not recurring and not `BLOCK_RELEASE` → **OBSERVE** (verify, then operator closes).
3. `rollbackStatus === BLOCK_RELEASE` → **HOLD_PROMOTION** (gate BLOCK, i.e. not yet promoted) or **PREPARE_ROLLBACK** (already live), CRITICAL.
4. `rollbackStatus === ROLLBACK_RECOMMENDED` → **ROLLBACK_RECOMMENDED**, HIGH.
5. Cause-specific verification (`CHUNK_VERIFICATION`, `HYDRATION_VERIFICATION`, `VERIFY_BROWSER`,
   `VERIFY_ROUTE`/`PLAYER_HEALTH_VERIFICATION`, `VERIFY_API`, `MEMORY_VERIFICATION`, `HOLD_PROMOTION`).
6. `gate PASS_WITH_WARNING` or `rollback WATCH` → **HOLD_PROMOTION**, MEDIUM.
7. Else **INVESTIGATE** (≥3 affected sessions) or **OBSERVE**.

`actionSafety(category)` is a fixed table: read-only verifications are `readOnly/reversible`,
`productionEffect:false`, `riskLevel:none`; release/rollback categories carry `productionEffect:true`
+ `riskLevel:medium|high` **but still** `requiresApproval:true` + `automated:false`.

## 4. Blast Radius & Impact (`blastRadius.ts`)

`computeBlastRadius(input)` → `level` ∈ ISOLATED/LIMITED/MODERATE/WIDESPREAD/CRITICAL/INSUFFICIENT_DATA
from the **affected-session rate** (deduped) against named thresholds:

| gate | constant | value |
|---|---|---|
| INSUFFICIENT (min affected) | `BLAST_MIN_AFFECTED_SESSIONS` | 5 |
| INSUFFICIENT (min denominator) | `BLAST_MIN_TOTAL_SESSIONS` | 20 |
| ISOLATED ≤ | `BLAST_ISOLATED_MAX` | 0.01 |
| LIMITED ≤ | `BLAST_LIMITED_MAX` | 0.05 |
| MODERATE ≤ | `BLAST_MODERATE_MAX` | 0.15 |
| WIDESPREAD ≤ | `BLAST_WIDESPREAD_MAX` | 0.40 |
| CRITICAL (severe sessions) | `BLAST_CRITICAL_SEVERE_SESSIONS` | 25 |

A single event is never WIDESPREAD; with `totalSessions == null` no rate is asserted
(`affectedSessionRate: null`, level `INSUFFICIENT_DATA`); `severeSessions ≥ 25` (critical+chunk) forces
**CRITICAL** regardless of rate.

`computeImpact(input)` → technical counts (error/critical/chunk/hydration/slow-API/memory), scoped
session/route/browser/release impact, and `businessImpact: 'BUSINESS_IMPACT_NOT_AVAILABLE'` with an
explanatory note. Timeout events are `null` when not separable from telemetry.

## 5. Recovery Tracking (`recovery.ts`)

`computeRecovery(input)` compares a **RECENT** sub-window against an **EARLIER** (incident) sub-window
of the same release → `status` ∈ NOT_STARTED/IMPROVING/STABLE/RECOVERED/REGRESSED/INSUFFICIENT_DATA.

- Gates: `observationWindowMinutes < RECOVERY_MIN_WINDOW_MINUTES` (30) → **NOT_STARTED**; too few
  sessions/events either side (`RECOVERY_MIN_SESSIONS_PER_BUCKET` 15, `RECOVERY_MIN_EVENTS_PER_BUCKET`
  60) → **INSUFFICIENT_DATA**.
- **REGRESSED** if recurrence detected (a dip then a fresh spike back over `RECOVERY_RECURRENCE_MIN_RATE`
  0.03) **or** current ≥ earlier × `RECOVERY_REGRESS_REL` (1.25).
- **RECOVERED** only if current ≤ earlier × `RECOVERY_IMPROVE_REL` (0.5) **and** ≤ absolute target
  (`RECOVERY_RECOVERED_ABS` 0.02). One dip is never RECOVERED on its own.
- `operatorCloseRequired` is **always `true`** — recovery is a signal, not an auto-close.

## 6. Incident Playbooks (`playbook.ts`)

`getPlaybook(incidentType)` returns a fresh (all `NOT_STARTED`) ordered checklist. Keys: `ERROR_SPIKE`,
`CHUNK_FAILURE_SPIKE`, `HYDRATION_ERROR_SPIKE`, `API_REGRESSION`, `WEB_VITAL_REGRESSION`, `MEMORY_RISK`,
`BOOT_RECOVERY_FAILURE`, `GENERIC`. `playbookKeyFor()` maps incident types to the closest supported
key (unsupported → **GENERIC**, no invented steps). Every step carries
`title/description/purpose/requiredEvidence/expectedResult/stopCondition/escalationCondition` and is
**`destructive:false` + `automated:false`** — pure human guidance; the module never runs anything.
Step status is UI-only display state.

## 7. Escalation & Lifecycle (`operationalAdvisor.ts`)

`computeEscalationDetail(input)` → `EscalationTarget` with reasons:
- `INSUFFICIENT` confidence → **NONE** (no over-escalation on thin data).
- **SECURITY** only when a real `securityEvidence` signal is present (this phase: always `false`).
- **EXECUTIVE** only for widespread+severe (or persistent unrecovered).
- Otherwise cause-typed (BACKEND/DATABASE/INFRA/FRONTEND/OPERATOR) or NONE.

`deriveLifecycle(input)` → suggested `LifecycleStatus` (DETECTED/TRIAGED/INVESTIGATING/MITIGATING/
MONITORING/RESOLVED/FALSE_POSITIVE), `operatorControlled:true`. It **never auto-returns RESOLVED**; a
recovered incident is `MONITORING` with a "operator must close" note. Persistence of operator
status/notes is **deferred** (no incident-state table this phase).

## 8. RPC — `admin_incident_recovery` (migration 0458)

`admin_incident_recovery(p_release, p_window, p_environment)` → `jsonb`:
`window_totals` (denominator), `earlier`/`recent` aggregates split at `now() - interval/3`, a 6-bucket
`recent_series` for recurrence, and `observation_window_minutes`.

Security: `security definer` + `_is_super_admin()` gate + `set search_path = public` + parameter
binding (no dynamic SQL) + window/environment allow-list + bucket cap. **SELECT-only** (no data
change). Additive — one `CREATE FUNCTION`; rollback is a plain `DROP FUNCTION` (no data/schema/index/RLS
effect). Validated against production via `BEGIN … ROLLBACK` with synthetic events (no persistence).

## 9. API composition (`observabilityApi.ts`)

- `getIncidentRecovery(release, window, env)` calls the RPC and runs `computeRecovery` client-side.
- `composeOperationalIntel(rootCause, overview, gate, recovery)` → `OperationalIntelBundle`
  {`release, incidentType, advice, playbook, blastRadius, impact, recovery, escalation, lifecycle`}.
  Returns nulls (→ **NO DATA** in the UI) when the candidate error profile is missing. `CAUSE_TO_INCIDENT`
  maps the top root-cause code to an incident type for the playbook selection.

The dashboard `load()` fetches recovery **sequentially after** the parallel root-cause batch (it needs
the candidate release), and is **fail-open**: a recovery fetch error still composes the advice without
recovery. When the current window is `1h` the recovery fetch widens to `24h` (a 20-minute recovery
window needs a real observation span).

## 10. Feature flags (`config.ts`)

All default-on, safe, non-secret; a missing/mistyped env var can never break boot. Every section is
independently killable:
`VITE_OBSERVABILITY_OPERATIONAL_ADVISOR_ENABLED`, `…_PLAYBOOK_ENABLED`, `…_BLAST_RADIUS_ENABLED`,
`…_RECOVERY_TRACKING_ENABLED`, `…_INCIDENT_LIFECYCLE_ENABLED`, `…_ESCALATION_ENABLED`,
`…_BUSINESS_IMPACT_ENABLED`, and `…_MIN_RECOVERY_WINDOW_MINUTES` (default 30, 5..1440). Turning the
master advisor flag off skips the recovery fetch entirely.

## 11. UI — "Operations" tab

Read-only display only (no action buttons). Renders: advisor headline (recommended action + urgency +
reason + evidence + safety badges showing read-only/approval-required/`automated:false`/risk),
verification checklist, escalation, incident lifecycle (operator-owned, "no auto-RESOLVED" note),
impact (technical stats + `BUSINESS_IMPACT_NOT_AVAILABLE`), blast radius ("Session ≠ 사용자" note, rate
null when no denominator), recovery (baseline/current/target/observation window/recurrence/
operator-close-required), and the playbook (steps with status badges, all destructive/automated false).
Footer: **"모든 조치는 권고이며 자동 실행되지 않습니다."** Uses the admin tone system (no hardcoded colors;
`lint:tones` clean).

## 12. Tests & verification

- `src/lib/observability/operationalAdvisor.test.ts` — 34 tests (advisor precedence, safety contract,
  blast levels/gates, recovery statuses/recurrence, escalation targets, lifecycle never-RESOLVED,
  playbook coverage & read-only invariants). Full suite: **272 passing**.
- `npm run typecheck` / `lint` / `lint:tones` / `lint:migrations` / `build` — all green. Dashboard
  chunk (`RuntimeTelemetryPanel`, lazy-loaded) grows ~34 kB for the new engines + tab; no boot impact.
