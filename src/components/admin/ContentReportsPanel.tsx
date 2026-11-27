import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flag, ExternalLink, RefreshCw } from 'lucide-react';
import {
  adminListContentReports, adminResolveContentReport, reportTargetPath,
  REPORT_REASONS, REPORT_TARGET_LABEL, type AdminContentReport, type ReportStatus,
} from '@/lib/moderationApi';
import { toast } from '@/store/toastStore';
import { errorMessage } from '@/lib/errorMessage';
import { adminTones } from '@/lib/adminTones';

const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.value, r.label])) as Record<string, string>;
const STATUS_TABS: Array<{ key: ReportStatus | 'all'; label: string }> = [
  { key: 'open', label: '처리 대기' },
  { key: 'actioned', label: '조치함' },
  { key: 'dismissed', label: '문제없음' },
  { key: 'all', label: '전체' },
];

/**
 * 관리자 → 신고 관리 (migration 0568).
 * 회원이 신고한 음원·플레이리스트·큐레이터를 확인하고 처리한다(App Store 지침 1.2 — 24시간 안 처리 목표).
 * 회원 플레이리스트는 여기서 바로 비공개로 돌릴 수 있다. 음원·큐레이터 조치는 콘텐츠 관리 / 큐레이터 관리에서 한다.
 */
export default function ContentReportsPanel() {
  const [status, setStatus] = useState<ReportStatus | 'all'>('open');
  const [rows, setRows] = useState<AdminContentReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await adminListContentReports(status));
    } catch (e) {
      setError(errorMessage(e));
      setRows([]);
    }
  }, [status]);

  useEffect(() => { setRows(null); void load(); }, [load]);

  async function resolve(r: AdminContentReport, next: 'actioned' | 'dismissed', hide = false) {
    const note = window.prompt(next === 'actioned' ? '조치 내용을 적어 주세요 (선택)' : '문제없음으로 처리하는 이유 (선택)') ?? undefined;
    setBusyId(r.id);
    try {
      await adminResolveContentReport({ reportId: r.id, status: next, note, hideUserPlaylist: hide });
      toast.success(hide ? '비공개로 돌리고 처리했어요.' : '처리했어요.');
      void load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold"><Flag size={18} /> 신고 관리</h2>
        <div className="ml-auto flex flex-wrap gap-1">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className={`rounded-full px-3 py-1.5 text-xs ring-1 ${status === t.key ? 'bg-accent text-white ring-accent' : 'text-ink-mute ring-line/15 hover:text-ink'}`}
            >
              {t.label}
            </button>
          ))}
          <button onClick={() => void load()} className="rounded-full px-2 py-1.5 text-ink-mute ring-1 ring-line/15 hover:text-ink" aria-label="새로고침">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>
      <p className="text-xs text-ink-mute">
        신고는 24시간 안에 확인하는 것을 목표로 합니다(App Store 운영 기준). 같은 대상의 신고는 한 번에 함께 처리됩니다.
      </p>

      {error && <p className={`text-sm ${adminTones.danger.text}`}>{error}</p>}
      {rows === null ? (
        <p className="text-sm text-ink-mute">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-2xl bg-bg-card p-6 text-center text-sm text-ink-mute ring-1 ring-line/10">신고가 없어요.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const path = reportTargetPath(r);
            return (
              <li key={r.id} className="space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-ink/5 px-2 py-0.5 font-semibold">{REPORT_TARGET_LABEL[r.target_type]}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${adminTones.danger.badge}`}>{REASON_LABEL[r.reason] ?? r.reason}</span>
                  {r.report_count > 1 && <span className="text-ink-mute">누적 신고 {r.report_count}건</span>}
                  <span className="ml-auto text-ink-dim">{new Date(r.created_at).toLocaleString('ko-KR')}</span>
                </div>
                <p className="text-sm font-semibold">
                  {r.target_label ?? '(삭제된 대상)'}
                  {path && (
                    <Link to={path} target="_blank" className="ml-1 inline-flex items-center text-accent" aria-label="대상 열기">
                      <ExternalLink size={13} />
                    </Link>
                  )}
                </p>
                <p className="text-xs text-ink-mute">
                  작성자 {r.owner_name ?? '알 수 없음'} · 신고자 {r.reporter_name}
                </p>
                {r.detail && <p className="whitespace-pre-wrap rounded-xl bg-ink/5 p-2 text-xs">{r.detail}</p>}
                {r.status !== 'open' ? (
                  <p className="text-xs text-ink-mute">
                    {r.status === 'actioned' ? '조치함' : '문제없음'}
                    {r.resolved_at && ` · ${new Date(r.resolved_at).toLocaleString('ko-KR')}`}
                    {r.admin_note && ` · ${r.admin_note}`}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {r.target_type === 'user_playlist' && (
                      <button disabled={busyId === r.id} onClick={() => void resolve(r, 'actioned', true)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${adminTones.danger.buttonSolid}`}>
                        비공개로 돌리고 조치함
                      </button>
                    )}
                    <button disabled={busyId === r.id} onClick={() => void resolve(r, 'actioned')}
                      className="rounded-full px-3 py-1.5 text-xs ring-1 ring-line/15 disabled:opacity-50">
                      조치함 (다른 화면에서 처리)
                    </button>
                    <button disabled={busyId === r.id} onClick={() => void resolve(r, 'dismissed')}
                      className="rounded-full px-3 py-1.5 text-xs text-ink-mute ring-1 ring-line/15 disabled:opacity-50">
                      문제없음
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
