// WEB-OBS-9 — Operations Governance & Autonomous Decision Support. Pure, rule-based (NO ML/LLM) decision-
// SUPPORT engines. Nothing here executes, merges, rolls back, blocks a release, or controls the Player —
// every output is advisory and requires operator approval; recording an approval is an audit record only.
export * from './types';
export * from './thresholds';
export { computeConfidence } from './confidence';
export { computeReleaseReadiness, type ReadinessInput } from './readiness';
export { recommendForRelease, recommendForIncidents } from './recommendations';
export { PLAYBOOKS, getPlaybook, allPlaybooks } from './playbooks';
export { computeEscalation } from './escalation';
export { analyzeChangeImpact } from './impact';
export { buildEvidencePackage, evidenceToMarkdown, type EvidenceInput } from './evidence';
export { buildExecutiveReport, buildGovernanceTimeline, type ExecReportInput } from './executiveReport';
