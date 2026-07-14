/**
 * OperationsCenterSection — AI Operations Center & Human-AI Collaboration (Phase AI-OPS-1).
 *
 * AI 가 생성한 모든 제안(Executive/Recovery/Fleet/Best Practice)을 하나의 Operations Queue 로
 * 모아 사람이 검토·승인·거절·피드백한다. **AI 는 제안만 — 최종 운영은 사람.**
 * 자동 승인/Merge/Rollout/Publish/Production Apply 없음. Feedback 은 기록 기반 참고 Evidence.
 *
 * 탭: Operations Queue · Review · Evidence · Timeline · Executive Inbox · Analytics · Audit · Support Matrix.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Inbox, ClipboardCheck, FileSearch, ListOrdered, Crown, BarChart3, ScrollText, Grid3x3, Lock, RefreshCw,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  enrollOperation, fetchOperationsQueue, fetchOperationDetail, reviewOperation, archiveOperation, fetchOperationAnalytics,
  fetchExecRecommendations, fetchRecoveryCandidates, fetchFleetOpportunities, fetchBestPractices,
  type OperationRow, type OperationReviewRow, type OperationAnalyticsResp,
  type ExecRecommendationRow, type RecoveryCandidateRow, type FleetOpportunityRow, type BestPracticeRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  OPS_SOURCE_VERSION, OPS_SOURCES, OPS_SUPPORT, approvalGate, isExecutiveInboxItem, rankInbox,
  feedbackToLearningSignal, computeReviewAnalytics, opsInputHash,
  OPS_STATUS_LABEL, OPS_STATUS_TONE, ACTION_LABEL, FEEDBACK_LABEL,
  type OpsStatus, type ReviewAction, type FeedbackType, type ApprovalPolicy,
} from '@/lib/opsCenter';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'queue' | 'review' | 'evidence' | 'timeline' | 'inbox' | 'analytics' | 'audit' | 'support';
const TABS: { key: Tab; label: string; icon: typeof Inbox }[] = [
  { key: 'queue', label: 'Operations Queue', icon: Inbox },
  { key: 'review', label: 'Review', icon: ClipboardCheck },
  { key: 'evidence', label: 'Evidence', icon: FileSearch },
  { key: 'timeline', label: 'Timeline', icon: ListOrdered },
  { key: 'inbox', label: 'Executive Inbox', icon: Crown },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
  { key: 'audit', label: 'Audit', icon: ScrollText },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
];

export default function OperationsCenterSection() {
  const [tab, setTab] = useState<Tab>('queue');
  const [ops, setOps] = useState<OperationRow[]>([]);
  const [selOp, setSelOp] = useState<OperationRow | null>(null);
  const [reviews, setReviews] = useState<OperationReviewRow[]>([]);
  const [source, setSource] = useState<Record<string, unknown> | null>(null);
  const [analytics, setAnalytics] = useState<OperationAnalyticsResp | null>(null);
  const [execRecs, setExecRecs] = useState<ExecRecommendationRow[]>([]);
  const [recoveries, setRecoveries] = useState<RecoveryCandidateRow[]>([]);
  const [fleetOpps, setFleetOpps] = useState<FleetOpportunityRow[]>([]);
  const [practices, setPractices] = useState<BestPracticeRow[]>([]);
  const [reason, setReason] = useState('');
  const [feedback, setFeedback] = useState<FeedbackType | ''>('');
  const [policy, setPolicy] = useState<ApprovalPolicy>('single');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const [q, an, er, rc, fo, bp] = await Promise.all([
        fetchOperationsQueue(null, null, null, 100), fetchOperationAnalytics(),
        fetchExecRecommendations(null, null, null, 50).catch(() => [] as ExecRecommendationRow[]),
        fetchRecoveryCandidates(null, null, 50).catch(() => [] as RecoveryCandidateRow[]),
        fetchFleetOpportunities(null, null, 50).catch(() => [] as FleetOpportunityRow[]),
        fetchBestPractices(null, null, 50).catch(() => [] as BestPracticeRow[]),
      ]);
      setOps(q); setAnalytics(an); setExecRecs(er); setRecoveries(rc); setFleetOpps(fo); setPractices(bp);
    } catch (e) { setErr(classifyAdminError(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const enrolledIds = useMemo(() => new Set(ops.map((o) => `${o.source_type}:${o.source_id}`)), [ops]);
  const enrollable = useMemo(() => [
    ...execRecs.filter((r) => !enrolledIds.has(`executive_recommendation:${r.id}`)).map((r) => ({
      sourceType: 'executive_recommendation', sourceId: r.id, title: r.title, category: r.category === 'risk_mitigation' ? 'risk_mitigation' : r.category === 'opportunity' ? 'opportunity' : 'strategy', riskTier: r.risk_tier, impact: null as string | null,
    })),
    ...recoveries.filter((r) => !enrolledIds.has(`recovery_candidate:${r.id}`)).map((r) => ({
      sourceType: 'recovery_candidate', sourceId: r.id, title: `Recovery: ${r.strategy_type}`, category: 'recovery', riskTier: r.business_impact === 'critical' ? 'critical' : r.business_impact === 'high' ? 'high' : 'medium', impact: r.business_impact,
    })),
    ...fleetOpps.filter((r) => !enrolledIds.has(`fleet_opportunity:${r.id}`)).map((r) => ({
      sourceType: 'fleet_opportunity', sourceId: r.id, title: `Fleet: ${r.opportunity_type} (${r.scope_key})`, category: 'opportunity', riskTier: r.severity === 'critical' ? 'critical' : r.severity === 'high' ? 'high' : 'low', impact: null as string | null,
    })),
    ...practices.filter((r) => !enrolledIds.has(`best_practice:${r.id}`)).map((r) => ({
      sourceType: 'best_practice', sourceId: r.id, title: r.title.slice(0, 60), category: 'opportunity', riskTier: 'low', impact: null as string | null,
    })),
  ], [execRecs, recoveries, fleetOpps, practices, enrolledIds]);

  const enroll = async (e: typeof enrollable[number]) => {
    setBusy(true);
    try {
      const res = await enrollOperation({
        operation_code: `op_${opsInputHash([e.sourceType, e.sourceId]).slice(4)}`,
        source_type: e.sourceType, source_id: e.sourceId, title: e.title, category: e.category,
        risk_tier: e.riskTier, impact: e.impact, approval_policy: policy, source_version: OPS_SOURCE_VERSION,
      });
      toast.success(res.idempotent ? '이미 등록됨(중복 방지)' : `Queue 등록(${policy} 승인 정책)`);
      setOps(await fetchOperationsQueue(null, null, null, 100));
    } catch (e2) { toast.error(classifyAdminError(e2).message); } finally { setBusy(false); }
  };

  const openOp = async (o: OperationRow) => {
    setSelOp(o); setBusy(true);
    try { const d = await fetchOperationDetail(o.id); if (d.found && d.operation) { setSelOp(d.operation); setReviews(d.reviews); setSource(d.source); } }
    catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const doReview = async (action: ReviewAction) => {
    if (!selOp) { toast.error('Operation 을 먼저 선택하세요.'); return; }
    if (!reason.trim()) { toast.error('사유(reason) 필수 — 근거 없는 판정 금지'); return; }
    setBusy(true);
    try {
      const learning = feedback ? feedbackToLearningSignal(selOp.source_type, feedback, reason) : null;
      const res = await reviewOperation(selOp.id, action, reason.trim(), feedback || null, learning?.note ?? null);
      toast.success(res.note ?? `${ACTION_LABEL[action]} 기록됨(사람 판정)`);
      setReason(''); setFeedback('');
      await openOp(res.operation); setOps(await fetchOperationsQueue(null, null, null, 100));
      setAnalytics(await fetchOperationAnalytics());
    } catch (e) { toast.error(classifyAdminError(e).message); } finally { setBusy(false); }
  };

  const inbox = useMemo(() => rankInbox(ops.filter((o) => isExecutiveInboxItem({
    id: o.id, category: o.category, riskTier: o.risk_tier, impact: o.impact, status: o.status as OpsStatus, createdAt: o.created_at,
  })).map((o) => ({ ...o, riskTier: o.risk_tier, impact: o.impact, createdAt: o.created_at, status: o.status as OpsStatus }))), [ops]);

  const clientAnalytics = useMemo(() => computeReviewAnalytics(reviews.map((r) => ({
    action: r.action as ReviewAction, feedbackType: r.feedback_type as FeedbackType | null, createdAt: r.created_at,
  }))), [reviews]);

  const gate = useMemo(() => {
    if (!selOp) return null;
    const approvers = new Set(reviews.filter((r) => r.action === 'approve').map((r) => r.reviewer_id ?? '')).size;
    return approvalGate({ policy: selOp.approval_policy as ApprovalPolicy, distinctApprovers: approvers, hasRejection: reviews.some((r) => r.action === 'reject') });
  }, [selOp, reviews]);

  if (loading) return <AdminCard title="AI Operations Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="AI Operations Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const opsAgg = analytics?.operations ?? null;

  return (
    <AdminCard
      title="AI Operations Center"
      subtitle="AI 제안 통합 Queue → 사람 검토·승인·거절·피드백 (자동 승인 없음 · Production Apply 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="AI 는 의사결정을 제안할 뿐 최종 운영은 사람이 수행합니다. 모든 판정은 사유가 필수이며, dual 정책은 서로 다른 승인자 2인을 서버에서 강제합니다. 승인돼도 실행은 기존 Draft/Promotion/Candidate 흐름 + 수동 실행이며 자동 Merge/Rollout/Publish/Production Apply 는 없습니다. 피드백은 기록 기반 참고 Evidence(자동 학습 없음)입니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {/* ── Queue ── */}
      {tab === 'queue' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Queue 총계" value={NUM(num(opsAgg?.total))} />
            <Box label="승인됨" value={NUM(num(opsAgg?.approved))} />
            <Box label="거절됨" value={NUM(num(opsAgg?.rejected))} />
            <Box label="평균 검토(h)" value={NUM(num(opsAgg?.avg_review_hours))} />
          </div>
          {!ops.length ? <AdminEmpty icon={<Inbox size={20} />} title="Queue 비어 있음" description="아래에서 AI 제안을 등록하세요." /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">Operation</th><th className="px-2">Source</th><th className="px-2">Category</th><th className="px-2">Risk</th><th className="px-2">정책</th><th className="px-2">Status</th><th className="px-2" /></tr></thead>
                <tbody>
                  {ops.map((o) => (
                    <tr key={o.id} className="border-b border-border/50">
                      <td className="py-1.5 pr-2 font-semibold">{o.title.slice(0, 36)}</td>
                      <td className="px-2 text-[10px]">{OPS_SOURCES.find((s) => s.type === o.source_type)?.label ?? o.source_type}</td>
                      <td className="px-2 text-[10px]">{o.category}</td>
                      <td className="px-2 text-[10px]">{o.risk_tier ?? '—'}</td>
                      <td className="px-2 text-[10px]">{o.approval_policy}{o.approval_policy === 'dual' ? ` (${o.approve_count ?? 0}/2)` : ''}</td>
                      <td className="px-2"><AdminBadge tone={OPS_STATUS_TONE[o.status as OpsStatus] ?? 'neutral'}>{OPS_STATUS_LABEL[o.status as OpsStatus] ?? o.status}</AdminBadge></td>
                      <td className="px-2"><button disabled={busy} onClick={() => { void openOp(o); setTab('review'); }} className="rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">검토</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AdminCard title={`등록 가능한 AI 제안 (${enrollable.length})`}>
            <div className="mb-2 flex items-center gap-2 text-[11px]">
              <span className="text-[10px] font-bold text-muted-foreground">승인 정책</span>
              {(['single', 'dual', 'executive'] as ApprovalPolicy[]).map((p) => (
                <button key={p} onClick={() => setPolicy(p)} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${policy === p ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>{p}</button>
              ))}
            </div>
            {!enrollable.length ? <AdminEmpty icon={<Inbox size={20} />} title="등록 가능한 제안 없음" description="Executive/Self-Healing/Fleet 센터에서 제안을 먼저 생성하세요." /> : (
              <div className="space-y-1.5">
                {enrollable.slice(0, 10).map((e, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                    <AdminBadge tone="neutral">{OPS_SOURCES.find((s) => s.type === e.sourceType)?.label}</AdminBadge>
                    <span className="font-semibold">{e.title.slice(0, 44)}</span>
                    <button disabled={busy} onClick={() => void enroll(e)} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">Queue 등록</button>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>
        </div>
      )}

      {/* ── Review ── */}
      {tab === 'review' && (
        <div className="space-y-3">
          {!selOp ? <AdminEmpty icon={<ClipboardCheck size={20} />} title="Operation 선택 필요" description="Queue 탭에서 검토할 항목을 선택하세요." /> : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <AdminBadge tone={OPS_STATUS_TONE[selOp.status as OpsStatus]}>{OPS_STATUS_LABEL[selOp.status as OpsStatus]}</AdminBadge>
                <span className="text-sm font-black">{selOp.title.slice(0, 50)}</span>
                <span className="text-[10px] text-muted-foreground">{selOp.approval_policy} 정책</span>
              </div>
              {gate && <AdminAlert tone={gate.canFinalize ? 'info' : 'warning'} title="승인 게이트" description={gate.note} />}
              <div className="space-y-2 rounded-lg border border-border p-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="판정 사유(필수)" className="w-full rounded-md border border-border bg-background px-2 py-1 text-[11px]" aria-label="판정 사유" />
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] font-bold text-muted-foreground">AI Feedback</span>
                  {(['accurate', 'inaccurate', 'needs_modification', 'insufficient_evidence'] as FeedbackType[]).map((f) => (
                    <button key={f} onClick={() => setFeedback(feedback === f ? '' : f)} className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${feedback === f ? 'bg-accent text-black' : 'border border-border text-muted-foreground'}`}>{FEEDBACK_LABEL[f]}</button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button disabled={busy || ['approved', 'rejected', 'archived'].includes(selOp.status)} onClick={() => void doReview('approve')} className="rounded-md bg-accent px-2.5 py-1 text-[11px] font-bold text-black disabled:opacity-50">승인</button>
                  <button disabled={busy || ['approved', 'rejected', 'archived'].includes(selOp.status)} onClick={() => void doReview('hold')} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">보류(Evidence 대기)</button>
                  <button disabled={busy || ['approved', 'rejected', 'archived'].includes(selOp.status)} onClick={() => void doReview('reject')} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">거절</button>
                  <button disabled={busy || ['approved', 'rejected', 'archived'].includes(selOp.status)} onClick={() => void doReview('request_review')} className="rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">재검토 요청</button>
                  <button disabled={busy} onClick={() => { if (reason.trim()) void archiveOperation(selOp.id, reason.trim()).then(() => load()); else toast.error('사유 필수'); }} className="ml-auto rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50">보관</button>
                </div>
              </div>
              {feedback && <p className="text-[10px] text-muted-foreground">Learning Signal: {feedbackToLearningSignal(selOp.source_type, feedback, reason || '—').signal} — 자동 학습 없음(Memory Reinforce/Contradict 로 사람이 반영)</p>}
            </>
          )}
        </div>
      )}

      {/* ── Evidence ── */}
      {tab === 'evidence' && (
        <div className="space-y-3">
          {!selOp ? <AdminEmpty icon={<FileSearch size={20} />} title="Operation 선택 필요" /> : (
            <>
              <AdminAlert tone="info" title="Evidence Viewer (Source 읽기 전용 스냅샷)" description={`${OPS_SOURCES.find((s) => s.type === selOp.source_type)?.label} — ${OPS_SOURCES.find((s) => s.type === selOp.source_type)?.origin}`} />
              {!source ? <AdminEmpty icon={<FileSearch size={20} />} title="Source 스냅샷 없음" /> : (
                <div className="max-h-72 overflow-auto rounded-lg border border-border bg-muted/30 p-2">
                  <pre className="whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(source, null, 1)}</pre>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Timeline ── */}
      {tab === 'timeline' && (
        <div className="space-y-2">
          {!selOp ? <AdminEmpty icon={<ListOrdered size={20} />} title="Operation 선택 필요" /> : (
            (selOp.timeline ?? []).map((t, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <span className="text-[10px] text-muted-foreground">{String(t.at).slice(0, 16)}</span>
                <AdminBadge tone="neutral">{t.event}</AdminBadge>
                <span className="text-[10px] text-muted-foreground">{t.detail ?? ''}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Executive Inbox ── */}
      {tab === 'inbox' && (
        <div className="space-y-2">
          <AdminAlert tone="info" title="Executive Inbox" description="High Risk/High Impact/Recovery/Strategy 항목을 결정적 우선순위로 표시합니다." />
          {!inbox.length ? <AdminEmpty icon={<Crown size={20} />} title="Inbox 비어 있음" /> : (
            inbox.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={o.risk_tier === 'critical' ? 'danger' : o.risk_tier === 'high' ? 'warning' : 'neutral'}>{o.risk_tier ?? '—'}</AdminBadge>
                <AdminBadge tone="neutral">{o.category}</AdminBadge>
                <span className="font-semibold">{o.title.slice(0, 44)}</span>
                <AdminBadge tone={OPS_STATUS_TONE[o.status as OpsStatus]}>{OPS_STATUS_LABEL[o.status as OpsStatus]}</AdminBadge>
                <button disabled={busy} onClick={() => { void openOp(o as unknown as OperationRow); setTab('review'); }} className="ml-auto rounded-md border border-border px-2 py-0.5 text-[10px] font-bold hover:bg-muted disabled:opacity-50">검토</button>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Analytics ── */}
      {tab === 'analytics' && (
        <div className="space-y-3">
          <AdminAlert tone="info" title="AI Feedback Analytics (실측만)" description="결정 2건 미만이면 승인율을 계산하지 않습니다(insufficient_data — 가짜 지표 없음). AI 정확도 추이는 전/후 절반 승인율 비교입니다." />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="선택 Op 승인율" value={clientAnalytics.approvalRate == null ? 'insufficient' : `${clientAnalytics.approvalRate}%`} />
            <Box label="거절율" value={clientAnalytics.rejectionRate == null ? '—' : `${clientAnalytics.rejectionRate}%`} />
            <Box label="수정 요청율" value={clientAnalytics.modificationRate == null ? '—' : `${clientAnalytics.modificationRate}%`} />
            <Box label="AI 정확도 추이" value={clientAnalytics.aiAccuracyTrend} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="전체 리뷰" value={NUM(num(analytics?.reviews?.total))} />
            <Box label="정확 피드백" value={NUM(num(analytics?.reviews?.accurate))} />
            <Box label="부정확 피드백" value={NUM(num(analytics?.reviews?.inaccurate))} />
            <Box label="Evidence 부족" value={NUM(num(analytics?.reviews?.insufficient_evidence))} />
          </div>
        </div>
      )}

      {/* ── Audit ── */}
      {tab === 'audit' && (
        <div className="space-y-2">
          {!selOp || !reviews.length ? <AdminEmpty icon={<ScrollText size={20} />} title="리뷰 이력 없음" description="Operation 선택 후 리뷰 이력이 표시됩니다." /> : (
            reviews.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[11px]">
                <AdminBadge tone={r.action === 'approve' ? 'success' : r.action === 'reject' ? 'danger' : 'warning'}>{ACTION_LABEL[r.action as ReviewAction] ?? r.action}</AdminBadge>
                {r.feedback_type && <AdminBadge tone="neutral">{FEEDBACK_LABEL[r.feedback_type as FeedbackType] ?? r.feedback_type}</AdminBadge>}
                <span className="text-[10px] text-muted-foreground">{r.reason.slice(0, 60)}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">{r.created_at.slice(0, 16)}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Support ── */}
      {tab === 'support' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-border text-[10px] uppercase text-muted-foreground"><th className="py-1.5 pr-2">기능</th><th className="px-2">상태</th><th className="px-2">근거</th></tr></thead>
            <tbody>
              {OPS_SUPPORT.map((s) => (
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

function num(v: unknown): number | null {
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
