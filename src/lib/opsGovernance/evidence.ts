// WEB-OBS-9 — Operational Evidence Package. Assembles a shareable, PII-free evidence bundle for an
// incident/scope from already-computed WEB-OBS-8 replay + root-cause + metrics. Exportable to a plain
// text/markdown blob the browser can print to PDF (no PDF dependency, no external service).

import type { PlaybackReplay, RootCauseEvidence } from '../streamingOps';
import type { EvidencePackage } from './types';

export interface EvidenceInput {
  incidentKey: string;
  scope: string;
  title: string;
  replay: PlaybackReplay | null;
  rootCause: RootCauseEvidence | null;
  metrics: Array<{ label: string; value: string }>;
  affectedStores: number | null;
  affectedSessions: number | null;
  regression: string;
  relatedRelease: string | null;
}

/** Build the evidence package (data only — rendering/print handled by the UI). */
export function buildEvidencePackage(input: EvidenceInput): EvidencePackage {
  return {
    incidentKey: input.incidentKey,
    generatedFor: input.scope,
    title: input.title,
    timeline: (input.replay?.steps ?? []).slice(0, 100).map((s) => ({ at: s.at, label: s.label, detail: s.detail })),
    metrics: input.metrics,
    affectedStores: input.affectedStores,
    affectedSessions: input.affectedSessions,
    regression: input.regression,
    relatedRelease: input.relatedRelease,
    rootCauseChain: (input.rootCause?.chain ?? []).map((c) => `${c.signal}: ${c.observed}`),
    caveat: input.rootCause?.caveat ?? '증거는 상관관계이며 인과를 완전 증명하지 않습니다. 운영자 확인 필요.',
  };
}

/** Render the package to a self-contained markdown string (for download / print-to-PDF). */
export function evidenceToMarkdown(pkg: EvidencePackage): string {
  const lines: string[] = [];
  lines.push(`# Operational Evidence Package — ${pkg.title}`, '');
  lines.push(`- Incident: ${pkg.incidentKey}`);
  lines.push(`- Scope: ${pkg.generatedFor}`);
  lines.push(`- Related Release: ${pkg.relatedRelease ?? 'N/A'}`);
  lines.push(`- Affected Stores: ${pkg.affectedStores ?? 'N/A'} · Affected Sessions: ${pkg.affectedSessions ?? 'N/A'}`);
  lines.push(`- Regression: ${pkg.regression}`, '');
  lines.push('## Metrics');
  for (const m of pkg.metrics) lines.push(`- ${m.label}: ${m.value}`);
  lines.push('', '## Root-Cause Chain');
  if (pkg.rootCauseChain.length === 0) lines.push('- (근거 부족)');
  else pkg.rootCauseChain.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
  lines.push('', '## Timeline');
  if (pkg.timeline.length === 0) lines.push('- NO DATA');
  else for (const t of pkg.timeline) lines.push(`- ${t.at} · ${t.label} — ${t.detail}`);
  lines.push('', `> ${pkg.caveat}`);
  return lines.join('\n');
}
