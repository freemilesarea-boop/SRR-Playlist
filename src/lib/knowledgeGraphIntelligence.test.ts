// Phase AI-OPS-10 — Knowledge Graph 순수 로직 단위 테스트.
// Evidence(inferred≠confirmed) · Graph(hop/clamp/cycle 방어) · Orphan(자동 삭제 없음) ·
// Duplicate(이름만 확정 금지) · Cycle · SPOF(확률 미계산) · Conflict(손상 단정 금지) ·
// Lineage · Blast Radius(추정치) · Risk(재정규화·conflict 우선) · Recommendation · Review · Support.
import { describe, it, expect } from 'vitest';
import {
  calculateEvidenceStrength, classifyRelationshipEvidence, buildKnowledgeGraph,
  findDownstreamPaths, findUpstreamPaths, detectOrphanCandidates, detectStaleReferences,
  detectDuplicateCandidates, detectCircularDependencies, detectSinglePointCandidate,
  detectMultiParentConflicts, detectSubjectMismatch, evaluateDataLineage, calculateBlastRadius,
  calculateCrossDomainImpact, calculateGraphRisk, classifyGraphRisk, buildEvidencePath,
  buildGraphRecommendation, canDecideReview, validateGraphReview, validateExternalCorrectionReference,
  KG_SUPPORT, MAX_GRAPH_DEPTH_CLAMP,
  type KGEntity, type KGEdge,
} from './knowledgeGraphIntelligence';

const E = (id: string, entityType: string, domain = 'organization'): KGEntity => ({ id, entityType, domain, label: id });
const edge = (source: string, target: string, type = 'enterprise_operates_store', evidenceType: KGEdge['evidenceType'] = 'explicit_fk', evidenceStrength: KGEdge['evidenceStrength'] = 'confirmed'): KGEdge =>
  ({ type, source, target, evidenceType, evidenceStrength, evidenceSource: 'test' });

describe('Relationship Evidence(inferred ≠ confirmed)', () => {
  it('explicit_fk → confirmed(업무 의미 보장 아님 note) · inferred/audit/external 상한', () => {
    expect(calculateEvidenceStrength('explicit_fk').strength).toBe('confirmed');
    expect(calculateEvidenceStrength('explicit_fk').note).toContain('보장 아님');
    expect(calculateEvidenceStrength('inferred_reference').strength).toBe('weak');
    expect(calculateEvidenceStrength('audit_reference').strength).toBe('weak');
    expect(calculateEvidenceStrength('external_reference').strength).toBe('unverified');
    expect(calculateEvidenceStrength('unknown').strength).toBe('insufficient_data');
  });
  it('inferred 를 confirmed 로 표시하면 위반', () => {
    expect(classifyRelationshipEvidence({ evidenceType: 'inferred_reference', evidenceStrength: 'confirmed' }).valid).toBe(false);
    expect(classifyRelationshipEvidence({ evidenceType: 'audit_reference', evidenceStrength: 'confirmed' }).valid).toBe(false);
    expect(classifyRelationshipEvidence({ evidenceType: 'explicit_fk', evidenceStrength: 'confirmed' }).valid).toBe(true);
    expect(classifyRelationshipEvidence({ evidenceType: 'inferred_reference', evidenceStrength: 'weak' }).valid).toBe(true);
  });
});

describe('Dependency Graph(1~3-hop · clamp · cycle 방어)', () => {
  const ents = [E('ent', 'enterprise'), E('store', 'store'), E('pl', 'playlist', 'playlist'), E('tr', 'track', 'track')];
  const edges = [edge('ent', 'store'), edge('store', 'pl', 'store_uses_playlist'), edge('pl', 'tr', 'playlist_contains_track')];
  const g = buildKnowledgeGraph(ents, edges);
  it('downstream 1/2/3-hop + depth clamp(5 초과 금지) + upstream', () => {
    const down = findDownstreamPaths(g, 'ent', 3);
    expect(down.some((p) => p.depth === 1 && p.nodes.at(-1) === 'store')).toBe(true);
    expect(down.some((p) => p.depth === 3 && p.nodes.at(-1) === 'tr')).toBe(true);
    expect(findDownstreamPaths(g, 'ent', 1).every((p) => p.depth <= 1)).toBe(true);
    expect(findDownstreamPaths(g, 'ent', 99).every((p) => p.depth <= MAX_GRAPH_DEPTH_CLAMP)).toBe(true);
    const up = findUpstreamPaths(g, 'tr', 3);
    expect(up.some((p) => p.nodes.at(-1) === 'ent')).toBe(true);
  });
  it('cycle 이 있어도 무한 재귀 없음 · node clamp(truncated)', () => {
    const cyc = buildKnowledgeGraph([E('a', 'policy'), E('b', 'policy')], [edge('a', 'b', 'policy_depends_on_policy'), edge('b', 'a', 'policy_depends_on_policy')]);
    expect(findDownstreamPaths(cyc, 'a', 5).length).toBeGreaterThan(0);
    const big = buildKnowledgeGraph(Array.from({ length: 10 }, (_, i) => E(`n${i}`, 'user')), [], 3);
    expect(big.truncated).toBe(true); expect(big.nodeIds.length).toBe(3);
  });
  it('끊긴 그래프 — 경로를 임의로 연결하지 않음', () => {
    const dis = buildKnowledgeGraph([E('x', 'store'), E('y', 'track')], []);
    expect(findDownstreamPaths(dis, 'x', 3)).toEqual([]);
  });
});

describe('Orphan / Stale(자동 삭제 없음)', () => {
  it('필수 관계 부재 → orphan_candidate 까지만 · 있으면 no_known_orphan', () => {
    const ents = [E('s1', 'store'), E('s2', 'store'), E('e1', 'enterprise')];
    const r = detectOrphanCandidates(ents, [edge('e1', 's1')], [{ entityType: 'store', requiredEdgeType: 'enterprise_operates_store', direction: 'incoming', note: 'Enterprise 없는 Store' }]);
    expect(r.find((x) => x.entityId === 's1')!.verdict).toBe('no_known_orphan');
    const s2 = r.find((x) => x.entityId === 's2')!;
    expect(s2.verdict).toBe('orphan_candidate');
    expect(s2.note).toContain('자동 삭제 없음');
    expect(r.some((x) => (x.verdict as string) === 'confirmed_orphan')).toBe(false);
    expect(detectOrphanCandidates([], [], [])).toEqual([]);
  });
  it('미존재 노드 참조 edge → stale_reference_candidate(삭제 단정 금지)', () => {
    const r = detectStaleReferences([E('a', 'playlist')], [edge('a', 'ghost', 'playlist_contains_track')]);
    expect(r.length).toBe(1); expect(r[0].verdict).toBe('stale_reference_candidate');
    expect(r[0].note).toContain('단정 금지');
  });
});

describe('Duplicate(이름만 확정 금지 · 자동 병합 없음)', () => {
  it('강한 키 일치 likely · 이름만 possible · 없으면 빈 결과', () => {
    const r = detectDuplicateCandidates([
      { id: 't1', strongKeys: { audio_sha256: 'abc' }, nameKey: 'song' },
      { id: 't2', strongKeys: { audio_sha256: 'abc' }, nameKey: 'other' },
      { id: 't3', strongKeys: { audio_sha256: null }, nameKey: 'same-name' },
      { id: 't4', strongKeys: {}, nameKey: 'same-name' },
    ]);
    expect(r.find((x) => x.ids.includes('t1') && x.ids.includes('t2'))!.verdict).toBe('likely_duplicate');
    const nameOnly = r.find((x) => x.ids.includes('t3'))!;
    expect(nameOnly.verdict).toBe('possible_duplicate');
    expect(nameOnly.signal).toContain('확정 금지');
    expect(r.every((x) => (x.verdict as string) !== 'confirmed_duplicate')).toBe(true);
    expect(detectDuplicateCandidates([{ id: 'x', strongKeys: { code: 'unique1' } }])).toEqual([]);
  });
});

describe('Circular Dependency(자동 관계 삭제 없음)', () => {
  it('no cycle · confirmed cycle · inferred 포함 potential · 정산 축 critical · 빈 입력 insufficient', () => {
    expect(detectCircularDependencies([edge('a', 'b', 'policy_depends_on_policy')]).verdict).toBe('no_known_cycle');
    expect(detectCircularDependencies([edge('a', 'b', 'policy_depends_on_policy'), edge('b', 'a', 'policy_depends_on_policy')]).verdict).toBe('confirmed_cycle');
    expect(detectCircularDependencies([edge('a', 'b', 'policy_depends_on_policy', 'inferred_reference', 'weak'), edge('b', 'a', 'policy_depends_on_policy')]).verdict).toBe('potential_cycle');
    expect(detectCircularDependencies([edge('a', 'b', 'settlement_uses_policy'), edge('b', 'a', 'policy_depends_on_policy')]).verdict).toBe('critical_cycle');
    expect(detectCircularDependencies([]).verdict).toBe('insufficient_data');
  });
});

describe('Single Point of Failure(확률 미계산)', () => {
  it('단일+백업없음 candidate/critical · 백업 있으면 concentration · null insufficient', () => {
    expect(detectSinglePointCandidate({ role: 'admin', count: 1, hasBackup: false, critical: true }).verdict).toBe('critical_single_point');
    expect(detectSinglePointCandidate({ role: 'approver', count: 1, hasBackup: false }).verdict).toBe('single_point_candidate');
    expect(detectSinglePointCandidate({ role: 'owner', count: 1, hasBackup: true }).verdict).toBe('concentration_risk');
    expect(detectSinglePointCandidate({ role: 'provider', count: 2, hasBackup: null }).verdict).toBe('concentration_risk');
    expect(detectSinglePointCandidate({ role: 'x', count: 5, hasBackup: null }).verdict).toBe('resilient');
    expect(detectSinglePointCandidate({ role: 'x', count: null, hasBackup: null }).verdict).toBe('insufficient_data');
    expect(detectSinglePointCandidate({ role: 'admin', count: 1, hasBackup: false, critical: true }).note).toContain('장애 확률');
  });
});

describe('Relationship Conflict(손상 단정 금지)', () => {
  it('Store 복수 Enterprise 귀속 → potential_conflict · 단일 귀속은 제외', () => {
    const r = detectMultiParentConflicts([edge('e1', 's1'), edge('e2', 's1'), edge('e1', 's2')], 'enterprise_operates_store');
    expect(r.length).toBe(1); expect(r[0].target).toBe('s1'); expect(r[0].sources).toEqual(['e1', 'e2']);
    expect(detectMultiParentConflicts([], 'enterprise_operates_store')).toEqual([]);
  });
  it('Settlement/Contract artist 불일치 — critical · 미확인 insufficient · 일치 no_known', () => {
    expect(detectSubjectMismatch({ label: 'settlement-vs-contract', subjectA: 'artist1', subjectB: 'artist2', critical: true }).verdict).toBe('critical_conflict');
    expect(detectSubjectMismatch({ label: 'x', subjectA: 'a', subjectB: 'b' }).verdict).toBe('conflict');
    expect(detectSubjectMismatch({ label: 'x', subjectA: 'a', subjectB: 'a' }).verdict).toBe('no_known_conflict');
    expect(detectSubjectMismatch({ label: 'x', subjectA: null, subjectB: 'a' }).verdict).toBe('insufficient_data');
    expect(detectSubjectMismatch({ label: 'x', subjectA: 'a', subjectB: 'b' }).note).toContain('단정 아님');
  });
});

describe('Data Lineage', () => {
  const S = (stage: 'source' | 'aggregation' | 'audit', evidence: 'confirmed' | 'unverified' | null) => ({ stage, evidence } as const);
  it('complete / partial / incomplete / unverified / insufficient', () => {
    expect(evaluateDataLineage([S('source', 'confirmed'), S('aggregation', 'confirmed'), S('audit', 'confirmed')]).verdict).toBe('complete');
    expect(evaluateDataLineage([S('source', 'confirmed'), S('aggregation', 'confirmed'), S('audit', null)]).verdict).toBe('partial');
    expect(evaluateDataLineage([S('source', 'confirmed'), S('aggregation', null), S('audit', null)]).verdict).toBe('lineage_incomplete');
    expect(evaluateDataLineage([S('source', 'confirmed'), S('aggregation', 'unverified'), S('audit', 'confirmed')]).verdict).toBe('evidence_unverified');
    expect(evaluateDataLineage([]).verdict).toBe('insufficient_data');
    expect(evaluateDataLineage([S('source', null)]).verdict).toBe('insufficient_data');
  });
});

describe('Blast Radius(Snapshot 추정치)', () => {
  it('direct/indirect/domain/unknown path — 실제 영향 확정 문구 금지', () => {
    const ents = [E('ent', 'enterprise', 'organization'), E('store', 'store', 'organization'), E('pl', 'playlist', 'playlist')];
    const g = buildKnowledgeGraph(ents, [edge('ent', 'store'), edge('store', 'pl', 'store_uses_playlist', 'inferred_reference', 'unverified')]);
    const r = calculateBlastRadius(g, ents, 'ent', 3);
    expect(r.direct).toEqual(['store']); expect(r.indirect).toEqual(['pl']);
    expect(r.affectedDomains).toContain('playlist');
    expect(r.unknownPaths).toBeGreaterThan(0);
    expect(r.snapshotEstimate).toBe(true);
    expect(r.note).toContain('추정치');
  });
});

describe('Cross-Domain Impact / Graph Risk', () => {
  it('재정규화 · 전부 null insufficient · noAutoAction', () => {
    const full = calculateCrossDomainImpact([{ domain: 'revenue', value: 60, weight: 0.5 }, { domain: 'security', value: 60, weight: 0.5 }]);
    expect(full.level).toBe('high'); expect(full.noAutoAction).toBe(true);
    const part = calculateCrossDomainImpact([{ domain: 'revenue', value: 40, weight: 0.5 }, { domain: 'security', value: null, weight: 0.5 }]);
    expect(part.score).toBe(40); expect(part.missing).toEqual(['security']);
    expect(calculateCrossDomainImpact([{ domain: 'x', value: null, weight: 1 }]).level).toBe('insufficient_data');
  });
  it('Risk — 성분 재정규화 · conflict 가중 최대 · critical flag 우선(자동 차단 없음)', () => {
    const base = { orphanRisk: null, duplicateRisk: null, cycleRisk: null, spofRisk: null, conflictRisk: null, lineageGapRisk: null, inferredRatioRisk: null, staleRatioRisk: null, auditGapRisk: null };
    expect(calculateGraphRisk(base).score).toBeNull();
    expect(classifyGraphRisk(null)).toBe('insufficient_data');
    const r = calculateGraphRisk({ ...base, conflictRisk: 80, orphanRisk: 20 });
    expect(r.score).not.toBeNull(); expect(r.missing.length).toBe(7);
    expect(classifyGraphRisk(10)).toBe('low');
    expect(classifyGraphRisk(60)).toBe('high');
    expect(classifyGraphRisk(90)).toBe('critical');
    expect(classifyGraphRisk(5, { criticalPaymentConflict: true })).toBe('critical');
    expect(classifyGraphRisk(5, { approvalSelfCycle: true })).toBe('critical');
  });
});

describe('Evidence Path / Recommendation / Review', () => {
  it('Evidence Path — Edge 별 근거/강도/한계(근거 없는 Edge 숨김 없음)', () => {
    const p = { nodes: ['a', 'b', 'c'], edges: [edge('a', 'b'), edge('b', 'c', 'artist_named_on_track', 'inferred_reference', 'unverified')], depth: 2, weakestEvidence: 'unverified' as const };
    const seg = buildEvidencePath(p, new Map([['a', 'Store A'], ['b', 'Brand B'], ['c', 'Track C']]));
    expect(seg.length).toBe(2);
    expect(seg[0].strength).toBe('confirmed'); expect(seg[0].limitation).toContain('보장 아님');
    expect(seg[1].evidenceType).toBe('inferred_reference'); expect(seg[1].limitation).toContain('미확정');
  });
  it('추천 — Evidence 없으면 생성 금지 · Human Approval · 결정적 · 유형 whitelist', () => {
    const ok = buildGraphRecommendation({ code: 'g1', recType: 'review_orphan_entity', finding: 'store 3건 enterprise 미연결', affectedEntities: ['s1', 's2', 's3'], evidenceCount: 3, severity: 'high' });
    expect('insufficient' in ok).toBe(false);
    if (!('insufficient' in ok)) {
      expect(ok.humanApprovalRequired).toBe(true); expect(ok.noAutoExecution).toBe(true);
      expect(ok.preconditions).toContain('Human Approval');
      expect(ok.limitations.join(' ')).toContain('자동');
    }
    expect('insufficient' in buildGraphRecommendation({ code: 'g2', recType: 'review_orphan_entity', finding: 'x', affectedEntities: [], evidenceCount: 0 })).toBe(true);
    expect('insufficient' in buildGraphRecommendation({ code: 'g3', recType: 'delete_entity' as never, finding: 'x', affectedEntities: [], evidenceCount: 3 })).toBe(true);
    const a = buildGraphRecommendation({ code: 'g1', recType: 'review_orphan_entity', finding: 'f', affectedEntities: ['x'], evidenceCount: 2 });
    expect(a).toEqual(buildGraphRecommendation({ code: 'g1', recType: 'review_orphan_entity', finding: 'f', affectedEntities: ['x'], evidenceCount: 2 }));
  });
  it('Review — 종결 상태 재결정 불가 · Reason/Evidence 필수 · external action whitelist', () => {
    expect(canDecideReview('pending_review')).toBe(true);
    expect(canDecideReview('waiting_evidence')).toBe(true);
    expect(canDecideReview('validated_reference')).toBe(false);
    expect(canDecideReview('invalidated')).toBe(false);
    expect(validateGraphReview({ reason: 'r', evidence: [1] })).toEqual([]);
    expect(validateGraphReview({ reason: ' ', evidence: [] }).length).toBe(2);
    expect(validateGraphReview(null)).toEqual(['review 없음']);
    expect(validateExternalCorrectionReference('duplicate_merged_reference')).toBe(true);
    expect(validateExternalCorrectionReference('delete_entity')).toBe(false);
  });
});

describe('Support Matrix(정직 표기)', () => {
  it('commercial FK 확인 · track↔artist inferred · brands/stores 미존재 · 자동 실행 전부 unsupported', () => {
    expect(KG_SUPPORT.find((s) => s.key === 'commercial_graph')!.status).toBe('fully_supported');
    expect(KG_SUPPORT.find((s) => s.key === 'content_graph')!.note).toContain('inferred');
    expect(KG_SUPPORT.find((s) => s.key === 'brands_stores_tables')!.status).toBe('unsupported');
    expect(KG_SUPPORT.find((s) => s.key === 'data_lineage')!.status).toBe('lineage_incomplete');
    expect(KG_SUPPORT.find((s) => s.key === 'graph_visualization_force')!.status).toBe('unsupported');
    for (const k of ['auto_entity_mutation', 'auto_relationship_mutation', 'auto_duplicate_merge', 'auto_orphan_cleanup', 'auto_fk_creation', 'production_apply']) {
      expect(KG_SUPPORT.find((s) => s.key === k)!.status).toBe('unsupported');
    }
  });
});
