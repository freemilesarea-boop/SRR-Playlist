import { useEffect, useState } from 'react';
import { ListPlus, Plus, Check, X, Lock, Globe } from 'lucide-react';
import {
  fetchMyUserPlaylists,
  createUserPlaylist,
  addTrackToUserPlaylist,
  type MyUserPlaylist,
} from '@/lib/userPlaylistApi';
import { useAuthStore } from '@/store/authStore';
import { errorMessage } from '@/lib/errorMessage';
import { toast } from '@/store/toastStore';

interface Props {
  trackId: string;
  /** 버튼 스타일 변형 — player(밝은 pill) / icon(테두리) */
  variant?: 'player' | 'icon';
  className?: string;
}

/**
 * "플레이리스트에 담기" 버튼 + picker modal.
 * Player / TrackSharePage 등 여러 곳에서 재사용.
 */
export default function AddToPlaylistButton({ trackId, variant = 'icon', className }: Props) {
  const session = useAuthStore((s) => s.session);
  const [open, setOpen] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!session) {
      toast.info('로그인 후 플레이리스트에 담을 수 있어요.');
      return;
    }
    setOpen(true);
  }

  const btnClass =
    variant === 'player'
      ? 'flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 ring-1 ring-white/15 backdrop-blur transition hover:text-white'
      : 'flex h-9 w-9 items-center justify-center rounded-full text-ink-mute ring-1 ring-line/15 transition hover:text-accent hover:ring-accent/30';

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`${btnClass} ${className ?? ''}`}
        aria-label="플레이리스트에 담기"
        title="플레이리스트에 담기"
      >
        <ListPlus size={variant === 'player' ? 16 : 16} />
      </button>
      {open && <PickerModal trackId={trackId} onClose={() => setOpen(false)} />}
    </>
  );
}

function PickerModal({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const [playlists, setPlaylists] = useState<MyUserPlaylist[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  // 최초 로드
  useEffect(() => {
    let alive = true;
    fetchMyUserPlaylists()
      .then((pls) => { if (alive) setPlaylists(pls); })
      .catch((e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, []);

  async function onPick(p: MyUserPlaylist) {
    if (addedIds.has(p.id) || busyId) return;
    setBusyId(p.id);
    // optimistic
    setAddedIds((prev) => new Set(prev).add(p.id));
    try {
      const r = await addTrackToUserPlaylist(p.id, trackId);
      toast.success(r.already ? '이미 담겨 있어요' : `"${p.title}" 에 담았어요`);
    } catch (e) {
      // rollback
      setAddedIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function onCreate() {
    if (!newTitle.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    setCreateBusy(true);
    try {
      const id = await createUserPlaylist({ title: newTitle.trim(), is_public: newPublic });
      await addTrackToUserPlaylist(id, trackId);
      toast.success(`"${newTitle.trim()}" 만들고 담았어요`);
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-t-3xl bg-bg-soft ring-1 ring-line/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/10 px-5 py-3">
          <h2 className="text-base font-bold">플레이리스트에 담기</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5" aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        {creating ? (
          <div className="space-y-4 p-5">
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">제목</label>
              <input
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="새 플레이리스트 이름"
                className="input text-sm"
                autoFocus
              />
            </div>
            <button
              type="button"
              onClick={() => setNewPublic((v) => !v)}
              className="flex w-full items-center justify-between rounded-xl bg-bg-card px-3 py-2.5 text-sm ring-1 ring-line/10"
            >
              <span className="flex items-center gap-2 text-ink-mute">
                {newPublic ? <Globe size={15} /> : <Lock size={15} />}
                {newPublic ? '공개 — 다른 사람도 볼 수 있어요' : '비공개 — 나만 볼 수 있어요'}
              </span>
              <span className={`h-5 w-9 rounded-full transition ${newPublic ? 'bg-accent' : 'bg-ink/15'} relative`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${newPublic ? 'left-[1.125rem]' : 'left-0.5'}`} />
              </span>
            </button>
            <div className="flex gap-2">
              <button onClick={() => setCreating(false)} disabled={createBusy} className="btn-ghost flex-1 py-2.5 text-sm">
                뒤로
              </button>
              <button onClick={() => void onCreate()} disabled={createBusy} className="btn-primary flex-1 py-2.5 text-sm">
                {createBusy ? '만드는 중…' : '만들고 담기'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-3 border-b border-line/10 px-5 py-3.5 text-left hover:bg-bg-hover"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <Plus size={18} />
              </span>
              <span className="text-sm font-semibold">새 플레이리스트 만들기</span>
            </button>

            <ul className="max-h-[50vh] overflow-y-auto">
              {error && <li className="p-5 text-center text-xs text-red-300">{error}</li>}
              {!error && playlists === null && (
                <li className="p-6 text-center text-sm text-ink-mute">불러오는 중…</li>
              )}
              {!error && playlists?.length === 0 && (
                <li className="p-6 text-center text-sm text-ink-mute">
                  아직 플레이리스트가 없어요.<br />위에서 새로 만들어보세요.
                </li>
              )}
              {playlists?.map((p) => {
                const added = addedIds.has(p.id);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => void onPick(p)}
                      disabled={busyId === p.id}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-bg-hover disabled:opacity-60"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-card text-ink-dim">
                        {p.is_public ? <Globe size={16} /> : <Lock size={16} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{p.title}</span>
                        <span className="block truncate text-xs text-ink-mute">트랙 {p.track_count}</span>
                      </span>
                      {added && <Check size={18} className="shrink-0 text-accent" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
