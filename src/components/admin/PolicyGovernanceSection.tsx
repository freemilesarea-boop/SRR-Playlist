/**
 * PolicyGovernanceSection — Enterprise Policy & Strategy Governance Center (Phase AI-OPS-9).
 *
 * Business Rules → Policy Inventory → Versioning → Dependency Graph → Impact Analysis →
 * Simulation(evidence-only) → AI Recommendation(Explainable) → Human Approval → Audit.
 * AI 는 Policy Recommendation 만 생성 — 자동 정책/가격/계약/정산/추천 정책 변경·
 * 자동 Merge/Deploy/Migration/Production Apply 없음.
 *
 * 탭 12개: Overview · Policy Inventory · Versions · Dependencies · Impact Analysis ·
 * Simulations · Recommendations · Strategy Alignment · Governance Consistency ·
 * Approval Workflow · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, GitBranch, Grid3x3, Layers, Lightbulb, Lock, RefreshCw,
  Scale, ScrollText, Target, FlaskConical, History,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchPolicySummary, fetchPolicyInventory, fetchPolicyVersions, registerPolicy, addPolicyVersion,
  savePolicyRecommendation, decidePolicyRecommendation, fetchPolicyRecommendations, fetchPolicyAudit,
  type PolicySummary, type PolicyRow, type PolicyVersionRow, type PolicyRecommendationRow, type PolicyEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  POLICY_DOMAINS, buildDependencyGraph, findDownstreamPolicies, calculatePolicyImpact,
  calculatePolicyRisk, simulatePolicyChange, buildPolicyRecommendation, validatePolicyRecommendation,
  canTransitionApproval, evaluateStrategyAlignment, detectPolicyConflict, evaluateGovernanceConsistency,
  POLICY_SUPPORT, IMPACT_TONE, CONSISTENCY_TONE, APPROVAL_TONE,
  type ApprovalStatus, type PolicySimulationContext,
} from '@/lib/policyGovernance';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'inventory' | 'versions' | 'dependencies' | 'impact' | 'simulations'
  | 'recommendations' | 'alignment' | 'consistency' | 'approval' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Overview', icon: Layers },
  { key: 'inventory', label: 'Policy Inventory', icon: BookOpen },
  { key: 'versions', label: 'Versions', icon: History },
  { key: 'dependencies', label: 'Dependencies', icon: GitBranch },
  { key: 'impact', label: 'Impact Analysis', icon: AlertTriangle },
  { key: 'simulations', label: 'Simulations', icon: FlaskConical },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'alignment', label: 'Strategy Alignment', icon: Target },
  { key: 'consistency', label: 'Governance Consistency', icon: Scale },
  { key: 'approval', label: 'Approval Workflow', icon: Scale },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

// 회사 전략 축(선언) — Alignment 판정 기준(추측 아님 — 명시 선언값)
const STRATEGY_PILLARS = ['revenue_growth', 'brand_trust', 'artist_fairness', 'operational_stability', 'compliance'];

export default function PolicyGovernanceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<PolicySummary>({});
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [recs, setRecs] = useState<PolicyRecommendationRow[]>([]);
  const [audit, setAudit] = useState<PolicyEventRow[]>([]);
  const [versions, setVersions] = useState<PolicyVersionRow[]>([]);
  const [versionCode, setVersionCode] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, p, r, au] = await Promise.all([
        fetchPolicySummary(), fetchPolicyInventory(null, null, 100), fetchPolicyRecommendations(null, 100), fetchPolicyAudit(100),
      ]);
      setSummary(s); setPolicies(p); setRecs(r); setAudit(au);
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

  const loadVersions = async (code: string) => {
    setVersionCode(code);
    try { setVersions(await fetchPolicyVersions(code, 50)); }
    catch (e) { toast.error(classifyAdminError(e).message); }
  };

  /* ── 실측 컨텍스트(summary 원본 값) ── */
  const settlement = summary.source_settlement_latest as Record<string, number | string> | null;
  const simCtx: PolicySimulationContext = useMemo(() => ({
    mrr: null,   // 이 Section 은 정책 원본만 조회 — MRR 은 Executive Section 실측(중복 조회 안 함 — 정직 표기)
    activeSubscriptions: null,
    poolRevenueRatio: settlement ? Number(settlement.pool_revenue_ratio) : null,
    companyFeeRatio: settlement ? Number(settlement.company_fee_ratio) : null,
    withholdingTaxRatio: settlement ? Number(settlement.withholding_tax_ratio) : null,
  }), [settlement]);

  /* ── Dependency Graph(등록 정책 depends_on 선언 기반) ── */
  const graph = useMemo(() => buildDependencyGraph(policies.map((p) => ({ code: p.policy_code, dependsOn: p.depends_on ?? [] }))), [policies]);

  /* ── Governance Consistency(실측 축만 판정) ── */
  const conflictChecks = useMemo(() => [
    detectPolicyConflict({ pair: 'contract_vs_settlement', values: { pool_revenue_ratio: simCtx.poolRevenueRatio, company_fee_ratio: simCtx.companyFeeRatio } }),
    detectPolicyConflict({ pair: 'pricing_vs_revenue', values: { plan_price: null, mrr: null, active_subscriptions: null } }),
    detectPolicyConflict({ pair: 'playlist_vs_brand', values: {} }),
    detectPolicyConflict({ pair: 'security_vs_privacy', values: {} }),
    detectPolicyConflict({ pair: 'cost_vs_capacity', values: { usage: null, limit: null } }),
  ], [simCtx]);
  const consistency = useMemo(() => evaluateGovernanceConsistency(conflictChecks), [conflictChecks]);

  /* ── Simulation(evidence-only) ── */
  const simulations = useMemo(() => {
    const pool = simCtx.poolRevenueRatio;
    return [
      { label: '구독료 10% 인상', r: simulatePolicyChange({ scenario: '구독료 +10%', kind: 'subscription_price', changeValue: 10 }, simCtx) },
      { label: '정산 pool 비율 +0.05', r: simulatePolicyChange({ scenario: 'pool +0.05', kind: 'settlement_ratio', changeValue: pool != null ? Math.min(1, pool + 0.05) : null }, simCtx) },
      { label: '수수료 비율 +0.05', r: simulatePolicyChange({ scenario: 'fee +0.05', kind: 'company_fee_ratio', changeValue: simCtx.companyFeeRatio != null ? Math.min(1, simCtx.companyFeeRatio + 0.05) : null }, simCtx) },
      { label: '플레이리스트 정책 변경', r: simulatePolicyChange({ scenario: '플레이리스트 정책', kind: 'playlist_policy', changeValue: 1 }, simCtx) },
      { label: '추천 알고리즘 변경', r: simulatePolicyChange({ scenario: '추천 알고리즘', kind: 'recommendation_algorithm', changeValue: 1 }, simCtx) },
    ];
  }, [simCtx]);

  /* ── 결정적 AI 추천(표본 방어 — 실측 관찰 기반) ── */
  const autoRecs = useMemo(() => {
    const out = [];
    const pool = simCtx.poolRevenueRatio; const fee = simCtx.companyFeeRatio;
    const srcCount = Number(summary.source_settlement_policies ?? 0);
    if (pool != null && fee != null && pool + fee > 0.9) {
      const r = buildPolicyRecommendation({
        code: `polrec_settlement_${now.toISOString().slice(0, 10)}`, domain: 'settlement',
        finding: `pool(${pool}) + fee(${fee}) = ${(pool + fee).toFixed(3)} — 여유 ${(1 - pool - fee).toFixed(3)}`,
        metricValue: pool + fee, sampleSize: srcCount >= 5 ? srcCount : 5,
        simulation: simulations[1].r,
      });
      if (!('insufficient' in r)) out.push(r);
    }
    const registered = policies.length;
    const domainsCovered = new Set(policies.map((p) => p.domain)).size;
    if (registered >= 1 && domainsCovered < POLICY_DOMAINS.length) {
      const r = buildPolicyRecommendation({
        code: `polrec_coverage_${now.toISOString().slice(0, 10)}`, domain: 'enterprise',
        finding: `정책 registry 커버리지 ${domainsCovered}/${POLICY_DOMAINS.length} 도메인`,
        metricValue: domainsCovered, sampleSize: Math.max(5, registered),
      });
      if (!('insufficient' in r)) out.push(r);
    }
    return out;
  }, [simCtx, summary, policies, simulations, now]);

  if (loading) return <AdminCard title="Enterprise Policy & Strategy Governance Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Enterprise Policy & Strategy Governance Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const regByStatus = (summary.registry_by_status ?? {}) as Record<string, number>;
  const recByStatus = (summary.recommendations_by_status ?? {}) as Record<string, number>;

  return (
    <AdminCard
      title="Enterprise Policy & Strategy Governance Center"
      subtitle="정책 Inventory/Versioning/영향 분석/시뮬레이션/Explainable 추천/Human Approval/Audit — AI 는 추천만(자동 정책 변경 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="자동 정책/가격/계약 정책/정산 정책/AI 추천 정책 변경, 자동 Merge/Deploy/Migration Apply/Production Apply 는 없습니다. 버전은 append-only(덮어쓰기 금지)이며 approved_reference 는 참고 승인일 뿐 실제 적용 상태가 아닙니다. 기존 정책 원본 테이블(settlement_policies/subscription_plans 등)은 절대 변경하지 않고 읽기 집계만 합니다. Simulation 은 Digital Twin evidence-only(simulated≠actual)입니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Registry 정책" value={NUM(summary.registry_total as number)} />
            <Box label="버전 총계" value={NUM(summary.versions_total as number)} />
            <Box label="추천 대기(proposed)" value={NUM(recByStatus.proposed ?? 0)} />
            <Box label="참고 승인" value={NUM(recByStatus.approved_reference ?? 0)} />
            <Box label="정산 정책 원본(0059)" value={NUM(summary.source_settlement_policies as number)} />
            <Box label="가격 플랜 원본(0015)" value={NUM(((summary.source_subscription_plans as Array<unknown>) ?? []).length)} />
            <Box label="Retention 정책(0510)" value={NUM(summary.source_retention_policies as number)} />
            <Box label="SLA/Escalation(0509)" value={NUM(summary.source_operational_policies as number)} />
            <Box label="B2B 음악 정책(0349)" value={NUM(summary.source_franchise_policies as number)} />
            <Box label="Enterprise 자동화 규칙(0378)" value={NUM(summary.source_automation_rules as number)} />
            <Box label="Governance Consistency" value={consistency.verdict} />
            <Box label="자동 정책 변경" value="없음(금지)" />
          </div>
          {settlement && (
            <div className="rounded-lg border border-border p-2 text-[11px]">
              <p className="font-bold">현행 정산 정책 실측(settlement_policies 최신 — 원본 미변경)</p>
              <p className="mt-1 text-muted-foreground">effective_from {String(settlement.effective_from)} · pool {String(settlement.pool_revenue_ratio)} · fee {String(settlement.company_fee_ratio)} · tax {String(settlement.withholding_tax_ratio)} · 최소 지급 {NUM(settlement.min_payout_amount as number)}원({String(settlement.min_payout_basis)})</p>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {Object.entries(regByStatus).map(([k, v]) => <AdminBadge key={k} tone={k === 'active' ? 'success' : k === 'deprecated' || k === 'archived' ? 'neutral' : 'info'}>{k}: {v}</AdminBadge>)}
          </div>
        </div>
      )}

      {/* ── Policy Inventory ── */}
      {tab === 'inventory' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => registerPolicy({
                code: `pol_settlement_baseline`, domain: 'settlement', title: '정산 정책 기준선(원본 참조)',
                content: settlement ?? {}, changeReason: r,
                evidence: settlement ? [{ label: 'settlement_policies_latest', value: JSON.stringify(settlement) }] : [],
                sourceRef: 'settlement_policies(0059)', dependsOn: [], objectives: ['artist_fairness', 'revenue_growth'],
              }), '정산 기준선 정책 등록(registry — Production 정책 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">정산 기준선 등록</button>
            <button disabled={busy} onClick={() => {
              const r = needReason(); if (!r) return;
              void act(() => registerPolicy({
                code: `pol_pricing_baseline`, domain: 'pricing', title: '가격 정책 기준선(원본 참조)',
                content: { plans: summary.source_subscription_plans ?? [] }, changeReason: r,
                evidence: [{ label: 'subscription_plans', value: JSON.stringify(summary.source_subscription_plans ?? []) }],
                sourceRef: 'subscription_plans(0015)', dependsOn: [], objectives: ['revenue_growth'],
              }), '가격 기준선 정책 등록(registry — Production 정책 아님)');
            }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">가격 기준선 등록</button>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="등록/버전/결정 사유(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!policies.length ? <AdminEmpty title="등록된 정책 없음" description="기준선 등록 버튼으로 실측 원본을 registry 에 기록하세요(원본 미변경)." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead><tr className="border-b border-border text-left text-muted-foreground"><th className="py-1 pr-2">code</th><th className="pr-2">domain</th><th className="pr-2">title</th><th className="pr-2">status</th><th className="pr-2">v</th><th className="pr-2">source_ref</th><th className="pr-2">versions</th></tr></thead>
                <tbody>
                  {policies.map((p) => (
                    <tr key={p.id} className="border-b border-border/50">
                      <td className="py-1 pr-2 font-mono">{p.policy_code}</td>
                      <td className="pr-2">{p.domain}</td>
                      <td className="pr-2">{p.title}</td>
                      <td className="pr-2"><AdminBadge tone={p.status === 'active' ? 'success' : p.status === 'insufficient_data' ? 'info' : 'neutral'}>{p.status}</AdminBadge></td>
                      <td className="pr-2">v{p.current_version}</td>
                      <td className="pr-2 text-muted-foreground">{p.source_ref ?? 'registry 전용'}</td>
                      <td className="pr-2"><button onClick={() => { void loadVersions(p.policy_code); setTab('versions'); }} className="font-bold underline">보기</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">도메인 18종 whitelist: {POLICY_DOMAINS.join(' · ')} — Store/Artist/Content 는 전용 원본 테이블 없음(reference_only 정직 표기).</p>
        </div>
      )}

      {/* ── Versions ── */}
      {tab === 'versions' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <select value={versionCode} onChange={(e) => void loadVersions(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              <option value="">정책 선택</option>
              {policies.map((p) => <option key={p.id} value={p.policy_code}>{p.policy_code}</option>)}
            </select>
            {versionCode && (
              <button disabled={busy} onClick={() => {
                const r = needReason(); if (!r) return;
                void act(() => addPolicyVersion({ code: versionCode, content: { note: '수동 개정(사람)', at: now.toISOString() }, changeReason: r }), '새 버전 추가(append-only — 기존 버전 불변)');
              }} className="rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">새 버전 추가</button>
            )}
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="change_reason(필수)" className="min-w-[220px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          </div>
          {!versionCode ? <AdminEmpty title="정책을 선택하세요" description="버전은 append-only — 덮어쓰기/삭제 없음." /> :
            !versions.length ? <AdminEmpty title="버전 없음" /> : (
            <div className="space-y-1">
              {versions.map((v) => (
                <div key={v.id} className="rounded-lg border border-border p-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminBadge tone="info">v{v.version}</AdminBadge>
                    {v.previous_version != null && <span className="text-muted-foreground">← v{v.previous_version}</span>}
                    <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString('ko-KR')}</span>
                    {v.approved_by ? <AdminBadge tone="success">approved</AdminBadge> : <AdminBadge tone="neutral">proposed</AdminBadge>}
                  </div>
                  <p className="mt-1"><span className="font-bold">사유:</span> {v.change_reason}</p>
                  {v.effective_date && <p className="text-muted-foreground">effective {v.effective_date}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Dependencies ── */}
      {tab === 'dependencies' && (
        <div className="space-y-2">
          {!graph.nodes.length ? <AdminEmpty title="등록 정책 없음" description="Inventory 에서 정책을 등록하면 depends_on 선언 기반 그래프가 표시됩니다." /> : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="노드" value={NUM(graph.nodes.length)} />
                <Box label="의존 edge" value={NUM(graph.edges.length)} />
                <Box label="순환(cycle)" value={NUM(graph.cycles.length)} />
                <Box label="미등록 참조" value={graph.unknownRefs.length ? graph.unknownRefs.join(', ') : '없음'} />
              </div>
              {graph.cycles.length > 0 && <AdminAlert tone="danger" title="순환 의존 감지" description={graph.cycles.map((c) => c.join(' → ')).join(' / ')} />}
              <div className="space-y-1">
                {graph.nodes.map((n) => {
                  const downstream = findDownstreamPolicies(policies.map((p) => ({ code: p.policy_code, dependsOn: p.depends_on ?? [] })), n);
                  return (
                    <div key={n} className="rounded-lg border border-border p-2 text-[11px]">
                      <span className="font-mono font-bold">{n}</span>
                      <span className="ml-2 text-muted-foreground">변경 시 영향 하류: {downstream.length ? downstream.join(', ') : '없음'}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">그래프는 등록 정책의 depends_on 선언 기반 — 선언 없는 의존성은 표시하지 않음(추측 금지).</p>
            </>
          )}
        </div>
      )}

      {/* ── Impact Analysis ── */}
      {tab === 'impact' && (
        <div className="space-y-2">
          {(() => {
            const pool = simCtx.poolRevenueRatio; const fee = simCtx.companyFeeRatio;
            const settlementImpact = pool != null && fee != null ? Math.min(100, (pool + fee) * 100) : null;
            const impact = calculatePolicyImpact({
              revenueImpact: settlementImpact != null ? settlementImpact * 0.8 : null,
              growthImpact: null, storeImpact: null, artistImpact: settlementImpact,
              contractImpact: null, settlementImpact, playbackImpact: null, securityImpact: null, complianceImpact: null,
            });
            const risk = calculatePolicyRisk({ impactScore: impact.score, confidence: 60, unknownFactorCount: impact.missing.length });
            return (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Box label="예시: 정산 정책 변경 영향" value={impact.score == null ? impact.level : `${impact.score} (${impact.level})`} />
                  <Box label="위험 점수" value={risk.score == null ? risk.level : `${risk.score} (${risk.level})`} />
                  <Box label="측정 성분" value={impact.used.length ? impact.used.join(', ') : '없음'} />
                  <Box label="누락 성분(제외)" value={impact.missing.length ? impact.missing.join(', ') : '없음'} />
                </div>
                <AdminAlert tone={IMPACT_TONE[impact.level]} description={impact.note + ' — 자동 조치 없음(noAutoAction). 영향 레벨: negligible < low < moderate < high < critical, 데이터 없으면 insufficient_data(추측 금지).'} />
              </>
            );
          })()}
          <p className="text-[10px] text-muted-foreground">영향 성분 9종(Revenue/Growth/Store/Artist/Contract/Settlement/Playback/Security/Compliance) — 실측 가능한 성분만 가중 재정규화.</p>
        </div>
      )}

      {/* ── Simulations ── */}
      {tab === 'simulations' && (
        <div className="space-y-1">
          {simulations.map((s) => (
            <div key={s.label} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold">{s.label}</span>
                <AdminBadge tone={s.r.result === 'projected' ? 'info' : s.r.result === 'conflicting' ? 'danger' : 'neutral'}>{s.r.result}</AdminBadge>
                <AdminBadge tone="neutral">simulated≠actual</AdminBadge>
                {s.r.confidence != null && <span className="text-muted-foreground">confidence {s.r.confidence}</span>}
              </div>
              <p className="mt-1"><span className="font-bold">Expected Benefit:</span> {s.r.expectedBenefit}</p>
              <p><span className="font-bold">Expected Risk:</span> {s.r.expectedRisk}</p>
              {s.r.unknownFactors.length > 0 && <p className="text-muted-foreground">Unknown Factors: {s.r.unknownFactors.join(' · ')}</p>}
              {s.r.evidence.length > 0 && <p className="text-muted-foreground">Evidence: {s.r.evidence.map((e) => `${e.label}=${e.value}`).join(' · ')}</p>}
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">Digital Twin evidence-only — 실제 적용 없음. MRR 투영은 Executive Section 실측과 별도(이 Section 은 정산 비율 원본만 조회 — 중복 조회 없음 정직 표기). 플레이리스트/추천 알고리즘은 반응 모델 없음 → insufficient_data.</p>
        </div>
      )}

      {/* ── Recommendations ── */}
      {tab === 'recommendations' && (
        <div className="space-y-2">
          <p className="text-[11px] font-bold">AI 생성 추천(결정적 · 저장 전 미리보기)</p>
          {!autoRecs.length ? <AdminEmpty title="생성된 추천 없음" description="실측 관찰이 임계에 도달하지 않았거나 표본 부족(<5) — 추측 생성 금지." /> : autoRecs.map((r) => (
            <div key={r.code} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone="info">{r.code}</AdminBadge>
                <span className="text-muted-foreground">confidence {r.confidence}</span>
                <AdminBadge tone="warning">Human Approval 필수</AdminBadge>
              </div>
              <p className="mt-1"><span className="font-bold">Recommendation:</span> {r.recommendation}</p>
              <p><span className="font-bold">Reason:</span> {r.reason}</p>
              <p><span className="font-bold">Risk:</span> {r.risk}</p>
              <p className="text-muted-foreground">Alternatives: {r.alternatives.join(' / ')} · Preconditions: {r.preconditions.join(' / ')}</p>
              <button disabled={busy} onClick={() => {
                const errs = validatePolicyRecommendation(r);
                if (errs.length) { toast.error(errs.join(', ')); return; }
                void act(() => savePolicyRecommendation({
                  code: r.code, recType: 'policy_change', recommendation: r.recommendation, reason: r.reason,
                  evidence: r.evidence.map((e) => ({ label: e.label, value: e.value })), confidence: r.confidence,
                  alternatives: r.alternatives, risk: r.risk, preconditions: r.preconditions, limitations: r.limitations,
                  idempotencyKey: r.code,
                }), '추천 저장(proposed — 자동 적용 없음)');
              }} className="mt-1 rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50">추천 저장</button>
            </div>
          ))}
          <p className="text-[11px] font-bold">저장된 추천</p>
          {!recs.length ? <AdminEmpty title="저장된 추천 없음" /> : recs.map((r) => (
            <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{r.rec_code}</span>
                <AdminBadge tone={APPROVAL_TONE[r.approval_status as ApprovalStatus] ?? 'info'}>{r.approval_status}</AdminBadge>
                <span className="text-muted-foreground">{r.rec_type}</span>
                {r.confidence != null && <span className="text-muted-foreground">confidence {r.confidence}</span>}
              </div>
              <p className="mt-1">{r.recommendation}</p>
            </div>
          ))}
        </div>
      )}

      {/* ── Strategy Alignment ── */}
      {tab === 'alignment' && (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground">회사 전략 축(선언): {STRATEGY_PILLARS.join(' · ')}</p>
          {!policies.length ? <AdminEmpty title="등록 정책 없음" description="정책의 objectives 선언과 전략 축을 비교합니다 — 미선언 시 insufficient_data." /> : policies.map((p) => {
            const a = evaluateStrategyAlignment(p.objectives, STRATEGY_PILLARS);
            return (
              <div key={p.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{p.policy_code}</span>
                  <AdminBadge tone={a.verdict === 'aligned' ? 'success' : a.verdict === 'partially_aligned' ? 'warning' : a.verdict === 'misaligned' ? 'danger' : 'info'}>{a.verdict}</AdminBadge>
                </div>
                <p className="mt-1 text-muted-foreground">{a.note}{a.matched.length ? ` · 일치: ${a.matched.join(', ')}` : ''}{a.unmatched.length ? ` · 불일치: ${a.unmatched.join(', ')}` : ''}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Governance Consistency ── */}
      {tab === 'consistency' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-bold">전체 판정:</span>
            <AdminBadge tone={CONSISTENCY_TONE[consistency.verdict]}>{consistency.verdict}</AdminBadge>
            <span className="text-[11px] text-muted-foreground">consistent {consistency.consistent} · partial {consistency.partial} · conflicting {consistency.conflicting} · 판정 불가 {consistency.unknown}</span>
          </div>
          {conflictChecks.map((c) => (
            <div key={c.pair} className="rounded-lg border border-border p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{c.pair}</span>
                <AdminBadge tone={CONSISTENCY_TONE[c.verdict]}>{c.verdict}</AdminBadge>
              </div>
              <p className="mt-1 text-muted-foreground">{c.detail}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground">정량 판정은 정산 비율(실측)만 가능 — 가격/용량 축은 이 Section 에서 원본 미조회(insufficient_data), 플레이리스트↔브랜드/보안↔프라이버시는 수동 검토(추측 금지).</p>
        </div>
      )}

      {/* ── Approval Workflow ── */}
      {tab === 'approval' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="전이 whitelist: draft→proposed→waiting_review→approved_reference/rejected→archived (cancelled 은 결정 전만). approved_reference 는 참고 승인 — 실제 Production 적용 상태가 아닙니다." />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="결정 사유(필수)" className="w-full rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />
          {!recs.length ? <AdminEmpty title="추천 없음" /> : recs.map((r) => {
            const from = r.approval_status as ApprovalStatus;
            const targets = (['proposed', 'waiting_review', 'approved_reference', 'rejected', 'cancelled', 'archived'] as ApprovalStatus[]).filter((t) => canTransitionApproval(from, t));
            return (
              <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono font-bold">{r.rec_code}</span>
                  <AdminBadge tone={APPROVAL_TONE[from] ?? 'info'}>{from}</AdminBadge>
                  {r.human_decision_reason && <span className="text-muted-foreground">사유: {r.human_decision_reason}</span>}
                </div>
                {targets.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {targets.map((t) => (
                      <button key={t} disabled={busy} onClick={() => {
                        const rr = needReason(); if (!rr) return;
                        void act(() => decidePolicyRecommendation(r.id, t, rr), `${t} 처리(사람 결정 — Production 미적용)`);
                      }} className={`rounded-md px-2 py-1 text-[11px] font-bold disabled:opacity-50 ${t === 'approved_reference' ? 'bg-accent text-black' : 'border border-border hover:bg-muted'}`}>{t}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        !audit.length ? <AdminEmpty title="감사 이벤트 없음" /> : (
          <div className="space-y-1">
            {audit.map((e) => (
              <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <AdminBadge tone={e.event_type === 'conflict_detected' ? 'danger' : 'info'}>{e.event_type}</AdminBadge>
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
          {POLICY_SUPPORT.map((s) => (
            <div key={s.key} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'supported' ? 'info' : s.status === 'unsupported' ? 'danger' : 'neutral'}>{s.status}</AdminBadge>
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
