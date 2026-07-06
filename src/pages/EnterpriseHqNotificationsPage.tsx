/**
 * EnterpriseHqNotificationsPage — Phase 3-5
 *
 * HQ 알림/장애 관리 센터. /enterprise/notifications.
 *
 * SQL: supabase/migrations/0403_enterprise_hq_notification_center.sql
 * API: src/lib/api/enterpriseHqNotificationsApi.ts
 *
 * 섹션:
 *   1) Header + Manual Scan 버튼
 *   2) KPI (Open · Critical · Unread · Resolved today)
 *   3) Incident List (필터 · ack/resolve/detail)
 *   4) Notification List (unread 우선 · mark read/all)
 *   5) Policy Panel (incident_type 별 enabled/severity/threshold/cooldown)
 *   6) Detail Modal (metadata · timeline · AI recommendation · 딥링크)
 *
 * 절대 원칙:
 *   - HF1~GC UI contrast 정책 유지 (라이트/다크 이중 테마)
 *   - HQ 만 접근 · 서버 게이트 · super admin 우회 없음
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Bell, RefreshCw, AlertCircle, ArrowLeft, PlayCircle, ShieldAlert, CheckCircle2,
  Sparkles, ScrollText, X, ClipboardCheck, Circle, ExternalLink,
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import {
  getMyEnterpriseIncidentKpi,
  getMyEnterpriseIncidents,
  getMyEnterpriseIncidentDetail,
  acknowledgeMyEnterpriseIncident,
  resolveMyEnterpriseIncident,
  getMyEnterpriseNotifications,
  markMyEnterpriseNotificationRead,
  markAllMyEnterpriseNotificationsRead,
  getMyEnterpriseNotificationPolicies,
  updateMyEnterpriseNotificationPolicy,
  runMyEnterpriseIncidentScan,
  getIncidentAiRecommendation,
  INCIDENT_TYPE_LABEL,
  INCIDENT_SEVERITY_LABEL,
  INCIDENT_STATUS_LABEL,
  type IncidentType, type IncidentSeverity, type IncidentStatus,
  type HqIncidentKpi, type HqIncident, type HqIncidentDetail,
  type HqNotification, type HqNotificationPolicy,
} from '@/lib/api/enterpriseHqNotificationsApi';

const KPI_POLL_MS = 30_000;
const INCIDENTS_POLL_MS = 30_000;
const NOTIFICATIONS_POLL_MS = 15_000;

export default function EnterpriseHqNotificationsPage() {
  const { user, loading: authLoading } = useAuthStore();
  const [detailId, setDetailId] = useState<string | null>(null);

  if (!authLoading && !user) return <Navigate to="/login" replace />;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 pb-24">
      <PageHeader />
      <KpiSection />
      <IncidentsSection onSelectDetail={setDetailId} />
      <div className="grid gap-4 lg:grid-cols-2">
        <NotificationsSection />
        <PolicySection />
      </div>
      {detailId && (
        <IncidentDetailModal incidentId={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Header
// -----------------------------------------------------------------------------

function PageHeader() {
  const [scanning, setScanning] = useState(false);

  const onScan = async () => {
    if (!confirm('지금 브랜드 전체 매장을 스캔할까요? (수 초 이내 완료)')) return;
    setScanning(true);
    try {
      const r = await runMyEnterpriseIncidentScan();
      toast.success(
        `스캔 완료 · 신규 ${r.created_count} · 재발 ${r.updated_count} · 알림 ${r.notification_created_count} (${r.duration_ms}ms)`,
      );
      window.dispatchEvent(new CustomEvent('hq-notifications:refresh'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setScanning(false);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-3">
      <Link
        to="/enterprise/me"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card"
        aria-label="본사 대시보드로"
      >
        <ArrowLeft size={18} />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Bell size={20} className="text-accent" /> 알림센터
        </h1>
        <p className="text-xs text-ink-mute">
          매장 장애 · 정책 지연 · 정산 이슈를 한 곳에서 확인하고 조치할 수 있어요.
        </p>
      </div>
      <button
        onClick={() => void onScan()}
        disabled={scanning}
        className="inline-flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-500 disabled:opacity-50"
      >
        <RefreshCw size={12} className={scanning ? 'animate-spin' : ''} />
        {scanning ? '스캔 중…' : '지금 스캔'}
      </button>
    </header>
  );
}

// -----------------------------------------------------------------------------
// KPI
// -----------------------------------------------------------------------------

function KpiSection() {
  const [kpi, setKpi] = useState<HqIncidentKpi | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKpi(await getMyEnterpriseIncidentKpi());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), KPI_POLL_MS);
    const onRefresh = () => void load();
    window.addEventListener('hq-notifications:refresh', onRefresh);
    return () => { window.clearInterval(t); window.removeEventListener('hq-notifications:refresh', onRefresh); };
  }, [load]);

  if (loading && !kpi) return <div className="h-24 animate-pulse rounded-2xl bg-bg-card" />;
  if (error) {
    return (
      <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-slate-900 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40 dark:text-rose-100">
        <AlertCircle size={12} className="mr-1 inline" /> {error}
      </div>
    );
  }
  if (!kpi) return null;

  return (
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <KpiCard label="Open" value={kpi.open} tone="amber" icon={<Circle size={12} />} />
      <KpiCard label="Critical (open+ack)" value={kpi.critical_open} tone="rose" icon={<ShieldAlert size={12} />} />
      <KpiCard label="Unread" value={kpi.unread_notifications} tone="sky" icon={<Bell size={12} />} />
      <KpiCard label="오늘 Resolved" value={kpi.resolved_today} tone="emerald" icon={<CheckCircle2 size={12} />} />
    </section>
  );
}

function KpiCard({
  label, value, tone, icon,
}: { label: string; value: number; tone: 'amber' | 'rose' | 'sky' | 'emerald'; icon: React.ReactNode }) {
  const cls =
    tone === 'amber' ? 'bg-amber-50 border-amber-200 dark:bg-amber-500/25 dark:border-transparent dark:ring-1 dark:ring-amber-400/40'
    : tone === 'rose' ? 'bg-rose-50 border-rose-200 dark:bg-rose-500/25 dark:border-transparent dark:ring-1 dark:ring-rose-400/40'
    : tone === 'sky' ? 'bg-sky-50 border-sky-200 dark:bg-sky-500/20 dark:border-transparent dark:ring-1 dark:ring-sky-400/40'
    : 'bg-emerald-50 border-emerald-200 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40';
  const iconCls =
    tone === 'amber' ? 'text-amber-700 dark:text-amber-100'
    : tone === 'rose' ? 'text-rose-700 dark:text-rose-100'
    : tone === 'sky' ? 'text-sky-700 dark:text-sky-100'
    : 'text-emerald-700 dark:text-emerald-100';
  return (
    <div className={`rounded-2xl border p-3 ${cls}`}>
      <p className="flex items-center gap-1 text-[10px] font-semibold text-slate-700 dark:text-ink-mute">
        <span className={iconCls}>{icon}</span> {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold tabular-nums text-slate-950 dark:text-ink">
        {value.toLocaleString('ko-KR')}
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Incidents
// -----------------------------------------------------------------------------

function IncidentsSection({ onSelectDetail }: { onSelectDetail: (id: string) => void }) {
  const [rows, setRows] = useState<HqIncident[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<IncidentStatus | ''>('open');
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [type, setType] = useState<IncidentType | ''>('');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseIncidents({
        status: (status as IncidentStatus | '') || null,
        severity: (severity as IncidentSeverity | '') || null,
        type: (type as IncidentType | '') || null,
        limit: 50, offset: 0,
      });
      setRows(r.data);
      setTotal(r.pagination.total);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [status, severity, type]);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), INCIDENTS_POLL_MS);
    const onRefresh = () => void load();
    window.addEventListener('hq-notifications:refresh', onRefresh);
    return () => { window.clearInterval(t); window.removeEventListener('hq-notifications:refresh', onRefresh); };
  }, [load]);

  const onAck = async (id: string) => {
    setActing(id);
    try {
      await acknowledgeMyEnterpriseIncident(id);
      toast.success('확인됨(ack) 처리');
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setActing(null); }
  };
  const onResolve = async (id: string) => {
    if (!confirm('이 incident 를 해결됨(resolved) 로 종료할까요?')) return;
    setActing(id);
    try {
      await resolveMyEnterpriseIncident(id);
      toast.success('해결됨 처리');
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setActing(null); }
  };

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-1.5 text-sm font-bold">
          <ShieldAlert size={14} /> Incident 목록
          <span className="ml-1 text-[11px] font-normal text-ink-mute">({total.toLocaleString('ko-KR')})</span>
        </h2>
        <select value={status} onChange={(e) => setStatus(e.target.value as IncidentStatus | '')}
          className="rounded bg-bg-deep px-2 py-1 text-xs">
          <option value="">전체 상태</option>
          <option value="open">열림</option>
          <option value="acknowledged">확인됨</option>
          <option value="resolved">해결됨</option>
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value as IncidentSeverity | '')}
          className="rounded bg-bg-deep px-2 py-1 text-xs">
          <option value="">전체 심각도</option>
          {(['critical','high','medium','low','info'] as IncidentSeverity[]).map((s) => (
            <option key={s} value={s}>{INCIDENT_SEVERITY_LABEL[s]}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as IncidentType | '')}
          className="rounded bg-bg-deep px-2 py-1 text-xs">
          <option value="">전체 유형</option>
          {(Object.keys(INCIDENT_TYPE_LABEL) as IncidentType[]).map((t) => (
            <option key={t} value={t}>{INCIDENT_TYPE_LABEL[t]}</option>
          ))}
        </select>
      </div>

      {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-200"><AlertCircle size={11} className="inline" /> {error}</p>}

      {loading && rows.length === 0 ? (
        <div className="mt-3 h-40 animate-pulse rounded bg-bg-deep" />
      ) : rows.length === 0 ? (
        <div className="mt-3 rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-slate-900 dark:bg-emerald-500/20 dark:border-transparent dark:ring-1 dark:ring-emerald-400/40 dark:text-emerald-100">
          <CheckCircle2 size={11} className="mr-1 inline text-emerald-700 dark:text-emerald-200" />
          현재 조건에 맞는 incident 가 없습니다.
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line/10">
          {rows.map((r) => (
            <IncidentRow key={r.id} incident={r}
              acting={acting === r.id}
              onSelectDetail={() => onSelectDetail(r.id)}
              onAck={() => void onAck(r.id)}
              onResolve={() => void onResolve(r.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function IncidentRow({
  incident, acting, onSelectDetail, onAck, onResolve,
}: {
  incident: HqIncident; acting: boolean;
  onSelectDetail: () => void; onAck: () => void; onResolve: () => void;
}) {
  const sevCls = severityBadgeClass(incident.severity);
  const statusCls = statusBadgeClass(incident.status);
  return (
    <li className="flex flex-wrap items-center gap-2 py-2 text-xs">
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${sevCls}`}>
        {INCIDENT_SEVERITY_LABEL[incident.severity]}
      </span>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusCls}`}>
        {INCIDENT_STATUS_LABEL[incident.status]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">
          {incident.title}
          {incident.occurrence_count > 1 && (
            <span className="ml-1 text-[10px] text-ink-mute">×{incident.occurrence_count}</span>
          )}
        </p>
        <p className="truncate text-[10px] text-ink-mute">
          {INCIDENT_TYPE_LABEL[incident.incident_type]}
          {incident.store_name && ` · ${incident.store_name}`}
          {' · 감지 '} {new Date(incident.detected_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        <button onClick={onSelectDetail}
          className="rounded bg-bg-deep px-2 py-1 text-[11px] hover:bg-bg-hover"
        >상세</button>
        {incident.status === 'open' && (
          <button onClick={onAck} disabled={acting}
            className="rounded bg-sky-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-sky-500 disabled:opacity-50"
          >Ack</button>
        )}
        {incident.status !== 'resolved' && (
          <button onClick={onResolve} disabled={acting}
            className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
          >Resolve</button>
        )}
      </div>
    </li>
  );
}

function severityBadgeClass(sev: IncidentSeverity) {
  return sev === 'critical' ? 'bg-rose-500 text-rose-50'
    : sev === 'high' ? 'bg-orange-500 text-orange-50'
    : sev === 'medium' ? 'bg-amber-500 text-amber-950'
    : sev === 'low' ? 'bg-emerald-500 text-emerald-50'
    : 'bg-sky-500 text-sky-50';
}

function statusBadgeClass(status: IncidentStatus) {
  return status === 'open' ? 'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100'
    : status === 'acknowledged' ? 'bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-100'
    : 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-100';
}

// -----------------------------------------------------------------------------
// Notifications
// -----------------------------------------------------------------------------

function NotificationsSection() {
  const [rows, setRows] = useState<HqNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseNotifications(30, 0, false);
      setRows(r.data);
      setUnread(r.unread_count);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), NOTIFICATIONS_POLL_MS);
    const onRefresh = () => void load();
    window.addEventListener('hq-notifications:refresh', onRefresh);
    return () => { window.clearInterval(t); window.removeEventListener('hq-notifications:refresh', onRefresh); };
  }, [load]);

  const onMarkRead = async (id: string) => {
    try {
      await markMyEnterpriseNotificationRead(id);
      await load();
    } catch (e) { toast.error((e as Error).message); }
  };

  const onMarkAll = async () => {
    if (unread === 0) { toast.info('읽지 않은 알림이 없어요.'); return; }
    setMarkingAll(true);
    try {
      const r = await markAllMyEnterpriseNotificationsRead();
      toast.success(`${r.updated}건 읽음 처리`);
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setMarkingAll(false); }
  };

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-center gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Bell size={14} /> 내 알림
        </h2>
        <span className="ml-auto text-[10px] text-ink-mute">
          미확인 <b className="text-rose-400">{unread}</b>
        </span>
        <button
          onClick={() => void onMarkAll()}
          disabled={markingAll || unread === 0}
          className="rounded bg-bg-deep px-2 py-1 text-[11px] hover:bg-bg-hover disabled:opacity-50"
        >모두 읽음</button>
      </div>
      {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-200"><AlertCircle size={11} className="inline" /> {error}</p>}
      {loading && rows.length === 0 ? (
        <div className="mt-3 h-40 animate-pulse rounded bg-bg-deep" />
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-ink-mute">알림이 없어요.</p>
      ) : (
        <ul className="mt-3 max-h-72 overflow-y-auto divide-y divide-line/10">
          {rows.map((n) => (
            <NotificationRow key={n.id} row={n} onMarkRead={() => void onMarkRead(n.id)} />
          ))}
        </ul>
      )}
    </section>
  );
}

function NotificationRow({ row, onMarkRead }: { row: HqNotification; onMarkRead: () => void }) {
  const unread = !row.read_at;
  const sevCls = severityBadgeClass(row.severity);
  return (
    <li className={`flex items-center gap-2 py-2 text-xs ${unread ? 'font-semibold' : 'opacity-70'}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${unread ? 'bg-rose-500' : 'bg-transparent'}`} aria-hidden />
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${sevCls}`}>
        {INCIDENT_SEVERITY_LABEL[row.severity]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate">{row.title}</p>
        <p className="truncate text-[10px] text-ink-mute">{row.message}</p>
      </div>
      <span className="shrink-0 text-[10px] text-ink-dim">
        {new Date(row.created_at).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit' })}
      </span>
      {row.action_url && (
        <Link to={row.action_url} className="shrink-0 rounded p-1 hover:bg-bg-hover" aria-label="이동">
          <ExternalLink size={11} />
        </Link>
      )}
      {unread && (
        <button onClick={onMarkRead} className="shrink-0 rounded bg-bg-deep px-1.5 py-0.5 text-[10px] hover:bg-bg-hover">
          읽음
        </button>
      )}
    </li>
  );
}

// -----------------------------------------------------------------------------
// Policy Panel
// -----------------------------------------------------------------------------

function PolicySection() {
  const [rows, setRows] = useState<HqNotificationPolicy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await getMyEnterpriseNotificationPolicies();
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onSave = async (policy: HqNotificationPolicy) => {
    setSaving(policy.incident_type);
    try {
      await updateMyEnterpriseNotificationPolicy({
        incident_type: policy.incident_type,
        enabled: policy.enabled,
        severity: policy.severity,
        threshold_minutes: policy.threshold_minutes,
        cooldown_minutes: policy.cooldown_minutes,
        channels: policy.channels as Record<string, boolean>,
      });
      toast.success('정책 저장됨');
      await load();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(null); }
  };

  return (
    <section className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <h2 className="flex items-center gap-1.5 text-sm font-bold">
        <ClipboardCheck size={14} /> 알림 정책 (브랜드 전체)
      </h2>
      <p className="mt-1 text-[11px] text-ink-mute">
        스캔 시 각 incident 유형별로 활성화 · 심각도 · cooldown 을 조정할 수 있어요.
      </p>
      {error && <p className="mt-2 text-xs text-rose-700 dark:text-rose-200"><AlertCircle size={11} className="inline" /> {error}</p>}
      {loading && rows.length === 0 ? (
        <div className="mt-3 h-40 animate-pulse rounded bg-bg-deep" />
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((p) => (
            <PolicyRow key={p.incident_type} initial={p} onSave={onSave} saving={saving === p.incident_type} />
          ))}
        </ul>
      )}
    </section>
  );
}

function PolicyRow({ initial, onSave, saving }: {
  initial: HqNotificationPolicy;
  onSave: (policy: HqNotificationPolicy) => void;
  saving: boolean;
}) {
  const [row, setRow] = useState<HqNotificationPolicy>(initial);
  useEffect(() => { setRow(initial); }, [initial]);
  const changed = useMemo(() =>
    row.enabled !== initial.enabled
    || row.severity !== initial.severity
    || row.cooldown_minutes !== initial.cooldown_minutes
    || row.threshold_minutes !== initial.threshold_minutes,
    [row, initial]);
  return (
    <li className="rounded-lg bg-bg-soft p-2.5 ring-1 ring-line/10">
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={row.enabled}
            onChange={(e) => setRow({ ...row, enabled: e.target.checked })} />
          <span className="font-semibold">{INCIDENT_TYPE_LABEL[row.incident_type]}</span>
        </label>
        <select value={row.severity}
          onChange={(e) => setRow({ ...row, severity: e.target.value as IncidentSeverity })}
          className="rounded bg-bg-deep px-2 py-1 text-[11px]"
        >
          {(['critical','high','medium','low','info'] as IncidentSeverity[]).map((s) => (
            <option key={s} value={s}>{INCIDENT_SEVERITY_LABEL[s]}</option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-[10px] text-ink-mute">
          cooldown
          <input type="number" min={0}
            value={row.cooldown_minutes}
            onChange={(e) => setRow({ ...row, cooldown_minutes: Math.max(0, parseInt(e.target.value) || 0) })}
            className="w-14 rounded bg-bg-deep px-1 py-0.5 text-[11px] tabular-nums"
          />
          분
        </label>
        <button
          onClick={() => onSave(row)} disabled={saving || !changed}
          className="ml-auto rounded bg-violet-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-40"
        >{saving ? '저장 중…' : '저장'}</button>
      </div>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Detail Modal
// -----------------------------------------------------------------------------

function IncidentDetailModal({ incidentId, onClose }: { incidentId: string; onClose: () => void }) {
  const [detail, setDetail] = useState<HqIncidentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await getMyEnterpriseIncidentDetail(incidentId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [incidentId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-2xl flex-col max-h-[95vh] sm:max-h-[90vh]
                   rounded-t-2xl sm:rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="shrink-0 flex items-center justify-between border-b border-line/10 px-4 py-3">
          <h3 className="text-sm font-bold flex items-center gap-1.5">
            <ShieldAlert size={14} /> Incident 상세
          </h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-bg-hover"><X size={14} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && !detail && <div className="h-40 animate-pulse rounded bg-bg-deep" />}
          {error && (
            <div className="rounded bg-rose-500/25 px-3 py-2 text-xs text-rose-100">
              <AlertCircle size={12} className="inline mr-1" />{error}
            </div>
          )}
          {detail && <IncidentDetailBody detail={detail} />}
        </div>
      </div>
    </div>
  );
}

function IncidentDetailBody({ detail }: { detail: HqIncidentDetail }) {
  const { incident, events } = detail;
  const meta = incident.metadata ?? {};
  const recAction = (meta.recommended_action as string | undefined) ?? getIncidentAiRecommendation(incident.incident_type);
  const actionUrl = (meta.action_url as string | undefined) ?? undefined;
  const recoveryHint = (meta.recovery_hint as string | undefined) ?? undefined;

  return (
    <div className="space-y-4 text-xs">
      {/* Header block */}
      <div className="rounded-lg bg-bg-deep p-3">
        <div className="flex items-start gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${severityBadgeClass(incident.severity)}`}>
            {INCIDENT_SEVERITY_LABEL[incident.severity]}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(incident.status)}`}>
            {INCIDENT_STATUS_LABEL[incident.status]}
          </span>
          <span className="ml-auto text-[10px] text-ink-mute">×{incident.occurrence_count}</span>
        </div>
        <p className="mt-2 text-sm font-bold">{incident.title}</p>
        {incident.message && <p className="mt-1 text-[12px] text-ink-mute">{incident.message}</p>}
        <dl className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-ink-mute">
          <div><dt className="text-[10px]">유형</dt><dd>{INCIDENT_TYPE_LABEL[incident.incident_type]}</dd></div>
          {incident.store_name && <div><dt className="text-[10px]">매장</dt><dd>{incident.store_name}</dd></div>}
          <div><dt className="text-[10px]">최초 감지</dt><dd>{new Date(incident.detected_at).toLocaleString('ko-KR')}</dd></div>
          <div><dt className="text-[10px]">최근 감지</dt><dd>{new Date(incident.last_seen_at).toLocaleString('ko-KR')}</dd></div>
          {incident.acknowledged_at && (
            <div><dt className="text-[10px]">확인</dt><dd>{new Date(incident.acknowledged_at).toLocaleString('ko-KR')}</dd></div>
          )}
          {incident.resolved_at && (
            <div><dt className="text-[10px]">해결</dt><dd>{new Date(incident.resolved_at).toLocaleString('ko-KR')}</dd></div>
          )}
        </dl>
      </div>

      {/* AI Recommendation */}
      <div className="rounded-lg bg-violet-50 border border-violet-200 p-3 dark:bg-violet-500/20 dark:border-transparent dark:ring-1 dark:ring-violet-400/40">
        <p className="flex items-center gap-1 text-[11px] font-bold text-violet-800 dark:text-violet-100">
          <Sparkles size={12} /> AI 조치 추천
        </p>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-900 dark:text-violet-50">
          {recAction}
        </p>
        {recoveryHint && (
          <p className="mt-1 text-[10px] text-slate-700 dark:text-violet-100">
            자동 해제 힌트: {recoveryHint}
          </p>
        )}
        {actionUrl && (
          <Link to={actionUrl}
            className="mt-2 inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-violet-500"
          >
            <ExternalLink size={11} /> 관련 화면으로 이동
          </Link>
        )}
      </div>

      {/* Timeline */}
      <div className="rounded-lg bg-bg-deep p-3">
        <p className="flex items-center gap-1 text-[11px] font-bold">
          <ScrollText size={12} /> Timeline ({events.length})
        </p>
        <ul className="mt-2 divide-y divide-line/10">
          {events.map((ev) => (
            <li key={ev.id} className="py-1.5 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="rounded bg-bg-soft px-1.5 py-0.5 text-[10px] font-semibold">
                  {ev.event_type}
                </span>
                <span className="text-ink-mute">{new Date(ev.created_at).toLocaleString('ko-KR')}</span>
              </div>
              {ev.message && <p className="mt-0.5 text-ink-mute">{ev.message}</p>}
            </li>
          ))}
        </ul>
      </div>

      {/* Deep links */}
      <div className="flex gap-2 text-[11px]">
        <Link to="/enterprise/ops" className="inline-flex items-center gap-1 rounded bg-sky-600 px-2 py-1 font-bold text-white hover:bg-sky-500">
          <PlayCircle size={11} /> 운영 관제
        </Link>
        <Link to="/enterprise/intel" className="inline-flex items-center gap-1 rounded bg-violet-600 px-2 py-1 font-bold text-white hover:bg-violet-500">
          <Sparkles size={11} /> 인텔리전스
        </Link>
      </div>
    </div>
  );
}
