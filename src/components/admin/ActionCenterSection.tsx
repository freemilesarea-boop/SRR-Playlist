/**
 * ActionCenterSection — Operations Action Center (Phase ADMIN-ACTION-CENTER-1).
 *
 * Mission Control 에서 발견한 문제를 안전하게 실행하는 운영 실행 계층이다.
 * **실행 자체는 기존 admin RPC 를 재사용**하고(admin_force_store_resync·
 * admin_retry_pending_qc·admin_enable_user·admin_disable_user 등), 신규는 Command
 * 등록/Audit(0479)뿐이다. 새 실행 로직 없음.
 *
 * 탭: Queue(자동 도출) · Approvals(승인 필요) · Bulk · Danger Zone · History(Audit).
 *
 * 실행 흐름: registerActionCommand(등록·중복차단) → 기존 RPC 실행 → completeActionCommand.
 *   등록 실패(마이그레이션 미적용/중복) 시 실제 실행하지 않음 → Audit 보장·안전 기본값.
 *   위험 작업은 확인 Dialog + 확인 문구 필수. 권한 부족 시 버튼 비활성.
 */
import { useEffect, useState } from 'react';
import {
  Zap, ShieldAlert, ListChecks, History as HistoryIcon, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, Inbox, Ban, Lock, Layers, PlayCircle,
} from 'lucide-react';
import { AdminCard, AdminAlert, AdminBadge, AdminEmpty, AdminModal } from '@/components/admin/ui';
import {
  fetchMemberGrowthKpis, fetchStreamingSummary, fetchNocKpi, fetchArtistBreakdown, fetchArtistSummary,
  registerActionCommand, completeActionCommand, fetchActionHistory,
  actionForceStoreResync, actionRetryPendingQc,
  type ActionHistoryRow,
} from '@/lib/adminApi';
import { classifyAdminError, type AdminError } from '@/lib/adminErrors';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { relativeTimeKo, formatKstDateTime } from '@/lib/memberGrowth';
import {
  ACTION_CATALOG, getAction, canExecute, hasPermission, isSupported, deriveQueue,
  ROLE_ORDER, ROLE_LABEL, STATUS_LABEL, STATUS_TONE, SEVERITY_TONE,
  type Role, type ActionDef, type QueueItem,
} from '@/lib/actionCenter';

const NUM = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('ko-KR'));

type Tab = 'queue' | 'approvals' | 'bulk' | 'danger' | 'history';
const TABS: { key: Tab; label: string }[] = [
  { key: 'queue', label: 'Queue' }, { key: 'approvals', label: 'Approvals' },
  { key: 'bulk', label: 'Bulk' }, { key: 'danger', label: 'Danger Zone' }, { key: 'history', label: 'History' },
];

interface Pending { action: ActionDef; targetId?: string | null; reason?: string }

export default function ActionCenterSection() {
  const [tab, setTab] = useState<Tab>('queue');
  // 현재 운영자 Role — 데모/게이팅용. DB 세분 role 부재로 기본 admin(관리자 페이지 접근자).
  const [role, setRole] = useState<Role>('admin');

  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [qErr, setQErr] = useState<AdminError | null>(null);
  const [qLoading, setQLoading] = useState(true);

  const [history, setHistory] = useState<ActionHistoryRow[] | null>(null);
  const [hLoading, setHLoading] = useState(false);

  const [pending, setPending] = useState<Pending | null>(null); // 승인 Dialog 대상
  const [confirmText, setConfirmText] = useState('');
  const [executing, setExecuting] = useState(false);

  async function loadQueue() {
    setQLoading(true); setQErr(null);
    try {
      const settle = async <T,>(p: Promise<T>) => p.catch(() => null);
      const [member, streaming, noc, artistBd, artist] = await Promise.all([
        settle(fetchMemberGrowthKpis()), settle(fetchStreamingSummary()), settle(fetchNocKpi()),
        settle(fetchArtistBreakdown()), settle(fetchArtistSummary()),
      ]);
      void member;
      const qcPending = artistBd?.qc.pending ?? null;
      const settlementPending = artistBd ? (artistBd.settlement.pending + artistBd.settlement.held + artistBd.settlement.carried_over) : (artist?.settled ?? null);
      setQueue(deriveQueue({
        offlinePlayers: streaming?.offline_players ?? null,
        offlineStores: noc?.offline_stores ?? null,
        qcPending, settlementPending, todayIncidents: noc?.today_incidents ?? null,
      }));
    } catch (e) { setQErr(classifyAdminError(e)); } finally { setQLoading(false); }
  }
  async function loadHistory() {
    setHLoading(true);
    try { setHistory(await fetchActionHistory(30)); } catch { setHistory([]); } finally { setHLoading(false); }
  }

  useEffect(() => { void loadQueue(); }, []);
  useEffect(() => { if (tab === 'history') void loadHistory(); }, [tab]);

  /** 실행 요청 — 위험/승인 필요는 Dialog, 아니면 즉시. */
  function requestExecute(action: ActionDef, targetId?: string | null, reason?: string) {
    if (!hasPermission(action, role)) { toast.error(`권한 부족: ${action.label} 는 ${ROLE_LABEL[action.minRole]} 이상 필요`); return; }
    if (!isSupported(action)) { toast.error(`${action.label} 는 실행 RPC 가 없어 관련 Dashboard 에서 수행하세요(미지원).`); return; }
    if (action.requiresApproval || action.danger) { setPending({ action, targetId, reason }); setConfirmText(''); return; }
    void execute(action, targetId, reason, false);
  }

  /** 실제 실행 — 등록(Audit) → 기존 RPC 재사용 → 완료 기록. */
  async function execute(action: ActionDef, targetId: string | null | undefined, reason: string | undefined, approved: boolean) {
    setExecuting(true);
    let commandId: string;
    try {
      // 1) Command 등록 (실패 시 실행하지 않음 = Audit 보장·중복/동시 차단)
      const reg = await registerActionCommand({ commandType: action.id, targetType: action.targetType, targetId: targetId ?? null, reason, approved });
      commandId = reg.command_id;
    } catch (e) {
      setExecuting(false); setPending(null);
      toast.error(`실행 차단(등록 실패): ${friendlyError(e, '중복 실행이거나 Command 레지스트리 미적용')}`);
      return;
    }
    try {
      // 2) 기존 admin RPC 재사용 실행
      await runReuse(action, targetId);
      // 3) 성공 기록
      await completeActionCommand(commandId, 'success').catch(() => {});
      toast.success(`${action.label} 실행 완료`);
    } catch (e) {
      await completeActionCommand(commandId, 'failed', null, friendlyError(e, 'error')).catch(() => {});
      toast.error(`${action.label} 실행 실패: ${friendlyError(e, '')}`);
    } finally {
      setExecuting(false); setPending(null);
      void loadQueue(); if (tab === 'history') void loadHistory();
    }
  }

  return (
    <AdminCard
      title={<span className="flex items-center gap-1.5"><Zap size={16} /> Operations Action Center</span>}
      subtitle="운영 실행 계층 — 실행은 기존 admin RPC 재사용, 등록/Audit 만 신규"
      action={
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] uppercase tracking-wider text-ink-dim">Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}
            className="rounded-full bg-bg-deep px-2 py-1 text-[11px] text-ink">
            {ROLE_ORDER.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${tab === t.key ? 'bg-accent text-black' : 'bg-bg-deep text-ink-mute hover:text-ink'}`}>
              {t.label}
            </button>
          ))}
        </div>
      }
      bodyClassName="space-y-4"
    >
      {tab === 'queue' && <QueueTab queue={queue} loading={qLoading} error={qErr} onRetry={loadQueue} role={role} onExecute={requestExecute} />}
      {tab === 'approvals' && <ActionListTab role={role} filter={(a) => a.requiresApproval} onExecute={requestExecute} title="승인 필요 Action" />}
      {tab === 'bulk' && <ActionListTab role={role} filter={(a) => a.bulk} onExecute={requestExecute} title="Bulk Action (여러 건 대상)" bulk />}
      {tab === 'danger' && <DangerTab role={role} onExecute={requestExecute} />}
      {tab === 'history' && <HistoryTab rows={history} loading={hLoading} />}

      {/* 승인/확인 Dialog */}
      {pending && (
        <AdminModal open onClose={() => setPending(null)} title={<span className="flex items-center gap-1.5"><ShieldAlert size={16} /> 실행 확인</span>}>
          <div className="space-y-3 text-xs">
            <p className="font-bold text-ink">{pending.action.label}</p>
            <div className="rounded-lg bg-bg-deep p-2 text-ink-mute">
              <p>대상 유형: {pending.action.targetType}{pending.targetId ? ` · ${pending.targetId}` : ''}</p>
              <p>영향도: {pending.action.impact}</p>
              <p>최소 권한: {ROLE_LABEL[pending.action.minRole]} · 현재: {ROLE_LABEL[role]}</p>
            </div>
            {pending.action.danger && (
              <div className="space-y-1">
                <p style={{ color: '#f87171' }}>위험 작업입니다. 계속하려면 <b>실행</b> 을 입력하세요.</p>
                <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="실행"
                  className="w-full rounded-lg bg-bg-deep px-2 py-1.5 text-ink placeholder:text-ink-dim" />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setPending(null)} className="rounded-full bg-bg-deep px-3 py-1.5 text-ink-mute hover:text-ink">취소</button>
              <button
                disabled={executing || !canExecute(pending.action, role) || (pending.action.danger && confirmText.trim() !== '실행')}
                onClick={() => void execute(pending.action, pending.targetId, pending.reason, true)}
                className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 font-bold text-black disabled:opacity-40">
                {executing ? <RefreshCw size={12} className="animate-spin" /> : <PlayCircle size={12} />} 승인 후 실행
              </button>
            </div>
          </div>
        </AdminModal>
      )}
    </AdminCard>
  );
}

/* ── Queue ─────────────────────────────────────────────── */
function QueueTab({ queue, loading, error, onRetry, role, onExecute }: {
  queue: QueueItem[] | null; loading: boolean; error: AdminError | null; onRetry: () => void;
  role: Role; onExecute: (a: ActionDef, t?: string | null, r?: string) => void;
}) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (error) return <AdminAlert tone="warning" title="Queue 를 불러오지 못했어요" description={error.message} action={<button onClick={onRetry} className="rounded-full bg-bg-card px-3 py-1.5 text-xs">다시 시도</button>} />;
  if (!queue || queue.length === 0) return <AdminEmpty icon={<CheckCircle2 size={24} />} title="실행할 Action 없음" description="Mission Control 지표상 조치가 필요한 항목이 없습니다." />;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-mute">Mission Control 지표에서 자동 도출 · 실행 가능한 작업만 표시</p>
      {queue.map((q, i) => {
        const action = getAction(q.actionId)!;
        return <ActionCard key={i} action={action} role={role} onExecute={onExecute} severity={q.severity} reason={q.reason} count={q.count} />;
      })}
    </div>
  );
}

/* ── Action Card ───────────────────────────────────────── */
function ActionCard({ action, role, onExecute, severity, reason, count }: {
  action: ActionDef; role: Role; onExecute: (a: ActionDef, t?: string | null, r?: string) => void;
  severity?: QueueItem['severity']; reason?: string; count?: number;
}) {
  const allowed = hasPermission(action, role);
  const supported = isSupported(action);
  return (
    <div className="rounded-xl bg-bg-deep p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {severity && <AdminBadge tone={SEVERITY_TONE[severity]} size="sm">{severity}</AdminBadge>}
            <span className="text-xs font-bold text-ink">{action.label}</span>
            {action.danger && <AdminBadge tone="danger" size="sm">위험</AdminBadge>}
            {!supported && <AdminBadge tone="neutral" size="sm">미지원</AdminBadge>}
          </div>
          {reason && <p className="mt-1 text-[11px] text-ink-mute">원인: {reason}{count != null ? ` (${NUM(count)}건)` : ''}</p>}
          <p className="mt-0.5 text-[10px] text-ink-dim">영향: {action.impact} · 최소 권한 {ROLE_LABEL[action.minRole]} · 실행 {action.reuse.kind === 'rpc' ? `RPC ${action.reuse.ref}` : action.reuse.kind === 'link' ? '관련 Dashboard' : '없음'}</p>
        </div>
        <button
          disabled={!allowed || !supported}
          onClick={() => onExecute(action, null, reason)}
          title={!allowed ? `${ROLE_LABEL[action.minRole]} 이상 필요` : !supported ? '실행 RPC 없음(관련 Dashboard 에서 수행)' : ''}
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${allowed && supported ? 'bg-accent text-black hover:opacity-90' : 'bg-bg-card text-ink-dim'}`}>
          {!allowed ? <Lock size={12} /> : <PlayCircle size={12} />} 실행
        </button>
      </div>
    </div>
  );
}

/* ── Action List (Approvals / Bulk) ────────────────────── */
function ActionListTab({ role, filter, onExecute, title, bulk }: {
  role: Role; filter: (a: ActionDef) => boolean; onExecute: (a: ActionDef, t?: string | null, r?: string) => void; title: string; bulk?: boolean;
}) {
  const actions = ACTION_CATALOG.filter(filter);
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1 text-xs font-bold">{bulk ? <Layers size={13} /> : <ListChecks size={13} />} {title}</p>
      {actions.map((a) => <ActionCard key={a.id} action={a} role={role} onExecute={onExecute} />)}
      {bulk && <p className="text-[10px] text-ink-dim">Bulk 대상 선택/실행은 기존 QC·매장 관리 패널(admin_bulk_approve_tracks·hq_bulk_force_resync)을 재사용합니다.</p>}
    </div>
  );
}

/* ── Danger Zone ───────────────────────────────────────── */
function DangerTab({ role, onExecute }: { role: Role; onExecute: (a: ActionDef, t?: string | null, r?: string) => void }) {
  const danger = ACTION_CATALOG.filter((a) => a.danger);
  return (
    <div className="space-y-2">
      <AdminAlert tone="danger" icon={<Ban size={16} />} title="Danger Zone"
        description="정지·탈퇴·일괄 반려·정산 승인 등 되돌리기 어려운 작업입니다. 확인 문구 입력 + 권한 충족 시에만 실행됩니다." />
      {danger.map((a) => <ActionCard key={a.id} action={a} role={role} onExecute={onExecute} />)}
    </div>
  );
}

/* ── History (Audit) ───────────────────────────────────── */
function HistoryTab({ rows, loading }: { rows: ActionHistoryRow[] | null; loading: boolean }) {
  if (loading) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (!rows) return <div className="h-32 animate-pulse rounded-2xl bg-bg-deep" />;
  if (rows.length === 0) return <AdminEmpty icon={<Inbox size={24} />} title="실행 이력 없음" description="아직 기록된 Command 가 없습니다 (0479 미적용 시 비어 있음)." />;

  return (
    <div className="overflow-x-auto">
      <p className="mb-1.5 flex items-center gap-1 text-xs font-bold"><HistoryIcon size={13} /> 실행 이력 (Audit)</p>
      <table className="w-full min-w-[640px] text-left text-xs">
        <thead>
          <tr className="border-b border-line/10 text-[10px] uppercase tracking-wider text-ink-dim">
            <th className="px-2 py-2 font-semibold">Action</th>
            <th className="px-2 py-2 font-semibold">대상</th>
            <th className="px-2 py-2 font-semibold">담당자</th>
            <th className="px-2 py-2 font-semibold">상태</th>
            <th className="px-2 py-2 text-right font-semibold">소요</th>
            <th className="px-2 py-2 text-right font-semibold">시각</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line/5 last:border-0">
              <td className="px-2 py-2"><span className="font-semibold text-ink">{getAction(r.command_type)?.label ?? r.command_type}</span>{r.retry_count > 0 && <span className="ml-1 text-[10px] text-ink-dim">재시도 {r.retry_count}</span>}</td>
              <td className="px-2 py-2 text-ink-mute">{r.target_type}{r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ''}</td>
              <td className="px-2 py-2 text-ink-mute">{r.requested_by_name ?? '—'}</td>
              <td className="px-2 py-2">
                <AdminBadge tone={STATUS_TONE[r.status]} size="sm">
                  {r.status === 'success' ? <CheckCircle2 size={10} /> : r.status === 'failed' ? <XCircle size={10} /> : <AlertTriangle size={10} />} {STATUS_LABEL[r.status]}
                </AdminBadge>
                {r.error && <span className="ml-1 text-[10px]" style={{ color: '#f87171' }} title={r.error}>오류</span>}
              </td>
              <td className="px-2 py-2 text-right tabular-nums text-ink-mute">{r.duration_seconds != null ? `${Math.round(r.duration_seconds)}s` : '—'}</td>
              <td className="px-2 py-2 text-right text-ink-dim" title={formatKstDateTime(r.requested_at)}>{relativeTimeKo(r.requested_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── 실행 dispatch (기존 RPC 재사용) ─────────────────────── */
async function runReuse(action: ActionDef, targetId?: string | null): Promise<void> {
  switch (action.id) {
    case 'store_resync':
      if (!targetId) throw new Error('대상 매장이 필요합니다. 매장 관리에서 개별 실행하세요.');
      await actionForceStoreResync(targetId); return;
    case 'qc_retry':
      await actionRetryPendingQc(50); return;
    default:
      // 나머지 user/qc bulk 등은 기존 전용 패널에서 대상 선택 후 실행(재사용). 여기선 무대상 실행 차단.
      throw new Error(`${action.label} 는 대상 선택이 필요해 기존 관리 패널에서 실행하세요(재사용).`);
  }
}
