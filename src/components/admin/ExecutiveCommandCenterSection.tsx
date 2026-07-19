/**
 * ExecutiveCommandCenterSection — Enterprise E-1 (Executive Command Center).
 *
 * 기존 Intelligence/KPI/Audit 를 하나의 운영 화면으로 통합하는 Command Layer.
 * 신규 Intelligence Engine/Migration/RPC 없음 — 기존 adminApi wrapper 만 재사용.
 * Executive Action(Review/Approval/Reject/Feedback/Export/Report)은 0479
 * Action Center 레지스트리(admin_action_register/complete/history)로 감사 기록.
 * AI 는 Review/Approval/Reject/Feedback 을 요청만 한다 — 승인·지급·계약·배포는 사람.
 * (기존 EnterpriseCommandCenterPanel(AdminPage B2B 계층)과 별개, 미접촉)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, Bot, ClipboardList, Gauge, Grid3x3, History,
  Inbox, LayoutDashboard, Lightbulb, Lock, RefreshCw, Scale, Shield, ThumbsUp,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty } from '@/components/admin/ui';
import { toast } from '@/store/toastStore';
import {
  fetchBusinessSummary, fetchRevenueSummary, fetchRevenueForecast, fetchRevenueBreakdown,
  fetchArtistSummary, fetchArtistBreakdown, fetchStreamingSummary, fetchNocKpi,
  fetchSelfHealingSummary, fetchReadableSettlementKpi, fetchCostSnapshots,
  fetchEnterpriseResilienceSummary, fetchActionHistory, fetchEnterpriseResilienceAudit,
  registerActionCommand, completeActionCommand,
  type ActionHistoryRow, type EnterpriseResilienceEventRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import {
  EXECUTIVE_COMMAND_SUPPORT_MATRIX, EXECUTIVE_FEED_KEYS,
  buildAdvisorBrief, buildExecutiveActionQueue, buildExecutiveKpis, buildExecutiveSummaryCard,
  computeEnterpriseHealth, computeObservationCoverage, deriveExecutiveAlerts,
  deriveObservedHealthDomains, emptyExecutiveFeeds, mergeExecutiveTimeline, numAt,
  validateExecutiveAuditAction,
  type ExecutiveActionType, type ExecutiveFeeds, type ExecutiveQueueItem, type FeedRecord,
} from '@/lib/executiveCommandCenter';

const NUM = (n: number | string | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('ko-KR'));

type Tab = 'summary' | 'kpi' | 'alerts' | 'timeline' | 'reviews' | 'approvals'
  | 'health' | 'advisor' | 'audit' | 'support' | 'limitations';
const TABS: { key: Tab; label: string; icon: typeof LayoutDashboard }[] = [
  { key: 'summary', label: 'Executive Summary', icon: LayoutDashboard },
  { key: 'kpi', label: 'KPI', icon: Gauge },
  { key: 'alerts', label: 'Alerts', icon: Bell },
  { key: 'timeline', label: 'Timeline', icon: History },
  { key: 'reviews', label: 'Reviews', icon: Inbox },
  { key: 'approvals', label: 'Approvals', icon: ThumbsUp },
  { key: 'health', label: 'Health', icon: Scale },
  { key: 'advisor', label: 'AI Advisor', icon: Bot },
  { key: 'audit', label: 'Audit', icon: ClipboardList },
  { key: 'support', label: 'Support Matrix', icon: Grid3x3 },
  { key: 'limitations', label: 'Known Limitations', icon: Shield },
];

const KNOWN_LIMITATIONS = [
  '신규 Intelligence Engine/추천 알고리즘/Music Engine 생성 없음 — 이 화면은 기존 관측 데이터를 통합하는 Command Layer 입니다',
  '자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·Production Apply 없음 — AI 는 Review/Approval/Reject/Feedback 을 요청만 합니다',
  '신규 Migration/RPC 없음 — Executive Action 감사 기록은 기존 0479 admin_action_register/complete/history 를 재사용합니다',
  'AI Confidence 는 피드 관측 커버리지(관측 13종 중 성공 수)이며 모델 신뢰도가 아닙니다',
  'Enterprise Health Score ≠ 실제 상태 보장 — 관측 도메인 <4 이면 insufficient_data, 미관측 도메인이 있으면 excellent 승격 차단',
  'Security/Compliance 도메인은 이 화면에 연결된 실시간 피드가 없어 항상 미관측으로 표시됩니다(조작 없음)',
  'Queue Health/오늘 단위 QC 실패/오늘 승인 완료 수/실제 청구 비용 피드 부재(실측) — insufficient_data 로만 노출',
  'Advisor 3줄 요약은 관측값 기반 결정적 문장 생성이며 판단/예측이 아닙니다 — 미관측 값은 수치를 지어내지 않습니다',
  'Migration 0472~0564 production 미적용 — 해당 Intelligence 피드는 적용 전까지 미관측으로 나타날 수 있습니다',
  '브라우저 실측 미검증 — UI 는 타입/린트/빌드/단위 테스트 기준으로만 검증했습니다',
];

const FEED_FETCHERS: Record<(typeof EXECUTIVE_FEED_KEYS)[number], () => Promise<unknown>> = {
  business: () => fetchBusinessSummary(),
  revenue: () => fetchRevenueSummary(),
  revenueForecast: () => fetchRevenueForecast(),
  revenueBreakdown: () => fetchRevenueBreakdown(),
  artist: () => fetchArtistSummary(),
  artistBreakdown: () => fetchArtistBreakdown(),
  streaming: () => fetchStreamingSummary(),
  noc: () => fetchNocKpi(),
  selfHealing: () => fetchSelfHealingSummary(),
  settlementKpi: () => {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return fetchReadableSettlementKpi(month);
  },
  costSnapshots: () => fetchCostSnapshots(100),
  resilience: () => fetchEnterpriseResilienceSummary(),
  actionHistory: () => fetchActionHistory(80),
};

export default function ExecutiveCommandCenterSection() {
  const [tab, setTab] = useState<Tab>('summary');
  const [feeds, setFeeds] = useState<ExecutiveFeeds>(emptyExecutiveFeeds());
  const [resilienceAudit, setResilienceAudit] = useState<EnterpriseResilienceEventRow[]>([]);
  const [failedFeeds, setFailedFeeds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<AdminError | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const results = await Promise.allSettled(EXECUTIVE_FEED_KEYS.map((k) => FEED_FETCHERS[k]()));
      const next = emptyExecutiveFeeds();
      const failed: string[] = [];
      EXECUTIVE_FEED_KEYS.forEach((k, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value != null) {
          // 각 피드는 기존 wrapper 반환값 그대로 — 모듈에서 유한 숫자만 선택적으로 읽는다
          (next as unknown as Record<string, unknown>)[k] = r.value as FeedRecord | FeedRecord[];
        } else {
          failed.push(k);
        }
      });
      const audit = await fetchEnterpriseResilienceAudit(60).catch(() => [] as EnterpriseResilienceEventRow[]);
      setFeeds(next); setFailedFeeds(failed); setResilienceAudit(audit);
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
  /** Executive Action 감사 기록 — 0479 레지스트리 재사용. 실행이 아니라 사람 행위의 기록이다. */
  const recordExec = (type: ExecutiveActionType, target: string, ok: string) => {
    const v = validateExecutiveAuditAction(type);
    if (!v.ok) { toast.error(v.reason); return; }
    const r = needReason();
    if (!r) return;
    void act(async () => {
      const reg = await registerActionCommand({
        commandType: `executive_${type}`, targetType: 'executive_command_center', targetId: target || null, reason: r, approved: true,
      });
      await completeActionCommand(reg.command_id, 'success').catch(() => {});
    }, ok);
  };

  const kpis = useMemo(() => buildExecutiveKpis(feeds), [feeds]);
  const alertsRes = useMemo(() => deriveExecutiveAlerts(feeds), [feeds]);
  const health = useMemo(() => computeEnterpriseHealth({
    observedDomains: deriveObservedHealthDomains(feeds), alerts: alertsRes.alerts,
  }), [feeds, alertsRes]);
  const coverage = useMemo(() => computeObservationCoverage(feeds), [feeds]);

  const queueRes = useMemo(() => {
    const incidents = numAt(feeds.noc, 'today_incidents');
    const recovered = numAt(feeds.noc, 'today_recovered');
    const actionRows = feeds.actionHistory;
    const items: ExecutiveQueueItem[] = [
      { key: 'incident_review', label: 'Review Incident (미복구)', priority: 'critical', requestType: 'review', count: incidents != null && recovered != null ? Math.max(0, incidents - recovered) : null },
      { key: 'settlement_held', label: 'Review Settlement (Held)', priority: 'high', requestType: 'review', count: numAt(feeds.settlementKpi, 'held_count') },
      { key: 'settlement_verification_failed', label: 'Review Settlement (계좌 검증 실패)', priority: 'high', requestType: 'review', count: numAt(feeds.settlementKpi, 'verification_failed_count') },
      { key: 'artist_approvals', label: 'Review New Artist (승인 대기)', priority: 'medium', requestType: 'approval', count: numAt(feeds.artist, 'pending') },
      { key: 'pending_commands', label: 'Review Pending Commands (0479)', priority: 'medium', requestType: 'review', count: actionRows == null ? null : actionRows.filter((r) => r.status === 'pending').length },
      { key: 'resilience_reviews', label: 'Review Enterprise Resilience', priority: 'medium', requestType: 'review', count: numAt(feeds.resilience, 'pending_human_reviews') },
      { key: 'contract_review', label: 'Review Contract', priority: 'high', requestType: 'review', count: null },
      { key: 'policy_review', label: 'Review Enterprise Policy', priority: 'low', requestType: 'review', count: null },
    ];
    return buildExecutiveActionQueue(items);
  }, [feeds]);

  const queueObserved = feeds.actionHistory != null || feeds.artist != null || feeds.settlementKpi != null || feeds.noc != null || feeds.resilience != null;
  const card = useMemo(() => buildExecutiveSummaryCard({
    feeds, health, alerts: alertsRes.alerts, queueTotal: queueObserved ? queueRes.totalPending : null,
  }), [feeds, health, alertsRes, queueRes, queueObserved]);

  const timeline = useMemo(() => {
    const actionRows = (feeds.actionHistory ?? []) as unknown as ActionHistoryRow[];
    const recent = (feeds.revenue?.recent ?? []) as Array<Record<string, unknown>>;
    return mergeExecutiveTimeline([
      {
        source: 'action_center',
        events: actionRows.map((r) => ({ at: r.requested_at, label: r.command_type, detail: `${r.target_type} · ${r.status}` })),
      },
      {
        source: 'subscription_payment',
        events: Array.isArray(recent) ? recent.map((p) => ({
          at: typeof p.paid_at === 'string' ? p.paid_at : null,
          label: 'Subscription Payment',
          detail: `${String(p.subscription_type ?? '')} · ${NUM(typeof p.amount === 'number' ? p.amount : null)}원`,
        })) : [],
      },
      {
        source: 'resilience_audit',
        events: resilienceAudit.map((e) => ({ at: e.created_at, label: e.event_type, detail: e.detail ?? '' })),
      },
    ], 60);
  }, [feeds, resilienceAudit]);

  const brief = useMemo(() => buildAdvisorBrief({
    overall: health.overall,
    criticalAlerts: alertsRes.alerts.filter((a) => a.priority === 'critical').length,
    todayApprovedArtists: numAt(feeds.artist, 'pending'),
    pendingSettlements: numAt(feeds.settlementKpi, 'month_payable_total'),
    offlineStores: numAt(feeds.noc, 'offline_stores'),
    incidents: numAt(feeds.noc, 'today_incidents'),
    recovered: numAt(feeds.noc, 'today_recovered'),
  }), [health, alertsRes, feeds]);

  const executiveAudit = useMemo(() => {
    const rows = (feeds.actionHistory ?? []) as unknown as ActionHistoryRow[];
    return rows.filter((r) => r.command_type.startsWith('executive_'));
  }, [feeds]);

  if (loading) return <AdminCard title="Executive Command Center"><div className="py-10 text-center text-xs text-muted-foreground">불러오는 중…</div></AdminCard>;
  if (err) return (
    <AdminCard title="Executive Command Center">
      <AdminAlert tone="danger" title="불러오기 실패" description={err.message} action={<button onClick={() => void load()} className="text-[11px] font-bold underline">재시도</button>} />
    </AdminCard>
  );

  const reasonInput = <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="사유(필수)" className="min-w-[180px] flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-[11px]" />;
  const btn = (label: string, onClick: () => void, primary = false) => (
    <button disabled={busy} onClick={onClick} className={primary ? 'rounded-md bg-accent px-2 py-1 text-[11px] font-bold text-black disabled:opacity-50' : 'rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted disabled:opacity-50'}>{label}</button>
  );
  const healthBadgeTone = (r: string) => (r === 'excellent' || r === 'healthy' ? 'success' : r === 'warning' ? 'warning' : r === 'critical' ? 'danger' : 'neutral') as 'success' | 'warning' | 'danger' | 'neutral';
  const priorityTone = (p: string) => (p === 'critical' ? 'danger' : p === 'high' ? 'warning' : 'neutral') as 'danger' | 'warning' | 'neutral';

  return (
    <AdminCard
      title="Executive Command Center"
      subtitle="Enterprise 전체 상태를 하나의 화면에서 — 기존 Intelligence 통합 관측 계층 (신규 Engine/자동 승인 없음)"
      action={<button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-bold hover:bg-muted"><RefreshCw size={12} /> 새로고침</button>}
    >
      <div className="mb-3">
        <AdminAlert tone="warning" icon={<Lock size={14} />}
          description="이 센터는 기존 AI-OPS Intelligence·KPI·Audit 를 재사용해 CEO/운영자가 회사 상태를 한 화면에서 파악하도록 통합하는 Command Layer 입니다. 신규 Intelligence Engine·추천 알고리즘·Music Engine 은 만들지 않으며, AI 는 Review/Approval/Reject/Feedback 을 요청만 합니다. 자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·Production Apply 는 수행하지 않습니다. 모든 Executive Action 은 기존 0479 Action Center 레지스트리에 감사 기록됩니다. 승인과 최종 의사결정은 사람이 내립니다." />
      </div>

      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => { const Icon = t.icon; const active = tab === t.key; return (
          <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${active ? 'bg-accent text-black' : 'text-muted-foreground hover:bg-muted'}`}><Icon size={12} /> {t.label}</button>
        ); })}
      </div>

      {tab === 'summary' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <Box label="Enterprise Health" value={card.enterpriseHealth} />
            <Box label="Active Alerts" value={NUM(card.activeAlerts)} />
            <Box label="Critical Issues" value={NUM(card.criticalIssues)} />
            <Box label="Pending Reviews" value={NUM(card.pendingReviews)} />
            <Box label="Today's KPI (Revenue)" value={`${NUM(card.todayKpi)}원`} />
            <Box label="Revenue Snapshot (월)" value={`${NUM(card.revenueSnapshot)}원`} />
            <Box label="Active Stores (online)" value={NUM(card.activeStores)} />
            <Box label="Active Artists" value={NUM(card.activeArtists)} />
            <Box label="Platform Status" value={card.platformStatus} />
            <Box label="AI Confidence (관측 커버리지)" value={`${NUM(card.aiConfidence)}%`} />
          </div>
          {failedFeeds.length > 0 && (
            <AdminAlert tone="warning" icon={<AlertTriangle size={14} />} description={`관측 실패 피드 ${failedFeeds.length}종: ${failedFeeds.join(', ')} — 해당 지표는 insufficient_data 로 표시됩니다(0 치환 없음).`} />
          )}
          <p className="text-[11px] text-muted-foreground">AI Confidence 는 피드 관측 커버리지({coverage.observed}/{coverage.total})이며 모델 신뢰도가 아닙니다. Health ≠ 실제 상태 보장.</p>
        </div>
      )}

      {tab === 'kpi' && (
        <div className="space-y-3">
          {(['business', 'platform', 'music', 'financial', 'operations'] as const).map((group) => (
            <div key={group}>
              <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{group}</div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {kpis.filter((k) => k.group === group).map((k) => (
                  <div key={k.key} className="rounded-lg border border-border p-2">
                    <div className="text-[10px] text-muted-foreground">{k.label}</div>
                    <div className="text-sm font-bold">{k.value == null ? '미관측' : `${NUM(k.value)}${k.unit === '%' ? '%' : ''}`}</div>
                    <div className="text-[10px] text-muted-foreground">{k.note}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'alerts' && (
        <div className="space-y-2">
          {alertsRes.alerts.length === 0
            ? <AdminEmpty title="Alert 없음" description="관측된 피드 기준 활성 Alert 가 없습니다 (미관측 카테고리는 아래 참조)." />
            : alertsRes.alerts.map((a) => (
              <div key={a.key} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone={priorityTone(a.priority)}>{a.priority}</AdminBadge>
                  <AdminBadge tone="neutral">{a.category}</AdminBadge>
                  <span className="truncate text-xs font-bold">{a.message}</span>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{a.evidence}</span>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">미관측 카테고리(조작 없음): {alertsRes.unobservedCategories.length > 0 ? alertsRes.unobservedCategories.join(', ') : '없음'}</p>
        </div>
      )}

      {tab === 'timeline' && (
        <div className="space-y-2">
          {timeline.events.length === 0
            ? <AdminEmpty title="Timeline 없음" description="관측된 이벤트 소스에 표시할 이력이 없습니다." />
            : timeline.events.map((e, i) => (
              <div key={`${e.at}-${e.label}-${i}`} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Activity size={12} className="shrink-0 text-muted-foreground" />
                  <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(e.at).toLocaleString('ko-KR')}</span>
                  <span className="truncate text-xs font-bold">{e.label}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{e.detail}</span>
                  <AdminBadge tone="neutral">{e.source}</AdminBadge>
                </div>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">소스: {timeline.observedSources.join(', ')} · timestamp 불량 drop {NUM(timeline.droppedInvalid)}건 (조작 없이 제외)</p>
        </div>
      )}

      {tab === 'reviews' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reasonInput}
            {btn('Review 기록(감사)', () => recordExec('review', 'review_queue', 'Executive Review 기록 완료'), true)}
            {btn('Feedback 기록', () => recordExec('feedback', 'review_queue', 'Executive Feedback 기록 완료'))}
          </div>
          {queueRes.queue.length === 0
            ? <AdminEmpty title="검토 대기 없음" description="관측된 피드 기준 대기 항목이 없습니다." />
            : queueRes.queue.map((q) => (
              <div key={q.key} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone={priorityTone(q.priority)}>{q.priority}</AdminBadge>
                  <span className="truncate text-xs font-bold">{q.label}</span>
                  <AdminBadge tone="neutral">{q.requestType}</AdminBadge>
                </div>
                <span className="shrink-0 text-xs font-bold">{NUM(q.count)}건</span>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">미관측 항목(제외 공개): {queueRes.excludedUnobserved.length > 0 ? queueRes.excludedUnobserved.join(', ') : '없음'} · AI 는 요청만 하며 승인하지 않습니다.</p>
        </div>
      )}

      {tab === 'approvals' && (
        <div className="space-y-2">
          <AdminAlert tone="warning" description="AI 는 승인하지 않습니다. 아래 버튼은 사람이 내린 Approval/Reject 결정을 감사 로그(0479)에 참조 기록할 뿐이며, 실제 승인/지급/계약은 각 기존 화면의 절차로 수행됩니다." />
          <div className="flex flex-wrap items-center gap-2">
            {reasonInput}
            {btn('Approval 참조 기록', () => recordExec('approval', 'human_decision', 'Approval 참조 기록 완료'), true)}
            {btn('Reject 참조 기록', () => recordExec('reject', 'human_decision', 'Reject 참조 기록 완료'))}
          </div>
          {queueRes.queue.filter((q) => q.requestType === 'approval').map((q) => (
            <div key={q.key} className="flex items-center justify-between rounded-lg border border-border p-2">
              <span className="text-xs font-bold">{q.label}</span>
              <span className="text-xs font-bold">{NUM(q.count)}건</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">자동 승인·자동 계약 승인·자동 지급·자동 Merge·자동 Deploy·Production Apply 는 차단 목록입니다.</p>
        </div>
      )}

      {tab === 'health' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <AdminBadge tone={healthBadgeTone(health.overall)}>{health.overall}</AdminBadge>
            <span className="text-xs font-bold">Overall {health.overallScore == null ? '—' : `${health.overallScore}점`}</span>
            <span className="text-[11px] text-muted-foreground">관측 도메인 {health.observedCount}/8</span>
          </div>
          {health.capped && <AdminAlert tone="warning" description={`과단정 방지: ${health.cappedReason}`} />}
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {health.domains.map((d) => (
              <div key={d.domain} className="rounded-lg border border-border p-2">
                <div className="text-[10px] text-muted-foreground">{d.domain}</div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{d.score == null ? '미관측' : `${d.score}점`}</span>
                  <AdminBadge tone={healthBadgeTone(d.result)}>{d.result}</AdminBadge>
                </div>
                <div className="text-[10px] text-muted-foreground">Alert {NUM(d.alertCount)}건</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Health Score ≠ 실제 상태 보장 — 관측된 Alert 의 감점 합산이며, 미관측 도메인은 점수를 부여하지 않습니다.</p>
        </div>
      )}

      {tab === 'advisor' && (
        <div className="space-y-2">
          <div className="rounded-lg border border-border p-3">
            {brief.map((line, i) => (
              <p key={i} className="flex items-start gap-2 text-xs"><Lightbulb size={12} className="mt-0.5 shrink-0 text-muted-foreground" /> {line}</p>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">이 요약은 관측값 기반 결정적 문장 생성입니다 — 요약 ≠ 판단, 예측/승인 아님. 미관측 값은 수치를 지어내지 않습니다.</p>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {reasonInput}
            {btn('Export 기록', () => recordExec('export', 'summary_export', 'Export 감사 기록 완료'))}
            {btn('Report 기록', () => recordExec('report', 'executive_report', 'Report 감사 기록 완료'))}
          </div>
          {executiveAudit.length === 0
            ? <AdminEmpty title="Executive Action 없음" description="executive_* 감사 기록이 아직 없습니다." />
            : executiveAudit.slice(0, 30).map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-border p-2">
                <div className="flex min-w-0 items-center gap-2">
                  <AdminBadge tone="neutral">{r.command_type.replace('executive_', '')}</AdminBadge>
                  <span className="truncate text-xs">{r.reason ?? '—'}</span>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{new Date(r.requested_at).toLocaleString('ko-KR')} · {r.status}</span>
              </div>
            ))}
          <p className="text-[11px] text-muted-foreground">Review/Approval/Reject/Feedback/Export/Report 전부 0479 Action Center 레지스트리에 남습니다(신규 감사 테이블 없음).</p>
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-1">
          {EXECUTIVE_COMMAND_SUPPORT_MATRIX.map((s) => (
            <div key={s.feature} className="flex items-center justify-between rounded-lg border border-border p-2">
              <div className="flex min-w-0 items-center gap-2">
                <AdminBadge tone={s.level === 'available' ? 'success' : s.level === 'human_review_only' ? 'warning' : s.level === 'unavailable' ? 'danger' : 'neutral'}>{s.level}</AdminBadge>
                <span className="truncate text-xs font-bold">{s.feature}</span>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground">{s.note}</span>
            </div>
          ))}
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
