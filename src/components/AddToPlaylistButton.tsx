import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ListPlus, Plus, Check, X, Lock, Globe, ArrowRight } from 'lucide-react';
import {
  fetchMyPlaylistsForAdd,
  createMyPlaylistAndAddTrack,
  addTrackToUserPlaylist,
  type MyPlaylistForAdd,
} from '@/lib/userPlaylistApi';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import { errorMessage } from '@/lib/errorMessage';
import { toast } from '@/store/toastStore';

interface Props {
  trackId: string;
  /** 버튼 스타일 변형 — player(밝은 pill) / icon(테두리 원형) / bare(리스트 행용, 테두리 없음) */
  variant?: 'player' | 'icon' | 'bare';
  /** 아이콘 크기 (기본 16) */
  size?: number;
  className?: string;
}

/**
 * "플레이리스트에 담기" 버튼 + picker modal.
 * 차트/검색/대기열/곡상세/보관함 등 곡을 발견하는 모든 화면에서 재사용.
 */
export default function AddToPlaylistButton({ trackId, variant = 'icon', size = 16, className }: Props) {
  const session = useAuthStore((s) => s.session);
  const [open, setOpen] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!session) {
      toast.info('로그인 후 플레이리스트에 담을 수 있어요.');
      useGateStore.getState().open('login');
      return;
    }
    setOpen(true);
  }

  const btnClass =
    variant === 'player'
      ? 'flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/90 ring-1 ring-white/15 backdrop-blur transition hover:text-white'
      : variant === 'bare'
        ? 'flex items-center justify-center rounded-full text-ink-mute transition hover:text-accent'
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
        <ListPlus size={size} />
      </button>
      {open && <PickerModal trackId={trackId} onClose={() => setOpen(false)} />}
    </>
  );
}

function PickerModal({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState<MyPlaylistForAdd[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newPublic, setNewPublic] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [lastAdded, setLastAdded] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchMyPlaylistsForAdd(trackId)
      .then((pls) => { if (alive) setPlaylists(pls); })
      .catch((e) => { if (alive) setError(errorMessage(e)); });
    return () => { alive = false; };
  }, [trackId]);

  function contains(p: MyPlaylistForAdd) {
    return p.already_contains_track || addedIds.has(p.playlist_id);
  }

  async function onPick(p: MyPlaylistForAdd) {
    if (contains(p) || busyId) return;
    setBusyId(p.playlist_id);
    setAddedIds((prev) => new Set(prev).add(p.playlist_id)); // optimistic
    try {
      const r = await addTrackToUserPlaylist(p.playlist_id, trackId);
      if (r.already) {
        toast.info('이미 담겨 있어요');
      } else {
        toast.success(`"${p.title}" 에 담았어요`);
        setLastAdded({ id: p.playlist_id, title: p.title });
      }
    } catch (e) {
      setAddedIds((prev) => { const next = new Set(prev); next.delete(p.playlist_id); return next; }); // rollback
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function onCreate() {
    if (!newTitle.trim()) { toast.error('제목을 입력해주세요.'); return; }
    setCreateBusy(true);
    try {
      const r = await createMyPlaylistAndAddTrack(newTitle.trim(), newPublic, trackId);
      toast.success(`"${newTitle.trim()}" 만들고 담았어요`);
      setLastAdded({ id: r.playlist_id, title: newTitle.trim() });
      setCreating(false);
      setNewTitle('');
      // 목록 갱신
      fetchMyPlaylistsForAdd(trackId).then(setPlaylists).catch(() => {});
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCreateBusy(false);
    }
  }

  function goView(id: string) {
    onClose();
    navigate(`/my/playlist/${id}`);
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-bg-soft ring-1 ring-line/15 sm:rounded-3xl"
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

            <ul className="flex-1 overflow-y-auto">
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
                const added = contains(p);
                return (
                  <li key={p.playlist_id}>
                    <button
                      onClick={() => void onPick(p)}
                      disabled={added || busyId === p.playlist_id}
                      className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-bg-hover disabled:cursor-default disabled:hover:bg-transparent"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-bg-card text-ink-dim">
                        {p.is_public ? <Globe size={16} /> : <Lock size={16} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-semibold ${added ? 'text-ink-mute' : ''}`}>{p.title}</span>
                        <span className="block truncate text-xs text-ink-mute">
                          {added ? '이미 포함됨' : `트랙 ${p.track_count}`}
                        </span>
                      </span>
                      {added
                        ? <Check size={18} className="shrink-0 text-accent" />
                        : busyId === p.playlist_id
                          ? <span className="shrink-0 text-xs text-ink-mute">담는 중…</span>
                          : <Plus size={18} className="shrink-0 text-ink-mute" />}
                    </button>
                  </li>
                );
              })}
            </ul>

            {lastAdded && (
              <div className="flex items-center justify-between gap-2 border-t border-line/10 bg-bg-card/60 px-5 py-3">
                <span className="min-w-0 truncate text-xs text-ink-mute">
                  <Check size={13} className="mb-0.5 mr-1 inline text-accent" />
                  &lsquo;{lastAdded.title}&rsquo; 에 담았어요
                </span>
                <button
                  onClick={() => goView(lastAdded.id)}
                  className="flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/25"
                >
                  보기 <ArrowRight size={13} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
