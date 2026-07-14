/**
 * KnowledgeGraphSection — Enterprise Knowledge Graph, Organizational Intelligence &
 * Dependency Reasoning Center (Phase AI-OPS-10).
 *
 * Entity Inventory → Relationship Map → Dependency/Lineage → Orphan/Duplicate/Cycle/
 * SPOF/Conflict → Blast Radius → Graph Risk → Recommendation → Human Review → Audit.
 * 조회·분석·근거 생성 전용 — 원본 Entity/FK/관계/계약/정산/정책 변경 없음.
 * Force Graph 라이브러리 미추가 — 리스트/경로 기반 UI(정직 표기).
 *
 * 탭 26개: Overview · Entities · Relationships · Org/Content/Commercial/Governance/
 * Incident Graph · Dependency Paths · Lineage · Org Intelligence · Orphans · Duplicates ·
 * Cycles · SPOF · Conflicts · Impact · Blast Radius · Investigation · Evidence Paths ·
 * Risk · Recommendations · Reviews · External Corrections · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Camera, GitBranch, Grid3x3, Layers, Lightbulb, Link2, Lock,
  Network, RefreshCw, Scale, ScrollText, Search, Share2, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchKGSummary, createKGSnapshot, fetchKGEntities, fetchKGRelationships, fetchKGEntityDetail,
  fetchKGSnapshots, createKGReview, decideKGReview, recordKGExternalCorrection, fetchKGReviews, fetchKGAudit,
  type KGSummary, type KGEntityRow, type KGRelationshipRow, type KGEntityDetail, type KGSnapshotRow,
  type KGReviewRow, type KGEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  buildKnowledgeGraph, findDownstreamPaths, detectOrphanCandidates,
  detectDuplicateCandidates, detectCircularDependencies, detectSinglePointCandidate,
  detectMultiParentConflicts, detectSubjectMismatch, evaluateDataLineage, calculateBlastRadius,
  calculateCrossDomainImpact, calculateGraphRisk, classifyGraphRisk, buildEvidencePath,
  buildGraphRecommendation, canDecideReview, EXTERNAL_ACTION_TYPES, KG_SUPPORT,
  type KGEntity, type KGEdge, type EvidenceType, type EvidenceStrength, type ReviewStatus, type GraphRecommendation,
} from '@/lib/knowledgeGraphIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'entities' | 'relationships' | 'org' | 'content' | 'commercial' | 'governance' | 'incident'
  | 'paths' | 'lineage' | 'orgintel' | 'orphans' | 'duplicates' | 'cycles' | 'spof' | 'conflicts'
  | 'impact' | 'blast' | 'investigation' | 'evidence' | 'risk' | 'recommendations' | 'reviews' | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'entities', label: 'Entity Inventory', icon: BookOpen },
  { key: 'relationships', label: 'Relationship Inventory', icon: Link2 },
  { key: 'org', label: 'Organization Graph', icon: Network },
  { key: 'content', label: 'Content Graph', icon: Network },
  { key: 'commercial', label: 'Commercial Graph', icon: Network },
  { key: 'governance', label: 'Governance Graph', icon: Network },
  { key: 'incident', label: 'Incident Graph', icon: AlertTriangle },
  { key: 'paths', label: 'Dependency Paths', icon: GitBranch },
  { key: 'lineage', label: 'Data Lineage', icon: Share2 },
  { key: 'orgintel', label: 'Org Intelligence', icon: Users },
  { key: 'orphans', label: 'Orphan Candidates', icon: AlertTriangle },
  { key: 'duplicates', label: 'Duplicate Candidates', icon: AlertTriangle },
  { key: 'cycles', label: 'Circular Dependencies', icon: RefreshCw },
  { key: 'spof', label: 'Single Points of Failure', icon: AlertTriangle },
  { key: 'conflicts', label: 'Relationship Conflicts', icon: Scale },
  { key: 'impact', label: 'Cross-Domain Impact', icon: Share2 },
  { key: 'blast', label: 'Blast Radius', icon: Share2 },
  { key: 'investigation', label: 'Graph Investigation', icon: Search },
  { key: 'evidence', label: 'Evidence Paths', icon: ScrollText },
  { key: 'risk', label: 'Graph Risk', icon: AlertTriangle },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External Corrections', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

const DOMAIN_REL_TYPES: Record<'org' | 'content' | 'commercial' | 'governance' | 'incident', string[]> = {
  org: ['enterprise_operates_store', 'user_is_artist'],
  content: ['playlist_contains_track', 'artist_named_on_track', 'track_played_at_store'],
  commercial: ['contract_belongs_to_artist', 'settlement_belongs_to_artist', 'settlement_references_track', 'settlement_uses_policy', 'payout_account_belongs_to_artist', 'subscription_belongs_to_user', 'payment_pays_subscription'],
  governance: ['policy_depends_on_policy', 'recommendation_references_policy'],
  incident: [],
};

export default function KnowledgeGraphSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<KGSummary>({});
  const [entities, setEntities] = useState<KGEntityRow[]>([]);
  const [relationships, setRelationships] = useState<KGRelationshipRow[]>([]);
  const [snapshots, setSnapshots] = useState<KGSnapshotRow[]>([]);
  const [reviews, setReviews] = useState<KGReviewRow[]>([]);
  const [audit, setAudit] = useState<KGEventRow[]>([]);
  const [detail, setDetail] = useState<KGEntityDetail | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [reason, setReason] = useState('');
  const [extAction, setExtAction] = useState<string>(EXTERNAL_ACTION_TYPES[0]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, e, r, sn, rv, au] = await Promise.all([
        fetchKGSummary(), fetchKGEntities(null, null, 300), fetchKGRelationships(null, null, 500),
        fetchKGSnapshots(10), fetchKGReviews(null, 100), fetchKGAudit(100),
      ]);
      setSummary(s); setEntities(e); setRelationships(r); setSnapshots(sn); setReviews(rv); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유 필수(Human Decision)'); return null; }
    return reason.trim();
  };

  /* ── 순수 로직 그래프(스냅샷 inventory 기반 — bounded) ── */
  const kgEntities: KGEntity[] = useMemo(() => entities.map((e) => ({ id: e.id, entityType: e.entity_type, domain: e.domain, label: e.display_label })), [entities]);
  const kgEdges: KGEdge[] = useMemo(() => relationships.map((r) => ({
    id: r.id, type: r.relationship_type, source: r.source_entity_id, target: r.target_entity_id,
    evidenceType: r.evidence_type as EvidenceType, evidenceStrength: r.evidence_strength as EvidenceStrength, evidenceSource: r.evidence_source,
  })), [relationships]);
  const graph = useMemo(() => buildKnowledgeGraph(kgEntities, kgEdges), [kgEntities, kgEdges]);
  const labels = useMemo(() => new Map(kgEntities.map((e) => [e.id, e.label])), [kgEntities]);

  const orphans = useMemo(() => detectOrphanCandidates(kgEntities, kgEdges, [
    { entityType: 'store', requiredEdgeType: 'enterprise_operates_store', direction: 'incoming', note: 'Enterprise(franchise) 미연결 Store' },
    { entityType: 'contract', requiredEdgeType: 'contract_belongs_to_artist', direction: 'out', note: 'Artist 미연결 Contract' },
    { entityType: 'settlement', requiredEdgeType: 'settlement_belongs_to_artist', direction: 'out', note: 'Artist 미연결 Settlement' },
    { entityType: 'track', requiredEdgeType: 'playlist_contains_track', direction: 'incoming', note: 'Playlist 미포함 Track' },
  ]).filter((o) => o.verdict === 'orphan_candidate'), [kgEntities, kgEdges]);

  const duplicates = useMemo(() => {
    const byType = new Map<string, KGEntity[]>();
    for (const e of kgEntities) byType.set(e.entityType, [...(byType.get(e.entityType) ?? []), e]);
    const out: { type: string; ids: string[]; verdict: string; signal: string }[] = [];
    for (const [type, list] of byType) {
      for (const d of detectDuplicateCandidates(list.map((e) => ({ id: e.id, strongKeys: {}, nameKey: e.label })))) {
        out.push({ type, ids: d.ids, verdict: d.verdict, signal: d.signal });
      }
    }
    return out;
  }, [kgEntities]);

  const cycles = useMemo(() => detectCircularDependencies(kgEdges), [kgEdges]);

  const sourceCounts = useMemo(() => (summary.source_counts ?? {}) as Record<string, number>, [summary]);
  const spofChecks = useMemo(() => [
    detectSinglePointCandidate({ role: '단일 Admin(users.role=admin)', count: sourceCounts.admin_users ?? null, hasBackup: (sourceCounts.admin_users ?? 0) > 1 ? true : false, critical: true }),
    detectSinglePointCandidate({ role: '단일 Payment Provider(PayApp — 코드 실측)', count: 1, hasBackup: false, critical: true }),
    detectSinglePointCandidate({ role: '단일 Storage/DB Provider(Supabase — 코드 실측)', count: 1, hasBackup: false, critical: true }),
    detectSinglePointCandidate({ role: '단일 Settlement Owner', count: null, hasBackup: null }),
    detectSinglePointCandidate({ role: '단일 Deployment Pipeline(Vercel — 코드 실측)', count: 1, hasBackup: false }),
  ], [sourceCounts]);

  const multiParent = useMemo(() => detectMultiParentConflicts(kgEdges, 'enterprise_operates_store'), [kgEdges]);
  const subjectMismatch = useMemo(() => detectSubjectMismatch({ label: 'Settlement Artist vs Contract Artist', subjectA: null, subjectB: null, critical: true }), []);

  const lineages = useMemo(() => [
    { name: 'Revenue KPI(매출 30d)', r: evaluateDataLineage([{ stage: 'source', evidence: 'confirmed' }, { stage: 'aggregation', evidence: 'confirmed' }, { stage: 'decision_input', evidence: 'moderate' }, { stage: 'audit', evidence: null }]) },
    { name: 'MRR/ARR', r: evaluateDataLineage([{ stage: 'source', evidence: 'confirmed' }, { stage: 'aggregation', evidence: 'confirmed' }, { stage: 'recommendation_output', evidence: 'moderate' }, { stage: 'audit', evidence: null }]) },
    { name: 'Settlement 금액', r: evaluateDataLineage([{ stage: 'source', evidence: 'confirmed' }, { stage: 'transformation', evidence: 'confirmed' }, { stage: 'aggregation', evidence: 'confirmed' }, { stage: 'audit', evidence: 'confirmed' }]) },
    { name: 'Track Exposure(재생 노출)', r: evaluateDataLineage([{ stage: 'source', evidence: 'unverified' }, { stage: 'aggregation', evidence: 'moderate' }]) },
    { name: 'Executive Recommendation', r: evaluateDataLineage([{ stage: 'source', evidence: 'confirmed' }, { stage: 'decision_input', evidence: 'confirmed' }, { stage: 'recommendation_output', evidence: 'confirmed' }, { stage: 'human_decision', evidence: 'confirmed' }, { stage: 'audit', evidence: 'confirmed' }]) },
  ], []);

  const inferredCount = Number(summary.inferred_relationships ?? 0);
  const confirmedCount = Number(summary.confirmed_relationships ?? 0);
  const totalRel = Number(summary.inventory_relationships ?? 0);
  const totalEnt = Number(summary.inventory_entities ?? 0);

  const riskComponents = useMemo(() => ({
    orphanRisk: totalEnt > 0 ? Math.min(100, (orphans.length / totalEnt) * 300) : null,
    duplicateRisk: totalEnt > 0 ? Math.min(100, (duplicates.length / totalEnt) * 300) : null,
    cycleRisk: cycles.verdict === 'insufficient_data' ? null : cycles.verdict === 'no_known_cycle' ? 5 : cycles.verdict === 'critical_cycle' ? 90 : 55,
    spofRisk: spofChecks.some((s) => s.verdict === 'critical_single_point') ? 80 : spofChecks.some((s) => s.verdict === 'single_point_candidate') ? 55 : 25,
    conflictRisk: multiParent.length > 0 ? 70 : totalRel > 0 ? 10 : null,
    lineageGapRisk: lineages.some((l) => l.r.verdict === 'lineage_incomplete') ? 60 : lineages.some((l) => l.r.verdict === 'partial') ? 40 : 15,
    inferredRatioRisk: totalRel > 0 ? Math.min(100, (inferredCount / totalRel) * 100) : null,
    staleRatioRisk: null,   // stale 집계 데이터 없음 — 성분 제외(0 변환 금지)
    auditGapRisk: audit.length > 0 ? 15 : null,
  }), [orphans, duplicates, cycles, spofChecks, multiParent, lineages, inferredCount, totalRel, totalEnt, audit]);
  const risk = useMemo(() => calculateGraphRisk(riskComponents), [riskComponents]);
  const riskLevel = useMemo(() => classifyGraphRisk(risk.score, { criticalPaymentConflict: false }), [risk]);

  const crossImpact = useMemo(() => {
    const relByDomain = new Map<string, number>();
    for (const e of kgEdges) {
      const d = kgEntities.find((x) => x.id === e.target)?.domain;
      if (d) relByDomain.set(d, (relByDomain.get(d) ?? 0) + 1);
    }
    return calculateCrossDomainImpact([
      { domain: 'settlement', value: relByDomain.has('settlement') ? Math.min(100, relByDomain.get('settlement')! * 5) : null, weight: 0.3 },
      { domain: 'revenue', value: relByDomain.has('revenue') ? Math.min(100, relByDomain.get('revenue')! * 5) : null, weight: 0.25 },
      { domain: 'organization', value: relByDomain.has('organization') ? Math.min(100, relByDomain.get('organization')! * 5) : null, weight: 0.25 },
      { domain: 'playlist', value: relByDomain.has('playlist') ? Math.min(100, relByDomain.get('playlist')! * 5) : null, weight: 0.2 },
    ]);
  }, [kgEdges, kgEntities]);

  const blast = useMemo(() => {
    if (!selectedId) return null;
    return calculateBlastRadius(graph, kgEntities, selectedId, 3);
  }, [graph, kgEntities, selectedId]);

  const samplePaths = useMemo(() => {
    const start = kgEntities.find((e) => e.entityType === 'enterprise') ?? kgEntities.find((e) => e.entityType === 'playlist');
    if (!start) return [];
    return findDownstreamPaths(graph, start.id, 3).slice(0, 20);
  }, [graph, kgEntities]);

  const autoRecs = useMemo(() => {
    const out: GraphRecommendation[] = [];
    const push = (r: GraphRecommendation | { insufficient: true; why: string }) => { if (!('insufficient' in r)) out.push(r); };
    if (orphans.length > 0) push(buildGraphRecommendation({ code: `kgrec_orphan_${now.toISOString().slice(0, 10)}`, recType: 'review_orphan_entity', finding: `orphan 후보 ${orphans.length}건`, affectedEntities: orphans.map((o) => o.entityId), evidenceCount: orphans.length, severity: 'moderate' }));
    if (duplicates.length > 0) push(buildGraphRecommendation({ code: `kgrec_dup_${now.toISOString().slice(0, 10)}`, recType: 'review_duplicate_candidate', finding: `중복 후보 ${duplicates.length}건(이름 기준 — 확정 금지)`, affectedEntities: duplicates.flatMap((d) => d.ids), evidenceCount: duplicates.length, severity: 'low' }));
    if (inferredCount > 0) push(buildGraphRecommendation({ code: `kgrec_inferred_${now.toISOString().slice(0, 10)}`, recType: 'validate_inferred_relationship', finding: `inferred 관계 ${inferredCount}건(track↔artist 이름 매칭 등)`, affectedEntities: [], evidenceCount: Math.min(10, inferredCount), severity: 'moderate' }));
    const criticalSpof = spofChecks.filter((s) => s.verdict === 'critical_single_point');
    if (criticalSpof.length > 0) push(buildGraphRecommendation({ code: `kgrec_spof_${now.toISOString().slice(0, 10)}`, recType: 'reduce_single_point_dependency', finding: criticalSpof.map((s) => s.role).join(' · '), affectedEntities: [], evidenceCount: criticalSpof.length, severity: 'high' }));
    if (!snapshots.length) push(buildGraphRecommendation({ code: `kgrec_snap_${now.toISOString().slice(0, 10)}`, recType: 'refresh_graph_snapshot', finding: 'Graph Snapshot 없음 — snapshot_age_unknown', affectedEntities: [], evidenceCount: 1, severity: 'moderate' }));
    return out;
  }, [orphans, duplicates, inferredCount, spofChecks, snapshots, now]);

  const loadDetail = async (id: string) => {
    setSelectedId(id);
    try { setDetail(await fetchKGEntityDetail(id)); }
    catch (e) { toast.error(classifyAdminError(e).message); }
  };

  if (loading) return <AdminCard title="Enterprise Knowledge Graph & Organizational Intelligence Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Knowledge Graph & Organizational Intelligence Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const latestSnap = summary.latest_snapshot as Record<string, unknown> | null;
  const relList = (types: string[]) => {
    const list = relationships.filter((r) => types.includes(r.relationship_type));
    if (!list.length) return <AdminEmpty title="관계 없음" description="Snapshot 을 생성하면 검증된 관계가 수집됩니다(원본 미변경). 데이터 부재 ≠ 관계 없음 단정." />;
    return (
      <div className="space-y-1">
        {list.slice(0, 100).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold">{r.relationship_type}</span>
              <AdminBadge tone={r.evidence_strength === 'confirmed' ? 'success' : r.evidence_type === 'inferred_reference' ? 'warning' : 'info'}>{r.evidence_strength}</AdminBadge>
              <AdminBadge tone="neutral">{r.evidence_type}</AdminBadge>
            </div>
            <p className="mt-1">{labels.get(r.source_entity_id) ?? r.source_entity_id} → {labels.get(r.target_entity_id) ?? r.target_entity_id}</p>
            <p className="text-muted-foreground">{r.evidence_source}</p>
          </div>
        ))}
      </div>
    );
  };

  return (
    <AdminCard
      title="Enterprise Knowledge Graph & Organizational Intelligence Center"
      subtitle="Entity/관계 Inventory · Dependency/Lineage · Orphan/중복/순환/SPOF/충돌 · Blast Radius · Graph Risk — 분석 전용(원본/FK/관계 변경 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 Entity/관계 생성·수정·삭제, 자동 중복 병합, 자동 Orphan 삭제, 자동 FK 생성, 자동 계약/정산/조직/정책 연결 변경, Production Apply/Merge/Deploy/Migration 은 없습니다. inferred_reference 는 confirmed 로 표시하지 않으며(DB CHECK 강제), 관계 존재가 실제 재생/지급/적용을 보장하지 않습니다. Snapshot 은 bounded sample(유형별≤200/관계≤300) 분석 결과이며 Production Master Data 가 아닙니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => void act(() => createKGSnapshot(), 'Snapshot 생성(bounded sample — 원본 미변경)')} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50"><Camera size={12} /> Graph Snapshot 생성</button>
            <span className="text-[10px] text-muted-foreground">동일 input_hash 재실행 시 idempotent(중복 snapshot 방지)</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Total Entities(inventory)" value={NUM(totalEnt)} />
            <Box label="Total Relationships" value={NUM(totalRel)} />
            <Box label="Confirmed" value={NUM(confirmedCount)} />
            <Box label="Inferred(≠confirmed)" value={NUM(inferredCount)} />
            <Box label="Orphan Candidates" value={NUM(orphans.length)} />
            <Box label="Duplicate Candidates" value={NUM(duplicates.length)} />
            <Box label="Circular Dependencies" value={cycles.verdict === 'insufficient_data' ? 'insufficient_data' : `${cycles.cycles.length} (${cycles.verdict})`} />
            <Box label="Single Point Candidates" value={NUM(spofChecks.filter((s) => s.verdict === 'single_point_candidate' || s.verdict === 'critical_single_point').length)} />
            <Box label="Relationship Conflicts" value={NUM(multiParent.length)} />
            <Box label="Lineage Gaps" value={NUM(lineages.filter((l) => l.r.verdict !== 'complete').length)} />
            <Box label="Graph Risk" value={risk.score == null ? riskLevel : `${risk.score} (${riskLevel})`} />
            <Box label="Evidence Coverage" value={totalRel > 0 ? `${Math.round((confirmedCount / totalRel) * 100)}% confirmed` : 'insufficient_data'} />
            <Box label="Last Snapshot" value={latestSnap ? String(latestSnap.snapshot_code) : 'snapshot_age_unknown'} />
            <Box label="Snapshot Age" value={latestSnap ? `${Math.round((now.getTime() - new Date(String(latestSnap.generated_at)).getTime()) / 3600000)}h` : 'snapshot_age_unknown'} />
          </div>
          <p className="text-[10px] text-muted-foreground">원본 실측 총계: franchises {NUM(sourceCounts.franchises)} · 매장(users.business) {NUM(sourceCounts.business_users)} · artist {NUM(sourceCounts.artist_profiles)} · track {NUM(sourceCounts.tracks)} · playlist {NUM(sourceCounts.playlists)} · 계약 {NUM(sourceCounts.artist_contracts)} · 구독 {NUM(sourceCounts.subscriptions)} · 결제 {NUM(sourceCounts.payment_orders)} · 정산 {NUM(sourceCounts.artist_settlements)}</p>
        </div>
      )}

      {/* ── Entity Inventory ── */}
      {tab === 'entities' && (
        !entities.length ? <AdminEmpty title="Entity 없음" description="Overview 에서 Snapshot 을 생성하세요(원본 미변경 · bounded sample)." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 pr-2">type</th><th className="pr-2">label(마스킹)</th><th className="pr-2">domain</th><th className="pr-2">source</th><th className="pr-2">lifecycle</th><th className="pr-2">조사</th></tr></thead>
              <tbody>
                {entities.slice(0, 150).map((e) => (
                  <tr key={e.id} className="border-b border-border/50">
                    <td className="py-1 pr-2 font-mono">{e.entity_type}</td>
                    <td className="pr-2">{e.display_label}{e.is_sensitive && <AdminBadge tone="warning">sensitive</AdminBadge>}</td>
                    <td className="pr-2">{e.domain}</td>
                    <td className="pr-2 text-muted-foreground">{e.source_table}</td>
                    <td className="pr-2">{e.lifecycle_status ?? '—'}</td>
                    <td className="pr-2"><button onClick={() => { void loadDetail(e.id); setTab('investigation'); }} className="font-bold underline">보기</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* ── Relationship Inventory ── */}
      {tab === 'relationships' && relList([...DOMAIN_REL_TYPES.org, ...DOMAIN_REL_TYPES.content, ...DOMAIN_REL_TYPES.commercial, ...DOMAIN_REL_TYPES.governance])}
      {tab === 'org' && relList(DOMAIN_REL_TYPES.org)}
      {tab === 'content' && relList(DOMAIN_REL_TYPES.content)}
      {tab === 'commercial' && relList(DOMAIN_REL_TYPES.commercial)}
      {tab === 'governance' && relList(DOMAIN_REL_TYPES.governance)}
      {tab === 'incident' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="incident↔entity 관계는 FK 가 없어 관계 그래프 미지원(read_only — 노드만). ai_incidents 노드는 Entity Inventory 에서 확인하세요." />
          {entities.filter((e) => e.entity_type === 'incident').length === 0 ? <AdminEmpty title="Incident 노드 없음" /> : (
            <div className="space-y-1">{entities.filter((e) => e.entity_type === 'incident').map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono font-bold">{e.display_label}</span> <span className="text-muted-foreground">{e.lifecycle_status}</span></div>
            ))}</div>
          )}
        </div>
      )}

      {/* ── Dependency Paths ── */}
      {tab === 'paths' && (
        !samplePaths.length ? <AdminEmpty title="경로 없음" description="Snapshot 생성 후 enterprise/playlist 시작 경로가 표시됩니다. 끊긴 경로는 임의로 연결하지 않습니다." /> : (
          <div className="space-y-1">
            {samplePaths.map((p, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="info">depth {p.depth}</AdminBadge>
                  <AdminBadge tone={p.weakestEvidence === 'confirmed' ? 'success' : 'warning'}>최약 근거 {p.weakestEvidence}</AdminBadge>
                </div>
                <p className="mt-1 break-all">{p.nodes.map((n) => labels.get(n) ?? n).join(' → ')}</p>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">기본 최대 깊이 3(clamp 5) · 경로 100 제한 · cycle 방어.</p>
          </div>
        )
      )}

      {/* ── Data Lineage ── */}
      {tab === 'lineage' && (
        <div className="space-y-1">
          {lineages.map((l) => (
            <div key={l.name} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{l.name}</span>
                <AdminBadge tone={l.r.verdict === 'complete' ? 'success' : l.r.verdict === 'insufficient_data' ? 'neutral' : 'warning'}>{l.r.verdict}</AdminBadge>
              </div>
              {l.r.missing.length > 0 && <p className="mt-1 text-muted-foreground">누락 단계: {l.r.missing.join(', ')}</p>}
              {l.r.unverified.length > 0 && <p className="text-muted-foreground">미검증 단계: {l.r.unverified.join(', ')}</p>}
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">선언된 7단계(source/transformation/aggregation/decision_input/recommendation_output/human_decision/audit) 기반 — 전체 DB 자동 Lineage 추적은 미지원(lineage_incomplete 정직 표기).</p>
        </div>
      )}

      {/* ── Org Intelligence ── */}
      {tab === 'orgintel' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="기업(franchises)" value={NUM(sourceCounts.franchises)} />
            <Box label="Enterprise Accounts" value={NUM(sourceCounts.enterprise_accounts)} />
            <Box label="매장(users.business)" value={NUM(sourceCounts.business_users)} />
            <Box label="Artist" value={NUM(sourceCounts.artist_profiles)} />
            <Box label="Track" value={NUM(sourceCounts.tracks)} />
            <Box label="Playlist" value={NUM(sourceCounts.playlists)} />
            <Box label="계약" value={NUM(sourceCounts.artist_contracts)} />
            <Box label="정산" value={NUM(sourceCounts.artist_settlements)} />
          </div>
          <AdminAlert tone="info" description="단순 개수와 위험 해석은 분리합니다 — 개수가 많다고 중요도가 높다고 단정하지 않습니다. 관리자/담당자 단일 의존은 Single Points of Failure 탭에서 구조 분류로만 표시합니다." />
        </div>
      )}

      {/* ── Orphans ── */}
      {tab === 'orphans' && (
        !orphans.length ? <AdminEmpty title="no_known_orphan" description="현재 inventory 기준 orphan 후보 없음 — bounded sample 이므로 전체 보장 아님. 자동 삭제 없음." /> : (
          <div className="space-y-1">
            {orphans.map((o) => (
              <div key={o.entityId} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2"><AdminBadge tone="warning">orphan_candidate</AdminBadge><span className="font-bold">{o.label}</span></div>
                <p className="mt-1 text-muted-foreground">{o.note}</p>
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Duplicates ── */}
      {tab === 'duplicates' && (
        !duplicates.length ? <AdminEmpty title="no_known_duplicate" description="이름 기준 중복 후보 없음(bounded sample). 자동 병합 없음." /> : (
          <div className="space-y-1">
            {duplicates.map((d, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone="warning">{d.verdict}</AdminBadge>
                  <span className="font-mono">{d.type}</span>
                  <span className="text-muted-foreground">signal: {d.signal}</span>
                </div>
                <p className="mt-1 break-all text-muted-foreground">{d.ids.map((id) => labels.get(id) ?? id).join(' · ')}</p>
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">이름만 동일 → possible_duplicate(확정 금지). ISRC/audio_sha256/사업자번호 강한 키는 서버 원본에 있으며 inventory 라벨에는 미포함(마스킹) — 서버측 강한 키 비교는 향후 검토(정직 표기).</p>
          </div>
        )
      )}

      {/* ── Cycles ── */}
      {tab === 'cycles' && (
        <div className="space-y-2">
          <AdminBadge tone={cycles.verdict === 'no_known_cycle' ? 'success' : cycles.verdict === 'critical_cycle' ? 'danger' : cycles.verdict === 'insufficient_data' ? 'neutral' : 'warning'}>{cycles.verdict}</AdminBadge>
          {!cycles.cycles.length ? <AdminEmpty title="순환 없음(no_known_cycle)" description="현재 inventory 기준 — 자동 관계 삭제 없음." /> : (
            <div className="space-y-1">{cycles.cycles.slice(0, 20).map((c, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px] break-all">{c.map((n) => labels.get(n) ?? n).join(' → ')}</div>
            ))}</div>
          )}
        </div>
      )}

      {/* ── SPOF ── */}
      {tab === 'spof' && (
        <div className="space-y-1">
          {spofChecks.map((s) => (
            <div key={s.role} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={s.verdict === 'resilient' ? 'success' : s.verdict === 'critical_single_point' ? 'danger' : s.verdict === 'insufficient_data' ? 'neutral' : 'warning'}>{s.verdict}</AdminBadge>
                <span className="font-bold">{s.role}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{s.note}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">구조 분류만 — 실제 장애 확률은 근거 없이 계산하지 않습니다.</p>
        </div>
      )}

      {/* ── Conflicts ── */}
      {tab === 'conflicts' && (
        <div className="space-y-2">
          {!multiParent.length ? <AdminEmpty title="no_known_conflict" description="Store 복수 Enterprise 귀속 없음(inventory 기준)." /> : multiParent.map((c) => (
            <div key={c.target} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="warning">{c.verdict}</AdminBadge>
              <p className="mt-1">{labels.get(c.target) ?? c.target} 가 복수 Enterprise 에 귀속: {c.sources.map((s) => labels.get(s) ?? s).join(', ')}</p>
              <p className="text-muted-foreground">관계 충돌 ≠ 데이터 손상 확정 — 사람 검토 필요</p>
            </div>
          ))}
          <div className="rounded-lg border border-border p-2 text-[11px]">
            <div className="flex flex-wrap items-center gap-2"><AdminBadge tone="neutral">{subjectMismatch.verdict}</AdminBadge><span className="font-bold">{subjectMismatch.label}</span></div>
            <p className="mt-1 text-muted-foreground">{subjectMismatch.note} — 계약↔정산 artist 대조는 원본 uuid 가 inventory 라벨에 없어 이 화면에서는 판정 불가(insufficient_data 정직 표기).</p>
          </div>
        </div>
      )}

      {/* ── Cross-Domain Impact ── */}
      {tab === 'impact' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Impact Score" value={crossImpact.score == null ? crossImpact.level : `${crossImpact.score} (${crossImpact.level})`} />
            <Box label="측정 도메인" value={crossImpact.used.length ? crossImpact.used.join(', ') : '없음'} />
            <Box label="누락(제외)" value={crossImpact.missing.length ? crossImpact.missing.join(', ') : '없음'} />
            <Box label="자동 적용" value="없음(금지)" />
          </div>
          <p className="text-[10px] text-muted-foreground">도메인별 관계 밀도 기반 예시 산정 — 실제 적용은 수행하지 않음. 성분 없으면 재정규화(0 변환 금지).</p>
        </div>
      )}

      {/* ── Blast Radius ── */}
      {tab === 'blast' && (
        <div className="space-y-2">
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            <option value="">Entity 선택</option>
            {entities.slice(0, 150).map((e) => <option key={e.id} value={e.id}>{e.entity_type}: {e.display_label}</option>)}
          </select>
          {!blast ? <AdminEmpty title="Entity 를 선택하세요" /> : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Directly Affected" value={NUM(blast.direct.length)} />
                <Box label="Indirectly Affected" value={NUM(blast.indirect.length)} />
                <Box label="Affected Domains" value={blast.affectedDomains.join(', ') || '없음'} />
                <Box label="Unknown Paths" value={NUM(blast.unknownPaths)} />
              </div>
              <p className="text-[11px] text-muted-foreground">direct: {blast.direct.map((d) => labels.get(d) ?? d).slice(0, 10).join(', ') || '—'}</p>
              <AdminAlert tone="info" description={blast.note} />
            </>
          )}
        </div>
      )}

      {/* ── Investigation ── */}
      {tab === 'investigation' && (
        <div className="space-y-2">
          <select value={selectedId} onChange={(e) => void loadDetail(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
            <option value="">Entity 선택(읽기 전용)</option>
            {entities.slice(0, 150).map((e) => <option key={e.id} value={e.id}>{e.entity_type}: {e.display_label}</option>)}
          </select>
          {!detail ? <AdminEmpty title="Entity 를 선택하세요" description="탐색은 읽기 전용 — Delete/Merge/FK/Scope/Owner 변경 버튼 없음." /> : (
            <div className="space-y-2 text-[11px]">
              <div className="rounded-lg border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{detail.entity.display_label}</span>
                  <AdminBadge tone="info">{detail.entity.entity_type}</AdminBadge>
                  <AdminBadge tone="neutral">{detail.entity.domain}</AdminBadge>
                  {detail.entity.lifecycle_status && <span className="text-muted-foreground">{detail.entity.lifecycle_status}</span>}
                </div>
                <p className="mt-1 text-muted-foreground">source: {detail.entity.source_table} · snapshot {new Date(detail.entity.snapshot_at).toLocaleString('ko-KR')}</p>
              </div>
              <p className="font-bold">Downstream(outgoing {detail.outgoing.length})</p>
              {detail.outgoing.slice(0, 30).map((o) => (
                <div key={o.id} className="rounded-lg border border-border p-2">
                  <span className="font-mono">{o.relationship_type}</span> → {o.target_label} <AdminBadge tone={o.evidence_strength === 'confirmed' ? 'success' : 'warning'}>{o.evidence_strength}</AdminBadge>
                  <p className="text-muted-foreground">{o.evidence_source}</p>
                </div>
              ))}
              <p className="font-bold">Upstream(incoming {detail.incoming.length})</p>
              {detail.incoming.slice(0, 30).map((o) => (
                <div key={o.id} className="rounded-lg border border-border p-2">
                  {o.source_label} → <span className="font-mono">{o.relationship_type}</span> <AdminBadge tone={o.evidence_strength === 'confirmed' ? 'success' : 'warning'}>{o.evidence_strength}</AdminBadge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Evidence Paths ── */}
      {tab === 'evidence' && (
        !samplePaths.length ? <AdminEmpty title="경로 없음" description="Snapshot 생성 후 표시됩니다." /> : (
          <div className="space-y-2">
            {samplePaths.slice(0, 5).map((p, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <p className="font-bold">경로 {i + 1} (depth {p.depth})</p>
                {buildEvidencePath(p, labels).map((seg, j) => (
                  <div key={j} className="mt-1 border-l-2 border-border pl-2">
                    <p>{seg.from} → <span className="font-mono">{seg.relationshipType}</span> → {seg.to}</p>
                    <p className="text-muted-foreground">{seg.evidenceType} · {seg.strength} · {seg.evidenceSource} · {seg.limitation}</p>
                  </div>
                ))}
              </div>
            ))}
            <p className="text-[10px] text-muted-foreground">근거 없는 Edge 를 숨겨서 연결하지 않습니다 — 각 Edge 에 근거/강도/한계 표시.</p>
          </div>
        )
      )}

      {/* ── Risk ── */}
      {tab === 'risk' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Graph Risk" value={risk.score == null ? riskLevel : `${risk.score} (${riskLevel})`} />
            <Box label="측정 성분" value={risk.used.join(', ') || '없음'} />
            <Box label="누락 성분(제외)" value={risk.missing.join(', ') || '없음'} />
            <Box label="자동 차단" value="없음(금지)" />
          </div>
          <AdminAlert tone={riskLevel === 'critical' ? 'danger' : riskLevel === 'high' ? 'danger' : riskLevel === 'moderate' ? 'warning' : 'info'}
            description="성분(orphan/duplicate/cycle/SPOF/conflict/lineage gap/inferred ratio/audit gap) 재정규화. 지급·정산 confirmed conflict, 민감 데이터 public 연결, 승인 자기참조 순환은 점수 무관 critical. stale ratio 는 집계 데이터 없음 — 성분 제외(0 변환 금지)." />
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          {!autoRecs.length ? <AdminEmpty title="생성된 추천 없음" description="Evidence 없는 추천은 생성하지 않습니다." /> : autoRecs.map((r) => (
            <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone="info">{r.recType}</AdminBadge>
                <AdminBadge tone={r.severity === 'critical' || r.severity === 'high' ? 'danger' : r.severity === 'moderate' ? 'warning' : 'info'}>{r.severity}</AdminBadge>
                <span className="text-muted-foreground">confidence {r.confidence}</span>
                <AdminBadge tone="warning">Human Approval 필수</AdminBadge>
              </div>
              <p className="mt-1"><span className="font-bold">Recommendation:</span> {r.recommendation}</p>
              <p><span className="font-bold">Reason:</span> {r.reason}</p>
              <p className="text-muted-foreground">Preconditions: {r.preconditions.join(' / ')} · Limitations: {r.limitations.join(' / ')}</p>
              <button disabled={busy} onClick={() => {
                const rr = needReason(); if (!rr) return;
                void act(() => createKGReview({ code: r.code, topic: r.recType === 'review_orphan_entity' ? 'orphan_candidate' : r.recType === 'review_duplicate_candidate' ? 'duplicate_candidate' : r.recType === 'validate_inferred_relationship' ? 'inferred_relationship' : r.recType === 'reduce_single_point_dependency' ? 'single_point_candidate' : 'snapshot_refresh', reason: `${rr} — ${r.reason}`, evidence: r.evidence.map((e) => ({ label: e.label, value: e.value })) }), 'Review 생성(pending_review — 실행 없음)');
              }} className="mt-1 rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Review 시작</button>
            </div>
          ))}
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Review 사유(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
        </div>
      )}

      {/* ── Human Reviews ── */}
      {tab === 'reviews' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="validated_reference 는 관계 검토 결과일 뿐 실제 DB 관계 변경 상태가 아닙니다. 종결 상태 재결정 불가." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="결정 사유(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          {!reviews.filter((r) => r.kind === 'review').length ? <AdminEmpty title="Review 없음" /> : reviews.filter((r) => r.kind === 'review').map((r) => {
            const from = r.review_status as ReviewStatus;
            const decidable = canDecideReview(from);
            return (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{r.review_code}</span>
                  <AdminBadge tone={from === 'validated_reference' ? 'success' : from === 'rejected' || from === 'invalidated' ? 'danger' : 'info'}>{from}</AdminBadge>
                  <span className="text-muted-foreground">{r.topic}</span>
                </div>
                <p className="mt-1">{r.reason}</p>
                {decidable && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(['waiting_evidence', 'validated_reference', 'correction_recommended', 'rejected', 'invalidated'] as const).map((t) => (
                      <button key={t} disabled={busy} onClick={() => {
                        const rr = needReason(); if (!rr) return;
                        void act(() => decideKGReview(r.id, t, rr), `${t} 처리(사람 결정 — DB 관계 변경 없음)`);
                      }} className={`rounded-md px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${t === 'validated_reference' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{t}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── External Corrections ── */}
      {tab === 'external' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="외부에서 실제 데이터 관계를 수정한 경우의 참고 기록만 저장합니다 — 시스템이 실제 조치를 실행하지 않습니다." />
          <div className="flex flex-wrap items-center gap-2">
            <select value={extAction} onChange={(e) => setExtAction(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {EXTERNAL_ACTION_TYPES.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="수정 내용/사유(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
            <button disabled={busy} onClick={() => {
              const rr = needReason(); if (!rr) return;
              void act(() => recordKGExternalCorrection({ code: `kgext_${extAction}_${now.toISOString().slice(0, 19)}`, actionType: extAction, reason: rr, evidence: [{ label: 'manual_report', value: rr.slice(0, 200) }] }), '참고 기록 저장(reference only — 실행 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">참고 기록</button>
          </div>
          {!reviews.filter((r) => r.kind === 'external_correction_reference').length ? <AdminEmpty title="참고 기록 없음" /> : reviews.filter((r) => r.kind === 'external_correction_reference').map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone="neutral">{r.external_action_type}</AdminBadge>
                <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString('ko-KR')}</span>
              </div>
              <p className="mt-1">{r.reason}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="감사 이벤트 없음" /> : (
          <div className="space-y-1">
            {audit.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={e.event_type.includes('conflict') || e.event_type.includes('orphan') ? 'warning' : 'info'}>{e.event_type}</AdminBadge>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
                </div>
                {e.detail && <p className="mt-1 text-muted-foreground">{e.detail}</p>}
              </div>
            ))}
          </div>
        )
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-1">
          {KG_SUPPORT.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'partially_supported' || s.status === 'read_only' || s.status === 'evidence_only' ? 'info' : 'neutral'}>{s.status}</AdminBadge>
              <span className="font-bold">{s.label}</span>
              <span className="text-muted-foreground">{s.note}</span>
            </div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
