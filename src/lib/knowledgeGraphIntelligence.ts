/**
 * knowledgeGraphIntelligence — Enterprise Knowledge Graph 순수 로직 (Phase AI-OPS-10).
 *
 * Entity Inventory → Relationship Map → Dependency/Impact/Lineage →
 * Orphan/Duplicate/Cycle/SPOF/Conflict → Graph Risk → Recommendation → Human Review.
 *
 * 원칙:
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어 · Date 주입 · Cycle 방어 · Depth/Node clamp.
 *  - inferred_reference 는 confirmed 로 승격하지 않는다. 시간 상관 ≠ 인과.
 *  - 관계 존재 ≠ 업무 실행 보장(재생/지급/적용 아님). 데이터 없으면 insufficient_data(0 변환 금지).
 *  - 분석 전용 — Production Entity/FK/관계 변경 없음. 자동 삭제/병합/생성 없음.
 */
import { isFiniteNumber, clampScore, normalizeAvailableComponents } from './aiMemory';

/* ── 타입 ─────────────────────────────────────────────────────────────── */
export type EvidenceType = 'explicit_fk' | 'explicit_code_reference' | 'explicit_rpc_join' | 'explicit_view_join'
  | 'explicit_snapshot_reference' | 'audit_reference' | 'event_reference' | 'external_reference' | 'inferred_reference' | 'unknown';
export type EvidenceStrength = 'confirmed' | 'strong' | 'moderate' | 'weak' | 'unverified' | 'insufficient_data';

export interface KGEntity { id: string; entityType: string; domain: string; label: string; lifecycleStatus?: string | null }
export interface KGEdge {
  id?: string; type: string; source: string; target: string;
  evidenceType: EvidenceType; evidenceStrength: EvidenceStrength; evidenceSource?: string;
}

export const MAX_GRAPH_DEPTH_DEFAULT = 3;
export const MAX_GRAPH_DEPTH_CLAMP = 5;
export const MAX_GRAPH_NODES = 500;

const clampDepth = (d: number | null | undefined): number =>
  Math.max(1, Math.min(MAX_GRAPH_DEPTH_CLAMP, isFiniteNumber(d) ? Math.floor(d) : MAX_GRAPH_DEPTH_DEFAULT));

/* ── Evidence 분류(inferred → confirmed 금지) ────────────────────────── */
const EVIDENCE_CEILING: Record<EvidenceType, EvidenceStrength> = {
  explicit_fk: 'confirmed',
  explicit_rpc_join: 'strong',
  explicit_view_join: 'strong',
  explicit_code_reference: 'moderate',
  explicit_snapshot_reference: 'moderate',
  audit_reference: 'weak',          // audit payload 문자열만으로 confirmed 금지
  event_reference: 'weak',
  external_reference: 'unverified', // 외부 실체 내부 보장 불가
  inferred_reference: 'weak',       // confirmed/strong 절대 금지(0513 CHECK 와 일치)
  unknown: 'insufficient_data',
};

/** evidence_type 별 최대 강도 — explicit_fk 도 업무 의미까지 보장하지 않음(note). */
export function calculateEvidenceStrength(evidenceType: EvidenceType): { strength: EvidenceStrength; note: string } {
  const strength = EVIDENCE_CEILING[evidenceType] ?? 'insufficient_data';
  const note = evidenceType === 'explicit_fk' ? 'FK 확인 — 업무 의미(재생/지급/적용)까지 보장 아님'
    : evidenceType === 'inferred_reference' ? '추정 참조 — confirmed 표시 금지'
    : evidenceType === 'external_reference' ? '외부 참조 — 내부에서 실체 미보장'
    : evidenceType === 'unknown' ? '근거 미확인 — evidence_unverified' : '구조적 근거';
  return { strength, note };
}

/** 강도 검증 — inferred/외부/audit 계열이 confirmed 로 들어오면 위반. */
export function classifyRelationshipEvidence(edge: Pick<KGEdge, 'evidenceType' | 'evidenceStrength'>): { valid: boolean; violation: string | null } {
  const ceiling = EVIDENCE_CEILING[edge.evidenceType] ?? 'insufficient_data';
  const order: EvidenceStrength[] = ['insufficient_data', 'unverified', 'weak', 'moderate', 'strong', 'confirmed'];
  if (order.indexOf(edge.evidenceStrength) > order.indexOf(ceiling)) {
    return { valid: false, violation: `${edge.evidenceType} 는 최대 ${ceiling} — ${edge.evidenceStrength} 표시 금지` };
  }
  return { valid: true, violation: null };
}

/* ── Graph 구축/탐색(무제한 재귀 금지) ───────────────────────────────── */
export interface KGGraph {
  nodeIds: string[]; out: Map<string, KGEdge[]>; incoming: Map<string, KGEdge[]>;
  truncated: boolean;
}

/** 인접 구조 — 노드 clamp(대형 그래프 전체 반환 금지). */
export function buildKnowledgeGraph(entities: KGEntity[], edges: KGEdge[], maxNodes = MAX_GRAPH_NODES): KGGraph {
  const limited = entities.slice(0, Math.max(1, maxNodes));
  const idSet = new Set(limited.map((e) => e.id));
  const out = new Map<string, KGEdge[]>(); const incoming = new Map<string, KGEdge[]>();
  for (const e of edges) {
    if (!idSet.has(e.source) || !idSet.has(e.target)) continue;   // 미존재 노드 edge 는 그래프에서 제외(별도 stale 검출)
    out.set(e.source, [...(out.get(e.source) ?? []), e]);
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
  }
  return { nodeIds: limited.map((e) => e.id), out, incoming, truncated: entities.length > limited.length };
}

export interface KGPath { nodes: string[]; edges: KGEdge[]; depth: number; weakestEvidence: EvidenceStrength }

const weakest = (edges: KGEdge[]): EvidenceStrength => {
  const order: EvidenceStrength[] = ['insufficient_data', 'unverified', 'weak', 'moderate', 'strong', 'confirmed'];
  return edges.reduce<EvidenceStrength>((acc, e) => (order.indexOf(e.evidenceStrength) < order.indexOf(acc) ? e.evidenceStrength : acc), 'confirmed');
};

function walk(graph: KGGraph, startId: string, dir: 'out' | 'incoming', maxDepth: number, maxPaths = 100): KGPath[] {
  const depth = clampDepth(maxDepth);
  const paths: KGPath[] = [];
  const dfs = (node: string, trail: string[], edges: KGEdge[]) => {
    if (paths.length >= maxPaths) return;
    if (edges.length > 0) paths.push({ nodes: [...trail], edges: [...edges], depth: edges.length, weakestEvidence: weakest(edges) });
    if (edges.length >= depth) return;
    for (const e of graph[dir].get(node) ?? []) {
      const next = dir === 'out' ? e.target : e.source;
      if (trail.includes(next)) continue;                          // cycle 방어
      dfs(next, [...trail, next], [...edges, e]);
    }
  };
  dfs(startId, [startId], []);
  return paths;
}

/** Downstream(하류 — start 가 source 인 방향) 경로. 깊이 clamp 1~5, 경로 100 제한. */
export function findDownstreamPaths(graph: KGGraph, startId: string, maxDepth = MAX_GRAPH_DEPTH_DEFAULT): KGPath[] {
  return walk(graph, startId, 'out', maxDepth);
}
/** Upstream(상류 — start 가 target 인 방향) 경로. */
export function findUpstreamPaths(graph: KGGraph, startId: string, maxDepth = MAX_GRAPH_DEPTH_DEFAULT): KGPath[] {
  return walk(graph, startId, 'incoming', maxDepth);
}

/* ── Orphan / Stale(자동 삭제 없음) ──────────────────────────────────── */
export type OrphanVerdict = 'no_known_orphan' | 'orphan_candidate' | 'stale_reference_candidate' | 'insufficient_data';
export interface OrphanCheck { entityType: string; requiredEdgeType: string; direction: 'out' | 'incoming'; note: string }

/** Orphan 후보 — 필수 관계 부재 = candidate 까지만(confirmed_orphan 은 사람 검토 결과). */
export function detectOrphanCandidates(entities: KGEntity[], edges: KGEdge[], checks: OrphanCheck[]): { entityId: string; label: string; verdict: OrphanVerdict; note: string }[] {
  if (!entities.length) return [];
  const bySrc = new Map<string, Set<string>>(); const byTgt = new Map<string, Set<string>>();
  for (const e of edges) {
    bySrc.set(e.source, (bySrc.get(e.source) ?? new Set()).add(e.type));
    byTgt.set(e.target, (byTgt.get(e.target) ?? new Set()).add(e.type));
  }
  const out: { entityId: string; label: string; verdict: OrphanVerdict; note: string }[] = [];
  for (const check of checks) {
    for (const ent of entities.filter((x) => x.entityType === check.entityType)) {
      const has = (check.direction === 'out' ? bySrc.get(ent.id) : byTgt.get(ent.id))?.has(check.requiredEdgeType) ?? false;
      out.push({
        entityId: ent.id, label: ent.label,
        verdict: has ? 'no_known_orphan' : 'orphan_candidate',
        note: has ? `${check.requiredEdgeType} 확인` : `${check.note} — 후보일 뿐(관계 데이터 부재 ≠ 관계 없음 단정 금지 · 자동 삭제 없음)`,
      });
    }
  }
  return out;
}

/** 미존재 노드를 참조하는 edge — stale_reference_candidate(삭제 단정 금지). */
export function detectStaleReferences(entities: KGEntity[], edges: KGEdge[]): { edgeType: string; source: string; target: string; verdict: 'stale_reference_candidate'; note: string }[] {
  const idSet = new Set(entities.map((e) => e.id));
  return edges.filter((e) => !idSet.has(e.source) || !idSet.has(e.target)).map((e) => ({
    edgeType: e.type, source: e.source, target: e.target, verdict: 'stale_reference_candidate' as const,
    note: '그래프에 없는 노드 참조 — 삭제된 Entity 로 단정 금지(bounded sample 밖일 수 있음)',
  }));
}

/* ── Duplicate 후보(자동 병합 없음) ──────────────────────────────────── */
export type DuplicateVerdict = 'no_known_duplicate' | 'possible_duplicate' | 'likely_duplicate' | 'insufficient_data';
export interface DuplicateItem { id: string; strongKeys: Record<string, string | null | undefined>; nameKey?: string | null }

/** 강한 키(code/ISRC/sha/계약번호) 일치 → likely, 이름만 일치 → possible(확정 금지). */
export function detectDuplicateCandidates(items: DuplicateItem[]): { ids: string[]; verdict: DuplicateVerdict; signal: string }[] {
  if (!items.length) return [];
  const out: { ids: string[]; verdict: DuplicateVerdict; signal: string }[] = [];
  const strongMap = new Map<string, string[]>();
  for (const it of items) for (const [k, v] of Object.entries(it.strongKeys ?? {})) {
    if (v == null || !String(v).trim()) continue;
    const key = `${k}:${String(v).trim().toLowerCase()}`;
    strongMap.set(key, [...(strongMap.get(key) ?? []), it.id]);
  }
  for (const [key, ids] of strongMap) if (ids.length > 1) out.push({ ids: [...ids].sort(), verdict: 'likely_duplicate', signal: key.split(':')[0] });
  const nameMap = new Map<string, string[]>();
  for (const it of items) {
    const n = it.nameKey?.trim().toLowerCase();
    if (!n) continue;
    nameMap.set(n, [...(nameMap.get(n) ?? []), it.id]);
  }
  for (const [, ids] of nameMap) if (ids.length > 1) {
    const sorted = [...ids].sort();
    if (!out.some((o) => o.ids.join(',') === sorted.join(','))) out.push({ ids: sorted, verdict: 'possible_duplicate', signal: 'name_only(확정 금지)' });
  }
  return out.sort((a, b) => a.ids[0].localeCompare(b.ids[0]));
}

/* ── Circular Dependency(자동 관계 삭제 없음) ────────────────────────── */
export type CycleVerdict = 'no_known_cycle' | 'potential_cycle' | 'confirmed_cycle' | 'critical_cycle' | 'insufficient_data';

/** 순환 감지 — 전부 confirmed/strong 근거면 confirmed, inferred 포함이면 potential.
 *  정산/지급/승인 도메인 순환은 critical. */
export function detectCircularDependencies(edges: KGEdge[], criticalTypes: string[] = ['settlement_uses_policy', 'payment_pays_subscription', 'decision_reviews_recommendation']): { cycles: string[][]; verdict: CycleVerdict } {
  if (!edges.length) return { cycles: [], verdict: 'insufficient_data' };
  const adj = new Map<string, KGEdge[]>();
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e]);
  const cycles: string[][] = []; const cycleEdges: KGEdge[][] = [];
  const state = new Map<string, 0 | 1 | 2>(); const stack: { node: string; edge: KGEdge | null }[] = [];
  const nodes = [...new Set(edges.flatMap((e) => [e.source, e.target]))].slice(0, MAX_GRAPH_NODES);
  const dfs = (n: string) => {
    state.set(n, 1);
    for (const e of adj.get(n) ?? []) {
      const s = state.get(e.target) ?? 0;
      if (s === 0) { stack.push({ node: e.target, edge: e }); dfs(e.target); stack.pop(); }
      else if (s === 1) {
        const idx = stack.findIndex((x) => x.node === e.target);
        const seg = idx >= 0 ? stack.slice(idx) : [];
        cycles.push([e.target, ...seg.map((x) => x.node === e.target ? '' : x.node).filter(Boolean), e.source, e.target].filter((v, i, a) => i === 0 || v !== a[i - 1]));
        cycleEdges.push([...seg.map((x) => x.edge).filter((x): x is KGEdge => !!x), e]);
      }
    }
    state.set(n, 2);
  };
  for (const n of nodes) if ((state.get(n) ?? 0) === 0) { stack.length = 0; stack.push({ node: n, edge: null }); dfs(n); }
  if (!cycles.length) return { cycles: [], verdict: 'no_known_cycle' };
  const anyCritical = cycleEdges.some((es) => es.some((e) => criticalTypes.includes(e.type)));
  if (anyCritical) return { cycles, verdict: 'critical_cycle' };
  const allStrong = cycleEdges.every((es) => es.every((e) => e.evidenceStrength === 'confirmed' || e.evidenceStrength === 'strong'));
  return { cycles, verdict: allStrong ? 'confirmed_cycle' : 'potential_cycle' };
}

/* ── Single Point of Failure(장애 확률 계산 금지 — 구조 분류만) ──────── */
export type SpofVerdict = 'resilient' | 'concentration_risk' | 'single_point_candidate' | 'critical_single_point' | 'insufficient_data';

export function detectSinglePointCandidate(input: { role: string; count: number | null; hasBackup: boolean | null; critical?: boolean }): { role: string; verdict: SpofVerdict; note: string } {
  if (!isFiniteNumber(input.count)) return { role: input.role, verdict: 'insufficient_data', note: '집계 데이터 없음 — 판정 금지' };
  if (input.count <= 0) return { role: input.role, verdict: 'insufficient_data', note: '대상 0 — 구조 판정 불가' };
  if (input.count === 1 && input.hasBackup !== true) {
    return input.critical
      ? { role: input.role, verdict: 'critical_single_point', note: '단일 + 백업 없음(critical 역할) — 구조 분류일 뿐 장애 확률 아님' }
      : { role: input.role, verdict: 'single_point_candidate', note: '단일 + 백업 미확인' };
  }
  if (input.count === 1 && input.hasBackup === true) return { role: input.role, verdict: 'concentration_risk', note: '단일이지만 백업 존재' };
  if (input.count === 2) return { role: input.role, verdict: 'concentration_risk', note: '2개 — 집중 위험' };
  return { role: input.role, verdict: 'resilient', note: `${input.count}개 분산` };
}

/* ── Relationship Conflict(데이터 손상 단정 금지) ────────────────────── */
export type ConflictVerdict = 'no_known_conflict' | 'potential_conflict' | 'conflict' | 'critical_conflict' | 'insufficient_data';

/** 다중 귀속 충돌 — 한 target(예: store)이 서로 다른 source(enterprise)에 복수 귀속. */
export function detectMultiParentConflicts(edges: KGEdge[], type: string): { target: string; sources: string[]; verdict: ConflictVerdict }[] {
  const rel = edges.filter((e) => e.type === type);
  if (!rel.length) return [];
  const byTarget = new Map<string, Set<string>>();
  for (const e of rel) byTarget.set(e.target, (byTarget.get(e.target) ?? new Set()).add(e.source));
  return [...byTarget.entries()].filter(([, s]) => s.size > 1)
    .map(([target, s]) => ({ target, sources: [...s].sort(), verdict: 'potential_conflict' as ConflictVerdict }))
    .sort((a, b) => a.target.localeCompare(b.target));
}

/** subject 불일치 — 예: settlement artist ≠ contract artist. 지급/정산 축은 critical. */
export function detectSubjectMismatch(input: { label: string; subjectA: string | null; subjectB: string | null; critical?: boolean }): { label: string; verdict: ConflictVerdict; note: string } {
  if (input.subjectA == null || input.subjectB == null) return { label: input.label, verdict: 'insufficient_data', note: '비교 대상 미확인 — 단정 금지' };
  if (input.subjectA === input.subjectB) return { label: input.label, verdict: 'no_known_conflict', note: '일치' };
  return {
    label: input.label, verdict: input.critical ? 'critical_conflict' : 'conflict',
    note: '불일치 — 실제 데이터 손상 단정 아님(사람 검토 필요)',
  };
}

/* ── Data Lineage ────────────────────────────────────────────────────── */
export type LineageVerdict = 'complete' | 'partial' | 'lineage_incomplete' | 'evidence_unverified' | 'insufficient_data';
export interface LineageStage { stage: 'source' | 'transformation' | 'aggregation' | 'decision_input' | 'recommendation_output' | 'human_decision' | 'audit'; evidence: EvidenceStrength | null }

export function evaluateDataLineage(stages: LineageStage[]): { verdict: LineageVerdict; missing: string[]; unverified: string[] } {
  if (!stages.length) return { verdict: 'insufficient_data', missing: [], unverified: [] };
  const missing = stages.filter((s) => s.evidence == null).map((s) => s.stage);
  const unverified = stages.filter((s) => s.evidence === 'unverified' || s.evidence === 'insufficient_data').map((s) => s.stage);
  if (missing.length === stages.length) return { verdict: 'insufficient_data', missing, unverified };
  if (missing.length > 0) return { verdict: missing.length >= stages.length / 2 ? 'lineage_incomplete' : 'partial', missing, unverified };
  if (unverified.length > 0) return { verdict: 'evidence_unverified', missing, unverified };
  return { verdict: 'complete', missing, unverified };
}

/* ── Blast Radius(Snapshot 기준 추정치) ──────────────────────────────── */
export interface BlastRadius {
  direct: string[]; indirect: string[]; affectedDomains: string[];
  maxDepthReached: number; unknownPaths: number; snapshotEstimate: true; note: string;
}

export function calculateBlastRadius(graph: KGGraph, entities: KGEntity[], startId: string, maxDepth = MAX_GRAPH_DEPTH_DEFAULT): BlastRadius {
  const domainOf = new Map(entities.map((e) => [e.id, e.domain]));
  const paths = [...findDownstreamPaths(graph, startId, maxDepth), ...findUpstreamPaths(graph, startId, maxDepth)];
  const direct = new Set<string>(); const indirect = new Set<string>(); let unknownPaths = 0; let maxD = 0;
  for (const p of paths) {
    maxD = Math.max(maxD, p.depth);
    if (p.weakestEvidence === 'unverified' || p.weakestEvidence === 'insufficient_data') unknownPaths += 1;
    for (let i = 1; i < p.nodes.length; i += 1) (i === 1 ? direct : indirect).add(p.nodes[i]);
  }
  for (const d of direct) indirect.delete(d);
  const affectedDomains = [...new Set([...direct, ...indirect].map((id) => domainOf.get(id)).filter((x): x is string => !!x))].sort();
  return {
    direct: [...direct].sort(), indirect: [...indirect].sort(), affectedDomains,
    maxDepthReached: maxD, unknownPaths, snapshotEstimate: true,
    note: 'Graph Snapshot 기준 추정치 — 실제 영향 확정 아님(bounded sample)',
  };
}

/* ── Cross-Domain Impact(재정규화) ───────────────────────────────────── */
export type ImpactLevel = 'negligible' | 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data';
const impactLevel = (s: number): Exclude<ImpactLevel, 'insufficient_data'> =>
  s < 10 ? 'negligible' : s < 30 ? 'low' : s < 55 ? 'moderate' : s < 80 ? 'high' : 'critical';

export function calculateCrossDomainImpact(components: { domain: string; value: number | null; weight: number }[]): { score: number | null; level: ImpactLevel; used: string[]; missing: string[]; noAutoAction: true } {
  const { score, used, missing } = normalizeAvailableComponents(components.map((c) => ({ key: c.domain, value: c.value, weight: c.weight })));
  if (score == null) return { score: null, level: 'insufficient_data', used, missing, noAutoAction: true };
  return { score, level: impactLevel(score), used, missing, noAutoAction: true };
}

/* ── Graph Risk(0~100 · conflict 우선) ───────────────────────────────── */
export interface GraphRiskComponents {
  orphanRisk: number | null; duplicateRisk: number | null; cycleRisk: number | null;
  spofRisk: number | null; conflictRisk: number | null; lineageGapRisk: number | null;
  inferredRatioRisk: number | null; staleRatioRisk: number | null; auditGapRisk: number | null;
}
export type GraphRiskLevel = 'low' | 'moderate' | 'high' | 'critical' | 'insufficient_data';

export function calculateGraphRisk(c: GraphRiskComponents): { score: number | null; used: string[]; missing: string[] } {
  const { score, used, missing } = normalizeAvailableComponents([
    { key: 'orphan', value: c.orphanRisk, weight: 0.12 },
    { key: 'duplicate', value: c.duplicateRisk, weight: 0.1 },
    { key: 'cycle', value: c.cycleRisk, weight: 0.1 },
    { key: 'spof', value: c.spofRisk, weight: 0.15 },
    { key: 'conflict', value: c.conflictRisk, weight: 0.2 },
    { key: 'lineage_gap', value: c.lineageGapRisk, weight: 0.12 },
    { key: 'inferred_ratio', value: c.inferredRatioRisk, weight: 0.08 },
    { key: 'stale_ratio', value: c.staleRatioRisk, weight: 0.05 },
    { key: 'audit_gap', value: c.auditGapRisk, weight: 0.08 },
  ]);
  return { score, used, missing };
}

/** 위험 상태 — 지급·정산 confirmed conflict 등 critical flag 는 점수와 무관하게 critical(자동 차단 없음). */
export function classifyGraphRisk(score: number | null, flags?: { criticalPaymentConflict?: boolean; sensitivePublicLink?: boolean; approvalSelfCycle?: boolean }): GraphRiskLevel {
  if (flags?.criticalPaymentConflict || flags?.sensitivePublicLink || flags?.approvalSelfCycle) return 'critical';
  if (!isFiniteNumber(score)) return 'insufficient_data';
  return score < 25 ? 'low' : score < 50 ? 'moderate' : score < 75 ? 'high' : 'critical';
}

/* ── Evidence Path(근거 없는 Edge 를 숨기지 않음) ────────────────────── */
export interface EvidencePathSegment { from: string; to: string; relationshipType: string; evidenceType: EvidenceType; evidenceSource: string; strength: EvidenceStrength; limitation: string }

export function buildEvidencePath(path: KGPath, labels: Map<string, string>): EvidencePathSegment[] {
  return path.edges.map((e) => ({
    from: labels.get(e.source) ?? e.source, to: labels.get(e.target) ?? e.target,
    relationshipType: e.type, evidenceType: e.evidenceType, evidenceSource: e.evidenceSource ?? 'unknown',
    strength: e.evidenceStrength,
    limitation: e.evidenceType === 'inferred_reference' ? '추정 참조 — 근거 미확정' : e.evidenceStrength === 'confirmed' ? 'FK 확인 — 업무 실행 보장 아님' : '구조 참조',
  }));
}

/* ── Graph Recommendation(Explainable · 자동 실행 없음) ──────────────── */
export const GRAPH_REC_TYPES = [
  'review_orphan_entity', 'review_duplicate_candidate', 'validate_inferred_relationship', 'repair_lineage_reference',
  'assign_entity_owner', 'assign_backup_owner', 'separate_conflicting_scope', 'review_circular_dependency',
  'reduce_single_point_dependency', 'validate_contract_settlement_link', 'validate_policy_scope',
  'add_relationship_audit', 'refresh_graph_snapshot', 'create_operational_work_item',
] as const;
export type GraphRecType = (typeof GRAPH_REC_TYPES)[number];

export interface GraphRecommendation {
  code: string; recType: GraphRecType; recommendation: string; reason: string;
  evidence: { label: string; value: number | string | null }[]; confidence: number;
  severity: 'low' | 'moderate' | 'high' | 'critical'; scope: string; affectedEntities: string[];
  expectedBenefit: string; preconditions: string[]; limitations: string[];
  humanApprovalRequired: true; noAutoExecution: true;
}

export function buildGraphRecommendation(input: {
  code: string; recType: GraphRecType; finding: string; affectedEntities: string[];
  evidenceCount: number | null; severity?: 'low' | 'moderate' | 'high' | 'critical';
}): GraphRecommendation | { insufficient: true; why: string } {
  if (!GRAPH_REC_TYPES.includes(input.recType)) return { insufficient: true, why: '허용되지 않는 추천 유형' };
  if (!input.finding?.trim()) return { insufficient: true, why: '실측 관찰 없음 — 추천 생성 금지' };
  if (!isFiniteNumber(input.evidenceCount) || input.evidenceCount < 1) return { insufficient: true, why: 'Evidence 없음 — 추천 생성 금지' };
  const confidence = clampScore(30 + Math.min(40, input.evidenceCount * 10) + (input.severity === 'critical' ? 10 : 0));
  return {
    code: input.code, recType: input.recType,
    recommendation: `[${input.recType}] ${input.finding} — 검토 제안(자동 조치 없음)`,
    reason: `그래프 관찰: ${input.finding} (evidence ${input.evidenceCount}건, snapshot 기준)`,
    evidence: [{ label: 'evidence_count', value: input.evidenceCount }, { label: 'affected_entities', value: input.affectedEntities.length }],
    confidence, severity: input.severity ?? 'moderate', scope: 'graph_snapshot',
    affectedEntities: [...input.affectedEntities].sort().slice(0, 50),
    expectedBenefit: '관계 무결성/거버넌스 근거 개선(검토 후 사람이 조치)',
    preconditions: ['Human Approval', 'Snapshot 최신성 확인', '원본 데이터 검증'],
    limitations: ['추천만 — 자동 Entity/관계 변경·삭제·병합·FK 생성 없음'],
    humanApprovalRequired: true, noAutoExecution: true,
  };
}

/* ── Review 검증 ─────────────────────────────────────────────────────── */
export type ReviewStatus = 'draft' | 'pending_review' | 'waiting_evidence' | 'validated_reference' | 'correction_recommended' | 'rejected' | 'cancelled' | 'expired' | 'invalidated';
const TERMINAL_REVIEW: ReviewStatus[] = ['validated_reference', 'correction_recommended', 'rejected', 'cancelled', 'expired', 'invalidated'];

export function canDecideReview(from: ReviewStatus): boolean { return !TERMINAL_REVIEW.includes(from); }

export function validateGraphReview(r: { reason?: string | null; evidence?: unknown[] | null } | null | undefined): string[] {
  if (!r) return ['review 없음'];
  const errors: string[] = [];
  if (!r.reason || !r.reason.trim()) errors.push('Reason 필수');
  if (!r.evidence || !r.evidence.length) errors.push('Evidence 필수(빈 배열 금지)');
  return errors;
}

export const EXTERNAL_ACTION_TYPES = [
  'entity_corrected_reference', 'relationship_corrected_reference', 'orphan_resolved_reference',
  'duplicate_merged_reference', 'scope_corrected_reference', 'owner_assigned_reference',
  'backup_owner_assigned_reference', 'foreign_key_added_reference', 'stale_reference_removed_reference',
] as const;

export function validateExternalCorrectionReference(actionType: string): boolean {
  return (EXTERNAL_ACTION_TYPES as readonly string[]).includes(actionType);
}

/* ── Support Matrix(정직 표기) ───────────────────────────────────────── */
export interface KGSupportItem { key: string; label: string; status: 'fully_supported' | 'partially_supported' | 'read_only' | 'evidence_only' | 'inferred_reference' | 'lineage_incomplete' | 'unsupported' | 'insufficient_data'; note: string }

export const KG_SUPPORT: KGSupportItem[] = [
  { key: 'entity_inventory', label: 'Entity Inventory', status: 'partially_supported', note: '검증 17종 · bounded sample(유형별≤200) · 마스킹 라벨' },
  { key: 'relationship_inventory', label: 'Relationship Inventory', status: 'partially_supported', note: '검증 15종 · 유형별≤300 · inferred≠confirmed CHECK 강제' },
  { key: 'organization_graph', label: 'Organization Graph', status: 'partially_supported', note: 'franchises/enterprise_accounts/store(users) — 별도 brands/stores 테이블 없음' },
  { key: 'content_graph', label: 'Content Graph', status: 'partially_supported', note: 'playlist↔track FK 확인 — track↔artist 는 inferred(FK 없음)' },
  { key: 'commercial_graph', label: 'Commercial Graph', status: 'fully_supported', note: '계약/구독/결제/정산/지급계좌 전부 explicit FK' },
  { key: 'governance_graph', label: 'Governance Graph', status: 'partially_supported', note: 'policy depends_on(code ref)/recommendation policy_code(FK 없음 — moderate)' },
  { key: 'incident_graph', label: 'Incident Graph', status: 'read_only', note: 'ai_incidents 노드만 — incident↔entity 관계 FK 없음(수동 검토)' },
  { key: 'dependency_graph', label: 'Dependency Graph', status: 'fully_supported', note: '1~3-hop(기본), clamp 5, 경로 100 제한, cycle 방어' },
  { key: 'upstream_downstream', label: 'Upstream/Downstream 분석', status: 'fully_supported', note: '방향 그래프 순수 로직' },
  { key: 'data_lineage', label: 'Data Lineage', status: 'lineage_incomplete', note: '7단계 선언 기반 — 전체 DB 자동 추적 불가(정직 표기)' },
  { key: 'organizational_intelligence', label: 'Organizational Intelligence', status: 'partially_supported', note: '개수 집계와 위험 해석 분리' },
  { key: 'orphan_detection', label: 'Orphan Detection', status: 'partially_supported', note: 'candidate 까지만 — confirmed 는 사람 검토 · 자동 삭제 없음' },
  { key: 'duplicate_detection', label: 'Duplicate Detection', status: 'partially_supported', note: '강한 키 → likely · 이름만 → possible(확정 금지) · 자동 병합 없음' },
  { key: 'circular_dependency', label: 'Circular Dependency', status: 'fully_supported', note: 'DFS 순환 감지 — 자동 관계 삭제 없음' },
  { key: 'single_point_detection', label: 'Single Point Detection', status: 'partially_supported', note: '구조 분류만 — 장애 확률 미계산' },
  { key: 'relationship_conflict', label: 'Relationship Conflict', status: 'partially_supported', note: '다중 귀속/subject 불일치 — 데이터 손상 단정 금지' },
  { key: 'cross_domain_impact', label: 'Cross-Domain Impact', status: 'partially_supported', note: '재정규화 — 실제 적용 없음' },
  { key: 'blast_radius', label: 'Blast Radius', status: 'evidence_only', note: 'Snapshot 기준 추정치 명시 — 실제 영향 확정 금지' },
  { key: 'graph_investigation', label: 'Graph Investigation', status: 'read_only', note: 'entity detail + 1-hop(각 100 제한)' },
  { key: 'evidence_path', label: 'Evidence Path', status: 'fully_supported', note: 'Edge 별 근거/강도/한계 표시 — 근거 없는 Edge 숨김 금지' },
  { key: 'graph_snapshot', label: 'Graph Snapshot', status: 'fully_supported', note: 'input_hash 중복 방지 — master data 아님' },
  { key: 'graph_risk', label: 'Graph Risk', status: 'partially_supported', note: '9성분 재정규화 · conflict 우선 · critical flag' },
  { key: 'graph_recommendation', label: 'Graph Recommendation', status: 'fully_supported', note: 'Explainable(Evidence/Confidence/Severity/Preconditions) — 자동 실행 없음' },
  { key: 'human_review', label: 'Human Review', status: 'fully_supported', note: '9상태 — validated_reference ≠ DB 관계 변경' },
  { key: 'external_correction_reference', label: 'External Correction Reference', status: 'evidence_only', note: '참고 기록만 — 실제 조치 미실행' },
  { key: 'graph_visualization_force', label: 'Force Graph 시각화', status: 'unsupported', note: '신규 그래프 라이브러리 미추가 — 리스트/경로 UI 로 대체(정직 표기)' },
  { key: 'brands_stores_tables', label: 'brands/stores/store_codes 테이블', status: 'unsupported', note: '테이블 미존재 — 매장 실체는 users(account_type=business)' },
  { key: 'contract_snapshots', label: 'Contract Snapshot Entity', status: 'unsupported', note: 'contract_snapshots/settlement_versions 테이블 미존재' },
  { key: 'external_system_graph', label: '외부 시스템 그래프', status: 'unsupported', note: 'external_reference_only — 내부 실체 미보장' },
  { key: 'auto_entity_mutation', label: '자동 Entity 생성/수정/삭제', status: 'unsupported', note: '금지' },
  { key: 'auto_relationship_mutation', label: '자동 관계 생성/변경/삭제', status: 'unsupported', note: '금지' },
  { key: 'auto_duplicate_merge', label: '자동 중복 병합', status: 'unsupported', note: '금지' },
  { key: 'auto_orphan_cleanup', label: '자동 Orphan 삭제', status: 'unsupported', note: '금지' },
  { key: 'auto_fk_creation', label: '자동 FK 생성', status: 'unsupported', note: '금지 — 원본 테이블 FK 변경 없음' },
  { key: 'production_apply', label: 'Production Apply/Merge/Deploy/Migration', status: 'unsupported', note: '금지' },
];
