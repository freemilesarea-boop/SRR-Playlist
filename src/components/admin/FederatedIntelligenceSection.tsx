/**
 * FederatedIntelligenceSection — Federated Learning & Global Knowledge Federation (Phase AI-MUSIC-14).
 *
 * Store/Enterprise 는 Raw Data 를 노출하지 않고 Privacy Gate(표본/익명성/금지필드/PII)를
 * 통과한 **익명 Knowledge(통계/패턴/Confidence/Sample/Evidence)만** 공유한다.
 * Local Evidence 가 강하면 Local 우선, 강한 충돌은 Governance Review. Evidence Only —
 * 자동 Apply/Publish/Rollout/Scheduler/Queue/Playback 변경 없음. 기존 Memory/Graph 무변경.
 *
 * 탭: Overview · Store · Brand · Enterprise · Regional · Global · Federated Memory ·
 *     Federated Knowledge · Promotion · Privacy · Trust · Governance · Conflict · Support.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Network, Store, Tag, Building2, MapPin, Globe2, Database, BookOpen, ArrowUpCircle,
  ShieldCheck, Gauge, Scale, Swords, Grid3x3, Lock, RefreshCw,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchFederatedSummary, fetchFederatedPatterns, saveFederatedPattern, promoteFederatedPattern,
  fetchFederatedConflicts, saveFederatedConflict, resolveFederatedConflict, fetchFederatedPrivacyLog,
  fetchContextOverview, fetchEnterpriseBenchmark, fetchRegionBenchmark, fetchAiMemorySummary,
  fetchAgentReputation, fetchGovernanceSummary,
  type FederatedSummaryResp, type FederatedPatternRow, type FederatedConflictRow, type FederatedPrivacyRow,
  type ContextOverview, type EnterpriseBenchmarkRow, type RegionBenchmarkRow, type AiMemorySummaryResp,
  type AgentReputationRow, type GovernanceSummaryResp,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  FEDERATED_SOURCE_VERSION, FEDERATED_LAYERS, FEDERATED_SUPPORT, PROMOTION_GATES,
  extractKnowledge, validatePrivacy, aggregateKnowledge, resolveLocalOverride, detectFederatedConflicts,
  classifyPromotion, calculateKnowledgeDecay, computeFederatedTrust, federatedInputHash,
  STATUS_LABEL, STATUS_TONE, OVERRIDE_LABEL, OVERRIDE_TONE,
  type FederatedLayer, type PromotionStatus,
} from '@/lib/federatedIntel';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'store' | 'brand' | 'enterprise' | 'region' | 'global' | 'memory' | 'knowledge'
  | 'promotion' | 'privacy' | 'trust' | 'governance' | 'conflict' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Network }[] = [
  { key: 'overview', label: 'Overview', icon: Network },
  { key: 'store', label: 'Store Learning', icon: Store },
  { key: 'brand', label: 'Brand Learning', icon: Tag },
  { key: 'enterprise', label: 'Enterprise Learning', icon: Building2 },
  { key: 'region', label: 'Regional Learning', icon: MapPin },
  { key: 'global', label: 'Global Learning', icon: Globe2 },
  { key: 'memory', label: 'Federated Memory', icon: Database },
  { key: 'knowledge', label: 'Federated Knowledge', icon: BookOpen },
  { key: 'promotion', label: 'Promotion', icon: ArrowUpCircle },
  { key: 'privacy', label: 'Privacy Validation', icon: ShieldCheck },
  { key: 'trust', label: 'Trust', icon: Gauge },
  { key: 'governance', label: 'Governance', icon: Scale },
  { key: 'conflict', label: 'Conflict Resolution', icon: Swords },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function FederatedIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<FederatedSummaryResp | null>(null);
  const [patterns, setPatterns] = useState<FederatedPatternRow[]>([]);
  const [conflicts, setConflicts] = useState<FederatedConflictRow[]>([]);
  const [privacyLog, setPrivacyLog] = useState<FederatedPrivacyRow[]>([]);
  const [overview, setOverview] = useState<ContextOverview | null>(null);
  const [enterprise, setEnterprise] = useState<EnterpriseBenchmarkRow[]>([]);
  const [regions, setRegions] = useState<RegionBenchmarkRow[]>([]);
  const [memSummary, setMemSummary] = useState<AiMemorySummaryResp | null>(null);
  const [reputation, setReputation] = useState<AgentReputationRow[]>([]);
  const [gov, setGov] = useState<GovernanceSummaryResp | null>(null);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const now = useMemo(() => new Date(), []);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, p, c, pl, ov, ent, reg, ms, rep, gs] = await Promise.all([
        fetchFederatedSummary(), fetchFederatedPatterns(null, null, null, 100), fetchFederatedConflicts(null, 100),
        fetchFederatedPrivacyLog(null, 100), fetchContextOverview('30d'),
        fetchEnterpriseBenchmark('30d', 50).then((r) => r.items).catch(() => [] as EnterpriseBenchmarkRow[]),
        fetchRegionBenchmark('30d', 50).catch(() => [] as RegionBenchmarkRow[]),
        fetchAiMemorySummary().catch(() => null), fetchAgentReputation().catch(() => [] as AgentReputationRow[]),
        fetchGovernanceSummary().catch(() => null),
      ]);
      setSummary(s); setPatterns(p); setConflicts(c); setPrivacyLog(pl); setOverview(ov);
      setEnterprise(ent); setRegions(reg); setMemSummary(ms); setReputation(rep); setGov(gs);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Global baseline(업종 completion 중앙값 대용 — 전체 가중 평균).
  const industryRows = useMemo(() => (overview?.items ?? []), [overview]);
  const globalCompletion = useMemo(() => {
    const valid = industryRows.filter((r) => r.completion_rate != null);
    if (!valid.length) return null;
    const total = valid.reduce((a, r) => a + r.events, 0);
    return Math.round(valid.reduce((a, r) => a + (r.completion_rate as number) * r.events, 0) / Math.max(1, total) * 10) / 10;
  }, [industryRows]);

  // 익명 Knowledge 추출 + Privacy Gate + 저장(서버가 게이트 재검증).
  const extractAndShare = async (layer: FederatedLayer, industry: string, value: number | null, baseline: number | null, sampleCount: number, sampleStores: number, metricCode = 'completion_rate') => {
    const k = extractKnowledge({ industry, metricCode, value, baseline, sampleCount, sampleStores }, layer);
    if (!k) { toast.error('데이터 없는 KPI 는 추출하지 않습니다(insufficient_data)'); return; }
    const payload: Record<string, unknown> = {
      pattern_key: k.patternKey, layer: k.layer, industry: k.industry, context_key: k.contextKey,
      subject: { metric: k.metricCode }, metric_code: k.metricCode, direction: k.direction,
      effect_value: k.effectValue, baseline_value: k.baselineValue, confidence: k.confidence,
      sample_count: k.sampleCount, sample_stores: k.sampleStores,
      evidence: k.evidence, limitations: k.limitations,
      source_version: FEDERATED_SOURCE_VERSION,
      input_hash: federatedInputHash([k.patternKey, k.effectValue, k.sampleCount]),
    };
    const pre = validatePrivacy({ sampleCount: k.sampleCount, sampleStores: k.sampleStores, layer, payloadKeys: Object.keys(payload), payloadText: JSON.stringify(payload) });
    if (!pre.passed) { toast.error(`Privacy Gate 차단: ${pre.violations.join(', ')}`); return; }
    setBusy(true);
    try {
      const res = await saveFederatedPattern(payload);
      if (!res.privacy_passed) toast.error(`서버 Privacy Gate 차단: ${(res.violations ?? []).join(', ')}`);
      else toast.success(res.idempotent ? '이미 공유됨(중복 방지)' : '익명 Knowledge 공유됨(Evidence Only)');
      await load();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const promote = async (p: FederatedPatternRow, target: PromotionStatus) => {
    const check = classifyPromotion({ current: p.status as PromotionStatus, target, sampleStores: p.sample_stores, sampleCount: p.sample_count, confidence: p.confidence, privacyPassed: p.privacy_passed });
    if (!check.eligible) { toast.error(`승격 불가: ${check.reasons.join(', ')}`); return; }
    setBusy(true);
    try {
      await promoteFederatedPattern(p.id, target, `표본 게이트 충족(stores=${p.sample_stores}, sample=${p.sample_count})`);
      toast.success(`${STATUS_LABEL[target]} 승격(사람 승인)`);
      setPatterns(await fetchFederatedPatterns(null, null, null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  // Local vs Global 충돌 탐지(순수 로직) → 저장.
  const localPatterns = useMemo(() => patterns.filter((p) => p.layer === 'store' || p.status === 'local_only'), [patterns]);
  const globalPatterns = useMemo(() => patterns.filter((p) => ['global', 'region', 'enterprise'].includes(p.layer) || ['global_candidate', 'global_validated'].includes(p.status)), [patterns]);
  const detectedConflicts = useMemo(() => detectFederatedConflicts(
    localPatterns.map((p) => ({ id: p.id, layer: p.layer as FederatedLayer, industry: p.industry, metricCode: p.metric_code, direction: p.direction, confidence: p.confidence, sampleCount: p.sample_count })),
    globalPatterns.map((p) => ({ id: p.id, layer: p.layer as FederatedLayer, industry: p.industry, metricCode: p.metric_code, direction: p.direction, confidence: p.confidence, sampleCount: p.sample_count })),
  ), [localPatterns, globalPatterns]);

  const saveConflict = async (c: typeof detectedConflicts[number]) => {
    setBusy(true);
    try {
      const res = await saveFederatedConflict({
        conflict_key: c.conflictKey, conflict_type: c.type, local_pattern_id: c.localId, global_pattern_id: c.globalId,
        summary: c.summary, evidence: [{ label: 'detected_by', value: 'detectFederatedConflicts' }],
      });
      toast.success(res.idempotent ? '이미 기록됨' : 'Conflict 기록(Governance Review 대상)');
      setConflicts(await fetchFederatedConflicts(null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const resolve = async (id: string, resolution: string) => {
    setBusy(true);
    try {
      await resolveFederatedConflict(id, resolution, 'Governance Review 판단(사람)');
      toast.success('해소 기록됨');
      setConflicts(await fetchFederatedConflicts(null, 100));
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const trust = useMemo(() => computeFederatedTrust({
    localTrust: reputation.length ? Math.round(reputation.reduce((a, r) => a + r.reputation, 0) / reputation.length) : null,
    enterpriseTrust: null, globalTrust: null,
    privacyPassRate: summary?.privacy && summary.privacy.total > 0 ? Math.round((summary.privacy.passed / summary.privacy.total) * 100) : null,
  }), [reputation, summary]);

  if (loading) return <AdminCard title="Federated Intelligence Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Federated Intelligence Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const ps = summary?.patterns ?? null;

  return (
    <AdminCard
      title="Federated Intelligence Center"
      subtitle="Raw Data 미공유 — Privacy Gate 통과 익명 Knowledge 만 Federation (Evidence Only · Production 무변경)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="Store/Enterprise 원본 데이터·PII·Audio URL·계약/정산 원문은 공유되지 않습니다(Privacy Gate 서버측 강제 + Audit). Federated Knowledge 는 Evidence Only 이며 자동 Playlist Publish/Rollout/Scheduler/Queue/Playback 변경 및 Production Apply 는 없습니다. 승격 게이트는 코드 상수로 AI 가 수정할 수 없습니다." />
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
            <Box label="Federated Patterns" value={NUM(ps?.total)} />
            <Box label="Global Validated" value={NUM(ps?.global_validated)} />
            <Box label="Deprecated" value={NUM(ps?.deprecated)} />
            <Box label="Privacy 통과/차단" value={`${NUM(summary?.privacy?.passed)} / ${NUM(summary?.privacy?.blocked)}`} />
            <Box label="Conflicts (미해소)" value={NUM(summary?.conflicts?.unresolved)} />
            <Box label="Governance Review" value={NUM(summary?.conflicts?.governance_review)} />
            <Box label="마지막 Pattern" value={ps?.last_pattern_at ? String(ps.last_pattern_at).slice(0, 10) : '—'} />
            <Box label="Layer 수" value={NUM(Object.keys(ps?.by_layer ?? {}).length)} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">계층</th><th className="px-2">지원</th><th className="px-2">근거</th></tr></thead>
              <tbody>
                {FEDERATED_LAYERS.map((l) => (
                  <tr key={l.layer} className="border-b border-border/50">
                    <td className="py-1.5 pr-2 font-semibold">{l.label}</td>
                    <td className="px-2"><AdminBadge tone={l.support === 'supported' ? 'success' : l.support === 'insufficient_data' ? 'neutral' : 'warning'}>{l.support}</AdminBadge></td>
                    <td className="px-2 text-[10px] text-muted-foreground">{l.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Store Learning ── */}
      {tab === 'store' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Store Local Learning" description="각 업종 세그먼트는 자기 데이터(Skip/Completion/Like/Quality/Rotation/Context)만 학습합니다. Raw Data 대신 통계만 추출해 공유할 수 있습니다(외부 Store 데이터 접근 없음)." />
          {!industryRows.length ? <AdminEmpty icon={<Store size={20} />} title="Local 데이터 없음" /> : (
            <div className="space-y-1.5">
              {industryRows.map((r) => (
                <div key={r.store_type} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{r.store_type}</span>
                  <span className="text-[10px] text-muted-foreground">Completion {r.completion_rate ?? '—'}% · Skip {r.skip_rate ?? '—'}% · {NUM(r.events)} events</span>
                  <button disabled={busy} onClick={() => void extractAndShare('store', r.store_type, r.completion_rate, globalCompletion, r.events, 1)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Knowledge 추출(익명)</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Brand ── */}
      {tab === 'brand' && (
        <AdminAlert tone="info" title="Brand Learning — insufficient_data" description="별도 Brand 계층 데이터가 없습니다(franchise=Enterprise/HQ 만 존재). Brand 간 원본 데이터 혼합 없이, Brand 계층 도입 시 동일한 Privacy Gate 방식으로 확장합니다." />
      )}

      {/* ── Enterprise ── */}
      {tab === 'enterprise' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Enterprise Learning (익명 집계)" description="0500 익명 Enterprise Benchmark 재사용 — franchise 원본 미노출. 2+ Store 집계만 Knowledge 로 추출 가능합니다." />
          {!enterprise.length ? <AdminEmpty icon={<Building2 size={20} />} title="Enterprise 집계 없음" description="franchise 연결 데이터 축적 필요(insufficient_data)." /> : (
            <div className="space-y-1.5">
              {enterprise.map((r) => (
                <div key={r.anon_code} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{r.anon_code}</span>
                  <span className="text-[10px] text-muted-foreground">{r.store_count} stores · Completion {r.completion_rate ?? '—'}% · {NUM(r.events)} events</span>
                  <button disabled={busy} onClick={() => void extractAndShare('enterprise', 'multi', r.completion_rate, globalCompletion, r.events, r.store_count)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Knowledge 추출(익명)</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Regional ── */}
      {tab === 'region' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Regional Learning" description="franchise_regions 실존 라벨 집계만 사용(임의 지역 생성 없음)." />
          {!regions.length ? <AdminEmpty icon={<MapPin size={20} />} title="Region 집계 없음" description="region 연결 데이터 축적 필요(insufficient_data)." /> : (
            <div className="space-y-1.5">
              {regions.map((r) => (
                <div key={r.region_name} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <span className="font-bold">{r.region_name}</span>
                  <span className="text-[10px] text-muted-foreground">{r.store_count} stores · Completion {r.completion_rate ?? '—'}%</span>
                  <button disabled={busy} onClick={() => void extractAndShare('region', 'multi', r.completion_rate, globalCompletion, r.events, r.store_count)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Knowledge 추출(익명)</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Global ── */}
      {tab === 'global' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Global Learning (Federated Aggregation)" description="계층별 익명 Knowledge 를 표본 가중으로 병합합니다(2+ Source 필수 — 단일 Store 일반화 금지)." />
          {(() => {
            const candidates = patterns.filter((p) => p.metric_code === 'completion_rate' && p.effect_value != null);
            const agg = aggregateKnowledge(candidates.map((p) => ({ effectValue: p.effect_value, confidence: p.confidence, sampleCount: p.sample_count, sampleStores: p.sample_stores })));
            if (!agg) return <AdminEmpty icon={<Globe2 size={20} />} title="병합 불가" description="Federated Pattern 2개 이상 필요(단일 Source 일반화 금지)." />;
            return (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="병합 Effect (가중)" value={`${agg.effect}`} />
                <Box label="병합 Confidence" value={`${agg.confidence ?? '—'}`} />
                <Box label="총 Sample" value={NUM(agg.sampleCount)} />
                <Box label="총 Stores" value={NUM(agg.sampleStores)} />
              </div>
            );
          })()}
          <div className="space-y-1.5">
            {patterns.filter((p) => ['global_candidate', 'global_validated'].includes(p.status)).map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={STATUS_TONE[p.status as PromotionStatus]}>{STATUS_LABEL[p.status as PromotionStatus]}</AdminBadge>
                <span className="font-semibold">{p.pattern_key}</span>
                <span className="text-[10px] text-muted-foreground">effect {p.effect_value ?? '—'} · {p.sample_stores} stores · {NUM(p.sample_count)} samples</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Federated Memory ── */}
      {tab === 'memory' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Federated Memory (기존 Memory 무변경)" description="기존 Long-Term Memory(0498)는 수정하지 않습니다. Federated 계층은 Memory 요약 통계를 읽기 전용 참조만 합니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Memory Total" value={NUM(num(memSummary?.memory?.total))} />
            <Box label="Active" value={NUM(num(memSummary?.memory?.active))} />
            <Box label="With Outcome" value={NUM(num(memSummary?.memory?.with_outcome))} />
            <Box label="Patterns (0498)" value={NUM(memSummary?.patterns?.total)} />
          </div>
        </div>
      )}

      {/* ── Federated Knowledge ── */}
      {tab === 'knowledge' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Federated Knowledge (익명 · 기존 Graph 무변경)" description="Genre/Context/Industry/Region 축의 익명 통계 Knowledge 입니다. Store 이름은 존재하지 않습니다. Confidence Decay(반감기 180일)는 삭제가 아닌 deprecated/archive 권고로만 표시됩니다." />
          {!patterns.length ? <AdminEmpty icon={<BookOpen size={20} />} title="Knowledge 없음" description="Store/Enterprise/Region 탭에서 익명 Knowledge 를 추출하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Pattern</th><th className="px-2">Layer</th><th className="px-2">Industry</th><th className="px-2">Effect/Baseline</th><th className="px-2">Sample</th><th className="px-2">Confidence</th><th className="px-2">Status</th><th className="px-2">Decay 권고</th></tr></thead>
                <tbody>
                  {patterns.map((p) => {
                    const decay = calculateKnowledgeDecay({ lastValidatedAt: p.last_validated_at, now, confidence: p.confidence });
                    return (
                      <tr key={p.id} className="border-b border-border/50">
                        <td className="py-1.5 pr-2"><code className="text-[10px]">{p.pattern_key.slice(0, 30)}</code></td>
                        <td className="px-2">{p.layer}</td>
                        <td className="px-2">{p.industry ?? '—'}</td>
                        <td className="px-2">{p.effect_value ?? '—'} / {p.baseline_value ?? '—'}</td>
                        <td className="px-2">{NUM(p.sample_count)} ({p.sample_stores}s)</td>
                        <td className="px-2">{p.confidence ?? '—'}{decay.decayedConfidence != null && decay.decayedConfidence !== p.confidence ? ` → ${decay.decayedConfidence}` : ''}</td>
                        <td className="px-2"><AdminBadge tone={STATUS_TONE[p.status as PromotionStatus] ?? 'neutral'}>{STATUS_LABEL[p.status as PromotionStatus] ?? p.status}</AdminBadge></td>
                        <td className="px-2 text-[10px]">{decay.recommendation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Promotion ── */}
      {tab === 'promotion' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Knowledge Promotion (사람 승인 · 표본 게이트)" description={`게이트(코드 상수): regional stores≥${PROMOTION_GATES.regional.stores} · enterprise stores≥${PROMOTION_GATES.enterprise.stores} · global_candidate stores≥${PROMOTION_GATES.global_candidate.stores}+sample≥${PROMOTION_GATES.global_candidate.sample} · global_validated stores≥${PROMOTION_GATES.global_validated.stores}+sample≥${PROMOTION_GATES.global_validated.sample}+conf≥${PROMOTION_GATES.global_validated.confidence}. 자동 승격 없음.`} />
          {!patterns.length ? <AdminEmpty icon={<ArrowUpCircle size={20} />} title="Pattern 없음" /> : (
            <div className="space-y-1.5">
              {patterns.filter((p) => !['deprecated', 'archived'].includes(p.status)).map((p) => (
                <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={STATUS_TONE[p.status as PromotionStatus]}>{STATUS_LABEL[p.status as PromotionStatus]}</AdminBadge>
                  <span className="font-semibold">{p.pattern_key.slice(0, 28)}</span>
                  <span className="text-[10px] text-muted-foreground">{p.sample_stores}s / {NUM(p.sample_count)}</span>
                  <div className="ml-auto flex gap-1">
                    {(['regional', 'enterprise', 'global_candidate', 'global_validated'] as PromotionStatus[]).map((t) => {
                      const chk = classifyPromotion({ current: p.status as PromotionStatus, target: t, sampleStores: p.sample_stores, sampleCount: p.sample_count, confidence: p.confidence, privacyPassed: p.privacy_passed });
                      return <button key={t} disabled={busy || !chk.eligible} title={chk.reasons.join(', ')} onClick={() => void promote(p, t)} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-40">{STATUS_LABEL[t]}</button>;
                    })}
                    <button disabled={busy} onClick={() => void promote(p, 'deprecated')} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-40">Deprecate</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Privacy ── */}
      {tab === 'privacy' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Privacy Validation (4중 게이트 + Audit)" description="① 최소 표본(sample≥30) ② 익명성 임계(store 외 계층 stores≥3) ③ 금지 필드(store_id/user_id/email/audio_url/contract/settlement 등) ④ PII 패턴(이메일/URL). 통과·차단 모두 Audit 에 기록되며 원본 payload 는 저장하지 않습니다." />
          {!privacyLog.length ? <AdminEmpty icon={<ShieldCheck size={20} />} title="Privacy Audit 없음" /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Pattern</th><th className="px-2">Layer</th><th className="px-2">결과</th><th className="px-2">위반</th><th className="px-2">시각</th></tr></thead>
                <tbody>
                  {privacyLog.map((a) => (
                    <tr key={a.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2"><code className="text-[10px]">{(a.pattern_key ?? '—').slice(0, 28)}</code></td>
                      <td className="px-2">{a.layer ?? '—'}</td>
                      <td className="px-2"><AdminBadge tone={a.passed ? 'success' : 'danger'}>{a.passed ? '통과' : '차단'}</AdminBadge></td>
                      <td className="px-2 text-[10px] text-muted-foreground">{(a.violations ?? []).join(', ') || '—'}</td>
                      <td className="px-2 text-[10px] text-muted-foreground">{a.created_at.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Trust ── */}
      {tab === 'trust' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Federated Trust (표시 전용 — 직접 수정 없음)" description="Local(Agent Reputation 평균 proxy)/Enterprise/Global/Privacy 통과율 성분을 재정규화한 표시 지표입니다. Enterprise/Global Trust 는 Outcome 축적 전 null 유지." />
          <div className="flex items-center gap-2">
            <span className="text-sm font-black">{trust.score ?? '—'}</span>
            <span className="text-[10px] text-muted-foreground">Federated Trust (재정규화)</span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {trust.components.map((c) => (
              <div key={c.key} className="rounded-lg border border-border p-2">
                <p className="text-[10px] font-bold text-muted-foreground">{c.key}</p>
                <p className="mt-0.5 text-sm font-black">{c.value ?? 'null'}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Governance ── */}
      {tab === 'governance' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Governance Validation (기존 흐름 재사용 · 무변경)" description="Global Knowledge 는 Governance Validation 을 거친 Evidence Only 로만 사용됩니다. 강한 Local/Global 충돌은 Governance Review 로 승격됩니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Violations" value={NUM(gov?.events?.violations)} />
            <Box label="Overrides" value={NUM(gov?.events?.overrides)} />
            <Box label="충돌 Governance Review" value={NUM(summary?.conflicts?.governance_review)} />
            <Box label="Privacy 차단" value={NUM(summary?.privacy?.blocked)} />
          </div>
        </div>
      )}

      {/* ── Conflict ── */}
      {tab === 'conflict' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Conflict Resolution (Local Override 포함)" description="Local Evidence 가 강하면 Local 우선(예: Global LoFi 추천 vs 병원 Classical 우선). 강한 상반 Evidence 는 Governance Review 로만 해소합니다(자동 해소 없음)." />
          {detectedConflicts.length > 0 && (
            <div className="space-y-1.5">
              {detectedConflicts.map((c) => {
                const l = localPatterns.find((p) => p.id === c.localId); const g = globalPatterns.find((p) => p.id === c.globalId);
                const ov = l && g ? resolveLocalOverride({
                  globalDirection: (g.direction ?? 'neutral') as 'positive' | 'negative' | 'neutral', globalConfidence: g.confidence, globalSample: g.sample_count,
                  localDirection: (l.direction ?? 'neutral') as 'positive' | 'negative' | 'neutral', localConfidence: l.confidence, localSample: l.sample_count,
                }) : null;
                return (
                  <div key={c.conflictKey} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <AdminBadge tone="warning">감지됨</AdminBadge>
                    <span className="font-semibold">{c.summary}</span>
                    {ov && <AdminBadge tone={OVERRIDE_TONE[ov.decision]}>{OVERRIDE_LABEL[ov.decision]}</AdminBadge>}
                    <button disabled={busy} onClick={() => void saveConflict(c)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기록</button>
                  </div>
                );
              })}
            </div>
          )}
          {!conflicts.length ? <AdminEmpty icon={<Swords size={20} />} title="기록된 Conflict 없음" /> : (
            <div className="space-y-1.5">
              {conflicts.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                  <AdminBadge tone={c.resolution === 'unresolved' ? 'warning' : c.resolution === 'governance_review' ? 'danger' : 'success'}>{c.resolution}</AdminBadge>
                  <span className="font-semibold">{c.summary.slice(0, 50)}</span>
                  {c.resolution === 'unresolved' && (
                    <div className="ml-auto flex gap-1">
                      {['local_preferred', 'global_preferred', 'context_split', 'governance_review'].map((r) => (
                        <button key={r} disabled={busy} onClick={() => void resolve(c.id, r)} className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">{r}</button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Support ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>
              {FEDERATED_SUPPORT.map((s) => (
                <tr key={s.key} className="border-b border-border/50">
                  <td className="py-1.5 pr-2 font-semibold">{s.label}</td>
                  <td className="px-2"><AdminBadge tone={s.status === 'fully_supported' ? 'success' : s.status === 'unsupported' ? 'danger' : s.status === 'insufficient_data' ? 'neutral' : 'warning'}>{s.status}</AdminBadge></td>
                  <td className="px-2 text-[10px] text-muted-foreground">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminCard>
  );
}

function num(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-sm font-black">{value}</p>
    </div>
  );
}
