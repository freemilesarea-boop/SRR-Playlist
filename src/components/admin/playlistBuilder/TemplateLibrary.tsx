/**
 * TemplateLibrary — UX-2 Template 라이브러리(기존 Playlist + Clone RPC 재사용).
 *   새 Template 엔진/테이블 없음. 기존 playlists 를 Template 카드로 보여주고,
 *   미리보기(트랙 목록 lazy 로드) 후 복제(admin_clone_playlist → 새 draft)한다.
 *   복제 즉시 배포하지 않는다(항상 draft).
 */
import { useState } from 'react';
import { Copy, Eye, X, Loader2 } from 'lucide-react';
import { AdminModal } from '@/components/admin/ui';
import type { PlaylistRow } from '@/types/db';
import { loadPlacedTracks, clonePlaylist, type PlacedTrackRow } from '@/lib/api/playlistBuilderApi';
import { suggestCloneTitle } from '@/lib/playlistBuilder';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

export function TemplateLibrary({
  open,
  onClose,
  playlists,
  counts,
  onCloned,
}: {
  open: boolean;
  onClose: () => void;
  playlists: PlaylistRow[];
  counts: Map<string, number>;
  onCloned: (newId: string, title: string) => void;
}) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previewTracks, setPreviewTracks] = useState<PlacedTrackRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [cloneId, setCloneId] = useState<string | null>(null);
  const [cloneTitle, setCloneTitle] = useState('');
  const [cloning, setCloning] = useState(false);

  const openPreview = async (p: PlaylistRow) => {
    setPreviewId(p.id);
    setPreviewTracks([]);
    setPreviewLoading(true);
    try {
      setPreviewTracks(await loadPlacedTracks(p.id));
    } catch (e) {
      toast.error(friendlyError(e, '트랙을 불러오지 못했습니다.'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const startClone = (p: PlaylistRow) => {
    setCloneId(p.id);
    setCloneTitle(suggestCloneTitle(p.title));
  };

  const doClone = async () => {
    if (!cloneId) return;
    const title = cloneTitle.trim();
    if (!title) {
      toast.error('새 제목을 입력하세요.');
      return;
    }
    setCloning(true);
    try {
      const res = await clonePlaylist(cloneId, title, 'draft');
      toast.success(`복제 완료 — "${title}" (초안)`);
      setCloneId(null);
      onCloned(res.new_playlist_id, title);
    } catch (e) {
      toast.error(friendlyError(e, '복제에 실패했습니다.'));
    } finally {
      setCloning(false);
    }
  };

  return (
    <AdminModal open={open} onClose={onClose} title="Template 라이브러리" size="xl">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {/* 카드 목록 */}
        <div className="space-y-2">
          {playlists.length === 0 && <p className="text-xs text-ink-mute">사용 가능한 Template 이 없습니다.</p>}
          {playlists.map((p) => (
            <div key={p.id} className="rounded-lg border border-line/10 p-2.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.title}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] ${
                    p.status === 'released' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                  }`}
                >
                  {p.status === 'released' ? '발매' : '초안'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-ink-mute">
                {counts.get(p.id) ?? 0}곡{p.category ? ` · ${p.category}` : ''}
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <button className="btn-ghost h-7 gap-1 px-2 text-xs" onClick={() => openPreview(p)}>
                  <Eye size={13} /> 미리보기
                </button>
                <button className="btn-ghost h-7 gap-1 px-2 text-xs" onClick={() => startClone(p)}>
                  <Copy size={13} /> 복제
                </button>
              </div>

              {/* 복제 제목 입력(인라인) */}
              {cloneId === p.id && (
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    className="input h-8 flex-1 text-sm"
                    value={cloneTitle}
                    onChange={(e) => setCloneTitle(e.target.value)}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void doClone();
                    }}
                  />
                  <button className="btn-primary h-8 px-3 text-xs disabled:opacity-50" onClick={() => void doClone()} disabled={cloning}>
                    {cloning ? '복제 중…' : '확인'}
                  </button>
                  <button className="btn-ghost h-8 px-2 text-xs" onClick={() => setCloneId(null)} aria-label="취소">
                    <X size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 미리보기 */}
        <div className="rounded-lg border border-line/10 p-2.5">
          {!previewId ? (
            <p className="p-6 text-center text-xs text-ink-mute">카드의 미리보기를 눌러 트랙을 확인하세요.</p>
          ) : previewLoading ? (
            <p className="flex items-center justify-center gap-2 p-6 text-xs text-ink-mute">
              <Loader2 size={14} className="animate-spin" /> 불러오는 중…
            </p>
          ) : (
            <>
              <p className="mb-1 text-xs font-medium">미리보기 ({previewTracks.length}곡)</p>
              <ol className="max-h-[50vh] divide-y divide-line/10 overflow-y-auto">
                {previewTracks.map((t, i) => (
                  <li key={t.track_id} className="flex items-center gap-2 py-1.5 text-sm">
                    <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-dim">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.title ?? '제목 없음'}</span>
                    <span className="shrink-0 truncate text-xs text-ink-mute">{t.artist ?? '—'}</span>
                  </li>
                ))}
                {previewTracks.length === 0 && <li className="p-4 text-center text-xs text-ink-mute">트랙이 없습니다.</li>}
              </ol>
            </>
          )}
        </div>
      </div>
    </AdminModal>
  );
}
