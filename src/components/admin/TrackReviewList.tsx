import { useCallback, useState } from 'react';
import { Music, Check, X, EyeOff, Play, FileText, Wallet, ChevronDown, ChevronRight } from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  listPendingReviewTracks,
  approveArtistTrack,
  rejectArtistTrack,
  hideArtistTrack,
  type PendingReviewTrackRow,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';

type ActionKind = 'approve' | 'reject' | 'hide';

const PAYOUT_TONE: Record<string, string> = {
  verified:
    'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300',
  pending:
    'bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200',
  rejected: 'bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300',
};

const PAYOUT_LABEL: Record<string, string> = {
  verified: '계좌 ✓',
  pending: '계좌 대기',
  rejected: '계좌 거절',
};

export default function TrackReviewList() {
  const [rows, setRows] = useState<PendingReviewTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openLyricsId, setOpenLyricsId] = useState<string | null>(null);
  const [modal, setModal] = useState<{
    kind: ActionKind;
    track: PendingReviewTrackRow;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listPendingReviewTracks();
      setRows(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useFreshFetch(load, []);

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
        approve: '승인 완료 — 서비스에 노출됩니다',
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
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Music size={16} className="text-accent" /> 음원 검수
          </h2>
          <p className="text-xs text-ink-mute">심사 대기 {rows.length}건</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-xs text-ink-mute">심사 대기 중인 음원이 없어요.</div>
        ) : (
          <ul className="divide-y divide-line/10">
            {rows.map((r) => {
              const payoutKey = r.payout_verification_status ?? 'pending';
              const payoutTone = PAYOUT_TONE[payoutKey] ?? PAYOUT_TONE.pending;
              const payoutLabel = PAYOUT_LABEL[payoutKey] ?? '계좌 미등록';
              const lyricsOpen = openLyricsId === r.track_id;
              return (
                <li key={r.track_id} className="space-y-2 p-3">
                  <div className="flex items-start gap-3">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-bg-hover">
                      {r.cover_url ? (
                        <img src={r.cover_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-ink-dim">
                          <Music size={14} />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="truncate text-sm font-semibold">{r.title}</p>
                      {r.track_code && (
                        <code className="inline-block rounded bg-bg-soft px-1.5 py-0.5 font-mono text-[10px] text-ink-mute">
                          {r.track_code}
                        </code>
                      )}
                      <p className="truncate text-xs text-ink-mute">
                        {r.artist_name ?? r.artist ?? '—'}
                        {r.album_name && <span className="text-ink-dim"> · {r.album_name}</span>}
                      </p>
                      {r.rights_holder_name && (
                        <p className="text-[11px] text-ink-dim">
                          권리자: <span className="text-ink-mute">{r.rights_holder_name}</span>
                          {r.isrc && (
                            <span className="ml-2">
                              ISRC: <code className="font-mono">{r.isrc}</code>
                            </span>
                          )}
                        </p>
                      )}
                      <p className="text-[11px] text-ink-dim">
                        업로드: {new Date(r.created_at).toLocaleString('ko-KR')}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                        심사 대기
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${payoutTone}`}
                        title={r.payout_bank_name ?? '—'}
                      >
                        <Wallet size={9} />
                        {payoutLabel}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {r.main_genre && (
                      <Tag label="메인" value={r.main_genre} tone="bg-accent/15 text-accent" />
                    )}
                    {r.sub_genre && (
                      <Tag label="서브" value={r.sub_genre} tone="bg-ink/5 text-ink-mute" />
                    )}
                    {r.mood && <Tag label="분위기" value={r.mood} tone="bg-ink/5 text-ink-mute" />}
                    {r.suitable_store && (
                      <Tag
                        label="매장"
                        value={r.suitable_store}
                        tone="bg-sky-100 text-sky-900 dark:bg-blue-500/15 dark:text-blue-200"
                      />
                    )}
                  </div>

                  {r.admin_note && (
                    <p className="rounded bg-bg-soft px-2 py-1 text-[11px] text-ink-mute">
                      📝 이전 관리자 메모: {r.admin_note}
                    </p>
                  )}

                  {r.audio_url && (
                    <audio src={r.audio_url} controls preload="none" className="h-8 w-full" />
                  )}

                  {r.lyrics && (
                    <div className="rounded-md bg-bg-hover/40 p-2">
                      <button
                        type="button"
                        onClick={() => setOpenLyricsId(lyricsOpen ? null : r.track_id)}
                        className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-ink-mute hover:text-ink"
                      >
                        {lyricsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        <FileText size={11} />
                        가사 ({r.lyrics.length}자)
                      </button>
                      {lyricsOpen && (
                        <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink-mute">
                          {r.lyrics}
                        </pre>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-1.5">
                    <button
                      onClick={() => setModal({ kind: 'approve', track: r })}
                      disabled={busyId === r.track_id}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-200 disabled:opacity-50 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25"
                    >
                      <Check size={11} /> 승인
                    </button>
                    <button
                      onClick={() => setModal({ kind: 'reject', track: r })}
                      disabled={busyId === r.track_id}
                      className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2.5 py-1 text-[11px] font-semibold text-red-900 hover:bg-red-200 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
                    >
                      <X size={11} /> 거절
                    </button>
                    <button
                      onClick={() => setModal({ kind: 'hide', track: r })}
                      disabled={busyId === r.track_id}
                      className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2.5 py-1 text-[11px] font-semibold text-ink-mute hover:bg-ink/10 disabled:opacity-50"
                    >
                      <EyeOff size={11} /> 숨김
                    </button>
                    {r.audio_url && (
                      <a
                        href={r.audio_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2.5 py-1 text-[11px] font-semibold text-ink-mute hover:bg-ink/10"
                      >
                        <Play size={11} /> 원본
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {modal && (
        <ReviewActionModal
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

function ReviewActionModal({
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
          {trackCode && (
            <p className="mt-0.5 font-mono text-[11px] opacity-80">{trackCode}</p>
          )}
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

function Tag({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${tone}`}>
      <span className="text-[9px] uppercase tracking-wider opacity-70">{label}</span>
      {value}
    </span>
  );
}
