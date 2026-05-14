import { useCallback, useState } from 'react';
import { Music, Check, X, EyeOff, Play } from 'lucide-react';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import {
  listPendingReviewTracks,
  approveArtistTrack,
  rejectArtistTrack,
  hideArtistTrack,
  type PendingReviewTrackRow,
} from '@/lib/artistApi';
import { toast } from '@/store/toastStore';

export default function TrackReviewList() {
  const [rows, setRows] = useState<PendingReviewTrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  async function approve(id: string) {
    setBusyId(id);
    const res = await approveArtistTrack(id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? '승인 실패');
      return;
    }
    toast.success('승인 완료 — 서비스에 노출됩니다');
    await load();
  }

  async function reject(id: string) {
    const reason = window.prompt('거절 사유 (선택)') ?? '';
    setBusyId(id);
    const res = await rejectArtistTrack(id, reason || null);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? '거절 실패');
      return;
    }
    toast.success('거절 완료');
    await load();
  }

  async function hide(id: string) {
    if (!window.confirm('이 음원을 숨김 처리하시겠어요?')) return;
    setBusyId(id);
    const res = await hideArtistTrack(id);
    setBusyId(null);
    if (!res.ok) {
      toast.error(res.error ?? '숨김 실패');
      return;
    }
    toast.success('숨김 처리 완료');
    await load();
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
            {rows.map((r) => (
              <li key={r.track_id} className="space-y-2 p-3">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-bg-hover">
                    {r.cover_url ? (
                      <img src={r.cover_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-ink-dim">
                        <Music size={14} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.title}</p>
                    <p className="truncate text-xs text-ink-mute">
                      {r.artist_name ?? r.artist ?? '—'} ·{' '}
                      <span className="text-ink-dim">{r.source_type}</span>
                    </p>
                    <p className="text-[11px] text-ink-dim">
                      업로드: {new Date(r.created_at).toLocaleString('ko-KR')}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-semibold text-yellow-200">
                    심사 대기
                  </span>
                </div>

                {r.audio_url && (
                  <audio src={r.audio_url} controls preload="none" className="h-8 w-full" />
                )}

                <div className="flex flex-wrap justify-end gap-1.5">
                  <button
                    onClick={() => approve(r.track_id)}
                    disabled={busyId === r.track_id}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    <Check size={11} /> 승인
                  </button>
                  <button
                    onClick={() => reject(r.track_id)}
                    disabled={busyId === r.track_id}
                    className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-50"
                  >
                    <X size={11} /> 거절
                  </button>
                  <button
                    onClick={() => hide(r.track_id)}
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
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
