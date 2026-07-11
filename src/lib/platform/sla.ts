// WEB-OPS-10 — SLA metrics. Availability / recovery rate / incident rate / error budget are derived from
// streaming-quality aggregates. MTTR / MTBF are derived from the governance timeline (incident → resolution
// pairs) ONLY when enough resolved incidents exist — otherwise honestly INSUFFICIENT_DATA (they cannot be
// invented from telemetry alone). Read-only; nothing acts on these.

import { round, safeRatio } from '../observability/math';
import { SLA_ERROR_BUDGET, SLA_RECOVERY_GOOD, SLA_MIN_SESSIONS, SLA_MIN_INCIDENTS_FOR_MTTR } from './thresholds';
import type { SlaMetrics, SlaStatus, CommandEvent } from './types';

export interface SlaInput {
  sessions: number;
  availability: number | null;      // 0..100
  recoverySucceeded: number;
  recoveryAttempted: number;
  badSessions: number;              // sessions with a media error / catastrophic failure
  incidentCount: number;
}

/** Derive MTTR (mean minutes incident→resolution) and MTBF (mean hours between incidents) from a
 * time-ordered command timeline. Returns null when there are too few resolved incidents to average. */
export function deriveMttrMtbf(events: CommandEvent[]): { mttrMinutes: number | null; mtbfHours: number | null } {
  const incidents = events.filter((e) => e.stage === 'INCIDENT').map((e) => Date.parse(e.at)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  const resolutions = events.filter((e) => e.stage === 'RESOLVED').map((e) => Date.parse(e.at)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);

  // MTTR: pair each incident with the next resolution after it.
  const durations: number[] = [];
  for (const inc of incidents) {
    const res = resolutions.find((r) => r >= inc);
    if (res != null) durations.push((res - inc) / 60000);
  }
  const mttrMinutes = durations.length >= SLA_MIN_INCIDENTS_FOR_MTTR ? round(durations.reduce((s, v) => s + v, 0) / durations.length, 1) : null;

  // MTBF: mean gap between consecutive incidents.
  const gaps: number[] = [];
  for (let i = 1; i < incidents.length; i++) gaps.push((incidents[i] - incidents[i - 1]) / 3600000);
  const mtbfHours = gaps.length >= SLA_MIN_INCIDENTS_FOR_MTTR ? round(gaps.reduce((s, v) => s + v, 0) / gaps.length, 1) : null;

  return { mttrMinutes, mtbfHours };
}

export function computeSlaMetrics(input: SlaInput, timeline: CommandEvent[]): SlaMetrics {
  const notes: string[] = [];
  if (input.sessions < SLA_MIN_SESSIONS) {
    return { availability: null, recoveryRate: null, incidentRate: null, errorBudgetRemaining: null, mttrMinutes: null, mtbfHours: null, status: 'INSUFFICIENT_DATA', notes: [`표본 부족 (sessions ${input.sessions})`] };
  }
  const recoveryRate = input.recoveryAttempted > 0 ? safeRatio(input.recoverySucceeded, input.recoveryAttempted) : null;
  const incidentRate = round(safeRatio(input.incidentCount, input.sessions) * 1000, 2); // per 1k sessions
  const badRate = safeRatio(input.badSessions, input.sessions);
  const errorBudgetRemaining = round(Math.max(0, 1 - badRate / SLA_ERROR_BUDGET), 3);
  const { mttrMinutes, mtbfHours } = deriveMttrMtbf(timeline);
  if (mttrMinutes == null) notes.push('MTTR/MTBF: 해결된 incident 표본 부족 → INSUFFICIENT_DATA');

  let status: SlaStatus = 'OK';
  if (badRate >= SLA_ERROR_BUDGET) { status = 'BREACHED'; notes.push('error budget 소진'); }
  else if (badRate >= SLA_ERROR_BUDGET * 0.5) { status = 'AT_RISK'; notes.push('error budget 절반 소진'); }
  if (recoveryRate != null && recoveryRate < SLA_RECOVERY_GOOD) notes.push('recovery 성공률 낮음');

  return {
    availability: round(input.availability, 1),
    recoveryRate: round(recoveryRate, 3),
    incidentRate,
    errorBudgetRemaining,
    mttrMinutes,
    mtbfHours,
    status,
    notes: notes.length ? notes : ['정상 범위'],
  };
}
