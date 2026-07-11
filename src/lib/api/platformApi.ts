// WEB-OPS-10 — Unified Operations Platform API. Composes the Command Center bundle from the existing
// WEB-OBS super-admin APIs + the platform engines, and wraps the 0463 workspace/search RPCs. Read-only
// analysis + per-operator UI-state persistence. Nothing executes a release/rollback/Player action.

import { supabase } from '@/lib/supabase';
import { getOpsOverview, getEnterpriseHeatmap, getFleetReplay, type SqWindow } from './streamingOpsApi';
import { getReleaseReadiness, getGovernanceState } from './opsGovernanceApi';
import { detectQualityIncidents } from '@/lib/streamingQuality/analysis';
import {
  computePlatformScore, computeSlaMetrics, buildExecutiveSummary, buildCommandTimeline, searchPlatform,
  normalizeLayout,
  type PlatformScore, type SlaMetrics, type ExecutiveSummary, type CommandEvent, type GlobalHealth,
  type SearchableEntity, type SearchResult, type SavedWorkspace, type OperationsPreferences, type WorkspaceLayout,
} from '@/lib/platform';

export type { SqWindow } from './streamingOpsApi';

export interface PlatformCenter {
  window: SqWindow;
  globalHealth: GlobalHealth;
  platformScore: PlatformScore;
  sla: SlaMetrics;
  executiveSummary: ExecutiveSummary;
  commandTimeline: CommandEvent[];
  searchable: SearchableEntity[];
  // pass-throughs for the tab views (already computed by the WEB-OBS APIs; null when their RPC failed)
  overview: Awaited<ReturnType<typeof getOpsOverview>>;
  readiness: Awaited<ReturnType<typeof getReleaseReadiness>>;
  governance: Awaited<ReturnType<typeof getGovernanceState>> | null;
  enterprise: Awaited<ReturnType<typeof getEnterpriseHeatmap>> | null;
  fleet: Awaited<ReturnType<typeof getFleetReplay>>;
}

/** Compose the whole Command Center bundle from the existing observability APIs + platform engines. */
export async function getPlatformCenter(window: SqWindow = '24h'): Promise<PlatformCenter | null> {
  const [ovR, rdR, gvR, entR, fltR] = await Promise.allSettled([
    getOpsOverview(window), getReleaseReadiness(window === '1h' ? '24h' : window), getGovernanceState(),
    getEnterpriseHeatmap(window), getFleetReplay(window, 5),
  ]);
  const overview = ovR.status === 'fulfilled' ? ovR.value : null;
  const readiness = rdR.status === 'fulfilled' ? rdR.value : null;
  const governance = gvR.status === 'fulfilled' ? gvR.value : null;
  const enterprise = entR.status === 'fulfilled' ? entR.value : null;
  const fleet = fltR.status === 'fulfilled' ? fltR.value : null;
  if (!overview && !readiness && !governance) return null;

  const q = overview?.overall ?? null;
  const availabilitySub = overview?.reliability.subs.find((s) => s.key === 'availability')?.score ?? null;
  const availability = availabilitySub ?? (q?.start.successRate != null ? q.start.successRate * 100 : null);
  const incidents = q ? detectQualityIncidents(null, q) : [];
  const criticalIncidents = incidents.filter((i) => i.severity === 'CRITICAL').length + (readiness?.readiness.reduce((s, r) => s + r.criticalIncidents, 0) ?? 0);
  const highIncidents = incidents.filter((i) => i.severity === 'HIGH').length;
  const mediumIncidents = incidents.filter((i) => i.severity === 'MEDIUM').length;
  const sessions = q?.sessions ?? 0;
  const coverage = overview?.coverage.overall ?? null;
  const confidences = (readiness?.readiness ?? []).map((r) => r.confidence).filter((c): c is number => c != null);
  const avgConfidence = confidences.length ? confidences.reduce((s, c) => s + c, 0) / confidences.length : null;
  const governanceOpen = governance?.overview?.openDecisions ?? 0;

  const platformScore = computePlatformScore({
    availability, streaming: q?.score ?? null, reliability: overview?.reliability.index ?? null,
    governanceOpen, criticalIncidents, highIncidents, coverage, confidence: avgConfidence, sessions,
  });

  // Command timeline (governance + incidents + releases).
  const nowIso = fleet?.snapshots?.[fleet.snapshots.length - 1]?.bucketStart ?? governance?.timeline?.[0]?.at ?? '1970-01-01T00:00:00Z';
  const releaseEvents = (readiness?.readiness ?? []).map((r) => ({ release: r.release, status: r.status, at: nowIso }));
  const commandTimeline = buildCommandTimeline({ governance: governance?.timeline ?? [], incidents, incidentAt: nowIso, releases: releaseEvents });

  const sla = computeSlaMetrics({
    sessions, availability, recoverySucceeded: q?.recovery.succeeded ?? 0, recoveryAttempted: q?.recovery.attempted ?? 0,
    badSessions: q?.mediaError.events ?? 0, incidentCount: criticalIncidents + highIncidents,
  }, commandTimeline);

  const hasBlockingRelease = (readiness?.readiness ?? []).some((r) => r.status === 'BLOCK_RECOMMENDED');
  const executiveSummary = buildExecutiveSummary({
    window, platformScore: platformScore.score, sessions, hasBlockingRelease, criticalIncidents, highIncidents, mediumIncidents,
    recoveryRate: q?.recovery.successRate ?? null,
  });

  // Global health KPIs.
  const entRows = enterprise && enterprise.available ? enterprise.rows : [];
  const enterpriseHealth = entRows.length ? entRows.reduce((s, r) => s + (r.score ?? 0), 0) / entRows.length : null;
  const lastFleet = fleet?.snapshots?.[fleet.snapshots.length - 1] ?? null;
  const storeAvailability = lastFleet && lastFleet.total > 0 ? (lastFleet.healthy / lastFleet.total) * 100 : availability;
  const openRecommendations = (readiness?.recommendations ?? []).filter((r) => r.urgency === 'CRITICAL' || r.urgency === 'HIGH').length;
  const worstReadiness = (readiness?.readiness ?? []).map((r) => r.status);
  const releaseReadiness = worstReadiness.includes('BLOCK_RECOMMENDED') ? 'BLOCK_RECOMMENDED'
    : worstReadiness.includes('HIGH_RISK') ? 'HIGH_RISK'
    : worstReadiness.includes('REVIEW_REQUIRED') ? 'REVIEW_REQUIRED'
    : worstReadiness.includes('READY') ? 'READY' : 'INSUFFICIENT_DATA';

  const globalHealth: GlobalHealth = {
    platformAvailability: availability == null ? null : Math.round(availability * 10) / 10,
    streamingReliability: overview?.reliability.index ?? null,
    enterpriseHealth: enterpriseHealth == null ? null : Math.round(enterpriseHealth * 10) / 10,
    storeAvailability: storeAvailability == null ? null : Math.round(storeAvailability * 10) / 10,
    criticalIncidents, openRecommendations, releaseReadiness, governanceQueue: governanceOpen,
  };

  // Searchable entities (client-side unified search corpus).
  const searchable: SearchableEntity[] = [];
  for (const r of readiness?.readiness ?? []) searchable.push({ kind: 'release', id: r.release, label: `Release ${r.release}`, detail: r.status });
  for (const r of readiness?.recommendations ?? []) searchable.push({ kind: 'recommendation', id: r.id, label: r.action, detail: `${r.scope} · ${r.reason}` });
  for (const b of entRows) searchable.push({ kind: 'enterprise', id: b.brand, label: b.brand, detail: `${b.stores} stores` });
  for (const i of incidents) searchable.push({ kind: 'incident', id: `${i.scope}:${i.type}`, label: i.type, detail: `${i.scope} · ${i.severity}` });
  for (const d of governance?.queue ?? []) searchable.push({ kind: 'decision', id: d.id, label: d.title, detail: `${d.recommendation} · ${d.status}` });

  return { window, globalHealth, platformScore, sla, executiveSummary, commandTimeline, searchable, overview, readiness, governance, enterprise, fleet };
}

// ── Unified search (governance decisions via RPC + client corpus) ──
export async function searchGovernanceDecisions(query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc('admin_operations_search', { p_query: query, p_limit: 50 });
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; results?: SearchResult[] };
  return res.ok ? (res.results ?? []) : [];
}
export function searchLocal(query: string, corpus: SearchableEntity[]): SearchResult[] { return searchPlatform(query, corpus); }

// ── Workspace persistence (0463 RPCs — per-operator UI state) ──
export async function getWorkspace(): Promise<{ workspaces: SavedWorkspace[]; preferences: OperationsPreferences | null }> {
  const { data, error } = await supabase.rpc('get_operations_workspace');
  if (error) throw error;
  const res = (data ?? {}) as { ok?: boolean; workspaces?: Array<{ id: string; name: string; layout: unknown; isDefault: boolean; updatedAt: string }>; preferences?: { defaultWindow?: string; defaultFilters?: Record<string, unknown> } | null };
  const workspaces: SavedWorkspace[] = (res.workspaces ?? []).map((w) => ({ id: w.id, name: w.name, layout: normalizeLayout(w.layout), isDefault: w.isDefault, updatedAt: w.updatedAt }));
  const preferences = res.preferences ? { defaultWindow: res.preferences.defaultWindow ?? '24h', defaultFilters: (res.preferences.defaultFilters ?? {}) as OperationsPreferences['defaultFilters'] } : null;
  return { workspaces, preferences };
}
export async function saveWorkspace(name: string, layout: WorkspaceLayout, isDefault: boolean, id: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('upsert_operations_workspace', { p_name: name, p_layout: layout as unknown as Record<string, unknown>, p_is_default: isDefault, p_id: id });
  if (error) throw error;
  return ((data ?? {}) as { id?: string }).id ?? null;
}
export async function deleteWorkspace(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('delete_operations_workspace', { p_id: id });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
export async function savePreferences(window: string, filters: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabase.rpc('upsert_operations_preferences', { p_window: window, p_filters: filters });
  if (error) throw error;
  return ((data ?? {}) as { ok?: boolean }).ok === true;
}
