/**
 * ResilienceIntelligenceSection — Enterprise Resilience Intelligence,
 * Adaptive Response & Business Continuity Center (Phase AI-OPS-60).
 *
 * Enterprise Vision→Mission→Strategy→Innovation→Strategic Foresight→
 * Risk Signal Detection→Enterprise Resilience Assessment→Adaptive Response
 * Planning→Business Continuity Analysis→Recovery Readiness→Executive
 * Resilience Review→Resilience Learning→Audit.
 * Resilience ≠ Guaranteed Survival · Recovery Plan ≠ Successful Recovery ·
 * Preparedness ≠ Readiness · Recovery Score ≠ Recovery Success.
 * 자동 복구 실행/장애 조치/전략·조직·Budget 변경 없음.
 * (기존 RiskResilienceSection(0528)/SelfHealingSection(0502)/
 *  CapacityContinuitySection(0508)과 별개 계층)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, BookOpen, ClipboardList, GitBranch, Grid3x3, HeartPulse, History,
  Inbox, Layers, Lightbulb, Lock, RefreshCw, Scale, Shield, Users,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchEnterpriseResilienceSummary, fetchEnterpriseResiliences,
  createEnterpriseResilience, reviewEnterpriseResilience,
  createEnterpriseResilienceReview, reviewEnterpriseResilienceReview,
  fetchEnterpriseResilienceReviews, recordEnterpriseResilienceEvent,
  fetchEnterpriseResilienceAudit,
  type EnterpriseResilienceSummary, type EnterpriseResilienceRow,
  type EnterpriseResilienceReviewRow, type EnterpriseResilienceEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  RESILIENCE_CATEGORIES, RESILIENCE_DIMENSIONS, RESILIENCE_ASSESSMENT_RESULTS,
  RECOVERY_DIMENSIONS, RECOVERY_READINESS_RESULTS, ADAPTIVE_DIMENSIONS,
  ADAPTIVE_RESPONSE_RESULTS, BUSINESS_CONTINUITY_RESULTS,
  OPERATIONAL_STABILITY_RESULTS, RISK_SIGNAL_RESULTS, SPOF_RESULTS,
  PRIORITY_RISK_RESULTS, RESILIENCE_RECOMMENDATION_TYPES,
  RESILIENCE_SCORECARD_FIELDS, buildResilienceTimeline,
  ENTERPRISE_RESILIENCE_SUPPORT_MATRIX,
} from '@/lib/enterpriseResilience';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'overview' | 'resiliences' | 'assessment' | 'recovery' | 'adaptive' | 'continuity'
  | 'stability' | 'risksignal' | 'spof' | 'priorityrisk' | 'timeline'
  | 'summary' | 'scorecard' | 'recommendations' | 'reviewqueue' | 'reviewed'
  | 'learning' | 'links' | 'flow' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Layers }[] = [
  { key: 'overview', label: 'Resilience Overview', icon: Layers },
  { key: 'resiliences', label: 'Resilience Candidates', icon: HeartPulse },
  { key: 'assessment', label: 'Resilience Assessment', icon: Scale },
  { key: 'recovery', label: 'Recovery Readiness', icon: Activity },
  { key: 'adaptive', label: 'Adaptive Response', icon: Activity },
  { key: 'continuity', label: 'Business Continuity', icon: Shield },
  { key: 'stability', label: 'Operational Stability', icon: Activity },
  { key: 'risksignal', label: 'Priority Risks (Signals)', icon: Shield },
  { key: 'spof', label: 'SPOF Analysis', icon: GitBranch },
  { key: 'priorityrisk', label: 'Priority Risk Review', icon: Scale },
  { key: 'timeline', label: 'Recovery Timeline', icon: History },
  { key: 'summary', label: 'Executive Resilience Summaries', icon: ClipboardList },
  { key: 'scorecard', label: 'Executive Resilience Scorecard', icon: Grid3x3 },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'reviewqueue', label: 'Review Queue', icon: Inbox },
  { key: 'reviewed', label: 'Review References', icon: Users },
  { key: 'learning', label: 'Resilience Learning', icon: BookOpen },
  { key: 'links', label: 'Reference Links', icon: GitBranch },
  { key: 'flow', label: 'Flow Timeline', icon: History },
  { key: 'audit', label: 'Audit', icon: History },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: ClipboardList },
];

const KNOWN_LIMITATIONS = [
  '자동 복구 실행·자동 장애 조치·자동 전략 변경·자동 조직 변경·자동 Budget 변경·Production 변경·Merge/Deploy/Rollback 없음 — 모든 반환 flag(recovery_executed/failover_applied/strategy_changed 등) 항상 false',
  'Resilience ≠ Guaranteed Survival · Recovery Plan ≠ Successful Recovery · Recovery Score ≠ Recovery Success — 회복력 관측 후보 분석이며 생존/복구 보장이 아닙니다',
  'Preparedness ≠ Readiness · Scenario ≠ Reality — Evidence 없는 SPOF/Recommendation 서버 차단',
  'Resilience Review Reference 는 Self-Review 차단(작성자 ≠ 평가자) + Evidence 필수 — Review ≠ Approval, Recovery 실행은 사람',
  'archived_reference/review_reference_recorded 재결정 차단 · 참조 실존 검증(0551/0555/0556/0557/0558/0560/0561/0562/0563)',
  '이름 실측: ai_enterprise_resilience/admin_enterprise_resilience_* 미사용 확인 — 스펙 권장명 그대로 사용. 기존 riskResilience(0528)/selfHealing(0502)/CapacityContinuity(0508) 계층과 별개(미접촉)',
  '스펙 §1 의 ai_enterprise_resource_capacity 테이블은 실측 부재 — 실제 자원/용량 원장은 ai_enterprise_capacity_resources(0558)로 참조',
  '인시던트 관리/모니터링 알림/재해복구 시스템/백업 검증/공급망/BCP 훈련 기록 피드 부재(실측) — insufficient_data 유지, 분석은 수동 기록 기반',
  'Migration 0472~0564 production 미적용 — 운영 수치는 적용 후 축적됩니다',
  '브라우저 실측 미검증 — UI 는 코드 리뷰/타입/빌드 기준 검증만 수행했습니다',
];

export default function ResilienceIntelligenceSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [summary, setSummary] = useState<EnterpriseResilienceSummary>({});
  const [resiliences, setResiliences] = useState<EnterpriseResilienceRow[]>([]);
  const [reviews, setReviews] = useState<EnterpriseResilienceReviewRow[]>([]);
  const [audit, setAudit] = useState<EnterpriseResilienceEventRow[]>([]);
  const [reason, setReason] = useState('');
  const [selResilience, setSelResilience] = useState('');
  const [selReview, setSelReview] = useState('');
  const [catSel, setCatSel] = useState<string>('infrastructure');
  const [resDimSel, setResDimSel] = useState<string>('operational_stability');
  const [recDimSel, setRecDimSel] = useState<string>('recovery_time');
  const [adpDimSel, setAdpDimSel] = useState<string>('response_speed');
  const [recTypeSel, setRecTypeSel] = useState<string>('gather_more_evidence_candidate');
  const [resultSel, setResultSel] = useState<string>('insufficient_data');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [s, r, v, a] = await Promise.all([
        fetchEnterpriseResilienceSummary(), fetchEnterpriseResiliences(null, null, 200),
        fetchEnterpriseResilienceReviews(null, 200), fetchEnterpriseResilienceAudit(200),
      ]);
      setSummary(s); setResiliences(r); setReviews(v); setAudit(a);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };
  const needReason = (): string | null => {
    if (!reason.trim()) { toast.error('사유/내용 필수(Human Review)'); return null; }
    return reason.trim();
  };
  const rsReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selResilience) { if (!selResilience) toast.error('Resilience 선택 필수'); return; }
    void act(() => reviewEnterpriseResilience(selResilience, action, r, payload), ok);
  };
  const rvReview = (action: string, payload: Record<string, unknown>, ok: string) => {
    const r = needReason();
    if (!r || !selReview) { if (!selReview) toast.error('Resilience Review 선택 필수'); return; }
    void act(() => reviewEnterpriseResilienceReview(selReview, action, r, payload), ok);
  };
  const rsEvent = (kind: string, payload: Record<string, unknown>, ok: string, ids: { rs?: boolean; review?: boolean } = { rs: true }) => {
    const r = needReason();
    if (!r) return;
    void act(() => recordEnterpriseResilienceEvent(kind, r, payload, ids.rs ? (selResilience || null) : null, ids.review ? (selReview || null) : null), ok);
  };

  const obj = useCallback((k: string): Record<string, unknown> => (typeof summary[k] === 'object' && summary[k] !== null && !Array.isArray(summary[k]) ? summary[k] as Record<string, unknown> : {}), [summary]);
  const num = useCallback((k: string, sub: string): number | null => {
    const v = obj(k)[sub];
    return typeof v === 'number' ? v : null;
  }, [obj]);

  const flowTimeline = useMemo(() => {
    const present: Record<string, boolean> = {
      mission: (num('resilience_actuals', 'missions_0555') ?? 0) > 0,
      strategy: (num('resilience_actuals', 'governance_decisions_0551') ?? 0) > 0,
      innovation: (num('resilience_actuals', 'innovations_0562') ?? 0) > 0,
      strategic_foresight: (num('resilience_actuals', 'foresights_0563') ?? 0) > 0,
      risk_signal_detection: (num('resilience_events', 'risk_signal_reviews') ?? 0) > 0,
      enterprise_resilience_assessment: (num('resiliences', 'total') ?? 0) + (num('resilience_events', 'assessment_reviews') ?? 0) > 0,
      adaptive_response_planning: (num('resilience_events', 'adaptive_reviews') ?? 0) > 0,
      business_continuity_analysis: (num('resilience_events', 'continuity_reviews') ?? 0) > 0,
      recovery_readiness: (num('resilience_events', 'recovery_reviews') ?? 0) > 0,
      executive_resilience_review: (num('resilience_events', 'resilience_review_requests') ?? 0) + (num('resilience_events', 'executive_review_requests') ?? 0) + (num('resilience_events', 'human_review_requests') ?? 0) + (num('resilience_events', 'review_references') ?? 0) > 0,
      resilience_learning: (num('resilience_events', 'learnings') ?? 0) > 0,
      audit: (num('resilience_events', 'total') ?? 0) > 0,
      // vision 은 본 summary 에 원천 피드가 없어 관측 여부를 표시하지 않습니다(정직 미관측).
    };
    const entries = Object.entries(present).filter(([, ok]) => ok).map(([stage]) => ({ stage }));
    return buildResilienceTimeline(entries).stages.map((s) => ({ stage: s.stage, present: s.entries.length > 0 }));
  }, [num]);

  if (loading) return <AdminCard title="Resilience Intelligence & Business Continuity Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Resilience Intelligence & Business Continuity Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const rsSelect = (
    <select value={selResilience} onChange={(e) => setSelResilience(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Resilience 선택</option>
      {resiliences.map((r) => <option key={r.id} value={r.id}>{r.resilience_code} · {r.resilience_status}</option>)}
    </select>
  );
  const reviewSelect = (
    <select value={selReview} onChange={(e) => setSelReview(e.target.value)} className="min-w-[180px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Resilience Review 선택</option>
      {reviews.map((r) => <option key={r.id} value={r.id}>{r.review_code} · {r.review_status}</option>)}
    </select>
  );
  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const tone = (s: string) => (s.includes('highly_resilient') || s === 'resilient' || s.includes('fully_ready') || s.includes('mostly_ready') || s.includes('highly_adaptive') || s === 'adaptive' || s.includes('continuity_assured') || s.includes('stable_candidate') || s.includes('low_risk_signal') || s.includes('redundant') || s.includes('low_priority') || s.includes('review_reference') || s === 'observed' ? 'success' as const : s.includes('vulnerable') || s.includes('not_ready') || s === 'rigid' || s.includes('critical') || s.includes('unstable') || s.includes('confirmed_spof') || s.includes('top_priority') || s === 'unavailable' ? 'danger' as const : 'warning' as const);
  const evByType = (t: string) => audit.filter((e) => e.event_type === t);
  const eventList = (rows: EnterpriseResilienceEventRow[], emptyTitle: string, emptyDesc: string) => (
    !rows.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {rows.slice(0, 30).map((e) => (
          <div key={e.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(String(e.payload?.result ?? e.event_type))}>{e.event_type}</AdminBadge>
            <span className="ml-2">{e.detail}</span>
            <span className="ml-2 text-muted-foreground">{new Date(e.created_at).toLocaleString('ko-KR')}</span>
          </div>
        ))}
      </div>
    )
  );
  const rsList = (list: EnterpriseResilienceRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.resilience_status)}>{r.resilience_status}</AdminBadge>
            <AdminBadge tone={tone(r.assessment_status)}>{r.assessment_status}</AdminBadge>
            <AdminBadge tone={tone(r.recovery_status)}>{r.recovery_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.resilience_code}</span>
            <span className="ml-2 text-muted-foreground">{r.resilience_category} · {r.resilience_name} · adaptive {r.adaptive_status} · reviews {Array.isArray(r.resilience_reviews) ? r.resilience_reviews.length : 0}건</span>
          </div>
        ))}
      </div>
    )
  );
  const reviewList = (list: EnterpriseResilienceReviewRow[], emptyTitle: string, emptyDesc: string) => (
    !list.length ? <AdminEmpty title={emptyTitle} description={emptyDesc} /> : (
      <div className="space-y-1">
        {list.slice(0, 30).map((r) => (
          <div key={r.id} className="rounded-lg border border-border p-2 text-[11px]">
            <AdminBadge tone={tone(r.review_status)}>{r.review_status}</AdminBadge>
            <span className="ml-2 font-bold">{r.review_code}</span>
            <span className="ml-2 text-muted-foreground">{r.review_type} · findings {Array.isArray(r.findings) ? r.findings.length : 0}건 · {r.review_summary ?? '—'}</span>
          </div>
        ))}
      </div>
    )
  );
  const simpleEventTab = (kind: string, title: string, note: string) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {rsSelect}{reasonInput}
        {btn(`${title} 기록`, () => rsEvent(kind, { note: reason.trim() }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '기록이 여기에 표시됩니다.')}
    </div>
  );
  const resultEventTab = (kind: string, title: string, note: string, results: readonly string[], extraPayload: Record<string, unknown> = {}) => (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        {rsSelect}
        <select value={results.includes(resultSel) ? resultSel : results[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
          {results.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        {reasonInput}
        {btn(`${title} 기록`, () => rsEvent(kind, { result: results.includes(resultSel) ? resultSel : results[0], ...extraPayload }, `${title} 기록됨`), true)}
      </div>
      <AdminAlert tone="info" description={note} />
      {eventList(evByType(kind), `${title} 없음`, '사람 검토 기록이 여기에 표시됩니다.')}
    </div>
  );

  return (
    <AdminCard
      title="Resilience Intelligence & Business Continuity Center"
      subtitle="Risk Signal Detection→Resilience Assessment→Adaptive Response Planning→Business Continuity Analysis→Recovery Readiness→Executive Review→Learning — 복구 승인·실행과 최종 결정은 반드시 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 예측하지 못한 변화·시장 충격·기술 장애·공급망 문제·운영 위기에 대해 Enterprise 가 얼마나 빠르게 적응하고 회복할 수 있는지 분석하는 Resilience Intelligence 계층입니다. AI 는 Resilience Assessment/Risk Signal Detection/Recovery Readiness/Business Continuity 분석/Adaptive Response Planning/Operational Stability·SPOF·Priority Risk 분석/Executive Summary·Scorecard/Recommendation/Review 요청/Learning 기록까지만 수행하며, 자동 복구 실행·자동 장애 조치·자동 전략 변경·자동 조직 변경·자동 Budget 변경·Production 변경·Merge/Deploy/Rollback 은 수행하지 않습니다. Resilience ≠ Guaranteed Survival, Recovery Plan ≠ Successful Recovery, Recovery Score ≠ Recovery Success, Preparedness ≠ Readiness. AI 는 회복력을 분석합니다. 사람이 복구를 승인하고, 실행하며, 최종 의사결정을 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'overview' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Resiliences" value={NUM(num('resiliences', 'total'))} />
            <Box label="Observed / Candidate / Reference / Archived" value={`${NUM(num('resiliences', 'observed'))} / ${NUM(num('resiliences', 'candidate'))} / ${NUM(num('resiliences', 'review_reference'))} / ${NUM(num('resiliences', 'archived'))}`} />
            <Box label="Highly Resilient / Vulnerable" value={`${NUM(num('resiliences', 'highly_resilient'))} / ${NUM(num('resiliences', 'vulnerable'))}`} />
            <Box label="Fully Ready / Not Ready Recoveries" value={`${NUM(num('resiliences', 'fully_ready'))} / ${NUM(num('resiliences', 'not_ready'))}`} />
            <Box label="Adaptive / Rigid" value={`${NUM(num('resiliences', 'highly_adaptive'))} / ${NUM(num('resiliences', 'rigid'))}`} />
            <Box label="Resilience Reviews" value={NUM(num('reviews', 'total'))} />
            <Box label="Requested / In Review / Reference / Revision" value={`${NUM(num('reviews', 'requested'))} / ${NUM(num('reviews', 'in_review'))} / ${NUM(num('reviews', 'reference_recorded'))} / ${NUM(num('reviews', 'revision_requested'))}`} />
            <Box label="Assessment / Recovery / Adaptive Reviews" value={`${NUM(num('resilience_events', 'assessment_reviews'))} / ${NUM(num('resilience_events', 'recovery_reviews'))} / ${NUM(num('resilience_events', 'adaptive_reviews'))}`} />
            <Box label="Continuity / Stability / Risk Signals" value={`${NUM(num('resilience_events', 'continuity_reviews'))} / ${NUM(num('resilience_events', 'stability_reviews'))} / ${NUM(num('resilience_events', 'risk_signal_reviews'))}`} />
            <Box label="SPOF / Priority Risk Reviews" value={`${NUM(num('resilience_events', 'spof_reviews'))} / ${NUM(num('resilience_events', 'priority_risk_reviews'))}`} />
            <Box label="Timelines / Summaries / Scorecards" value={`${NUM(num('resilience_events', 'timelines'))} / ${NUM(num('resilience_events', 'summaries'))} / ${NUM(num('resilience_events', 'scorecards'))}`} />
            <Box label="Recommendations" value={NUM(num('resilience_events', 'recommendations'))} />
            <Box label="Resilience / Executive / Human Review 요청" value={`${NUM(num('resilience_events', 'resilience_review_requests'))} / ${NUM(num('resilience_events', 'executive_review_requests'))} / ${NUM(num('resilience_events', 'human_review_requests'))}`} />
            <Box label="Review References" value={NUM(num('resilience_events', 'review_references'))} />
            <Box label="Learnings / Foresight Links(0563)" value={`${NUM(num('resilience_events', 'learnings'))} / ${NUM(num('resilience_events', 'foresight_links'))}`} />
            <Box label="Capacity Links(0558) / Environment Links(0556)" value={`${NUM(num('resilience_events', 'capacity_links'))} / ${NUM(num('resilience_events', 'environment_links'))}`} />
          </div>
          <AdminAlert tone="info" description={`resilience_unavailable: ${Array.isArray(summary.resilience_unavailable) ? (summary.resilience_unavailable as unknown[]).map(String).join(', ') : '—'}. Resilience 원천 실측 — Foresights(0563) ${NUM(num('resilience_actuals', 'foresights_0563'))}건 · Innovations(0562) ${NUM(num('resilience_actuals', 'innovations_0562'))}건 · Transformations(0560) ${NUM(num('resilience_actuals', 'transformations_0560'))}건 · Capacity Resources(0558) ${NUM(num('resilience_actuals', 'capacity_resources_0558'))}건(스펙 표기 ai_enterprise_resource_capacity 는 부재) · Environment Observations(0556) ${NUM(num('resilience_actuals', 'environment_observations_0556'))}건 · Missions(0555) ${NUM(num('resilience_actuals', 'missions_0555'))}건. 0 과 Unknown 을 혼동하지 않습니다.`} />
        </div>
      )}

      {tab === 'resiliences' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <select value={catSel} onChange={(e) => setCatSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESILIENCE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {reasonInput}
            {btn('Resilience 관측 기록(≠ 복구 실행)', () => {
              const r = needReason();
              if (!r) return;
              void act(() => createEnterpriseResilience({ resilience_category: catSel, resilience_name: r }), 'Resilience 관측 기록됨(자동 복구 없음)');
            }, true)}
            {btn('Observed 표시', () => rsReview('mark_observed', {}, 'observed(관측 상태)'))}
            {btn('Candidate 표시', () => rsReview('mark_candidate', {}, 'candidate(≠ 승인)'))}
            {btn('Review Reference(Self 차단·Evidence 필수)', () => rsReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'review_reference(≠ Approval)'))}
            {btn('Archive', () => rsReview('archive_reference', {}, 'archived_reference'))}
            {btn('Insufficient Data', () => rsReview('mark_insufficient_data', {}, 'insufficient_data'))}
            {rsSelect}
          </div>
          <AdminAlert tone="info" description="Category 11종 · 자동 복구 실행/장애 조치/전략·조직·Budget 변경 계열 category 서버 차단 · archived 재결정 차단." />
          {rsList(resiliences, 'Resilience 없음', '핵심 질문 예: 현재 Resilience 수준은 어느 정도인가? 어떤 Resource 가 단일 장애점인가? — 전부 Candidate 분석.')}
        </div>
      )}

      {tab === 'assessment' && (
        <>
          {resultEventTab('resilience_assessment_reviewed', 'Resilience Assessment 검토', 'Resilience 5평가(§5 — Operational Stability/Recovery Capability/Adaptive Capacity/Resource Redundancy/Business Continuity) — Resilience ≠ Guaranteed Survival.', RESILIENCE_ASSESSMENT_RESULTS, { resilience_dimension: resDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Resilience Dimension:</span>
            <select value={resDimSel} onChange={(e) => setResDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESILIENCE_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'recovery' && (
        <>
          {resultEventTab('recovery_readiness_reviewed', 'Recovery Readiness 검토', 'Recovery 5평가(§6 — Time/Resources/Dependencies/Procedures/Confidence) — Recovery Score ≠ Recovery Success.', RECOVERY_READINESS_RESULTS, { recovery_dimension: recDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Recovery Dimension:</span>
            <select value={recDimSel} onChange={(e) => setRecDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RECOVERY_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'adaptive' && (
        <>
          {resultEventTab('adaptive_response_reviewed', 'Adaptive Response 검토', 'Adaptive 5평가(§7 — Response Speed/Decision Agility/Organizational Flexibility/Resource Adaptability/Learning Capability) — Preparedness ≠ Readiness.', ADAPTIVE_RESPONSE_RESULTS, { adaptive_dimension: adpDimSel })}
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="text-[11px] text-muted-foreground">Adaptive Dimension:</span>
            <select value={adpDimSel} onChange={(e) => setAdpDimSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {ADAPTIVE_DIMENSIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </>
      )}
      {tab === 'continuity' && resultEventTab('business_continuity_reviewed', 'Business Continuity 검토', 'Recovery Plan ≠ Successful Recovery — BCP 커버리지 관측 후보입니다.', BUSINESS_CONTINUITY_RESULTS)}
      {tab === 'stability' && resultEventTab('operational_stability_reviewed', 'Operational Stability 검토', 'Stability 관측 ≠ 무장애 보장 — 운영 안정성 관측 후보입니다.', OPERATIONAL_STABILITY_RESULTS)}
      {tab === 'risksignal' && resultEventTab('risk_signal_reviewed', 'Risk Signal 검토', 'Risk Signal ≠ 사고 확정 — 위험 신호 관측 후보입니다.', RISK_SIGNAL_RESULTS)}
      {tab === 'spof' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {rsSelect}
            <select value={(SPOF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : SPOF_RESULTS[0]} onChange={(e) => setResultSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {SPOF_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {reasonInput}
            {btn('SPOF 기록(Evidence 필수)', () => rsEvent('spof_reviewed', { result: (SPOF_RESULTS as readonly string[]).includes(resultSel) ? resultSel : SPOF_RESULTS[0], evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'SPOF 기록됨(≠ 실패 확정)'), true)}
          </div>
          <AdminAlert tone="warning" description="SPOF 관측 후보 ≠ 실패 확정 — Evidence 없는 기록 서버 차단, 이중화 결정은 사람이 수행합니다." />
          {eventList(evByType('spof_reviewed'), 'SPOF 기록 없음', '단일 장애점 관측 후보가 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'priorityrisk' && resultEventTab('priority_risk_reviewed', 'Priority Risk 검토', 'Priority ≠ Mandatory Order — 우선 위험 후보이며 강제 순서가 아닙니다.', PRIORITY_RISK_RESULTS)}
      {tab === 'timeline' && simpleEventTab('recovery_timeline_recorded', 'Recovery Timeline 기록', 'Recovery Timeline — resilience_history 로 통합 축적됩니다(≠ 복구 확정).')}
      {tab === 'summary' && simpleEventTab('executive_resilience_summary_recorded', 'Executive Resilience Summary 기록', 'Summary ≠ 복구 실행 확정 — 경영진 판단 보조 자료입니다.')}
      {tab === 'scorecard' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {rsSelect}{reasonInput}
            {btn('Resilience Scorecard 기록', () => rsEvent('executive_resilience_scorecard_recorded', { fields: [...RESILIENCE_SCORECARD_FIELDS], note: reason.trim() }, 'Scorecard 기록됨(≠ 복구 지시)'), true)}
          </div>
          <AdminAlert tone="warning" description={`§8 필드 8종(${RESILIENCE_SCORECARD_FIELDS.join(', ')}) — Scorecard ≠ 복구 지시(vulnerable/not ready 우선 결정적 정렬 후보).`} />
          {eventList(evByType('executive_resilience_scorecard_recorded'), 'Scorecard 없음', 'Executive Resilience Scorecard 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {rsSelect}
            <select value={recTypeSel} onChange={(e) => setRecTypeSel(e.target.value)} className="rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
              {RESILIENCE_RECOMMENDATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            {reasonInput}
            {btn('Recommendation 기록(Evidence 필수)', () => rsEvent('recovery_recommendation_recorded', { recommendation_type: recTypeSel, evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Recommendation 기록됨(≠ Decision)'), true)}
          </div>
          <AdminAlert tone="info" description="Recovery Recommendation ≠ Decision — 권고 23종 whitelist, Evidence 없는 Recommendation 서버 차단. 채택은 사람이 결정합니다." />
          {eventList(evByType('recovery_recommendation_recorded'), 'Recommendation 없음', 'Recovery Recommendation 후보가 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'reviewqueue' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {rsSelect}{reasonInput}
            {btn('Resilience Review 요청', () => {
              const r = needReason();
              if (!r || !selResilience) { if (!selResilience) toast.error('Resilience 선택 필수'); return; }
              void act(() => createEnterpriseResilienceReview({ resilience_id: selResilience, review_type: 'resilience_review', review_summary: r }), 'Resilience Review 요청됨(≠ Approval)');
            }, true)}
            {btn('Executive Review 요청', () => {
              const r = needReason();
              if (!r || !selResilience) { if (!selResilience) toast.error('Resilience 선택 필수'); return; }
              void act(() => createEnterpriseResilienceReview({ resilience_id: selResilience, review_type: 'executive_review', review_summary: r }), 'Executive Review 요청됨(≠ Approval)');
            })}
            {btn('Human Review 요청', () => {
              const r = needReason();
              if (!r || !selResilience) { if (!selResilience) toast.error('Resilience 선택 필수'); return; }
              void act(() => createEnterpriseResilienceReview({ resilience_id: selResilience, review_type: 'human_review', review_summary: r }), 'Human Review 요청됨(Recovery 실행은 사람)');
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {reviewSelect}
            {btn('검토 시작', () => rvReview('mark_in_review', {}, 'in_review'))}
            {btn('Review Reference 기록(Evidence 필수)', () => rvReview('record_review_reference', { evidence: [{ type: 'manual_review', note: reason.trim() }] }, 'Review Reference 기록됨(≠ Approval)'), true)}
            {btn('수정 요청', () => rvReview('request_revision', {}, 'revision_requested'))}
            {btn('Insufficient Data', () => rvReview('mark_insufficient_data', {}, 'insufficient_data'))}
          </div>
          <AdminAlert tone="warning" description="Review Workflow(§9 — resilience/executive/human 3종 요청만) — Self-Review 서버 차단(작성자 ≠ 평가자) · Evidence 없는 Review Reference 차단 · 종결 재결정 차단 · Review ≠ Approval. Recovery 실행은 반드시 사람이 수행합니다." />
          {reviewList(reviews.filter((r) => ['requested', 'in_review', 'revision_requested'].includes(r.review_status)), '대기 Review 없음', '0건은 검토할 것이 없음을 의미하지 않습니다.')}
        </div>
      )}
      {tab === 'reviewed' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Review Reference — 사람이 기록한 검토 참조이며 승인/복구 실행이 아닙니다." />
          {reviewList(reviews.filter((r) => r.review_status === 'review_reference_recorded'), 'Review Reference 없음', '사람이 검토를 완료한 기록이 여기에 표시됩니다.')}
          {eventList(evByType('resilience_review_reference_recorded'), 'Reference 이벤트 없음', 'Review Reference 기록이 여기에 표시됩니다.')}
        </div>
      )}
      {tab === 'learning' && simpleEventTab('resilience_learning_recorded', 'Resilience Learning 기록', 'Resilience Learning ≠ 자동 복구 — 학습 반영 여부는 사람이 결정합니다.')}

      {tab === 'links' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            {rsSelect}{reasonInput}
            {btn('Foresight Link(0563 실존 검증)', () => rsEvent('foresight_reference_linked', { note: reason.trim() }, 'Foresight Link 기록됨(0563 참조만)'), true)}
            {btn('Innovation Link(0562)', () => rsEvent('innovation_reference_linked', { note: reason.trim() }, 'Innovation Link 기록됨(0562 참조만)'))}
            {btn('Improvement Link(0561)', () => rsEvent('improvement_reference_linked', { note: reason.trim() }, 'Improvement Link 기록됨(0561 참조만)'))}
            {btn('Transformation Link(0560)', () => rsEvent('transformation_reference_linked', { note: reason.trim() }, 'Transformation Link 기록됨(0560 참조만)'))}
            {btn('Capacity Link(0558)', () => rsEvent('capacity_reference_linked', { note: reason.trim() }, 'Capacity Link 기록됨(0558 참조만)'))}
            {btn('Environment Link(0556)', () => rsEvent('environment_reference_linked', { note: reason.trim() }, 'Environment Link 기록됨(0556 참조만)'))}
            {btn('Mission Link(0555)', () => rsEvent('mission_reference_linked', { note: reason.trim() }, 'Mission Link 기록됨'))}
            {btn('Governance Link(0551)', () => rsEvent('governance_reference_linked', { note: reason.trim() }, 'Governance Link 기록됨(0551 참조만)'))}
            {btn('Scenario Link(0557)', () => rsEvent('scenario_reference_linked', { note: reason.trim() }, 'Scenario Link 기록됨'))}
          </div>
          <AdminAlert tone="info" description="Reference Link — ID 지정 시 실존 검증(0551/0555/0556/0557/0558/0560/0561/0562/0563). Link ≠ 변경/확정/복구." />
          {eventList([...evByType('foresight_reference_linked'), ...evByType('innovation_reference_linked'), ...evByType('improvement_reference_linked'), ...evByType('transformation_reference_linked'), ...evByType('capacity_reference_linked'), ...evByType('environment_reference_linked'), ...evByType('mission_reference_linked'), ...evByType('governance_reference_linked'), ...evByType('scenario_reference_linked')], 'Reference Link 없음', '참조 연결 기록이 여기에 표시됩니다.')}
        </div>
      )}

      {tab === 'flow' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description="Resilience 흐름 관측(13단계) — 단계별 기록 존재 여부만 표시합니다(자동 진행 아님). vision 단계는 본 summary 에 원천 피드가 없어 항상 미관측으로 표시됩니다(정직 고지)." />
          <div className="space-y-1">
            {flowTimeline.map((s) => (
              <div key={s.stage} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={s.present ? 'success' : 'warning'}>{s.present ? '관측됨' : '미관측'}</AdminBadge>
                <span className="font-bold">{s.stage}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`Resilience 이벤트 31종 통합 Audit — 총 ${NUM(num('resilience_events', 'total'))}건. 자동 복구 이벤트 생성 금지.`} />
          {eventList(audit, 'Audit 이벤트 없음', '모든 Resilience Intelligence 활동이 여기에 기록됩니다.')}
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-2">
          <AdminAlert tone="info" description={`분류 6종(fully/partially/advisory_only/human_review_only/unavailable/insufficient_data) — 매트릭스 ${ENTERPRISE_RESILIENCE_SUPPORT_MATRIX.length}항목. unavailable 은 전부 automatic_*(자동 복구 없음).`} />
          <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {ENTERPRISE_RESILIENCE_SUPPORT_MATRIX.map((e) => (
              <div key={e.feature} className="flex items-center justify-between rounded-lg border border-border p-2 text-[11px]">
                <span>{e.feature}</span>
                <AdminBadge tone={e.level === 'unavailable' ? 'danger' : e.level === 'fully_supported' ? 'success' : 'warning'}>{e.level}</AdminBadge>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'limitations' && (
        <div className="space-y-1">
          {KNOWN_LIMITATIONS.map((l) => (
            <div key={l} className="rounded-lg border border-border p-2 text-[11px]">{l}</div>
          ))}
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold">{value}</div>
    </div>
  );
}
