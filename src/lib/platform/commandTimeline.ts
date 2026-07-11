// WEB-OPS-10 — Command Timeline. Merges operational events from every layer (releases, streaming
// incidents, recommendations, governance approvals) into one time-ordered stream. Read-only view.

import type { CommandEvent, CommandStage } from './types';
import type { GovTimelineEntry } from '../opsGovernance';
import type { QualityIncident } from '../streamingQuality/analysis';

export interface CommandTimelineInput {
  governance: GovTimelineEntry[];
  incidents: QualityIncident[];              // current incidents (no timestamp → stamped by caller with `now`)
  incidentAt: string;
  releases: Array<{ release: string; status: string; at: string }>;
}

const GOV_STAGE: Record<string, CommandStage> = {
  INCIDENT: 'INCIDENT', RECOMMENDATION: 'RECOMMENDATION', APPROVAL: 'APPROVAL',
  RELEASE: 'RELEASE', OBSERVATION: 'OBSERVATION', CLOSED: 'RESOLVED',
};

/** Merge all sources into a single ordered command timeline. */
export function buildCommandTimeline(input: CommandTimelineInput): CommandEvent[] {
  const out: CommandEvent[] = [];

  for (const g of input.governance) {
    out.push({ at: g.at, stage: GOV_STAGE[g.stage] ?? 'OBSERVATION', label: g.label, detail: g.detail, actor: g.actor });
  }
  for (const inc of input.incidents) {
    out.push({ at: input.incidentAt, stage: 'INCIDENT', label: inc.type, detail: `${inc.scope} · ${inc.severity}`, actor: null });
  }
  for (const r of input.releases) {
    out.push({ at: r.at, stage: 'RELEASE', label: `Release ${r.release}`, detail: r.status, actor: null });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
