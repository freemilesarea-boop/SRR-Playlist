import { useEffect, useState } from 'react';
import { Music, RefreshCw, Search, Check, X, EyeOff, ExternalLink, Wallet } from 'lucide-react';
import {
  adminListArtistTracks,
  approveArtistTrack,
  rejectArtistTrack,
  hideArtistTrack,
  type AdminTrackRow,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

type StatusFilter = '' | 'pending_review' | 'approved' | 'rejected' | 'hidden';
type ActionKind = 'approve' | 'reject' | 'hide';

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString('ko-KR', { year: '2-digit', month: '2-digit', day: '2-digit' });
}

const STATUS_TONE: Record<string, string> = {
  pending_review: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  approved: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
  hidden: 'bg-ink/10 text-ink-dim',
};

const STATUS_LABEL: Record<string, string> = {
  pending_review: '심사 대기',
  approved: '승인됨',
  rejected: '거절됨',
  hidden: '숨김',
};

const PAYOUT_TONE: Record<string, string> = {
  verified: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
};

export default function ArtistTrackManagementList() {
  const [rows, setRows] = useState<AdminTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ kind: ActionKind; track: AdminTrackRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await adminListArtistTracks({
        status: status || undefined,
        search: search || undefined,
      });
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    const t = window.setTimeout(load, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  async function handleConfirm(reason: string, adminNote: string) {
    if (!modal) return;
    const { kind, track } = modal;
    setBusyId(track.track_id);
    try {
      const res =
        kind === 'approve'
          ? await approveArtistTrack(track.track_id, adminNote || null)
          : kind === 'reject'
            ? await rejectArtistTrack(track.track_id, reason || null, adminNote || null)
            : await hideArtistTrack(track.track_id, adminNote || null);
      if (!res.ok) {
        toast.error(res.error ?? '처리 실패');
        return;
      }
      const labels: Record<ActionKind, string> = {
        approve: '승인 완료',
        reject: '거절 처리 완료',
        hide: '숨김 처리 완료',
      };
      toast.success(labels[kind]);
      setModal(null);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Music size={16} className="text-accent" /> 음원 관리
          </h2>
          <p className="text-xs text-ink-mute">
            {rows.length}건 · approved 만 Phase 4 정산 대상
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover"
        >
          <RefreshCw size={12} /> 새로고침
        </button>
      </div>

      {error && <Alert tone="error" title="조회 실패">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="track_code / 제목 / 아티스트 / ISRC / 이메일"
            className="input pl-9 text-sm"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="input w-auto text-sm"
        >
          <option value="">전체 상태</option>
          <option value="pending_review">심사 대기</option>
          <option value="approved">승인됨</option>
          <option value="rejected">거절됨</option>
          <option value="hidden">숨김</option>
        </select>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1200px] text-sm">
            <thead>
              <tr className="border-b border-line/10 text-[11px] uppercase text-ink-dim [&_th]:whitespace-nowrap">
                <th className="px-3 py-2.5 text-left font-semibold">track_code</th>
                <th className="px-3 py-2.5 text-left font-semibold">제목</th>
                <th className="px-3 py-2.5 text-left font-semibold">아티스트</th>
                <th className="px-3 py-2.5 text-left font-semibold">권리자</th>
                <th className="px-3 py-2.5 text-left font-semibold">ISRC</th>
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-left font-semibold">계좌</th>
                <th className="px-3 py-2.5 text-right font-semibold">등록일</th>
                <th className="w-px px-3 py-2.5 text-right font-semibold">액션</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-xs text-ink-mute">
                    불러오는 중…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && !error && (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-xs text-ink-mute">
                    등록된 음원이 없어요.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const payoutKey = r.payout_verification_status ?? 'pending';
                const payoutTone = PAYOUT_TONE[payoutKey] ?? PAYOUT_TONE.pending;
                return (
                  <tr key={r.track_id} className="border-b border-line/10 hover:bg-bg-hover">
                    <td className="px-3 py-2.5">
                      <code className="rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[10px]">
                        {r.track_code ?? '—'}
                      </code>
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="font-medium">{r.title}</p>
                      {r.album_name && (
                        <p className="text-[11px] text-ink-mute">{r.album_name}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="text-xs">{r.artist_name ?? r.artist ?? '—'}</p>
                      <p className="text-[11px] text-ink-dim">{r.artist_email ?? '—'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-xs">{r.rights_holder_name ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      <code className="font-mono text-[11px]">{r.isrc ?? '—'}</code>
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[r.visibility_status] ?? STATUS_TONE.hidden}`}
                      >
                        {STATUS_LABEL[r.visibility_status] ?? r.visibility_status}
                      </span>
                      {r.rejected_reason && (
                        <p className="mt-1 text-[10px] text-red-700 dark:text-red-300">
                          {r.rejected_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${payoutTone}`}
                      >
                        <Wallet size={9} /> {payoutKey}
                      </span>
                      {r.contract_status !== 'signed' && (
                        <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
                          계약 {r.contract_status ?? 'none'}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-ink-mute">
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex justify-end gap-1">
                        {r.visibility_status !== 'approved' && (
                          <button
                            onClick={() => setModal({ kind: 'approve', track: r })}
                            disabled={busyId === r.track_id}
                            className="rounded p-1.5 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-500/15"
                            title="승인"
                          >
                            <Check size={14} />
                          </button>
                        )}
                        {r.visibility_status !== 'rejected' && (
                          <button
                            onClick={() => setModal({ kind: 'reject', track: r })}
                            disabled={busyId === r.track_id}
                            className="rounded p-1.5 text-red-700 hover:bg-red-100 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-500/15"
                            title="거절"
                          >
                            <X size={14} />
                          </button>
                        )}
                        {r.visibility_status !== 'hidden' && (
                          <button
                            onClick={() => setModal({ kind: 'hide', track: r })}
                            disabled={busyId === r.track_id}
                            className="rounded p-1.5 text-ink-mute hover:bg-ink/10 disabled:opacity-50"
                            title="숨김"
                          >
                            <EyeOff size={14} />
                          </button>
                        )}
                        {r.audio_url && (
                          <a
                            href={r.audio_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="rounded p-1.5 text-ink-mute hover:bg-ink/10"
                            title="원본 오디오"
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <ActionModal
          kind={modal.kind}
          trackTitle={modal.track.title}
          trackCode={modal.track.track_code}
          busy={busyId === modal.track.track_id}
          onCancel={() => setModal(null)}
          onConfirm={handleConfirm}
        />
      )}
    </div>
  );
}

function ActionModal({
  kind,
  trackTitle,
  trackCode,
  busy,
  onCancel,
  onConfirm,
}: {
  kind: ActionKind;
  trackTitle: string;
  trackCode: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, adminNote: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const titles: Record<ActionKind, string> = {
    approve: '승인 처리',
    reject: '거절 처리',
    hide: '숨김 처리',
  };
  const tones: Record<ActionKind, 'success' | 'error' | 'warning'> = {
    approve: 'success',
    reject: 'error',
    hide: 'warning',
  };
  const buttonColor: Record<ActionKind, string> = {
    approve: 'bg-emerald-500 hover:bg-emerald-600',
    reject: 'bg-red-500 hover:bg-red-600',
    hide: 'bg-amber-500 hover:bg-amber-600',
  };
  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-3 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <h3 className="text-base font-bold">{titles[kind]}</h3>
        <Alert tone={tones[kind]}>
          <p className="font-semibold">{trackTitle}</p>
          {trackCode && <p className="mt-0.5 font-mono text-[11px] opacity-80">{trackCode}</p>}
        </Alert>
        {kind === 'reject' && (
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-ink-mute">아티스트에게 노출될 거절 사유</span>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="input"
              placeholder="예: 권리 확인 미흡, 음질 불량 등"
            />
          </label>
        )}
        <label className="block space-y-1">
          <span className="text-xs font-semibold text-ink-mute">내부 관리자 메모 (선택)</span>
          <textarea
            rows={2}
            value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
            className="input"
            placeholder="다음 검수자가 참고할 메모"
          />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} disabled={busy} className="btn-ghost px-3 py-2 text-xs">
            취소
          </button>
          <button
            onClick={() => onConfirm(reason, adminNote)}
            disabled={busy}
            className={`rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-60 ${buttonColor[kind]}`}
          >
            {busy ? '처리 중…' : `${titles[kind]}`}
          </button>
        </div>
      </div>
    </div>
  );
}
