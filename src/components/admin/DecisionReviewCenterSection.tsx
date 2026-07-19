/**
 * DecisionReviewCenterSection — Enterprise E-3 (Decision & Review Center).
 *
 * Enterprise 전역의 Review/Recommendation/Advisory/Incident/Approval Request/
 * Policy Suggestion 을 통합 관리하는 Human Decision Layer.
 * 신규 Decision Engine/Recommendation Engine/Migration/RPC 없음 —
 * 기존 원장(0479 Action Center · 0481 Recommendation · 0502 Recovery ·
 * 0503 Executive Recommendation · 0484 Playlist Reco) 재사용.
 * AI 는 결정을 내리지 않는다 — Approve/Reject/Request Changes/Escalate/Defer 는
 * 사람의 행위이며 0479 레지스트리(decision_*)에 감사 기록된다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, Bot, ClipboardList, Gauge, History, Inbox, Layers, Lightbulb,
  Lock, RefreshCw, Scale, Shield,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchActionHistory, fetchArtistSummary, fetchNocKpi, fetchReadableSettlementKpi,
  fetchEnterpriseResilienceSummary, fetchRecommendationHistory, fetchExecRecommendations,
  fetchRecoveryCandidates, fetchPlaylistHistory, registerActionCommand, completeActionCommand,
  type ActionHistoryRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { numAt, type FeedRecord } from '@/lib/executiveCommandCenter';
import {
  DECISION_COMMAND_PREFIX, DECISION_OVERSIGHT_MATRIX, HUMAN_DECISION_ACTIONS,
  buildDecisionDetail, buildDecisionInbox, buildDecisionSummaryLines, filterDecisionHistory,
  normalizeRecommendations, summarizeDecisionAnalytics, validateHumanDecisionAction,
  type DecisionInboxItem, type HumanDecisionAction,
} from '@/lib/decisionReviewCenter';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'inbox' | 'reviews' | 'recommendations' | 'detail' | 'history' | 'analytics' | 'summary' | 'oversight' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof Inbox }[] = [
  { key: 'inbox', label: 'Decision Inbox', icon: Inbox },
  { key: 'reviews', label: 'Reviews', icon: ClipboardList },
  { key: 'recommendations', label: 'Recommendations', icon: Lightbulb },
  { key: 'detail', label: 'Decision Detail', icon: Layers },
  { key: 'history', label: 'History', icon: History },
  { key: 'analytics', label: 'Analytics', icon: Gauge },
  { key: 'summary', label: 'AI Summary', icon: Bot },
  { key: 'oversight', label: 'Human Oversight', icon: Shield },
  { key: 'limitations', label: 'Known Limitations', icon: Scale },
];

const KNOWN_LIMITATIONS = [
  '신규 AI Decision Engine/Recommendation Engine 생성 없음 — 기존 원장(0479/0481/0502/0503/0484)의 통합 표시·기록 계층입니다',
  '신규 Migration/RPC 없음 — Human Decision 감사 기록은 기존 0479 admin_action_register/complete/history 를 decision_* 로 재사용합니다',
  'AI 는 결정을 내리지 않습니다 — Approve/Reject/Request Changes/Escalate/Defer 는 사람의 행위 기록이며, 원본 대상의 실제 승인/지급/계약은 각 기존 화면의 절차로 수행됩니다',
  'Confidence/Risk 는 원본 기록값 그대로 노출 — 원본에 없으면 null(미관측)로 표시하고 재채점/조작하지 않습니다',
  'Policy Suggestion/Security Review 전용 실측 피드 부재 — Decision Inbox 에서 미관측 항목으로만 공개됩니다',
  'Decision Analytics 의 평균 시간은 duration 이 측정된 완료 건만 사용하며, 측정 불가 시 null 로 표시합니다',
  'AI Decision Summary 는 관측값 기반 결정적 문장 생성(5줄 이내)이며 판단/예측/승인이 아닙니다',
  '자동 승인/자동 거절/자동 계약 승인/자동 지급/자동 Merge/자동 Deploy/자동 Production Apply/새 AI Decision 생성 없음',
  'Migration 0472~0564 production 미적용 — 관련 원장 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

interface Feeds {
  actionHistory: ActionHistoryRow[] | null;
  artist: FeedRecord | null;
  noc: FeedRecord | null;
  settlementKpi: FeedRecord | null;
  resilience: FeedRecord | null;
  general: Array<Record<string, unknown>> | null;
  executive: Array<Record<string, unknown>> | null;
  recovery: Array<Record<string, unknown>> | null;
  playlist: Array<Record<string, unknown>> | null;
}

const EMPTY_FEEDS: Feeds = {
  actionHistory: null, artist: null, noc: null, settlementKpi: null, resilience: null,
  general: null, executive: null, recovery: null, playlist: null,
};

export default function DecisionReviewCenterSection() {
  const [tab, setTab] = useState<Tab>('inbox');
  const [feeds, setFeeds] = useState<Feeds>(EMPTY_FEEDS);
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [selReco, setSelReco] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const now = new Date();
      const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const keys = ['actionHistory', 'artist', 'noc', 'settlementKpi', 'resilience', 'general', 'executive', 'recovery', 'playlist'] as const;
      const results = await Promise.allSettled([
        fetchActionHistory(100), fetchArtistSummary(), fetchNocKpi(), fetchReadableSettlementKpi(month),
        fetchEnterpriseResilienceSummary(), fetchRecommendationHistory({ limit: 50 }),
        fetchExecRecommendations(null, null, null, 100), fetchRecoveryCandidates(null, null, 100), fetchPlaylistHistory(50),
      ]);
      const next: Feeds = { ...EMPTY_FEEDS };
      const failed: string[] = [];
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value != null) (next as unknown as Record<string, unknown>)[k] = r.value;
        else failed.push(k);
      });
      setFeeds(next); setFailedFeeds(failed);
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
  /** 사람의 결정을 0479 레지스트리에 감사 기록 — 실행이 아니라 기록이다. */
  const recordDecision = (action: HumanDecisionAction, target: string) => {
    const v = validateHumanDecisionAction(action);
    if (!v.ok) { toast.error(v.reason); return; }
    const r = needReason();
    if (!r) return;
    void act(async () => {
      const reg = await registerActionCommand({
        commandType: `${DECISION_COMMAND_PREFIX}${action}`, targetType: 'decision_review_center',
        targetId: target || null, reason: r, approved: true,
      });
      await completeActionCommand(reg.command_id, 'success').catch(() => {});
    }, `${action} 결정 기록 완료 (감사 로그)`);
  };

  const recos = useMemo(() => normalizeRecommendations({
    general: feeds.general, executive: feeds.executive, recovery: feeds.recovery, playlist: feeds.playlist,
  }), [feeds]);

  const reviewItems = useMemo(() => {
    const incidents = numAt(feeds.noc, 'today_incidents');
    const recovered = numAt(feeds.noc, 'today_recovered');
    const items: DecisionInboxItem[] = [
      { key: 'incident_review', label: 'Incident Review (미복구)', type: 'operations', priority: 'critical', count: incidents != null && recovered != null ? Math.max(0, incidents - recovered) : null },
      { key: 'settlement_review_held', label: 'Settlement Review (Held)', type: 'financial', priority: 'high', count: numAt(feeds.settlementKpi, 'held_count') },
      { key: 'settlement_review_verification', label: 'Settlement Review (계좌 검증 실패)', type: 'financial', priority: 'high', count: numAt(feeds.settlementKpi, 'verification_failed_count') },
      { key: 'artist_review', label: 'New Artist Review (승인 대기)', type: 'music', priority: 'medium', count: numAt(feeds.artist, 'pending') },
      { key: 'command_review', label: 'Pending Command Review (0479)', type: 'review', priority: 'medium', count: feeds.actionHistory == null ? null : feeds.actionHistory.filter((r) => r.status === 'pending').length },
      { key: 'enterprise_review', label: 'Enterprise Resilience Review', type: 'enterprise', priority: 'medium', count: numAt(feeds.resilience, 'pending_human_reviews') },
      { key: 'playlist_review', label: 'Playlist Review (제안 상태)', type: 'music', priority: 'low', count: feeds.playlist == null ? null : feeds.playlist.filter((r) => r.state === 'proposed' || r.state === 'pending').length },
      { key: 'policy_review', label: 'Policy Suggestion Review', type: 'policy', priority: 'low', count: null },
      { key: 'security_review', label: 'Security Review', type: 'security', priority: 'high', count: null },
    ];
    return items;
  }, [feeds]);

  const inbox = useMemo(() => buildDecisionInbox(reviewItems), [reviewItems]);
  const analytics = useMemo(() => summarizeDecisionAnalytics(feeds.actionHistory), [feeds]);
  const history = useMemo(() => filterDecisionHistory(feeds.actionHistory), [feeds]);
  const selected = useMemo(() => recos.items.find((r) => r.id === selReco) ?? null, [recos, selReco]);
  const detail = useMemo(() => (selected == null ? null : buildDecisionDetail(selected)), [selected]);

  const summaryLines = useMemo(() => {
    const held = numAt(feeds.settlementKpi, 'held_count');
    const verif = numAt(feeds.settlementKpi, 'verification_failed_count');
    const playlistReviews = feeds.playlist == null ? null : feeds.playlist.filter((r) => r.state === 'proposed' || r.state === 'pending').length;
    const anyObserved = reviewItems.some((i) => i.count != null);
    return buildDecisionSummaryLines({
      totalPending: anyObserved ? inbox.totalPending : null,
      settlementReviews: held != null && verif != null ? held + verif : held ?? verif,
      playlistReviews,
      policyReviews: null,
      criticalCount: anyObserved ? inbox.criticalCount : null,
    });
  }, [feeds, inbox, reviewItems]);

  if (loading) return <AdminCard title="Decision & Review Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Decision & Review Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const priorityTone = (p: string) => (p === 'critical' ? 'danger' : p === 'high' ? 'warning' : 'neutral') as 'danger' | 'warning' | 'neutral';
  const recoSelect = (
    <select value={selReco} onChange={(e) => setSelReco(e.target.value)} className="min-w-[240px] rounded-md border border-border bg-transparent px-2 py-1 text-[11px]">
      <option value="">Recommendation 선택</option>
      {recos.items.slice(0, 100).map((r) => <option key={`${r.source}-${r.id}`} value={r.id}>[{r.source}] {r.title} · {r.status}</option>)}
    </select>
  );

  return (
    <AdminCard
      title="Decision & Review Center"
      subtitle="Enterprise 전역 Review·Recommendation·Advisory·Incident·Approval·Policy 통합 Human Decision Layer — AI 는 근거 제시, 결정은 사람"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 기존 AI 가 생성한 제안과 검토 요청을 사람이 한 화면에서 검토·결정하도록 통합하는 Human Decision Layer 입니다. 신규 Decision Engine·Recommendation Engine 은 만들지 않았고, AI 는 Recommend/Explain/Summarize/Highlight Risk 만 수행합니다. Approve/Reject/Request Changes/Escalate/Defer 는 사람의 행위이며 기존 0479 레지스트리에 감사 기록됩니다. 자동 승인·자동 거절·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·자동 Production Apply·새 AI Decision 생성은 수행하지 않습니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'inbox' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Box label="Pending Total" value={NUM(inbox.totalPending)} />
            <Box label="Critical" value={NUM(inbox.criticalCount)} />
            <Box label="관측 항목" value={NUM(inbox.queue.length)} />
            <Box label="미관측 항목" value={NUM(inbox.excludedUnobserved.length)} />
          </div>
          {inbox.queue.length === 0
            ? <AdminEmpty title="결정 대기 없음" description="관측된 피드 기준 대기 항목이 없습니다." />
            : inbox.queue.map((q) => (
              <div key={q.key} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone={priorityTone(q.priority)}>{q.priority}</AdminBadge>
                  <AdminBadge tone="neutral">{q.type}</AdminBadge>
                  <span className="truncate text-xs font-bold">{q.label}</span>
                </div>
                <span className="shrink-0 text-xs font-bold">{NUM(q.count)}건</span>
              </div>
            ))}
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — 해당 항목은 미관측으로만 표시됩니다.`} />
          )}
          <p className="text-[11px] text-muted-foreground">미관측 항목(피드 부재/실패, 0 조작 없음): {inbox.excludedUnobserved.join(', ') || '없음'}</p>
        </div>
      )}

      {tab === 'reviews' && (
        <div className="space-y-2">
          {reviewItems.map((q) => (
            <div key={q.key} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={priorityTone(q.priority)}>{q.priority}</AdminBadge>
                <span className="truncate text-xs font-bold">{q.label}</span>
              </div>
              <span className="shrink-0 text-xs font-bold">{q.count == null ? '미관측' : `${NUM(q.count)}건`}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">AI 가 요청한 검토 항목의 통합 조회 — 실제 검토/승인은 각 기존 화면 절차로 수행됩니다.</p>
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="space-y-2">
          {recos.items.length === 0
            ? <AdminEmpty title="Recommendation 없음" description="관측된 원장에 표시할 Recommendation 이 없습니다." />
            : recos.items.slice(0, 30).map((r) => (
              <div key={`${r.source}-${r.id}`} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone="neutral">{r.source}</AdminBadge>
                  <span className="truncate text-xs font-bold">{r.title}</span>
                  <AdminBadge tone="neutral">{r.status}</AdminBadge>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">conf {r.confidence == null ? '미관측' : r.confidence} · evidence {r.evidenceCount}</span>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">기존 원장 통합 조회(0481/0503/0502/0484) — 새 Recommendation Engine 없음. 미관측 소스: {recos.unobservedSources.join(', ') || '없음'}</p>
        </div>
      )}

      {tab === 'detail' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">{recoSelect}</div>
          {detail == null
            ? <AdminEmpty title="선택 없음" description="Recommendation 을 선택하면 Source/Reason/Evidence/Confidence/Risk 를 원본 그대로 표시합니다." />
            : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Box label="Source" value={detail.source} />
                <Box label="Related Data" value={detail.relatedData} />
                <Box label="Confidence" value={detail.confidence == null ? `미관측 — ${detail.confidenceNote}` : `${detail.confidence} (${detail.confidenceNote})`} />
                <Box label="Risk" value={detail.risk == null ? `미관측 — ${detail.riskNote}` : `${detail.risk} (${detail.riskNote})`} />
                <Box label="Evidence" value={detail.evidencePresent ? `${detail.evidenceCount}건` : 'Evidence 없음(원본 그대로)'} />
                <Box label="Human Actions" value={detail.humanActions.join(' / ')} />
                <div className="rounded-lg border border-border p-2 md:col-span-2">
                  <div className="text-[10px] text-muted-foreground">Reason</div>
                  <div className="text-xs">{detail.reason}</div>
                </div>
              </div>
            )}
          <div className="flex flex-wrap items-center gap-2">
            {reasonInput}
            {btn('Approve 기록', () => recordDecision('approve', selReco), true)}
            {btn('Reject 기록', () => recordDecision('reject', selReco))}
            {btn('Request Changes', () => recordDecision('request_changes', selReco))}
            {btn('Escalate', () => recordDecision('escalate', selReco))}
            {btn('Defer', () => recordDecision('defer', selReco))}
          </div>
          <p className="text-[11px] text-muted-foreground">버튼은 사람이 내린 결정을 감사 로그(0479 decision_*)에 기록할 뿐이며, AI 는 Approve 를 실행하지 않습니다. 실제 승인/지급/계약은 각 기존 화면 절차로 수행됩니다.</p>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-2">
          {history.length === 0
            ? <AdminEmpty title="Decision History 없음" description="decision_* 감사 기록이 아직 없습니다." />
            : history.slice(0, 30).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone="neutral">{r.command_type.replace(DECISION_COMMAND_PREFIX, '')}</AdminBadge>
                  <span className="truncate text-xs">{r.reason ?? '—'}</span>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{r.requested_by_name ?? '—'} · {new Date(r.requested_at).toLocaleString('ko-KR')} · {r.status}</span>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">Decision/Reviewer/Timestamp/Result/Evidence(사유) — 전부 기존 0479 레지스트리에 저장됩니다(신규 감사 테이블 없음).</p>
        </div>
      )}

      {tab === 'analytics' && (
        analytics == null
          ? <AdminEmpty title="Analytics 미관측" description="0479 감사 피드가 관측되지 않아 집계를 지어내지 않습니다." />
          : (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Box label="Total Decisions" value={NUM(analytics.totalDecisions)} />
                <Box label="Pending" value={NUM(analytics.pending)} />
                <Box label="Approved" value={NUM(analytics.approved)} />
                <Box label="Rejected" value={NUM(analytics.rejected)} />
                <Box label="Deferred" value={NUM(analytics.deferred)} />
                <Box label="Escalated" value={NUM(analytics.escalated)} />
                <Box label="Request Changes" value={NUM(analytics.requestChanges)} />
                <Box label="Avg Review / Approval (분)" value={`${analytics.avgReviewMinutes == null ? '측정 불가' : analytics.avgReviewMinutes} / ${analytics.avgApprovalMinutes == null ? '측정 불가' : analytics.avgApprovalMinutes}`} />
              </div>
              <p className="text-[11px] text-muted-foreground">평균 시간은 duration 이 측정된 완료 건({NUM(analytics.measuredCount)}건)만 사용 — 측정 불가 시 null(조작 없음).</p>
            </div>
          )
      )}

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {summaryLines.map((line, i) => <p key={i} className="text-xs">{line}</p>)}
          </div>
          <p className="text-[11px] text-muted-foreground">관측값 기반 결정적 요약(5줄 이내) — 판단/예측/승인 아님. 미관측 값은 수치를 지어내지 않습니다.</p>
        </div>
      )}

      {tab === 'oversight' && (
        <div className="space-y-1">
          {DECISION_OVERSIGHT_MATRIX.map((e) => (
            <div key={e.capability} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={e.level === 'ai_allowed' ? 'success' : e.level === 'human_only' ? 'warning' : 'danger'}>{e.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{e.capability}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{e.note}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">AI 는 Recommend/Explain/Summarize/Highlight Risk 만 수행하며 Approve/Reject/Execute 는 수행하지 않습니다. Human Decision 5종({HUMAN_DECISION_ACTIONS.join('/')})은 전부 사람의 행위입니다.</p>
        </div>
      )}

      {tab === 'limitations' && (
        <ul className="list-disc space-y-1 pl-4">
          {KNOWN_LIMITATIONS.map((l, i) => <li key={i} className="text-[11px] text-muted-foreground">{l}</li>)}
        </ul>
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
