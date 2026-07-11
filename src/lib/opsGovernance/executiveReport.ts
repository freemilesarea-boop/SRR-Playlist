// WEB-OBS-9 — Executive Weekly Report + Governance Timeline builders. Aggregate views over already-
// computed data + persisted governance records. Read-only summaries; no action is taken.

import { round } from '../observability/math';
import type { ExecutiveReport, GovTimelineEntry, OperationsDecision, OperationsApproval, GovStage } from './types';
import { EXEC_REPORT_MIN_SESSIONS } from './thresholds';

export interface ExecReportInput {
  window: string;
  availability: number | null;
  reliability: number | null;
  sessions: number;
  releasesReviewed: number;
  approvals: number;
  rejectedReleases: number;
  majorIncidents: number;
  recommendations: string[];
}

/** Build the executive weekly report. Sections flagged INSUFFICIENT_DATA below the sample floor. */
export function buildExecutiveReport(input: ExecReportInput): ExecutiveReport {
  const dataSufficient = input.sessions >= EXEC_REPORT_MIN_SESSIONS;
  return {
    window: input.window,
    availability: dataSufficient ? round(input.availability, 1) : null,
    reliability: dataSufficient ? round(input.reliability, 1) : null,
    releasesReviewed: input.releasesReviewed,
    approvals: input.approvals,
    rejectedReleases: input.rejectedReleases,
    majorIncidents: input.majorIncidents,
    recommendations: input.recommendations.length ? input.recommendations : ['특이사항 없음 — 관찰 유지'],
    dataSufficient,
  };
}

/** Build a governance timeline (Incident → Recommendation → Approval → Release → Observation → Closed). */
export function buildGovernanceTimeline(decisions: OperationsDecision[], approvals: OperationsApproval[]): GovTimelineEntry[] {
  const entries: GovTimelineEntry[] = [];
  for (const d of decisions) {
    const stage: GovStage = d.kind === 'INCIDENT' ? 'INCIDENT' : d.kind === 'RELEASE' ? 'RELEASE' : 'RECOMMENDATION';
    entries.push({ at: d.createdAt, stage, label: d.title, actor: d.createdBy, detail: `${d.recommendation} · ${d.status}` });
  }
  for (const a of approvals) {
    const stage: GovStage = a.choice === 'APPROVE' ? 'APPROVAL' : a.choice === 'REJECT' ? 'CLOSED' : 'OBSERVATION';
    entries.push({ at: a.createdAt, stage, label: `Approval: ${a.choice}`, actor: a.actor, detail: a.reason ?? '' });
  }
  return entries.sort((x, y) => x.at.localeCompare(y.at));
}
