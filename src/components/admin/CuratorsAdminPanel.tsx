import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Search, UserX, Trash2, RotateCcw, ListTree,
  ShieldAlert, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import {
  adminListCurators,
  adminDeactivateCurator,
  adminSoftDeleteCurator,
  adminRestoreCurator,
  adminGetCuratorAuditLogs,
  type AdminCuratorRow,
  type CuratorStatus,
  type CuratorAuditLog,
} from '@/lib/curatorAdminApi';
import { toast } from '@/store/toastStore';

type StatusFilter = '' | CuratorStatus;

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: '', label: '전체' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Inactive' },
  { key: 'deleted', label: 'Deleted' },
];

const STATUS_TONE: Record<CuratorStatus, string> = {
  active: 'bg-emerald-500/15 text-emerald-500 ring-emerald-500/20',
  inactive: 'bg-amber-500/15 text-amber-500 ring-amber-500/20',
  deleted: 'bg-rose-500/15 text-rose-500 ring-rose-500/20',
};

const STATUS_LABEL: Record<CuratorStatus, string> = {
  active: '활성',
  inactive: '비활성',
  deleted: '삭제됨',
};

function fmt(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function CuratorsAdminPanel() {
  const [rows, setRows] = useState<AdminCuratorRow[]>([]);
  const [status, setStatus] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminCuratorRow | null>(null);
  const [confirmMode, setConfirmMode] = useState<'deactivate' | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const [archiveDrafts, setArchiveDrafts] = useState(true);
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1);
  const [auditLogs, setAuditLogs] = useState<CuratorAuditLog[]>([]);
  const [showLogs, setShowLogs] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListCurators({ status: status || undefined, search });
      setRows(res);
    } catch (e) {
      toast.error(`큐레이터 목록 로딩 실패: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c = { total: rows.length, active: 0, inactive: 0, deleted: 0 };
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);

  function openDeactivate(row: AdminCuratorRow) {
    setSelected(row);
    setConfirmMode('deactivate');
    setReason('');
    setConfirmStep(1);
  }
  function openDelete(row: AdminCuratorRow) {
    setSelected(row);
    setConfirmMode('delete');
    setReason('');
    setArchiveDrafts(true);
    setConfirmStep(1);
  }
  function closeModal() {
    setSelected(null);
    setConfirmMode(null);
    setReason('');
    setConfirmStep(1);
  }

  async function doDeactivate() {
    if (!selected) return;
    setBusyId(selected.curator_id);
    try {
      const res = await adminDeactivateCurator(selected.curator_id, reason);
      toast.success(res.noop ? '이미 비활성 상태' : '큐레이터를 비활성화했습니다');
      closeModal();
      await load();
    } catch (e) {
      toast.error(`비활성화 실패: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function doSoftDelete() {
    if (!selected) return;
    setBusyId(selected.curator_id);
    try {
      const res = await adminSoftDeleteCurator(selected.curator_id, {
        reason,
        archiveDrafts,
        reassignPlaylists: true,
      });
      toast.success(
        `삭제 처리 완료 — 운영 중 ${res.preserved_active_playlists}개 유지 / draft ${res.archived_drafts}개 archive`,
      );
      closeModal();
      await load();
    } catch (e) {
      toast.error(`삭제 실패: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function doRestore(row: AdminCuratorRow) {
    setBusyId(row.curator_id);
    try {
      const res = await adminRestoreCurator(row.curator_id);
      toast.success(res.noop ? '이미 활성 상태' : '큐레이터를 복구했습니다');
      await load();
    } catch (e) {
      toast.error(`복구 실패: ${(e as Error).message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleLogs(curatorId: string) {
    if (showLogs === curatorId) {
      setShowLogs(null);
      setAuditLogs([]);
      return;
    }
    setShowLogs(curatorId);
    try {
      const logs = await adminGetCuratorAuditLogs(curatorId, 20);
      setAuditLogs(logs);
    } catch (e) {
      toast.error(`감사 로그 로딩 실패: ${(e as Error).message}`);
    }
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">큐레이터 관리</h2>
          <p className="text-[11px] text-ink-mute">
            유령/미사용 큐레이터 정리 · soft delete · 운영 중 playlist 유지
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-full bg-bg-soft px-3 py-1.5 text-xs ring-1 ring-line/20 hover:bg-bg-hover"
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </header>

      {/* 카운트 + 필터 */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key || 'all'}
            onClick={() => setStatus(t.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              status === t.key ? 'bg-ink text-bg' : 'bg-bg-soft text-ink-mute hover:bg-bg-hover'
            }`}
          >
            {t.label}
            {t.key && (
              <span className="ml-1.5 text-[10px] opacity-70">
                {counts[t.key as CuratorStatus] ?? 0}
              </span>
            )}
            {!t.key && <span className="ml-1.5 text-[10px] opacity-70">{counts.total}</span>}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="이름 / handle / 이메일 검색"
            className="w-full rounded-md bg-bg-soft px-7 py-2 text-xs ring-1 ring-line/20 placeholder:text-ink-dim focus:outline-none focus:ring-accent/30"
          />
        </div>
      </div>

      {loading && <p className="text-xs text-ink-mute">불러오는 중...</p>}

      <div className="overflow-x-auto rounded-lg ring-1 ring-line/10">
        <table className="w-full min-w-[920px] text-xs">
          <thead className="bg-bg-soft text-ink-mute">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">큐레이터</th>
              <th className="px-3 py-2 text-left font-semibold">handle</th>
              <th className="px-3 py-2 text-left font-semibold">이메일</th>
              <th className="px-3 py-2 text-right font-semibold">플리(active/total)</th>
              <th className="px-3 py-2 text-left font-semibold">생성일</th>
              <th className="px-3 py-2 text-left font-semibold">상태</th>
              <th className="px-3 py-2 text-right font-semibold">액션</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const dimmed = r.status !== 'active';
              const isDel = r.status === 'deleted';
              return (
                <Fragment key={r.curator_id}>
                  <tr
                    className={`border-t border-line/10 ${dimmed ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <div className="font-semibold">{r.display_name}</div>
                      {(r.is_verified || r.is_featured) && (
                        <div className="mt-0.5 flex gap-1 text-[10px]">
                          {r.is_verified && <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-500">verified</span>}
                          {r.is_featured && <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-500">featured</span>}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-ink-mute">@{r.handle}</td>
                    <td className="px-3 py-2 text-ink-mute">{r.user_email ?? r.contact_email ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      <span className="text-emerald-500">{r.active_playlist_count}</span>
                      <span className="text-ink-dim"> / {r.playlist_count}</span>
                    </td>
                    <td className="px-3 py-2 text-ink-mute">{fmt(r.created_at)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${STATUS_TONE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={() => void toggleLogs(r.curator_id)}
                          title="감사 로그"
                          className="rounded p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink"
                        >
                          <ListTree size={12} />
                        </button>
                        {r.status === 'active' && (
                          <>
                            <button
                              disabled={busyId === r.curator_id}
                              onClick={() => openDeactivate(r)}
                              title="비활성화"
                              className="rounded p-1.5 text-amber-500 hover:bg-amber-500/10 disabled:opacity-50"
                            >
                              <UserX size={12} />
                            </button>
                            <button
                              disabled={busyId === r.curator_id}
                              onClick={() => openDelete(r)}
                              title="삭제"
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                        {r.status === 'inactive' && (
                          <>
                            <button
                              disabled={busyId === r.curator_id}
                              onClick={() => void doRestore(r)}
                              title="복구"
                              className="rounded p-1.5 text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                            >
                              <RotateCcw size={12} />
                            </button>
                            <button
                              disabled={busyId === r.curator_id}
                              onClick={() => openDelete(r)}
                              title="삭제"
                              className="rounded p-1.5 text-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                            >
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                        {isDel && (
                          <button
                            disabled={busyId === r.curator_id}
                            onClick={() => void doRestore(r)}
                            title="복구"
                            className="rounded p-1.5 text-emerald-500 hover:bg-emerald-500/10 disabled:opacity-50"
                          >
                            <RotateCcw size={12} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {showLogs === r.curator_id && (
                    <tr className="border-t border-line/10 bg-bg-soft/50">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="space-y-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                            감사 로그 (최근 20)
                          </div>
                          {auditLogs.length === 0 ? (
                            <p className="text-xs text-ink-dim">로그가 없습니다.</p>
                          ) : (
                            <ul className="space-y-1">
                              {auditLogs.map((l) => (
                                <li key={l.id} className="flex gap-2 text-[11px]">
                                  <span className="font-mono text-ink-dim">{fmt(l.created_at)}</span>
                                  <span className="rounded bg-bg-card px-1.5 py-0.5 font-semibold">{l.action}</span>
                                  {l.before_status && l.after_status && (
                                    <span className="text-ink-mute">
                                      {l.before_status} → {l.after_status}
                                    </span>
                                  )}
                                  <span className="text-ink-mute">by {l.admin_email ?? '?'}</span>
                                  {l.reason && <span className="text-ink-mute">· {l.reason}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {/* 상태별 메타 (간략) */}
                  {(r.status === 'inactive' || r.status === 'deleted') && (
                    <tr className="border-t border-line/5 text-[10px] text-ink-dim">
                      <td colSpan={7} className="px-3 py-1">
                        {r.status === 'inactive' && (
                          <span>비활성 {fmt(r.deactivated_at)} · {r.deactivate_reason || '사유 없음'}</span>
                        )}
                        {r.status === 'deleted' && (
                          <span>삭제 {fmt(r.deleted_at)} · {r.delete_reason || '사유 없음'}</span>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-ink-dim">큐레이터 없음</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Confirm Modal */}
      {selected && confirmMode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeModal}>
          <div
            className="w-full max-w-md rounded-xl bg-bg-card p-5 ring-1 ring-line/20"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className={confirmMode === 'delete' ? 'text-rose-500' : 'text-amber-500'}>
                {confirmMode === 'delete' ? <Trash2 size={20} /> : <UserX size={20} />}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold">
                  {confirmMode === 'delete' ? '큐레이터 삭제' : '큐레이터 비활성화'}
                </h3>
                <p className="mt-1 text-xs text-ink-mute">
                  {selected.display_name} (@{selected.handle})
                </p>
              </div>
            </div>

            {confirmStep === 1 && (
              <>
                <div className="mt-4 space-y-2 rounded-lg bg-bg-soft p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <ShieldAlert size={14} className="text-amber-500" />
                    <span className="font-semibold">관련 데이터</span>
                  </div>
                  <ul className="space-y-1 pl-5 text-[11px] text-ink-mute">
                    <li>운영 중 playlist: <span className="font-semibold text-ink">{selected.active_playlist_count}개</span></li>
                    <li>전체 playlist: <span className="font-semibold text-ink">{selected.playlist_count}개</span></li>
                    <li>이메일: {selected.user_email ?? selected.contact_email ?? '—'}</li>
                  </ul>
                </div>

                <div className="mt-3">
                  <label className="block text-[11px] font-semibold text-ink-mute">사유 (선택)</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="예: 1년 이상 비활성 / 테스트 계정"
                    className="mt-1 w-full rounded-md bg-bg-soft px-2 py-1.5 text-xs ring-1 ring-line/20 focus:outline-none focus:ring-accent/30"
                  />
                </div>

                {confirmMode === 'delete' && (
                  <label className="mt-2 flex items-center gap-2 text-[11px] text-ink-mute">
                    <input
                      type="checkbox"
                      checked={archiveDrafts}
                      onChange={(e) => setArchiveDrafts(e.target.checked)}
                    />
                    <span>draft/검토중 playlist 도 archive 처리 (운영 중은 절대 건드리지 않음)</span>
                  </label>
                )}

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={closeModal}
                    className="rounded-md bg-bg-soft px-3 py-1.5 text-xs ring-1 ring-line/20 hover:bg-bg-hover"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => setConfirmStep(2)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${
                      confirmMode === 'delete' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-amber-500 hover:bg-amber-600'
                    }`}
                  >
                    다음
                  </button>
                </div>
              </>
            )}

            {confirmStep === 2 && (
              <>
                <div className="mt-4 rounded-lg bg-rose-500/10 p-3 text-xs ring-1 ring-rose-500/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={14} className="mt-0.5 text-rose-500" />
                    <div className="space-y-1">
                      <p className="font-bold text-rose-500">최종 확인</p>
                      {confirmMode === 'delete' ? (
                        <p className="text-ink-mute">
                          이 큐레이터를 <b>삭제 처리</b>합니다. 계정과 데이터는 <b>hard delete 되지 않으며</b>,
                          운영 중인 플레이리스트는 유지됩니다.
                        </p>
                      ) : (
                        <p className="text-ink-mute">
                          이 큐레이터를 <b>비활성화</b>합니다. 로그인 계정은 남고, 큐레이터 기능 및 자동
                          노출/추천에서 제외됩니다.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex justify-end gap-2">
                  <button
                    onClick={() => setConfirmStep(1)}
                    className="rounded-md bg-bg-soft px-3 py-1.5 text-xs ring-1 ring-line/20 hover:bg-bg-hover"
                  >
                    뒤로
                  </button>
                  <button
                    disabled={busyId === selected.curator_id}
                    onClick={() => (confirmMode === 'delete' ? void doSoftDelete() : void doDeactivate())}
                    className={`rounded-md px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50 ${
                      confirmMode === 'delete' ? 'bg-rose-500 hover:bg-rose-600' : 'bg-amber-500 hover:bg-amber-600'
                    }`}
                  >
                    {busyId === selected.curator_id ? '처리 중...' : (
                      <span className="inline-flex items-center gap-1">
                        <CheckCircle2 size={12} />
                        {confirmMode === 'delete' ? '삭제 확정' : '비활성화 확정'}
                      </span>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
