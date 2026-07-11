# WEB-OBS-9 — Operations Governance & Autonomous Decision Support

Extends the operations-intelligence layer (WEB-OBS-8) into **structured decision support**: release-
readiness scoring, advisory recommendations, static playbooks, an approval queue with an audit trail,
rule management, a confidence engine, escalation routing, evidence packages, and executive reporting.

> **Decision SUPPORT only.** Nothing here executes, merges, deploys, rolls back, blocks a release, or
> controls the Player. Every recommendation is advisory and **requires operator approval**. Recording an
> approval writes an **audit row** — it never triggers a downstream action. Rule-based / statistical, **NO
> ML/LLM**. Additive. Preview PR only — no production merge / deploy / migration apply. Base =
> `feat/web-obs-8-intelligent-operations` (PR #347).

## 1. Non-negotiable safety contract

- **No automation, ever.** `record_operations_decision`, `record_operations_approval` and
  `upsert_operations_rule` persist records only. No RPC, engine, or UI button performs a release merge,
  deploy, rollback, release-block, or Player action. Every advisory output is stamped
  `requiresApproval:true`, `automated:false`, `remoteControl:false` (asserted by tests). The migration
  contains no `pg_cron` / `http` / deploy / release / player-control call.
- **Operator approval is a record, not an execution.** The approval workflow writes an append-only audit
  row (`operations_approvals`) and reflects the choice on the parent decision's `status` (OPEN →
  APPROVED/REJECTED/NEEDS_INVESTIGATION). Nothing acts on that status automatically.
- **No client/Player change.** This phase touches only new `src/lib/opsGovernance/*`, a new
  `opsGovernanceApi.ts`, a new admin dashboard, an AdminPage tab wiring, a new migration, and docs.
  Player / Queue / Playback / Crossfade / Recovery / Scheduler / Audio Output are untouched; existing
  telemetry semantics are unchanged (WEB-OBS-7/8 data is read-only here).
- **Rule-based, not a model.** Readiness, confidence, recommendations, escalation and impact are all
  named-threshold rules (`thresholds.ts`). Confidence is a rule blend of evidence breadth, **capped at
  96** — observational data is never fully certain.
- **No fabrication.** Below the sample floors → INSUFFICIENT_DATA (readiness, confidence, impact all
  degrade). A live CRITICAL incident caps readiness at BLOCK_RECOMMENDED. TTFA stays TTFA_APPROX. Event
  count ≠ affected sessions ≠ affected stores.
- **Server-verified & private.** All RPCs super-admin gated (`_is_super_admin()`), security-definer,
  param-bound; `created_by`/`actor` derive from `auth.uid()`; decision payloads are PII-free snapshots.

## 2. Architecture

```
WEB-OBS-7 quality + WEB-OBS-8 reliability/regression/incidents (READ-ONLY)
         ▼   src/lib/opsGovernance/*  (rule-based decision-support engines — advisory)
  readiness · confidence · recommendations · playbooks · escalation · impact · evidence · executiveReport
         ▼   opsGovernanceApi.ts  (composes engines + wraps 0462 governance RPCs)
         ▼   0462 RPCs (super-admin): record_* / upsert_rule (WRITE audit) · admin_operations_* (READ)
         ▼   operations_decisions / operations_approvals(append-only) / operations_playbooks / operations_rules
         ▼   Admin "운영 거버넌스" tab (OperationsGovernanceCenter — 8 sub-tabs, operator-initiated only)
```

## 3. Engines (`src/lib/opsGovernance/`, 16 unit tests)

| Engine | Feature | Degradation |
| --- | --- | --- |
| `readiness.ts` | **Release Readiness Score** (0–100) from quality + reliability + regression + coverage + incident + sample; status READY / REVIEW_REQUIRED / HIGH_RISK / BLOCK_RECOMMENDED / INSUFFICIENT_DATA | sample floor → INSUFFICIENT_DATA; live CRITICAL caps at BLOCK_RECOMMENDED |
| `confidence.ts` | **Confidence Engine** — coverage + sample count + store diversity + browser diversity | no sessions → INSUFFICIENT; capped at 96 |
| `recommendations.ts` | **Decision Recommendations** (advisory) | low confidence → OBSERVE only |
| `playbooks.ts` | **Operations Playbooks** (static, per incident type) | unknown type → generic fallback |
| `escalation.ts` | **Incident Escalation Matrix** (severity × blast → Store/Brand/Enterprise/Platform) | severity floors the level |
| `impact.ts` | **Change Impact Analyzer** (previous→current release) | thin side → INSUFFICIENT_DATA |
| `evidence.ts` | **Operational Evidence Package** + markdown/print export | empty replay → NO DATA |
| `executiveReport.ts` | **Executive Weekly Report** + **Governance Timeline** | below floor → sections INSUFFICIENT_DATA |

## 4. Storage & RPCs (`supabase/migrations/0462_operations_governance.sql`)

Additive. Four self-contained tables, all RLS deny-all + super-admin read; direct
insert/update/delete revoked (writes only via the security-definer RPCs):
- `operations_decisions` — advisory decision/readiness snapshots (PII-free `payload`).
- `operations_approvals` — **append-only** operator audit (approve/reject/need-investigation).
- `operations_playbooks` — seeded static investigation cards.
- `operations_rules` — rule threshold/weight/enable with **version bump** on change.

Write RPCs (super-admin, `auth.uid()`-stamped, **record-only**): `record_operations_decision`,
`record_operations_approval` (append audit + reflect status; explicitly "audit record only — no
release/rollback/player action executed"), `upsert_operations_rule`. Read RPCs:
`admin_operations_overview / _queue / _history / _playbooks / _rules`. **Rollback = plain DROP.**

### Migration validation (never applied to production)

`0462` was validated against the **real production schema** inside a `BEGIN … ROLLBACK` transaction via
the Supabase MCP `execute_sql` (nothing persisted; `_is_super_admin()` stubbed true). It exercised the
full write→read flow: `record_operations_decision` → `record_operations_approval` (status OPEN →
APPROVED) → double `upsert_operations_rule` (version 1 → 2) → all read RPCs. Result:
`decision_status=APPROVED · approvals=1 · rule_version=2 · overview.open=0 · queue=0 · history.appr=1 ·
playbooks=5 · rules=3`. The transaction aborted (via `RAISE EXCEPTION`), leaving no trace; a follow-up
read confirmed the tables/functions do not exist. **Production migration head remains 0453 — 0462 is not
applied.**

## 5. Dashboard (`OperationsGovernanceCenter.tsx`)

Read-only super-admin tab "운영 거버넌스" with 8 sub-tabs: **Overview** (governance counts + top
recommendations), **Release Readiness** (score/status/confidence table + operator "기록" snapshot),
**Approvals** (queue with Approve/Reject/Need-Investigation — records audit only), **Recommendations**
(advisory list), **Playbooks** (static cards), **Evidence** (store→package + markdown export for
print-to-PDF), **History** (decisions + audit + governance timeline), **Governance** (executive report +
rule management enable/disable with version). Tone-system only; loading / empty / error / NO_DATA /
INSUFFICIENT_DATA handled. No control buttons execute anything.

## 6. Feature flags (`opsGovernance/config.ts`, read-side default ON)

| Flag | Default | Effect |
| --- | --- | --- |
| `VITE_OPSGOV_DASHBOARD_ENABLED` | true | Master read-side gate |
| `VITE_OPSGOV_APPROVALS_ENABLED` | true | Show approval-queue actions |
| `VITE_OPSGOV_RULES_ENABLED` | true | Show rule management |
| `VITE_OPSGOV_RECORD_ENABLED` | true | Allow logging a decision (still operator-click only) |
| `VITE_OPSGOV_EXEC_REPORT_ENABLED` | true | Executive report |
| `VITE_OPSGOV_AUTO_REFRESH` | false | Optional auto-refresh |

A flag OFF only hides governance UI; it can never affect playback, the queue, crossfade, recovery, or a
release.

## 7. Completion-condition notes

- **Fail-open**: all dashboard loads are `Promise.allSettled` — one failing RPC never blanks the page;
  write actions surface a notice and reload, never throw into the app.
- **Browser tests: NOT RUN.** No Playwright/browser E2E was executed for this phase (it adds no runtime
  Player surface); the 16 vitest unit tests + full suite (388) cover the engines. Any browser-only check
  is honestly reported **NOT RUN**, never PASS.
- **Not applied to production**: no merge / deploy / migration apply performed; 0462 validated by
  rollback transaction only.
