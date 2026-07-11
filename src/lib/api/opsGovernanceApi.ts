// WEB-OBS-9 — Operations Governance API. Composes the decision-SUPPORT engines over WEB-OBS-7/8 data and
// wraps the 0462 governance RPCs (super-admin). Read-only analysis + operator-initiated audit records.
// Nothing here executes a release/rollback/release-block/Player action — the write RPCs record only.

import { supabase } from '@/lib/supabase';
import { rowToAggregate, type SqeRow, type SqWindow } from './streamingQualityApi';
import { getQualityMatrix, getStoreReplay } from './streamingOpsApi';
import { computeStreamingQuality } from '@/lib/streamingQuality';
import { computeReliabilityIndex, computeSignalCoverage } from '@/lib/streamingOps';
import { computeQualityRegression, detectQualityIncidents } from '@/lib/streamingQuality/analysis';
import {
  computeReleaseReadiness, recommendForRelease, recommendForIncidents, analyzeChangeImpact,
  buildEvidencePackage, evidenceToMarkdown, buildExecutiveReport, buildGovernanceTimeline,
  type ReleaseReadiness, type DecisionRecommendation, type ChangeImpact, type EvidencePackage,
  type ExecutiveReport, type GovernanceOverview, type OperationsDecision, type OperationsApproval,
  type OperationsRule, type Playbook, type GovTimelineEntry, type ApprovalChoice,
} from '@/lib/opsGovernance';

export type { SqWindow } from './streamingQualityApi';

// ── Release readiness + recommendations + change impact (composed from analytics) ──
export interface ReleaseReadinessBundle {
  window: SqWindow;
  baseline: string | null;
  readiness: ReleaseReadiness[];
  recommendations: DecisionRecommendation[];
  impacts: ChangeImpact[];
}

export async function getReleaseReadiness(window: SqWindow = '7d', environment: string | null = null): Promise<ReleaseReadinessBundle | null> {
  const { data, error } = await supabase.rpc('admin_streaming_quality_overview', { p_window: window, p_environment: environment, p_release: null });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; overall?: SqeRow; by_release?: SqeRow[] };
  if (!res.ok || !res.overall) return null;

  // fleet browser diversity (proxy applied per release)
  let browsers = 1;
  try { const m = await getQualityMatrix('browser', window, environment); browsers = Math.max(1, m?.cells.length ?? 1); } catch { /* noop */ }

  const perRelease = (res.by_release ?? []).map((r) => {
    const agg = rowToAggregate(r);
    return { scope: r.scope, stores: r.stores ?? 0, agg, q: computeStreamingQuality(agg) };
  });
  const ranked = [...perRelease].filter((r) => r.q.sessions > 0).sort((a, b) => b.q.sessions - a.q.sessions);
  const base = ranked[0] ?? null;

  const readiness: ReleaseReadiness[] = [];
  const recommendations: DecisionRecommendation[] = [];
  const impacts: ChangeImpact[] = [];

  for (const r of perRelease) {
    const isBase = base != null && r.scope === base.scope;
    const regression = base && !isBase ? computeQualityRegression(base.q, r.q) : null;
    const criticalIncidents = detectQualityIncidents(base && !isBase ? base.q : null, r.q, r.scope).filter((i) => i.severity === 'CRITICAL').length;
    const coverage = computeSignalCoverage(r.agg).overall;
    const rr = computeReleaseReadiness({
      release: r.scope, quality: r.q, reliability: computeReliabilityIndex(r.q), regression,
      coverage, stores: r.stores, browsers, criticalIncidents,
    });
    readiness.push(rr);
    recommendations.push(...recommendForRelease(rr));
    if (base && !isBase) impacts.push(analyzeChangeImpact(base.q, r.q));
  }
  // fleet incident recommendations (overall)
  recommendations.push(...recommendForIncidents(detectQualityIncidents(null, computeStreamingQuality(rowToAggregate(res.overall)))));

  return { window, baseline: base?.scope ?? null, readiness, recommendations, impacts };
}

// ── Governance state (0462 RPCs) ──
export interface GovernanceState {
  overview: GovernanceOverview | null;
  queue: OperationsDecision[];
  history: { decisions: OperationsDecision[]; approvals: OperationsApproval[] };
  timeline: GovTimelineEntry[];
  rules: OperationsRule[];
}

export async function getGovernanceState(): Promise<GovernanceState> {
  const [ov, q, h, r] = await Promise.allSettled([
    supabase.rpc('admin_operations_overview'),
    supabase.rpc('admin_operations_queue', { p_limit: 100 }),
    supabase.rpc('admin_operations_history', { p_limit: 200 }),
    supabase.rpc('admin_operations_rules'),
  ]);
  const ovData = ov.status === 'fulfilled' && !ov.value.error ? (ov.value.data as GovernanceOverview & { ok?: boolean }) : null;
  const queue = q.status === 'fulfilled' && !q.value.error ? ((q.value.data as { decisions?: OperationsDecision[] })?.decisions ?? []) : [];
  const hist = h.status === 'fulfilled' && !h.value.error ? (h.value.data as { decisions?: OperationsDecision[]; approvals?: OperationsApproval[] }) : { decisions: [], approvals: [] };
  const decisions = hist.decisions ?? []; const approvals = hist.approvals ?? [];
  const rules = r.status === 'fulfilled' && !r.value.error ? ((r.value.data as { rules?: OperationsRule[] })?.rules ?? []) : [];
  return {
    overview: ovData?.ok ? ovData : null,
    queue,
    history: { decisions, approvals },
    timeline: buildGovernanceTimeline(decisions, approvals),
    rules,
  };
}

export async function getPlaybooks(): Promise<Playbook[]> {
  const { data, error } = await supabase.rpc('admin_operations_playbooks');
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; playbooks?: Playbook[] };
  return res.ok ? (res.playbooks ?? []) : [];
}

// ── Operator-initiated writes (record only — never executes a release/rollback/Player action) ──
export async function recordDecision(input: { scope: string; kind: string; title: string; recommendation: string; confidence?: number | null; payload?: unknown }): Promise<string | null> {
  const { data, error } = await supabase.rpc('record_operations_decision', {
    p_scope: input.scope, p_kind: input.kind, p_title: input.title, p_recommendation: input.recommendation,
    p_confidence: input.confidence ?? null, p_payload: (input.payload ?? null) as never,
  });
  if (error) throw error;
  return ((data ?? {}) as { id?: string }).id ?? null;
}

export async function recordApproval(decisionId: string, choice: ApprovalChoice, reason: string | null): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_operations_approval', { p_decision_id: decisionId, p_choice: choice, p_reason: reason });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}

export async function upsertRule(input: { key: string; label: string; threshold?: number | null; weight?: number | null; enabled: boolean }): Promise<boolean> {
  const { data, error } = await supabase.rpc('upsert_operations_rule', {
    p_key: input.key, p_label: input.label, p_threshold: input.threshold ?? null, p_weight: input.weight ?? null, p_enabled: input.enabled,
  });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}

// ── Executive report (composed) ──
export async function getExecutiveReport(window: SqWindow = '7d'): Promise<ExecutiveReport | null> {
  const [readiness, gov] = await Promise.allSettled([getReleaseReadiness(window), getGovernanceState()]);
  const rb = readiness.status === 'fulfilled' ? readiness.value : null;
  const gv = gov.status === 'fulfilled' ? gov.value : null;
  const overall = rb?.readiness.reduce((s, r) => s + (r.sessions ?? 0), 0) ?? 0;
  const avgReliability = rb && rb.readiness.length ? rb.readiness.reduce((s, r) => s + (r.components.find((c) => c.key === 'reliability')?.score ?? 0), 0) / rb.readiness.length : null;
  const avgAvailability = rb && rb.readiness.length ? rb.readiness.reduce((s, r) => s + (r.components.find((c) => c.key === 'streamingQuality')?.score ?? 0), 0) / rb.readiness.length : null;
  const majorIncidents = rb?.readiness.reduce((s, r) => s + r.criticalIncidents, 0) ?? 0;
  const recs = rb?.recommendations.filter((r) => r.urgency === 'CRITICAL' || r.urgency === 'HIGH').map((r) => `${r.scope}: ${r.action} — ${r.reason}`) ?? [];
  return buildExecutiveReport({
    window, availability: avgAvailability, reliability: avgReliability, sessions: overall,
    releasesReviewed: rb?.readiness.length ?? 0,
    approvals: gv?.overview?.approvals7d ?? 0,
    rejectedReleases: gv?.overview?.rejected7d ?? 0,
    majorIncidents,
    recommendations: recs,
  });
}

// ── Evidence package for a store/incident (composed from WEB-OBS-8 replay + root-cause) ──
export async function getEvidencePackage(store: string, window: SqWindow = '24h'): Promise<{ pkg: EvidencePackage; markdown: string } | null> {
  const bundle = await getStoreReplay(store, null, window);
  if (!bundle) return null;
  const rc = bundle.rootCause;
  const pkg = buildEvidencePackage({
    incidentKey: `${store}:${rc.verdict}`, scope: store, title: `Store Evidence — ${rc.verdict}`,
    replay: bundle.replay, rootCause: rc,
    metrics: [{ label: 'Root Cause', value: rc.verdict }, { label: 'Confidence', value: rc.confidence == null ? 'INSUFFICIENT' : `${rc.confidence}%` }],
    affectedStores: 1, affectedSessions: null, regression: 'N/A', relatedRelease: bundle.replay.steps[0]?.detail ? null : null,
  });
  return { pkg, markdown: evidenceToMarkdown(pkg) };
}
