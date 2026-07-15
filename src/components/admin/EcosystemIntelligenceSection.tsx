/**
 * EcosystemIntelligenceSection — Enterprise Ecosystem Intelligence, Partner Network &
 * External Dependency Center (Phase AI-OPS-27).
 *
 * Enterprise→Partners→External Services→Dependencies→Ecosystem Health→Executive Ecosystem Advisory.
 * 자동 파트너 등록/계약·API·공급사·클라우드·AI Provider 변경 없음 · Dependency ≠ Failure ·
 * Availability ≠ SLA Guarantee · Partner ≠ Trust · Integration ≠ Compatibility Guarantee.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, Gauge, GitBranch, Grid3x3, Handshake, HeartPulse, History, Layers,
  Lightbulb, Link2, Lock, Plug, RefreshCw, Scale, ScrollText, ShieldAlert, Truck,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEcosystemSummary, createPartnerRegistryEntry, reviewPartnerRegistryEntry,
  fetchPartnerRegistry, fetchEcosystemDependencies, recordEcosystemGovernance, fetchEcosystemAudit,
  type EcosystemSummary, type PartnerRegistryRow, type EcosystemDependencyRow, type EcosystemEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  analyzeDependencies, evaluateEcosystemHealth, analyzePartnerPerformance, analyzeIntegration,
  buildDependencyGraph, analyzeSupplyChain, assessEcosystemRisk,
  buildEcosystemBriefing, buildEcosystemRecommendation, buildEcosystemCockpit,
  PARTNER_KINDS, ECOSYSTEM_SUPPORT,
} from '@/lib/ecosystemIntelligence';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));
const API_DOMAINS = ['api', 'edge_functions', 'payment', 'notification', 'email', 'auth'];

type Tab = 'cockpit' | 'dashboard' | 'partners' | 'dependencies' | 'graph' | 'health' | 'performance'
  | 'integration' | 'supplychain' | 'risks' | 'briefing' | 'recommendations' | 'humanreviews'
  | 'external' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'cockpit', label: 'Ecosystem Cockpit', icon: Layers },
  { key: 'dashboard', label: 'Executive Ecosystem Dashboard', icon: Gauge },
  { key: 'partners', label: 'Partner Registry', icon: Handshake },
  { key: 'dependencies', label: 'External Dependencies', icon: Link2 },
  { key: 'graph', label: 'Dependency Graph', icon: GitBranch },
  { key: 'health', label: 'Ecosystem Health', icon: HeartPulse },
  { key: 'performance', label: 'Partner Performance', icon: Activity },
  { key: 'integration', label: 'Integration Intelligence', icon: Plug },
  { key: 'supplychain', label: 'Supply Chain', icon: Truck },
  { key: 'risks', label: 'Ecosystem Risk', icon: ShieldAlert },
  { key: 'briefing', label: 'Executive Ecosystem Briefing', icon: ScrollText },
  { key: 'recommendations', label: 'Ecosystem Recommendations', icon: Lightbulb },
  { key: 'humanreviews', label: 'Human Reviews', icon: Scale },
  { key: 'external', label: 'External References', icon: ScrollText },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function EcosystemIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('cockpit');
  const [summary, setSummary] = useState<EcosystemSummary>({});
  const [partners, setPartners] = useState<PartnerRegistryRow[]>([]);
  const [deps, setDeps] = useState<EcosystemDependencyRow[]>([]);
  const [audit, setAudit] = useState<EcosystemEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, pa, de, au] = await Promise.all([
        fetchEcosystemSummary(), fetchPartnerRegistry(null, 100), fetchEcosystemDependencies(null, 100), fetchEcosystemAudit(100),
      ]);
      setSummary(s); setPartners(pa); setDeps(de); setAudit(au);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Decision)'); return null; }
    return reason.trim();
  };

  const actuals = useMemo(() => (typeof summary.ecosystem_actuals === 'object' && summary.ecosystem_actuals !== null && !Array.isArray(summary.ecosystem_actuals) ? summary.ecosystem_actuals as Record<string, unknown> : {}), [summary]);
  const anum = useCallback((k: string): number | null => (typeof actuals[k] === 'number' ? actuals[k] as number : null), [actuals]);

  const depAnalysis = useMemo(() => analyzeDependencies(deps.map((d) => ({ code: d.dependency_code, domain: d.domain, criticality: d.criticality, fallbackAvailable: d.fallback_available }))), [deps]);

  const graph = useMemo(() => {
    const nodes: { id: string; level: string; label: string; parentId: string | null }[] = [
      { id: 'ent', level: 'enterprise', label: '스르륵 플리', parentId: null },
      { id: 'plat', level: 'platform', label: 'Platform', parentId: 'ent' },
      ...partners.filter((p) => p.partner_status !== 'suspended').map((p) => ({ id: p.id, level: 'partner', label: p.name, parentId: 'plat' })),
    ];
    for (const d of deps) {
      const owner = partners.find((p) => (p.linked_dependency_ids ?? []).includes(d.id));
      nodes.push({ id: d.id, level: API_DOMAINS.includes(d.domain) ? 'api' : 'infrastructure', label: d.dependency_code, parentId: owner?.id ?? 'plat' });
    }
    return buildDependencyGraph(nodes);
  }, [partners, deps]);

  const paymentSample = useMemo(() => (anum('payment_paid_30d') ?? 0) + (anum('payment_failed_30d') ?? 0), [anum]);
  const paymentAvailability = useMemo(() => (paymentSample > 0 ? Math.round(((anum('payment_paid_30d') ?? 0) / paymentSample) * 10000) / 100 : null), [paymentSample, anum]);

  const health = useMemo(() => evaluateEcosystemHealth({
    availabilityProxyPct: paymentAvailability,   // 결제 성공률 Proxy — 외부 uptime 아님
    reliabilitySample: paymentSample > 0 ? paymentSample : null,
    latencyMs: null,                             // latency 측정 원본 없음
    slaStatus: null,                             // 외부 SLA 데이터 없음
    integrationSignal: deps.filter((d) => d.lifecycle_status === 'active').length || null,
  }), [paymentAvailability, paymentSample, deps]);

  const performance = useMemo(() => partners.map((p) => {
    const isPayment = p.partner_kind === 'payment';
    return {
      p,
      perf: analyzePartnerPerformance({
        partner: p.name,
        incidentCount: isPayment ? anum('incidents_api_failure_0502') : null,
        failureRatePct: isPayment && paymentSample > 0 && paymentAvailability != null ? Math.round((100 - paymentAvailability) * 100) / 100 : null,
        sample: isPayment ? paymentSample : 0,
        evidence: isPayment && paymentSample > 0 ? ['payment_orders 실측'] : [],
      }),
    };
  }), [partners, anum, paymentSample, paymentAvailability]);

  const integration = useMemo(() => analyzeIntegration(deps.map((d) => ({ name: d.dependency_code, lifecycleStatus: d.lifecycle_status, deprecated: d.lifecycle_status === 'deprecated' }))), [deps]);

  const supplyChain = useMemo(() => analyzeSupplyChain([
    { key: 'content_supply(tracks)', measuredValue: anum('tracks_supply_rows'), note: 'tracks 행 수 실측' },
    { key: 'content_supply(artists)', measuredValue: anum('artists_registered'), note: '등록 아티스트 실측' },
    { key: 'payment_flow(paid 30d)', measuredValue: anum('payment_paid_30d'), note: 'payment_orders 실측' },
    { key: 'infrastructure_provider(deps)', measuredValue: depAnalysis.total || null, note: '0508 dependency 실측' },
    { key: 'ai_provider', measuredValue: null, note: '모델 사용 로그 원본 없음' },
  ]), [anum, depAnalysis]);

  const risks = useMemo(() => {
    const critical = deps.filter((d) => d.criticality === 'critical');
    const noFallbackCritical = critical.filter((d) => d.fallback_available === false).length;
    const incidents = anum('incidents_api_failure_0502');
    return [
      assessEcosystemRisk({ kind: 'partner_risk', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['파트너 외부 리포트 없음 — unknown 유지'] }),
      assessEcosystemRisk({ kind: 'api_risk', signal: incidents != null ? Math.min(100, incidents * 10) : null, highThreshold: 50, mediumThreshold: 20, evidence: incidents != null ? ['ai_incidents(0502) 실측'] : [] }),
      assessEcosystemRisk({ kind: 'infrastructure_risk', signal: critical.length ? Math.round((noFallbackCritical / critical.length) * 100) : null, highThreshold: 50, mediumThreshold: 25, evidence: critical.length ? ['0508 critical dependency 실측'] : [] }),
      assessEcosystemRisk({ kind: 'vendor_risk', signal: depAnalysis.total ? Math.round(((depAnalysis.noFallback.length + depAnalysis.fallbackUnknown.length) / depAnalysis.total) * 100) : null, highThreshold: 60, mediumThreshold: 30, evidence: depAnalysis.total ? ['fallback 실측'] : [] }),
      assessEcosystemRisk({ kind: 'supply_chain_risk', signal: null, highThreshold: 80, mediumThreshold: 50, evidence: ['공급망 외부 데이터 없음 — unknown 유지'] }),
    ];
  }, [deps, anum, depAnalysis]);

  const briefing = useMemo(() => buildEcosystemBriefing({
    periodKind: 'weekly',
    partnerChanges: partners.slice(0, 5).map((p) => `${p.partner_code}(${p.partner_kind}) ${p.partner_status}`),
    dependencyChanges: [`dependencies ${depAnalysis.total}건 · fallback 없음 ${depAnalysis.noFallback.length}건`],
    integrationStatus: [`coverage ${integration.coveragePct ?? '—'}% · deprecated ${integration.deprecatedCount}건(호환 보장 아님)`],
    unknownFactors: risks.filter((r) => r.level === 'unknown').map((r) => `${r.kind}: 외부 데이터 없음`),
    recommendations: [],
  }), [partners, depAnalysis, integration, risks]);

  const autoRecs = useMemo(() => {
    const out: { type: string; reason: string }[] = [];
    const push = (r: ReturnType<typeof buildEcosystemRecommendation>) => { if (!('rejected' in r)) out.push({ type: r.type, reason: r.reason }); };
    if (depAnalysis.noFallback.length) push(buildEcosystemRecommendation({ type: 'review_dependency', reason: `fallback 없는 의존성 ${depAnalysis.noFallback.length}건(Failure 단정 아님)`, evidence: depAnalysis.noFallback, confidence: null, assumptions: [] }));
    const unverified = partners.filter((p) => (p.evidence ?? []).length === 0).length;
    if (unverified > 0 || !partners.length) push(buildEcosystemRecommendation({ type: 'validate_partner', reason: partners.length ? `Evidence 없는 파트너 ${unverified}건` : 'Partner Registry 비어 있음 — 사람 등록 필요(자동 등록 불가)', evidence: ['registry'], confidence: null, assumptions: [] }));
    if (integration.deprecatedCount > 0) push(buildEcosystemRecommendation({ type: 'improve_integration', reason: `deprecated 연동 ${integration.deprecatedCount}건 — 수명주기 검토`, evidence: ['lifecycle 실측'], confidence: null, assumptions: [] }));
    if (risks.some((r) => r.level === 'unknown')) push(buildEcosystemRecommendation({ type: 'gather_external_evidence', reason: 'unknown 리스크 존재 — 외부 SLA/리포트 확보 전 해석 금지', evidence: ['risk_unknown'], confidence: null, assumptions: [] }));
    if (health.verdict !== 'partial_measured') push(buildEcosystemRecommendation({ type: 'monitor_ecosystem', reason: '생태계 실측 신호 부족 — 모니터링 도입 검토', evidence: [health.verdict], confidence: null, assumptions: [] }));
    if (risks.some((r) => r.kind === 'vendor_risk' && (r.level === 'high' || r.level === 'medium'))) push(buildEcosystemRecommendation({ type: 'review_vendor_risk', reason: 'fallback 미비 vendor 의존 비율 상승(Incident 아님)', evidence: ['fallback 실측'], confidence: null, assumptions: [] }));
    return out;
  }, [depAnalysis, partners, integration, risks, health]);

  const cockpit = useMemo(() => buildEcosystemCockpit({
    partnersTotal: partners.length,
    dependencyTotal: depAnalysis.total,
    healthVerdict: health.verdict,
    integrationCoverage: integration.coveragePct,
    supplyChainVerdict: supplyChain.verdict,
    risksHigh: risks.filter((r) => r.level === 'high').length,
    summaryNote: null,
  }), [partners, depAnalysis, health, integration, supplyChain, risks]);

  if (loading) return <AdminCard title="Enterprise Ecosystem Intelligence & External Dependency Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Ecosystem Intelligence & External Dependency Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Enterprise Ecosystem Intelligence & External Dependency Center"
      subtitle="Partners→External Services→Dependencies→Ecosystem Health→Executive Ecosystem Advisory — 자동 파트너 등록/계약·API·공급사 변경 없음"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 파트너 등록, 자동 계약/API/공급사/클라우드/AI Provider 변경, 자동 Production/Merge/Deploy 는 없습니다. Dependency 는 읽기 전용 분석만 수행합니다. Dependency ≠ Failure, Availability ≠ SLA Guarantee, Partner ≠ Trust, Integration ≠ Compatibility Guarantee, Risk ≠ Incident, Recommendation ≠ Business Decision." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Cockpit ── */}
      {tab === 'cockpit' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {cockpit.sections.map((s) => (
              <div key={s.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold uppercase text-muted-foreground">{s.key}</p>
                <p className="mt-0.5 text-sm font-black">{s.headline}</p>
                <p className="text-[10px] text-muted-foreground">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">humanDecisionRequired · contractChanged=false</p>
        </div>
      )}

      {/* ── Dashboard ── */}
      {tab === 'dashboard' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Dependencies(0508 실측)" value={NUM(anum('dependencies_total_0508'))} />
            <Box label="Active Dependencies" value={NUM(anum('dependencies_active_0508'))} />
            <Box label="Fallback 없음" value={NUM(anum('dependencies_no_fallback'))} />
            <Box label="Fallback unknown(null 유지)" value={NUM(anum('dependencies_fallback_unknown'))} />
            <Box label="Payment paid(30d)" value={NUM(anum('payment_paid_30d'))} />
            <Box label="Payment failed(30d)" value={NUM(anum('payment_failed_30d'))} />
            <Box label="API Incidents(0502)" value={NUM(anum('incidents_api_failure_0502'))} />
            <Box label="Content Supply(tracks)" value={NUM(anum('tracks_supply_rows'))} />
          </div>
          <AdminAlert tone="info" description={`ecosystem_unavailable: ${Array.isArray(summary.ecosystem_unavailable) ? (summary.ecosystem_unavailable as unknown[]).map(String).join(', ') : '—'} — 외부 SLA/uptime/latency/계약 데이터 원본 없음(임의 생성 금지).`} />
        </div>
      )}

      {/* ── Partners ── */}
      {tab === 'partners' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {PARTNER_KINDS.slice(0, 4).map((kind) => (
              <button key={kind} disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => createPartnerRegistryEntry({ code: `ptn_${kind}_${now.toISOString().slice(0, 19)}`, kind, name: r.slice(0, 100), evidence: [{ label: 'note', value: '사람 등록 파트너' }] }), `${kind} 파트너 등록(Trust 판정 아님)`);
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">{kind} 등록</button>
            ))}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="파트너 이름/사유(사람 입력·필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!partners.length ? <AdminEmpty title="파트너 없음" description="파트너는 AI 가 자동 등록하지 않습니다 — 사람 등록만 기록됩니다(active/monitoring/suspended/unknown 4상태)." /> : partners.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{p.partner_code}</span>
                <AdminBadge tone="info">{p.partner_kind}</AdminBadge>
                <AdminBadge tone={p.partner_status === 'active' ? 'success' : p.partner_status === 'monitoring' ? 'warning' : p.partner_status === 'suspended' ? 'neutral' : 'warning'}>{p.partner_status}</AdminBadge>
                <span className="text-muted-foreground">{p.name} · 의존 연결 {(p.linked_dependency_ids ?? []).length}건 · Partner ≠ Trust</span>
              </div>
              {p.partner_status !== 'suspended' && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {(['active', 'monitoring', 'suspended'] as const).map((st) => (
                    <button key={st} disabled={busy} onClick={() => { const rr = needReason(); if (!rr) return; void act(() => reviewPartnerRegistryEntry(p.id, st, rr), `${st}(계약 변경 아님)`); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{st}</button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Dependencies / Graph ── */}
      {tab === 'dependencies' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="총 의존성" value={NUM(depAnalysis.total)} />
            <Box label="Fallback 없음" value={depAnalysis.noFallback.join(', ') || '없음'} />
            <Box label="Fallback unknown" value={depAnalysis.fallbackUnknown.join(', ') || '없음'} />
            <Box label="Criticality 분포" value={Object.entries(depAnalysis.byCriticality).map(([k, v]) => `${k}:${v}`).join(' · ') || '—'} />
          </div>
          {!deps.length ? <AdminEmpty title="의존성 없음" description="ai_operational_dependencies(0508)가 기록되면 읽기 전용으로 분석합니다 — Dependency ≠ Failure." /> : deps.slice(0, 30).map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono font-bold">{d.dependency_code}</span>
              <AdminBadge tone="info">{d.domain}</AdminBadge>
              <AdminBadge tone={d.criticality === 'critical' ? 'danger' : d.criticality === 'high' ? 'warning' : 'neutral'}>{d.criticality}</AdminBadge>
              <AdminBadge tone={d.lifecycle_status === 'active' ? 'success' : 'neutral'}>{d.lifecycle_status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{d.provider}/{d.service_name} · fallback {d.fallback_available == null ? 'unknown(null 유지)' : d.fallback_available ? '있음' : '없음'}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'graph' && (
        <div className="space-y-2">
          {graph.levels.map((l) => (
            <div key={l.level} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={l.nodes.length ? 'info' : 'neutral'}>{l.level}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{l.nodes.length ? l.nodes.slice(0, 6).map((n) => n.label + (n.linked ? '' : '(미연결)')).join(' · ') : '노드 없음'}</span>
            </div>
          ))}
          {graph.orphans.length > 0 && <AdminAlert tone="warning" title={`미연결 ${graph.orphans.length}건`} description="상위 계층과 연결되지 않은 노드 — 사람 검토 필요" />}
          {graph.cycles.length > 0 && <AdminAlert tone="danger" title="Cycle 감지(원인 단정 아님)" description={graph.cycles.join(' · ')} />}
          <p className="text-[10px] text-muted-foreground">Enterprise→Platform→Partner→API→Infrastructure 5단계 · cycleIsNotCauseClaim=true</p>
        </div>
      )}

      {/* ── Health / Performance / Integration / Supply Chain ── */}
      {tab === 'health' && (
        <div className="space-y-1">
          {health.components.map((c) => (
            <div key={c.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{c.key}</span>
              <AdminBadge tone={c.status === 'measured_proxy' ? 'info' : 'warning'}>{c.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{c.value == null ? 'null(원본 없음 — 0 아님)' : String(c.value)}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">availability_proxy 는 결제 성공률 기반 Proxy 이며 외부 uptime 이 아닙니다 · Availability ≠ SLA Guarantee</p>
        </div>
      )}
      {tab === 'performance' && (
        !performance.length ? <AdminEmpty title="평가 대상 없음" description="파트너가 등록되면 내부 실측(결제/Incident)으로만 관찰합니다 — Partner ≠ Trust." /> : (
          <div className="space-y-1">
            {performance.map(({ p, perf }) => (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <span className="font-bold">{p.name}</span>
                <AdminBadge tone={perf.verdict === 'performance_observed' ? 'info' : 'warning'}>{perf.verdict}</AdminBadge>
                <span className="ml-2 text-muted-foreground">{p.partner_kind} · 내부 실측 기반 관찰 · Partner ≠ Trust</span>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'integration' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Coverage(active 비율)" value={integration.coveragePct == null ? 'insufficient_data' : `${integration.coveragePct}%`} />
            <Box label="총 연동" value={NUM(integration.total)} />
            <Box label="Deprecated" value={NUM(integration.deprecatedCount)} />
            <Box label="Lifecycle unknown" value={integration.lifecycleUnknown.join(', ') || '없음'} />
          </div>
          <AdminAlert tone="info" description="Version Compatibility 는 API 버전 레지스트리 원본이 없어 평가하지 않습니다(ecosystem_unavailable). integrationIsNotCompatibilityGuarantee=true — 연동 존재가 호환을 보장하지 않습니다." />
        </div>
      )}
      {tab === 'supplychain' && (
        <div className="space-y-1">
          {supplyChain.segments.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{s.key}</span>
              <AdminBadge tone={s.status === 'measured' ? 'success' : 'warning'}>{s.status}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.value == null ? 'null(원본 없음)' : NUM(s.value)} · {s.note}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Content/Payment/AI Provider/Infrastructure/Third-party — 실측/미존재를 구분 표기합니다.</p>
        </div>
      )}

      {/* ── Risks ── */}
      {tab === 'risks' && (
        <div className="space-y-1">
          {risks.map((r) => (
            <div key={r.kind} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-bold">{r.kind}</span>
              <AdminBadge tone={r.level === 'high' ? 'danger' : r.level === 'medium' ? 'warning' : r.level === 'low' ? 'success' : 'neutral'}>{r.level}</AdminBadge>
              <span className="ml-2 text-muted-foreground">Risk ≠ Incident{r.level === 'unknown' ? ' · 외부 데이터 없음 — unknown 유지' : ''}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Briefing ── */}
      {tab === 'briefing' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordEcosystemGovernance('ecosystem_briefing_recorded', r, { period: 'weekly', sections: briefing.sections.map((s) => ({ key: s.key, count: s.items.length })) }), 'Briefing 기록(자동 발송 없음)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Weekly Ecosystem Briefing 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {briefing.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.items.length ? 'info' : 'neutral'}>{s.key}</AdminBadge>
              <span className="ml-2 text-muted-foreground">{s.items.length ? s.items.join(' · ') : '항목 없음(unknown 유지)'}</span>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Today/Weekly/Monthly/Quarterly — autoSendDisabled=true(자동 발송 없음)</p>
        </div>
      )}

      {/* ── Recommendations / Reviews / External / Audit / Support ── */}
      {tab === 'recommendations' && (
        !autoRecs.length ? <AdminEmpty title="권고 없음" description="Evidence 없는 권고는 생성되지 않습니다." /> : (
          <div className="space-y-1">
            {autoRecs.map((r, i) => (
              <div key={i} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{r.type}</AdminBadge>
                <span className="ml-2">{r.reason}</span>
                <p className="mt-1 text-[10px] text-muted-foreground">humanApprovalRequired · Recommendation ≠ Business Decision</p>
              </div>
            ))}
          </div>
        )
      )}
      {tab === 'humanreviews' && (() => {
        const reviews = audit.filter((e) => ['partner_registered', 'partner_reviewed', 'partner_suspended'].includes(e.event_type));
        return !reviews.length ? <AdminEmpty title="검토 이력 없음" description="파트너 등록/판정은 전부 사람이 수행합니다(자동 등록 없음)." /> : (
          <div className="space-y-1">
            {reviews.slice(0, 40).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone="info">{e.event_type}</AdminBadge>
                <span className="ml-2">{e.detail}</span>
              </div>
            ))}
          </div>
        );
      })()}
      {tab === 'external' && (() => {
        const ext = audit.filter((e) => e.event_type === 'external_ecosystem_reference');
        return !ext.length ? <AdminEmpty title="외부 참조 없음" description="외부 생태계 자료(SLA/리포트)는 참조로만 기록됩니다." /> : (
          <div className="space-y-1">
            {ext.slice(0, 30).map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]"><span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span><span className="ml-2">{e.detail}</span></div>
            ))}
          </div>
        );
      })()}
      {tab === 'audit' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => recordEcosystemGovernance('ecosystem_risk_assessed', r, { risks: risks.map((x) => ({ kind: x.kind, level: x.level })) }), 'Risk 평가 기록(Risk ≠ Incident)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">Risk 평가 기록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="기록 사유(필수)" className="min-w-[200px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!audit.length ? <AdminEmpty title="Audit 없음" description="생태계 기록/분석이 이벤트로 남습니다(16종 whitelist)." /> : audit.slice(0, 60).map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
              <span className="font-mono text-muted-foreground">{e.created_at.slice(0, 16).replace('T', ' ')}</span>
              <AdminBadge tone="neutral">{e.event_type}</AdminBadge>
              <span className="ml-2">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
      {tab === 'support' && (
        <div className="space-y-1">
          {ECOSYSTEM_SUPPORT.map((s) => (
            <div key={s.key} className="rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'supported' ? 'success' : s.status === 'partial' ? 'warning' : 'danger'}>{s.status}</AdminBadge>
              <span className="ml-2 font-bold">{s.key}</span>
              <span className="ml-2 text-muted-foreground">{s.note}</span>
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
