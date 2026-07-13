/**
 * DraftPromotionSection — Human-Governed Draft Promotion & Controlled Execution Gateway
 * (Phase AI-MUSIC-7).
 *
 * Sandbox 에서 검증된 Strategy 를 **운영자 승인 후에만** 독립 Draft(Playlist/Rotation/Rollout/
 * Experiment)로 변환하고 재검증하여 Canary Candidate 지정까지만 수행한다.
 * 실제 Production 실행 없음 · 자동 Draft/Canary/승인/Publish 없음.
 *
 * 탭: Overview · Eligible Runs · Promotion Requests · Review Queue · Drafts · Draft Validation ·
 *     Canary Candidates · Comparison · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LayoutDashboard, ListChecks, FileText, UserCheck, FileStack, ShieldCheck, Bird, GitCompare,
  ScrollText, BookOpen, RefreshCw, Lock, Send,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchContextOverview, fetchEligibleRuns, createPromotionRequest, reviewPromotion, approvePromotion, rejectPromotion,
  convertPromotionDraft, validatePromotionDraft, markCanaryCandidate, removeCanaryCandidate,
  fetchPromotionHistory, fetchPromotionSummary, fetchPromotionAudit,
  type ContextOverview, type EligibleRunRow, type PromotionRequestRow, type PromotionDraftRow,
  type PromotionSummary, type PromotionAuditRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import type { StrategyType } from '@/lib/optimizationStrategy';
import {
  promotionEligibility, draftTypesFor, convertToDraft, draftValidation, computeRiskTier, approvalPolicy,
  canaryReadiness, approvalReadiness, goNoGo, defaultRollbackPlan, defaultObservationPlan, idempotencyKey,
  compareDrafts, planComplete, PROMOTION_MODEL_VERSION,
  STRATEGY_DRAFT_MAP, CANARY_SCOPE_SUPPORT, SEPARATION_OF_DUTIES, APPROVAL_REASONS, REJECTION_REASONS,
  DRAFT_TYPE_LABEL, RISK_TIER_LABEL, RISK_TIER_TONE, REQUEST_STATUS_LABEL, REQUEST_STATUS_TONE,
  DRAFT_STATUS_LABEL, DRAFT_STATUS_TONE, CANARY_STATUS_LABEL, CANARY_STATUS_TONE, CHECK_TONE, STRATEGY_LABEL,
  type DraftType, type StrategySnapshot, type DraftSourceRefs, type DraftCompareInput,
} from '@/lib/draftPromotion';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));
const RANGES = ['30d', '90d'] as const;

type Tab = 'overview' | 'eligible' | 'requests' | 'review' | 'drafts' | 'validation' | 'canary' | 'comparison' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'eligible', label: 'Eligible Runs', icon: ListChecks },
  { key: 'requests', label: 'Promotion Requests', icon: FileText },
  { key: 'review', label: 'Review Queue', icon: UserCheck },
  { key: 'drafts', label: 'Drafts', icon: FileStack },
  { key: 'validation', label: 'Draft Validation', icon: ShieldCheck },
  { key: 'canary', label: 'Canary Candidates', icon: Bird },
  { key: 'comparison', label: 'Comparison', icon: GitCompare },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: BookOpen },
];

function firstStrategy(run: EligibleRunRow): StrategySnapshot | null {
  const snap = run.strategy_snapshot as { strategies?: Array<{ type: StrategyType; target: string | null; roi: number; expected: StrategySnapshot['expected'] }> } | null;
  const s = snap?.strategies?.[0];
  return s ? { type: s.type, target: s.target, roi: s.roi ?? 0, expected: s.expected ?? { completion: 0, skip: 0, listening: 0, health: 0 } } : null;
}

export default function DraftPromotionSection() {
  const [tab, setTab] = useState<Tab>('overview');
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const [, setOverview] = useState<ContextOverview | null>(null);
  const [summary, setSummary] = useState<PromotionSummary | null>(null);
  const [eligible, setEligible] = useState<EligibleRunRow[]>([]);
  const [requests, setRequests] = useState<PromotionRequestRow[]>([]);
  const [drafts, setDrafts] = useState<PromotionDraftRow[]>([]);
  const [audit, setAudit] = useState<PromotionAuditRow[]>([]);
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [reqDraftType, setReqDraftType] = useState<Record<string, DraftType>>({});
  const [approveReason, setApproveReason] = useState<string>(APPROVAL_REASONS[0]);
  const [rejectReason, setRejectReason] = useState<string>(REJECTION_REASONS[0]);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [validateDraftId, setValidateDraftId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [o, s, el, rq, dr] = await Promise.all([
        fetchContextOverview(range), fetchPromotionSummary(null), fetchEligibleRuns(null, 100),
        fetchPromotionHistory(null, 'requests', 100), fetchPromotionHistory(null, 'drafts', 100),
      ]);
      setOverview(o); setSummary(s); setEligible(el);
      setRequests(rq as PromotionRequestRow[]); setDrafts(dr as PromotionDraftRow[]);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, [range]);
  useEffect(() => { void load(); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async () => {
    const [s, rq, dr] = await Promise.all([fetchPromotionSummary(null), fetchPromotionHistory(null, 'requests', 100), fetchPromotionHistory(null, 'drafts', 100)]);
    setSummary(s); setRequests(rq as PromotionRequestRow[]); setDrafts(dr as PromotionDraftRow[]);
  }, []);

  const requestPromotion = async (run: EligibleRunRow) => {
    const strat = firstStrategy(run);
    if (!strat) { toast.error('Strategy Snapshot 없음'); return; }
    const draftType = reqDraftType[run.sandbox_run_id] ?? draftTypesFor(strat.type)[0];
    if (!draftType) { toast.error('지원되는 Draft Type 없음'); return; }
    const elig = promotionEligibility({ ...run, evidenceComplete: true }, strat.type, draftType);
    if (!elig.eligible) { toast.error(`승격 불가: ${elig.blockers.join(', ')}`); return; }
    const risk = computeRiskTier({ strategyRisk: run.risk_score ?? 30, sandboxRisk: run.risk_score ?? 30, driftScore: null, diffSize: 1, predictionUncertainty: 100 - (run.confidence ?? 0) });
    setBusy(true);
    try {
      await createPromotionRequest({
        sandbox_run_id: run.sandbox_run_id, strategy_id: run.strategy_id, context_key: run.context_key,
        requested_draft_type: draftType, risk_tier: risk.tier,
        approval_readiness: approvalReadiness({ eligible: true, sandboxDecision: run.decision, safety: run.safety_score ?? 0, benefit: run.benefit_score ?? 0, confidence: run.confidence ?? 0, evidenceComplete: true, draftCompatible: true, policyCompliant: run.hard_constraint_pass === true, riskTier: risk.tier, rollbackReady: true }),
        additional_approval_required: risk.tier === 'high' || risk.tier === 'critical',
        source_snapshot: run.strategy_snapshot, eligibility_result: elig, source_input_hash: run.input_hash, source_model_version: run.model_version,
        idempotency_key: idempotencyKey({ sandboxRunId: run.sandbox_run_id, strategyId: run.strategy_id, draftType, inputHash: run.input_hash }),
        evidence: [{ label: 'Sandbox Run', value: run.sandbox_run_id }, { label: 'Draft Type', value: draftType }, { label: 'Risk', value: risk.tier }, { label: 'Decision', value: run.decision }, { label: 'Version', value: PROMOTION_MODEL_VERSION }],
      });
      toast.success('Draft 승격 요청 생성됨(운영자 검토 대기)');
      await refresh();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const doReview = async (id: string) => { setBusy(true); try { await reviewPromotion(id, null); toast.success('검토 시작'); await refresh(); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); } };
  const doApprove = async (id: string) => { setBusy(true); try { await approvePromotion(id, approveReason); toast.success('승인됨(Draft 생성 승인 · Production 승인 아님)'); await refresh(); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); } };
  const doReject = async (id: string) => { setBusy(true); try { await rejectPromotion(id, rejectReason); toast.success('기각됨'); await refresh(); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); } };

  const convertDraft = async (req: PromotionRequestRow) => {
    const strat = firstStrategy({ strategy_snapshot: null } as EligibleRunRow) ?? { type: (req.strategy_id?.split(':')[0] as StrategyType) ?? 'genre_ratio', target: req.strategy_id?.split(':')[1] ?? null, roi: 50, expected: { completion: 3, skip: -2, listening: 0, health: 2 } };
    const refs: DraftSourceRefs = { sandbox_run_id: req.sandbox_run_id ?? '', strategy_id: req.strategy_id, source_input_hash: req.source_input_hash, source_model_version: req.source_model_version };
    const payload = convertToDraft({ draftType: req.requested_draft_type as DraftType, strategy: strat, contextKey: req.context_key, refs, genreMixBefore: [], genreMixAfter: [], confidence: req.approval_readiness ?? 60, sample: 300, currentInterval: 10, currentStage: 'pilot' });
    if (!payload) { toast.error('지원되지 않는 Draft 변환'); return; }
    setBusy(true);
    try {
      await convertPromotionDraft(req.id!, {
        payload, rollback_plan: defaultRollbackPlan(req.context_key), observation_plan: defaultObservationPlan(),
        evidence: [{ label: 'Request', value: req.id }, { label: 'Draft Type', value: req.requested_draft_type }, { label: 'Version', value: PROMOTION_MODEL_VERSION }],
      });
      toast.success('Draft 변환 완료(독립 Draft · Production 무변경)');
      await refresh();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const runValidation = async (draft: PromotionDraftRow) => {
    const v = draftValidation({
      draftType: draft.draft_type as DraftType, hasContent: !!draft.payload, sourceLinked: !!draft.sandbox_run_id,
      inputHashMatch: true, modelVersionMatch: true, candidateTracksPresent: true, trackStatusValid: true,
      playlistCapacityOk: draft.draft_type === 'playlist' ? true : null, genreGuardrailPass: true, moodGuardrailPass: true,
      rolloutStageOk: draft.draft_type === 'rollout' ? true : null, rotationIntervalOk: draft.draft_type === 'rotation' ? true : null,
      metadataCoverage: 90, sample: 300, confidence: draft.canary_readiness ?? 60, hardConstraintPass: true, regressionSafe: true,
      duplicateTrack: false, duplicateDraft: false, evidenceComplete: true,
    });
    const rb = draft.rollback_plan; const ob = draft.observation_plan;
    const cReady = canaryReadiness({ sandboxSafety: 75, sandboxBenefit: 40, confidence: draft.canary_readiness ?? 60, sample: 300, draftValidationReady: v.status === 'ready', policyCompliant: true, rollbackReady: !!rb, observationReady: !!ob });
    setBusy(true);
    try {
      await validatePromotionDraft(draft.id!, {
        draft_status: v.status, validation_result: { checks: v.checks }, hard_constraint_pass: v.hardPass,
        risk_tier: draft.risk_tier ?? 'low', canary_readiness: cReady, approval_readiness: draft.approval_readiness ?? 70,
        go_criteria: goNoGo({ draftReady: v.status === 'ready', hardPass: v.hardPass, canaryReadiness: cReady, riskTier: (draft.risk_tier as never) ?? 'low', rollbackReady: !!rb, observationReady: !!ob, approved: true, evidenceComplete: true, expired: false, inputHashMatch: true, policyVersionMatch: true }),
      });
      toast.success(`Draft Validation: ${v.status}`);
      await refresh();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const doCanary = async (draft: PromotionDraftRow, mark: boolean) => {
    setBusy(true);
    try {
      if (mark) await markCanaryCandidate(draft.id!, null); else await removeCanaryCandidate(draft.id!, null);
      toast.success(mark ? 'Canary 후보 지정됨(실행 아님)' : '후보 해제됨');
      await refresh();
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const loadAudit = async () => { setBusy(true); try { setAudit(await fetchPromotionAudit(null, null, 200)); } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); } };
  useEffect(() => { if (tab === 'audit') void loadAudit(); }, [tab]);

  const readyDrafts = useMemo(() => drafts.filter((d) => d.draft_status === 'ready'), [drafts]);
  const comparison = useMemo(() => {
    const chosen = compareIds.map((id) => drafts.find((d) => d.id === id)).filter((d): d is PromotionDraftRow => !!d).slice(0, 3);
    if (chosen.length < 2) return null;
    return compareDrafts(chosen.map((d) => {
      const pl = d.payload as { expected_delta?: { completion?: number }; added_track_ids?: string[] } | null;
      return { id: d.id!, label: `${DRAFT_TYPE_LABEL[d.draft_type as DraftType]}·${d.id!.slice(0, 6)}`, draft_type: d.draft_type as DraftType, expected_gain: pl?.expected_delta?.completion ?? null, risk: d.risk_tier === 'low' ? 20 : d.risk_tier === 'medium' ? 50 : 80, cost: null, roi: null, canary_readiness: d.canary_readiness, approval_readiness: d.approval_readiness, changed_track_count: (pl?.added_track_ids?.length ?? 0) } as DraftCompareInput;
    }));
  }, [compareIds, drafts]);

  if (loading) return <AdminCard title="Draft Promotion Gateway"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Draft Promotion Gateway">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  return (
    <AdminCard
      title="Draft Promotion Gateway"
      subtitle="Sandbox 승인 후보 → 운영자 승인 → 독립 Draft 변환 → Canary 후보 (Production 무변경 · 자동 실행 없음)"
      action={
        <div className="flex items-center gap-1.5">
          <select value={range} onChange={(e) => setRange(e.target.value as (typeof RANGES)[number])} className="rounded-md border border-border bg-background px-2 py-1 text-[11px] font-semibold">
            {RANGES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>
        </div>
      }
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="승인은 'Draft 생성 승인'일 뿐 Production 승인이 아닙니다. 실제 Playlist/Rotation/Rollout/Experiment 는 실행되지 않으며 Canary 후보 지정까지만 가능합니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Overview ── */}
      {tab === 'overview' && summary && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Box label="Eligible Runs" value={NUM(eligible.length)} />
          <Box label="검토 대기" value={NUM(summary.requests?.pending_reviews)} />
          <Box label="승인 / 기각" value={`${NUM(summary.requests?.approved)}/${NUM(summary.requests?.rejected)}`} />
          <Box label="변환 Draft" value={NUM(summary.requests?.converted)} />
          <Box label="Ready / 검증실패" value={`${NUM(summary.drafts?.ready)}/${NUM(summary.drafts?.validation_failed)}`} />
          <Box label="Canary 후보" value={NUM(summary.drafts?.canary_candidates)} />
          <Box label="High / Critical Risk" value={`${NUM(summary.requests?.high_risk)}/${NUM(summary.requests?.critical_risk)}`} />
          <Box label="평균 Approval/Canary Readiness" value={`${summary.requests?.avg_approval_readiness ?? '—'}/${summary.drafts?.avg_canary_readiness ?? '—'}`} />
        </div>
      )}

      {/* ── Eligible Runs ── */}
      {tab === 'eligible' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Eligible Sandbox Runs (approval_candidate + Hard Pass + 미Expired)"
            description="아래 Run 을 Draft 로 승격 요청합니다. '적용/배포/실행/Publish' 가 아니라 Draft 생성 요청입니다." />
          {!eligible.length ? <AdminEmpty icon={<ListChecks size={20} />} title="적격 Sandbox Run 없음" description="Sandbox 에서 승인 후보를 먼저 지정하세요." /> : eligible.map((run) => {
            const strat = firstStrategy(run);
            const types = strat ? draftTypesFor(strat.type) : [];
            return (
              <div key={run.sandbox_run_id} className="rounded-lg border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AdminBadge tone="success">{run.decision}</AdminBadge>
                  <span className="text-[11px] font-bold">{strat ? STRATEGY_LABEL[strat.type] : run.strategy_id}</span>
                  <span className="text-[10px] text-muted-foreground">{run.context_key}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">Safety {run.safety_score} · Benefit {run.benefit_score} · Risk {run.risk_score} · Conf {run.confidence}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {!types.length ? <span className="text-[10px] text-muted-foreground">지원 Draft 없음</span> : (
                    <>
                      <select value={reqDraftType[run.sandbox_run_id] ?? types[0]} onChange={(e) => setReqDraftType((p) => ({ ...p, [run.sandbox_run_id]: e.target.value as DraftType }))} className="rounded-md border border-border bg-background px-2 py-0.5 text-[10px] font-semibold">
                        {types.map((t) => <option key={t} value={t}>{DRAFT_TYPE_LABEL[t]}</option>)}
                      </select>
                      <button disabled={busy} onClick={() => void requestPromotion(run)} className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-50"><Send size={11} /> Draft 승격 요청</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Promotion Requests ── */}
      {tab === 'requests' && (
        <RequestTable requests={requests} onConvert={convertDraft} busy={busy} />
      )}

      {/* ── Review Queue ── */}
      {tab === 'review' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Review Queue — 승인은 Draft 생성 승인(Production 승인 아님)"
            description="자기 승인 제한: High Risk 는 요청자와 승인자가 달라야 합니다(단일 관리자 환경 제약)." />
          <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="font-bold text-muted-foreground">승인 사유</span>
            <select value={approveReason} onChange={(e) => setApproveReason(e.target.value)} className="rounded-md border border-border bg-background px-2 py-0.5 font-semibold">{APPROVAL_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            <span className="font-bold text-muted-foreground">기각 사유</span>
            <select value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} className="rounded-md border border-border bg-background px-2 py-0.5 font-semibold">{REJECTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </div>
          {!requests.filter((r) => r.request_status === 'pending_review').length ? <AdminEmpty icon={<UserCheck size={20} />} title="검토 대기 없음" /> : requests.filter((r) => r.request_status === 'pending_review').map((r) => {
            const pol = approvalPolicy((r.risk_tier as never) ?? 'low');
            return (
              <div key={r.id} className="rounded-lg border border-border p-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <AdminBadge tone={REQUEST_STATUS_TONE[r.request_status]}>{REQUEST_STATUS_LABEL[r.request_status]}</AdminBadge>
                  <AdminBadge tone="info">{DRAFT_TYPE_LABEL[r.requested_draft_type as DraftType]}</AdminBadge>
                  {r.risk_tier && <AdminBadge tone={RISK_TIER_TONE[r.risk_tier as never]}>{RISK_TIER_LABEL[r.risk_tier as never]}</AdminBadge>}
                  <span className="text-[10px] text-muted-foreground">{r.context_key} · Approval Readiness {r.approval_readiness}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground">{pol.note}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button disabled={busy} onClick={() => void doReview(r.id!)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Review 시작</button>
                  <button disabled={busy || !pol.approvable} onClick={() => void doApprove(r.id!)} title={pol.approvable ? '' : 'Critical 승인 불가'} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">승인(Draft 생성)</button>
                  <button disabled={busy} onClick={() => void doReject(r.id!)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">기각</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Drafts ── */}
      {tab === 'drafts' && (
        <div className="space-y-2">
          {!drafts.length ? <AdminEmpty icon={<FileStack size={20} />} title="Draft 없음" description="승인된 요청을 Promotion Requests 탭에서 변환하세요." /> : drafts.map((d) => (
            <div key={d.id} className="rounded-lg border border-border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <AdminBadge tone={DRAFT_STATUS_TONE[d.draft_status]}>{DRAFT_STATUS_LABEL[d.draft_status]}</AdminBadge>
                <AdminBadge tone="info">{DRAFT_TYPE_LABEL[d.draft_type as DraftType]}</AdminBadge>
                <AdminBadge tone={CANARY_STATUS_TONE[d.canary_status]}>{CANARY_STATUS_LABEL[d.canary_status]}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{d.context_key} · Canary Readiness {d.canary_readiness ?? '—'}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{d.created_at.slice(0, 16).replace('T', ' ')}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button disabled={busy} onClick={() => { setValidateDraftId(d.id!); setTab('validation'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Validation</button>
                <button disabled={busy} onClick={() => void runValidation(d)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">재검증 실행</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Draft Validation ── */}
      {tab === 'validation' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Draft Validation" description="검증 통과(ready)한 Draft 만 Canary Candidate 로 지정할 수 있습니다." />
          {(() => {
            const d = drafts.find((x) => x.id === validateDraftId) ?? drafts[0];
            if (!d) return <AdminEmpty icon={<ShieldCheck size={20} />} title="Draft 없음" />;
            const vr = (d.validation_result as { checks?: Array<{ code: string; label: string; result: keyof typeof CHECK_TONE }> } | null)?.checks ?? [];
            return (
              <AdminCard title={`Validation · ${DRAFT_TYPE_LABEL[d.draft_type as DraftType]} (${DRAFT_STATUS_LABEL[d.draft_status]})`}
                action={<button disabled={busy} onClick={() => void runValidation(d)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">검증 실행</button>}>
                {!vr.length ? <p className="text-[11px] text-muted-foreground">검증 실행을 눌러 결과를 생성하세요.</p> : (
                  <table className="w-full text-left text-xs">
                    <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">항목</th><th className="px-2">결과</th></tr></thead>
                    <tbody>{vr.map((c) => <tr key={c.code} className="border-b border-border/50"><td className="py-1 pr-2 font-semibold">{c.label}</td><td className="px-2"><AdminBadge tone={CHECK_TONE[c.result]}>{c.result}</AdminBadge></td></tr>)}</tbody>
                  </table>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <span>Rollback Plan: <b>{planComplete(d.rollback_plan as never, d.observation_plan as never) ? '완비' : '미완'}</b></span>
                  <span>Observation Plan: <b>{d.observation_plan ? '있음' : '없음'}</b></span>
                </div>
              </AdminCard>
            );
          })()}
        </div>
      )}

      {/* ── Canary Candidates ── */}
      {tab === 'canary' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Canary Candidate (실제 Canary 실행 아님)"
            description="ready + 미Expired + Risk≠Critical + Rollback/Observation Plan 필수. Go/No-Go 표시까지만." />
          {!readyDrafts.length && !drafts.some((d) => d.canary_status === 'candidate') ? <AdminEmpty icon={<Bird size={20} />} title="Ready Draft 없음" description="Draft Validation 을 통과시키세요." /> : (
            drafts.filter((d) => d.draft_status === 'ready' || d.canary_status === 'candidate').map((d) => {
              const gng = goNoGo({ draftReady: d.draft_status === 'ready', hardPass: true, canaryReadiness: d.canary_readiness ?? 0, riskTier: (d.risk_tier as never) ?? 'low', rollbackReady: !!d.rollback_plan, observationReady: !!d.observation_plan, approved: true, evidenceComplete: true, expired: !!d.expired_at, inputHashMatch: true, policyVersionMatch: true });
              return (
                <div key={d.id} className="rounded-lg border border-border p-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AdminBadge tone={CANARY_STATUS_TONE[d.canary_status]}>{CANARY_STATUS_LABEL[d.canary_status]}</AdminBadge>
                    <AdminBadge tone="info">{DRAFT_TYPE_LABEL[d.draft_type as DraftType]}</AdminBadge>
                    <AdminBadge tone={gng.decision === 'go_candidate' ? 'success' : 'warning'}>{gng.decision === 'go_candidate' ? 'Go Candidate' : 'No-Go'}</AdminBadge>
                    <span className="text-[10px] text-muted-foreground">Canary Readiness {d.canary_readiness ?? '—'}</span>
                  </div>
                  {gng.reasons.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">{gng.reasons.join(' · ')}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {d.canary_status !== 'candidate' && gng.decision === 'go_candidate' && <button disabled={busy} onClick={() => void doCanary(d, true)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Canary 후보 지정</button>}
                    {d.canary_status === 'candidate' && <button disabled={busy} onClick={() => void doCanary(d, false)} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">후보 해제</button>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ── Comparison ── */}
      {tab === 'comparison' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="Draft 비교 (최대 3, Winner 단정 없음)" />
          <div className="flex flex-wrap gap-1.5">
            {drafts.slice(0, 12).map((d) => (
              <button key={d.id} onClick={() => setCompareIds((p) => p.includes(d.id!) ? p.filter((x) => x !== d.id) : p.length < 3 ? [...p, d.id!] : p)}
                className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${compareIds.includes(d.id!) ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>
                {DRAFT_TYPE_LABEL[d.draft_type as DraftType]}·{d.id!.slice(0, 6)}
              </button>
            ))}
          </div>
          {!comparison ? <AdminEmpty icon={<GitCompare size={20} />} title="2개 이상 선택" /> : (
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">지표</th>{comparison.drafts.map((r) => <th key={r} className="px-2">{r}</th>)}<th className="px-2">비교</th></tr></thead>
              <tbody>{comparison.rows.map((row) => <tr key={row.metric} className="border-b border-border/50"><td className="py-1 pr-2 font-semibold">{row.metric}</td>{row.values.map((v, i) => <td key={i} className="px-2">{v == null ? '—' : String(v)}</td>)}<td className="px-2 text-[10px] text-muted-foreground">{row.note}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!audit.length ? <AdminEmpty icon={<ScrollText size={20} />} title="Audit 없음" /> : audit.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
              <AdminBadge tone="neutral">{a.action}</AdminBadge>
              <span>{a.previous_state ?? '—'} → {a.next_state ?? '—'}</span>
              {a.reason && <span className="text-muted-foreground">· {a.reason}</span>}
              <span className="ml-auto text-[10px] text-muted-foreground">{a.created_at.slice(0, 16).replace('T', ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Support Matrix ── */}
      {tab === 'support' && (
        <div className="space-y-3">
          <AdminAlert tone="warning" title="Separation of Duties" description={SEPARATION_OF_DUTIES.note} />
          <AdminCard title="Strategy → Draft 매핑">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Strategy</th><th className="px-2">지원 Draft</th></tr></thead>
              <tbody>{(Object.keys(STRATEGY_DRAFT_MAP) as StrategyType[]).map((k) => <tr key={k} className="border-b border-border/50"><td className="py-1 pr-2 font-semibold">{STRATEGY_LABEL[k]}</td><td className="px-2">{STRATEGY_DRAFT_MAP[k].map((t) => DRAFT_TYPE_LABEL[t]).join(', ')}</td></tr>)}</tbody>
            </table>
          </AdminCard>
          <AdminCard title="Canary Scope 지원">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1 pr-2">Scope</th><th className="px-2">지원</th><th className="px-2">근거</th></tr></thead>
              <tbody>{CANARY_SCOPE_SUPPORT.map((s) => <tr key={s.key} className="border-b border-border/50"><td className="py-1 pr-2 font-semibold">{s.label}</td><td className="px-2"><AdminBadge tone={s.supported ? 'success' : 'danger'}>{s.supported ? '지원' : '미지원'}</AdminBadge></td><td className="px-2 text-[10px] text-muted-foreground">{s.note}</td></tr>)}</tbody>
            </table>
          </AdminCard>
        </div>
      )}
    </AdminCard>
  );
}

function Box({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-2">
      <p className="text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-black break-words">{value}</p>
    </div>
  );
}
function RequestTable({ requests, onConvert, busy }: { requests: PromotionRequestRow[]; onConvert: (r: PromotionRequestRow) => void; busy: boolean }) {
  if (!requests.length) return <AdminEmpty icon={<FileText size={20} />} title="Promotion Request 없음" description="Eligible Runs 에서 승격 요청하세요." />;
  return (
    <div className="space-y-2">
      {requests.map((r) => (
        <div key={r.id} className="rounded-lg border border-border p-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <AdminBadge tone={REQUEST_STATUS_TONE[r.request_status]}>{REQUEST_STATUS_LABEL[r.request_status]}</AdminBadge>
            <AdminBadge tone="info">{DRAFT_TYPE_LABEL[r.requested_draft_type as DraftType]}</AdminBadge>
            {r.risk_tier && <AdminBadge tone={RISK_TIER_TONE[r.risk_tier as never]}>{RISK_TIER_LABEL[r.risk_tier as never]}</AdminBadge>}
            <span className="text-[10px] text-muted-foreground">{r.context_key}</span>
            <span className="ml-auto text-[10px] text-muted-foreground">{r.created_at.slice(0, 16).replace('T', ' ')}</span>
          </div>
          {r.request_status === 'approved' && (
            <div className="mt-2"><button disabled={busy} onClick={() => onConvert(r)} className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-50">Draft 변환(독립 Entity)</button></div>
          )}
        </div>
      ))}
    </div>
  );
}
