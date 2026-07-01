/**
 * EnterpriseOperationsPanel — Phase 2-1 (Enterprise Operations Center)
 *
 * `/admin → 운영 관제` 탭.
 * Super admin 전용 read-only 관제 대시보드.
 *
 * 구성 (위→아래):
 *   1. 상단 헤더 (전체 상태 pill + 마지막 cron / refresh / auto-poll 토글)
 *   2. Enterprise Health Overview — KPI 그리드
 *   3. Cron Monitor Card
 *   4. NOC Dashboard Card + Notification Dashboard Card (2열)
 *   5. Policy Automation Card + Drift Monitor Card (2열)
 *   6. Activity Feed
 *   7. Quick Actions (전부 disabled — Phase 2-2 예정)
 *
 * 절대 무수정:
 *   기존 cron / NOC / dispatch / 자동화 로직 무관. 이 컴포넌트는 read-only.
 *   실시간 subscription 없음. 30s 또는 60s polling (기본 60s).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, Bell, Building2, CheckCircle2, Clock, Database,
  Download, PlayCircle, RefreshCw, ScrollText, ShieldCheck, TimerReset, Users, Wifi, WifiOff,
} from 'lucide-react';
import {
  AdminSection, AdminCard, AdminStatCard, AdminBadge, AdminButton,
  AdminAlert, AdminEmpty, AdminSkeleton, AdminTooltip, AdminModal,
} from '@/components/admin/ui';
import {
  fetchEnterpriseOpsOverview, fetchEnterpriseOpsCronStatus,
  fetchEnterpriseOpsNotificationsSummary, fetchEnterpriseOpsActivityFeed,
  runEnterpriseOpsCron, dispatchPendingNotifications, recalculateNoc,
  refreshPolicyAutomation, exportCronLogs, downloadLogsAsCsv,
  type EnterpriseOpsOverview, type EnterpriseOpsCronStatus,
  type EnterpriseOpsNotificationsSummary, type EnterpriseOpsActivityFeed,
  type EnterpriseOpsActivityType, type QuickActionOutcome,
} from '@/lib/api/enterpriseOperationsApi';
import { toast } from '@/store/toastStore';
import {
  getNocActiveAlerts, getNocStoreHealthList,
  type NocAlert, type NocStoreHealth,
} from '@/lib/api/nocApi';
import {
  getPolicyAutomationKpi, listPolicyAutomationRuns,
  type PolicyAutomationKpi, type PolicyAutomationRun,
} from '@/lib/api/policyAutomationApi';

// 자동 폴링 옵션 — 요구사항: 30s 또는 60s 만 허용.
const POLL_OPTIONS = [
  { label: '수동', value: 0 },
  { label: '30초', value: 30_000 },
  { label: '60초', value: 60_000 },
] as const;
type PollValue = (typeof POLL_OPTIONS)[number]['value'];

const OVERALL_TONE: Record<EnterpriseOpsOverview['overall_status'],
  { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  healthy:  { tone: 'success', label: '정상' },
  warning:  { tone: 'warning', label: '주의' },
  critical: { tone: 'danger',  label: '긴급' },
};

function fmtNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('ko-KR');
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    const t = new Date(iso).getTime();
    const diff = Date.now() - t;
    if (diff < 0) return '방금';
    if (diff < 60_000) return `${Math.floor(diff / 1000)}초 전`;
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}분 전`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}시간 전`;
    return `${Math.floor(diff / 86_400_000)}일 전`;
  } catch { return '—'; }
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  } catch { return '—'; }
}

const ACTIVITY_META: Record<EnterpriseOpsActivityType,
  { label: string; icon: JSX.Element }> = {
  cron_run:            { label: 'Cron',      icon: <TimerReset size={12} /> },
  notification:        { label: '알림',       icon: <Bell size={12} /> },
  policy_automation:   { label: '정책 자동화', icon: <ShieldCheck size={12} /> },
  announcement_play:   { label: '안내음',     icon: <PlayCircle size={12} /> },
  settlement_snapshot: { label: '정산 스냅샷', icon: <Database size={12} /> },
};

function severityTone(sev: string): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  const s = sev.toLowerCase();
  if (s === 'error' || s === 'critical' || s === 'danger') return 'danger';
  if (s === 'warning' || s === 'major')                     return 'warning';
  if (s === 'success' || s === 'healthy')                   return 'success';
  if (s === 'info' || s === 'minor')                        return 'info';
  return 'neutral';
}

export default function EnterpriseOperationsPanel() {
  const [overview, setOverview] = useState<EnterpriseOpsOverview | null>(null);
  const [cron,     setCron]     = useState<EnterpriseOpsCronStatus | null>(null);
  const [notif,    setNotif]    = useState<EnterpriseOpsNotificationsSummary | null>(null);
  const [feed,     setFeed]     = useState<EnterpriseOpsActivityFeed | null>(null);
  const [nocAlerts,setNocAlerts]= useState<NocAlert[]>([]);
  const [storeHealth, setStoreHealth] = useState<NocStoreHealth[]>([]);
  const [paKpi,    setPaKpi]    = useState<PolicyAutomationKpi | null>(null);
  const [paRuns,   setPaRuns]   = useState<PolicyAutomationRun[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pollMs, setPollMs] = useState<PollValue>(0);
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ov, cr, nt, af, na, sh, pk, pr] = await Promise.all([
        fetchEnterpriseOpsOverview(),
        fetchEnterpriseOpsCronStatus(),
        fetchEnterpriseOpsNotificationsSummary(),
        fetchEnterpriseOpsActivityFeed(20),
        getNocActiveAlerts(10).catch(() => [] as NocAlert[]),
        getNocStoreHealthList({ limit: 15 }).catch(() => [] as NocStoreHealth[]),
        getPolicyAutomationKpi().catch(() => null),
        listPolicyAutomationRuns({ limit: 10 }).catch(() => ({ success: true, data: [], pagination: { total: 0, limit: 10, offset: 0, has_more: false }, computed_at: '' })),
      ]);
      setOverview(ov);
      setCron(cr);
      setNotif(nt);
      setFeed(af);
      setNocAlerts(na);
      setStoreHealth(sh);
      setPaKpi(pk);
      setPaRuns(pr.data ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Polling (30s / 60s / off) — 실시간 subscription 은 사용하지 않음
  useEffect(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (pollMs > 0) {
      timerRef.current = window.setInterval(() => void load(), pollMs);
    }
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [pollMs, load]);

  const overallMeta = overview ? OVERALL_TONE[overview.overall_status] : null;

  const nocSteps = useMemo(() => {
    const n = overview?.noc ?? {};
    return [
      { key: 'critical',              label: 'Critical',            value: n.critical              as number | undefined, tone: 'danger'  as const },
      { key: 'major',                 label: 'Major',               value: n.major                 as number | undefined, tone: 'warning' as const },
      { key: 'minor',                 label: 'Minor',               value: n.minor                 as number | undefined, tone: 'info'    as const },
      { key: 'offline',               label: 'Offline',             value: n.offline               as number | undefined, tone: 'danger'  as const },
      { key: 'policy_drift',          label: 'Policy Drift',        value: n.policy_drift          as number | undefined, tone: 'warning' as const },
      { key: 'playback_error',        label: 'Playback Error',      value: n.playback_error        as number | undefined, tone: 'danger'  as const },
      { key: 'heartbeat_missing',     label: 'Heartbeat Missing',   value: n.heartbeat_missing     as number | undefined, tone: 'warning' as const },
      { key: 'device_disconnected',   label: 'Device Disconnected', value: n.device_disconnected   as number | undefined, tone: 'danger'  as const },
      { key: 'version_update_needed', label: 'Version Update',      value: n.version_update_needed as number | undefined, tone: 'info'    as const },
    ];
  }, [overview]);

  // ── 파생: cron 단계별 상태 (details 필드에 status 요약이 있으면 사용) ──
  const cronSteps = useMemo(() => {
    const last = cron?.recent_runs?.[0];
    const details = (last?.details ?? {}) as Record<string, unknown>;
    // enterprise-ops.ts 의 admin_log_operation payload 는
    //   { policy_automation: {ok, ms}, billing_overdue: {...}, noc_alert_sync: {...}, notifications_dispatch: {...} }
    // 형태로 저장됨. 없으면 null 로 표시.
    const step = (k: string): { ok?: boolean; ms?: number } | null => {
      const v = details[k];
      if (v && typeof v === 'object') return v as { ok?: boolean; ms?: number };
      return null;
    };
    return [
      { key: 'policy_automation',      label: '정책 자동화',  step: step('policy_automation') },
      { key: 'billing_overdue',        label: '청구 연체',    step: step('billing_overdue') },
      { key: 'noc_alert_sync',         label: 'NOC 동기화',   step: step('noc_alert_sync') },
      { key: 'notifications_dispatch', label: '알림 발송',    step: step('notifications_dispatch') },
    ];
  }, [cron]);

  return (
    <AdminSection
      title={
        <span className="flex items-center gap-2">
          <Activity size={16} /> 운영 관제 (Enterprise Operations)
          {overallMeta && (
            <AdminBadge tone={overallMeta.tone} variant="subtle">{overallMeta.label}</AdminBadge>
          )}
          <AdminBadge tone="primary" variant="subtle">Phase 2-1</AdminBadge>
        </span>
      }
      description={
        <span className="flex flex-wrap items-center gap-3 text-[11px] text-ink-mute">
          <span>모든 데이터는 read-only. 실시간 subscription 없음.</span>
          <span>마지막 cron: <b className="text-ink">{fmtRelative(overview?.last_cron_run_at ?? null)}</b></span>
        </span>
      }
      action={
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11px] text-ink-mute">
            <Clock size={11} /> 자동 새로고침
            <select
              value={pollMs}
              onChange={(e) => setPollMs(Number(e.target.value) as PollValue)}
              className="rounded bg-bg-card px-1.5 py-1 text-[11px] ring-1 ring-line/20"
            >
              {POLL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <AdminButton onClick={() => void load()}>
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
          </AdminButton>
        </div>
      }
    >
      {error && (
        <AdminAlert tone="danger" title="조회 실패">
          {error}
        </AdminAlert>
      )}

      {/* ─── §1. Enterprise Health Overview ─── */}
      {loading && !overview ? (
        <AdminSkeleton variant="kpi" />
      ) : overview ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <AdminStatCard label="본사 계정"    value={fmtNumber(overview.enterprise_accounts)} tone="primary" icon={<Building2 size={14} />} />
          <AdminStatCard label="HQ 사용자"    value={fmtNumber(overview.hq_users)}            tone="info"    icon={<Users size={14} />} />
          <AdminStatCard label="전체 매장"    value={fmtNumber(overview.total_stores)}        tone="neutral" icon={<Activity size={14} />} />
          <AdminStatCard label="온라인 매장"  value={fmtNumber(overview.online_stores)}       tone="success" icon={<Wifi size={14} />} />
          <AdminStatCard label="오프라인 매장" value={fmtNumber(overview.offline_stores)}      tone="danger"  icon={<WifiOff size={14} />} />
          <AdminStatCard label="정책 미동기"  value={fmtNumber(overview.drift_stores)}        tone="warning" icon={<ShieldCheck size={14} />} />
          <AdminStatCard label="Failed Sync" value={fmtNumber(overview.failed_sync_stores)}  tone="warning" icon={<AlertTriangle size={14} />} />
          <AdminStatCard label="Critical Alerts" value={fmtNumber((overview.noc?.critical as number) ?? 0)} tone="danger"  icon={<AlertTriangle size={14} />} />
          <AdminStatCard label="Major Alerts"    value={fmtNumber((overview.noc?.major    as number) ?? 0)} tone="warning" icon={<AlertTriangle size={14} />} />
          <AdminStatCard label="Last Cron"       value={fmtRelative(overview.last_cron_run_at)}             tone="neutral" icon={<TimerReset size={14} />} />
        </div>
      ) : null}

      {/* ─── §2. Cron Monitor ─── */}
      <AdminCard title={<span className="flex items-center gap-2"><TimerReset size={13} /> Cron Monitor (enterprise-ops)</span>}>
        {!cron ? <AdminSkeleton variant="block" /> : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              <AdminStatCard label="1시간 실행"  value={fmtNumber(cron.runs_1h)}   tone="info" icon={<Activity size={12} />} />
              <AdminStatCard label="24시간 실행" value={fmtNumber(cron.runs_24h)}  tone="info" icon={<Activity size={12} />} />
              <AdminStatCard label="24시간 실패" value={fmtNumber(cron.failed_24h)} tone={cron.failed_24h > 0 ? 'danger' : 'success'} icon={<AlertTriangle size={12} />} />
              <AdminStatCard label="마지막 실행" value={fmtRelative(cron.last_run_at)} tone="neutral" icon={<Clock size={12} />} />
              <AdminStatCard label="상태" value={cron.failed_24h > 0 ? '주의' : '정상'} tone={cron.failed_24h > 0 ? 'warning' : 'success'} icon={<CheckCircle2 size={12} />} />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {cronSteps.map((s) => (
                <div key={s.key} className="rounded-xl bg-bg-card p-2.5 ring-1 ring-line/10">
                  <p className="text-[10px] uppercase tracking-wider text-ink-dim">{s.label}</p>
                  <div className="mt-1 flex items-center gap-2">
                    {s.step ? (
                      <>
                        <AdminBadge tone={s.step.ok ? 'success' : 'danger'} variant="subtle">
                          {s.step.ok ? 'OK' : 'FAIL'}
                        </AdminBadge>
                        {typeof s.step.ms === 'number' && (
                          <span className="text-[10px] text-ink-mute">{s.step.ms}ms</span>
                        )}
                      </>
                    ) : (
                      <span className="text-[10px] text-ink-dim">데이터 없음</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {cron.last_error && (
              <div className="mt-3 rounded-xl bg-rose-500/25 p-2.5 text-[11px] text-rose-100 ring-1 ring-rose-500/40">
                <b className="text-rose-50">마지막 오류:</b> <span className="font-mono">{cron.last_error}</span>
              </div>
            )}

            <details className="mt-3 group">
              <summary className="cursor-pointer text-[11px] text-ink-mute hover:text-ink">최근 실행 로그 10개 보기</summary>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-[10px] uppercase text-ink-dim">
                    <tr>
                      <th className="px-2 py-1 text-left">시각</th>
                      <th className="px-2 py-1 text-left">Level</th>
                      <th className="px-2 py-1 text-left">Status</th>
                      <th className="px-2 py-1 text-left">Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cron.recent_runs.length === 0 ? (
                      <tr><td colSpan={4} className="px-2 py-3 text-center text-ink-mute">기록 없음</td></tr>
                    ) : cron.recent_runs.map((r) => (
                      <tr key={String(r.id)} className="border-t border-line/10">
                        <td className="px-2 py-1 text-ink-mute">{fmtDateTime(r.created_at)}</td>
                        <td className="px-2 py-1">
                          <AdminBadge tone={severityTone(r.level ?? 'info')} variant="subtle">{r.level ?? 'info'}</AdminBadge>
                        </td>
                        <td className="px-2 py-1 text-ink">{r.status ?? '—'}</td>
                        <td className="px-2 py-1 text-ink-mute font-mono">{r.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </AdminCard>

      {/* ─── §3. NOC + Notification (2열) ─── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <AdminCard title={<span className="flex items-center gap-2"><AlertTriangle size={13} /> NOC Dashboard</span>}>
          {!overview ? <AdminSkeleton variant="block" /> : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {nocSteps.map((s) => (
                  <div key={s.key} className="rounded-xl bg-bg-card p-2 ring-1 ring-line/10">
                    <p className="text-[10px] text-ink-dim">{s.label}</p>
                    <p className={`mt-0.5 text-lg font-bold ${
                      s.tone === 'danger'  ? 'text-rose-300' :
                      s.tone === 'warning' ? 'text-amber-300' :
                      s.tone === 'info'    ? 'text-sky-300' : 'text-ink'
                    }`}>{fmtNumber(s.value ?? 0)}</p>
                  </div>
                ))}
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-ink-mute hover:text-ink">
                  최근 활성 알림 ({nocAlerts.length}) 보기
                </summary>
                <ul className="mt-2 space-y-1.5">
                  {nocAlerts.length === 0 ? (
                    <li className="text-[11px] text-ink-mute">활성 알림 없음</li>
                  ) : nocAlerts.slice(0, 10).map((a, idx) => (
                    <li key={`${a.store_id}:${a.category}:${idx}`} className="flex items-center justify-between gap-2 rounded-lg bg-bg-card px-2 py-1.5 text-[11px]">
                      <div className="min-w-0 flex-1 truncate">
                        <AdminBadge tone={severityTone(a.severity)} variant="subtle">{a.severity}</AdminBadge>
                        <span className="ml-1.5 font-medium text-ink">{a.message}</span>
                        {a.store_name && <span className="ml-1 text-ink-mute">· {a.store_name}</span>}
                      </div>
                      <span className="shrink-0 text-[10px] text-ink-mute">{fmtRelative(a.event_at)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </AdminCard>

        <AdminCard title={<span className="flex items-center gap-2"><Bell size={13} /> Notification Dashboard</span>}>
          {!notif ? <AdminSkeleton variant="block" /> : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <AdminStatCard label="대기"       value={fmtNumber(notif.pending)}    tone={notif.pending > 20 ? 'warning' : 'neutral'} icon={<Clock size={12} />} />
                <AdminStatCard label="발송 완료"  value={fmtNumber(notif.dispatched)} tone="success" icon={<CheckCircle2 size={12} />} />
                <AdminStatCard label="실패"       value={fmtNumber(notif.failed)}     tone={notif.failed > 0 ? 'danger' : 'success'} icon={<AlertTriangle size={12} />} />
                <AdminStatCard label="Slack 발송" value={fmtNumber(notif.slack_sent)} tone="info" icon={<Bell size={12} />} />
                <AdminStatCard label="Email 발송" value={fmtNumber(notif.email_sent)} tone="info" icon={<Bell size={12} />} />
                <AdminStatCard label="NOC Alert"  value={fmtNumber(notif.noc_alert_count)} tone="warning" icon={<AlertTriangle size={12} />} />
              </div>
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-ink-mute hover:text-ink">최근 알림 10개</summary>
                <ul className="mt-2 space-y-1.5">
                  {notif.recent.length === 0 ? (
                    <li className="text-[11px] text-ink-mute">알림 없음</li>
                  ) : notif.recent.map((n) => (
                    <li key={n.id} className="rounded-lg bg-bg-card px-2 py-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <AdminBadge tone={severityTone(n.severity)} variant="subtle">{n.severity}</AdminBadge>
                          <span className="truncate font-medium text-ink">{n.title}</span>
                        </span>
                        <span className="shrink-0 text-[10px] text-ink-mute">{fmtRelative(n.created_at)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-dim">
                        <span>{n.dispatched_at ? '✓ 발송' : '⧗ 대기'}</span>
                        {n.dispatch_slack_at && <span>Slack ✓</span>}
                        {n.dispatch_email_at && <span>Email ✓</span>}
                        {n.dispatch_error && <span className="text-rose-300 truncate">err: {n.dispatch_error}</span>}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
        </AdminCard>
      </div>

      {/* ─── §4. Policy Automation + Drift Monitor (2열) ─── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <AdminCard title={<span className="flex items-center gap-2"><ShieldCheck size={13} /> Policy Automation</span>}>
          {paKpi === null ? <AdminEmpty title="정책 자동화 조회 실패" description="policy_automation KPI RPC 접근 불가" /> : (() => {
            const total7d   = paKpi.recent_7d_runs;
            const failed7d  = paKpi.failed_runs_7d;
            const success7d = Math.max(0, total7d - failed7d);
            const successRate = total7d > 0 ? Math.round((success7d / total7d) * 100) : 0;
            const lastRunAt = paRuns[0]?.started_at ?? null;
            return (
              <>
                <div className="grid grid-cols-4 gap-2">
                  <AdminStatCard label="최근 7일 실행" value={fmtNumber(total7d)}     tone="neutral" icon={<Activity size={12} />} />
                  <AdminStatCard label="성공"        value={fmtNumber(success7d)}   tone="success" icon={<CheckCircle2 size={12} />} />
                  <AdminStatCard label="실패"        value={fmtNumber(failed7d)}    tone={failed7d > 0 ? 'danger' : 'success'} icon={<AlertTriangle size={12} />} />
                  <AdminStatCard label="성공률"      value={`${successRate}%`}      tone="info" icon={<CheckCircle2 size={12} />} />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-ink-mute">
                  <span>최근 실행: <b className="text-ink">{fmtRelative(lastRunAt)}</b></span>
                  <span>다음 예약: <b className="text-ink">{fmtDateTime(paKpi.next_run_at)}</b></span>
                </div>
                <details className="mt-3">
                  <summary className="cursor-pointer text-[11px] text-ink-mute hover:text-ink">최근 실행 10개</summary>
                  <ul className="mt-2 space-y-1">
                    {paRuns.length === 0 ? (
                      <li className="text-[11px] text-ink-mute">실행 이력 없음</li>
                    ) : paRuns.slice(0, 10).map((r) => (
                      <li key={r.id} className="flex items-center justify-between rounded-lg bg-bg-card px-2 py-1 text-[11px]">
                        <AdminBadge tone={severityTone(r.status)} variant="subtle">{r.status}</AdminBadge>
                        <span className="text-ink-mute">{fmtRelative(r.started_at)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            );
          })()}
        </AdminCard>

        <AdminCard title={<span className="flex items-center gap-2"><Wifi size={13} /> Drift Monitor (매장 상태)</span>}>
          {storeHealth.length === 0 ? (
            <AdminEmpty title="이상 매장 없음" description="NOC store health 정상" />
          ) : (
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-bg text-[10px] uppercase text-ink-dim">
                  <tr>
                    <th className="px-2 py-1 text-left">상태</th>
                    <th className="px-2 py-1 text-left">매장</th>
                    <th className="px-2 py-1 text-left">Heartbeat</th>
                    <th className="px-2 py-1 text-left">Player</th>
                  </tr>
                </thead>
                <tbody>
                  {storeHealth.slice(0, 15).map((s) => {
                    const tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' =
                      s.health_tone === 'red'    ? 'danger'
                    : s.health_tone === 'orange' ? 'warning'
                    : s.health_tone === 'yellow' ? 'info'
                    : s.health_tone === 'green'  ? 'success'
                    : 'neutral';
                    return (
                      <tr key={s.store_id} className="border-t border-line/10">
                        <td className="px-2 py-1">
                          <AdminBadge tone={tone} variant="subtle">{s.health_tone}</AdminBadge>
                        </td>
                        <td className="px-2 py-1 truncate max-w-[140px]">
                          <AdminTooltip label={s.store_id}>
                            <span>{s.store_name ?? s.store_id.slice(0, 8)}</span>
                          </AdminTooltip>
                        </td>
                        <td className="px-2 py-1 text-ink-mute">{fmtRelative(s.last_heartbeat_at)}</td>
                        <td className="px-2 py-1 text-ink-mute font-mono">{s.player_status ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      </div>

      {/* ─── §5. Activity Feed ─── */}
      <AdminCard title={<span className="flex items-center gap-2"><ScrollText size={13} /> Enterprise Activity Feed (최근 7일, 최대 20건)</span>}>
        {!feed ? <AdminSkeleton variant="block" /> : feed.events.length === 0 ? (
          <AdminEmpty title="최근 이벤트 없음" description="cron / notification / policy / announcement / settlement" />
        ) : (
          <ul className="space-y-1.5">
            {feed.events.map((e) => (
              <li key={`${e.type}:${e.id}`} className="flex items-center justify-between gap-2 rounded-lg bg-bg-card px-2 py-1.5 text-[11px] ring-1 ring-line/10">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <AdminBadge tone={severityTone(e.severity)} variant="subtle" icon={ACTIVITY_META[e.type]?.icon}>
                    {ACTIVITY_META[e.type]?.label ?? e.type}
                  </AdminBadge>
                  <span className="truncate text-ink">{e.title}</span>
                </div>
                <span className="shrink-0 text-[10px] text-ink-mute">{fmtRelative(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </AdminCard>

      {/* ─── §6. Quick Actions ─── */}
      <QuickActionsCard onAfterAction={() => void load()} />
    </AdminSection>
  );
}

// ================================================================
// Quick Actions — Phase 2-2 (Option B: 5 active, Generate Settlement disabled)
// ================================================================

type QuickActionKey =
  | 'run_cron'
  | 'dispatch_pending'
  | 'recalculate_noc'
  | 'refresh_policy'
  | 'generate_settlement'
  | 'export_logs';

interface QuickActionDef {
  key: QuickActionKey;
  label: string;
  icon: JSX.Element;
  description: string;
  scope: string;               // 영향 범위 (사용자용 설명)
  disabled?: { reason: string };
}

const QUICK_ACTIONS: QuickActionDef[] = [
  { key: 'run_cron',            label: 'Run Enterprise Cron',
    icon: <TimerReset size={12} />,
    description: '즉시 enterprise-ops cron 을 1회 실행. policy_automation / billing_overdue / noc_alert_sync / notifications_dispatch 4 단계 동시 실행.',
    scope: '전체 Enterprise + 정책 자동화 + 알림 발송' },
  { key: 'dispatch_pending',    label: 'Dispatch Pending',
    icon: <Bell size={12} />,
    description: '미발송(dispatched_at IS NULL) admin_notifications 최근 24h 를 Slack/Email 로 발송. 이미 발송된 채널은 skip (0392 멱등).',
    scope: '알림 시스템 (외부 채널 발송 발생)' },
  { key: 'recalculate_noc',     label: 'Recalculate NOC',
    icon: <AlertTriangle size={12} />,
    description: 'NOC active alerts 를 admin_notifications 로 즉시 동기화. 6h cooldown + dedup index 로 중복 방지.',
    scope: '알림 생성 (외부 발송은 dispatch 별도)' },
  { key: 'refresh_policy',      label: 'Refresh Policy',
    icon: <ShieldCheck size={12} />,
    description: '정책 자동화 규칙 due 인 것만 실행 + next_run_at 전진 (중복 실행 내장 방지).',
    scope: '정책 자동화 규칙 + 정책 배포' },
  { key: 'generate_settlement', label: 'Generate Settlement',
    icon: <Database size={12} />,
    description: '(Phase 2-3 예정) 위험도 🔴 — enterprise + 월 지정 modal 필요.',
    scope: '월 정산 데이터 생성 (irreversible-like)',
    disabled: { reason: 'Phase 2-3 에서 활성화 예정 (위험도 🔴, enterprise+월 지정 UI 필요)' } },
  { key: 'export_logs',         label: 'Export Logs',
    icon: <Download size={12} />,
    description: '최근 30일 cron 로그를 CSV 로 다운로드. 최대 5000 행.',
    scope: '읽기 전용 export — 시스템 상태 변경 없음' },
];

const DEBOUNCE_MS = 10_000; // 10s: 요구사항

interface QuickActionRun {
  outcome: QuickActionOutcome;
  at: number;
}

function QuickActionsCard({ onAfterAction }: { onAfterAction: () => void }) {
  const [pending, setPending] = useState<QuickActionKey | null>(null);
  const [confirming, setConfirming] = useState<QuickActionDef | null>(null);
  const [lastRunAt, setLastRunAt] = useState<Partial<Record<QuickActionKey, number>>>({});
  const [lastOutcome, setLastOutcome] = useState<Partial<Record<QuickActionKey, QuickActionRun>>>({});

  const runAction = useCallback(async (a: QuickActionDef) => {
    if (a.disabled) return;
    if (pending) return;
    // Debounce — client-side 10s
    const last = lastRunAt[a.key] ?? 0;
    const remain = Math.ceil((DEBOUNCE_MS - (Date.now() - last)) / 1000);
    if (remain > 0) {
      toast.error(`${a.label}: ${remain}초 후 다시 시도`);
      return;
    }
    setPending(a.key);
    setConfirming(null);
    try {
      let outcome: QuickActionOutcome;
      switch (a.key) {
        case 'run_cron':
          outcome = await runEnterpriseOpsCron();
          break;
        case 'dispatch_pending':
          outcome = await dispatchPendingNotifications();
          break;
        case 'recalculate_noc':
          outcome = await recalculateNoc();
          break;
        case 'refresh_policy':
          outcome = await refreshPolicyAutomation();
          break;
        case 'export_logs': {
          const r = await exportCronLogs({ days: 30, source: 'cron', limit: 5000 });
          if (r.ok && r.data) downloadLogsAsCsv(r.data);
          outcome = r;
          break;
        }
        default:
          outcome = { ok: false, error: 'disabled' };
      }
      setLastRunAt((m) => ({ ...m, [a.key]: Date.now() }));
      setLastOutcome((m) => ({ ...m, [a.key]: { outcome, at: Date.now() } }));
      if (outcome.ok) {
        toast.success(`${a.label} 완료 (${outcome.duration_ms ?? '?'}ms)`);
      } else {
        toast.error(`${a.label} 실패: ${outcome.error ?? 'unknown'}`);
      }
    } catch (e) {
      const msg = (e as Error).message;
      toast.error(`${a.label} 오류: ${msg}`);
      setLastOutcome((m) => ({ ...m, [a.key]: { outcome: { ok: false, error: msg }, at: Date.now() } }));
    } finally {
      setPending(null);
      onAfterAction();
    }
  }, [pending, lastRunAt, onAfterAction]);

  return (
    <>
      <AdminCard
        title={<span className="flex items-center gap-2"><PlayCircle size={13} /> Quick Actions</span>}
        subtitle={<span className="text-[10px] text-amber-300">super_admin 전용. 모든 실행은 audit log 기록됨. 10초 debounce 적용.</span>}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {QUICK_ACTIONS.map((a) => {
            const isPending = pending === a.key;
            const isDisabled = !!a.disabled || (pending !== null && !isPending);
            const last = lastOutcome[a.key];
            const lastAgo = last ? Math.floor((Date.now() - last.at) / 1000) : null;
            return (
              <div key={a.key} className="flex flex-col gap-1">
                <button
                  type="button"
                  disabled={isDisabled}
                  onClick={() => setConfirming(a)}
                  className={
                    a.disabled
                      ? 'flex items-center justify-center gap-1.5 rounded-xl bg-bg-card px-3 py-2 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 opacity-50 cursor-not-allowed'
                    : isPending
                      ? 'flex items-center justify-center gap-1.5 rounded-xl bg-accent/25 px-3 py-2 text-[11px] font-semibold text-accent ring-1 ring-accent/40'
                    : isDisabled
                      ? 'flex items-center justify-center gap-1.5 rounded-xl bg-bg-card px-3 py-2 text-[11px] font-semibold text-ink-mute ring-1 ring-line/10 opacity-50 cursor-not-allowed'
                      : 'flex items-center justify-center gap-1.5 rounded-xl bg-bg-card px-3 py-2 text-[11px] font-semibold text-ink ring-1 ring-line/20 hover:bg-bg-hover'
                  }
                >
                  {isPending ? <RefreshCw size={12} className="animate-spin" /> : a.icon}
                  {a.label}
                </button>
                {last && (
                  <div className="flex items-center justify-between gap-1 px-1 text-[10px]">
                    <AdminBadge tone={last.outcome.ok ? 'success' : 'danger'} variant="subtle">
                      {last.outcome.ok ? '성공' : '실패'}
                    </AdminBadge>
                    <span className="text-ink-mute">{lastAgo}초 전</span>
                  </div>
                )}
                {a.disabled && (
                  <p className="px-1 text-[9px] text-amber-300">{a.disabled.reason}</p>
                )}
              </div>
            );
          })}
        </div>
      </AdminCard>

      {/* Confirmation modal */}
      {confirming && (
        <AdminModal
          open
          onClose={() => setConfirming(null)}
          title={`${confirming.label} 실행하시겠어요?`}
        >
          <div className="space-y-3 text-[12px]">
            <p className="text-ink-mute">{confirming.description}</p>
            <div className="rounded-xl bg-bg-card p-2.5 ring-1 ring-line/10">
              <p className="text-[10px] uppercase tracking-wider text-ink-dim">영향 범위</p>
              <p className="mt-0.5 font-medium text-ink">{confirming.scope}</p>
            </div>
            <div className="rounded-xl bg-amber-500/25 p-2.5 text-[10px] text-amber-100 ring-1 ring-amber-500/50">
              실행 후 취소 불가. 실패해도 다른 액션에 영향 없음. 결과는 audit log 에 기록됩니다.
            </div>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <AdminButton onClick={() => setConfirming(null)}>취소</AdminButton>
            <AdminButton onClick={() => void runAction(confirming)}>실행</AdminButton>
          </div>
        </AdminModal>
      )}
    </>
  );
}
