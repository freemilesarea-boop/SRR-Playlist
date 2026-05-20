import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Lock, Globe, ListMusic, Heart, Users, Play, X } from 'lucide-react';
import {
  fetchMyUserPlaylists,
  fetchFollowedUserPlaylists,
  createUserPlaylist,
  type MyUserPlaylist,
  type FollowedUserPlaylist,
} from '@/lib/userPlaylistApi';
import { fetchLibraryOverview } from '@/lib/libraryApi';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { errorMessage } from '@/lib/errorMessage';
import { toast } from '@/store/toastStore';
import type { TrackRow } from '@/types/db';
import AutoCover from '@/components/AutoCover';
import ErrorRetry from '@/components/common/ErrorRetry';

type Tab = 'mine' | 'liked' | 'followed';

export default function MyPlaylistsPage() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const [tab, setTab] = useState<Tab>('mine');
  const [mine, setMine] = useState<MyUserPlaylist[]>([]);
  const [followed, setFollowed] = useState<FollowedUserPlaylist[]>([]);
  const [likedTracks, setLikedTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [m, f, ov] = await Promise.all([
        fetchMyUserPlaylists(),
        fetchFollowedUserPlaylists(),
        userId ? fetchLibraryOverview(userId) : Promise.resolve(null),
      ]);
      setMine(m);
      setFollowed(f);
      setLikedTracks((ov?.liked_tracks ?? []) as TrackRow[]);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useFreshFetch(load, [userId]);

  function playLiked(startId: string) {
    const { playable } = filterPlayableTracks(likedTracks);
    if (playable.length === 0) {
      toast.info('재생 가능한 곡이 없어요.');
      return;
    }
    const idx = Math.max(0, playable.findIndex((t) => t.id === startId));
    setQueue(playable, idx, null);
  }

  return (
    <div className="space-y-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-accent">내 음악</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">내 플레이리스트</h1>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary shrink-0">
          <Plus size={16} /> 새 플리
        </button>
      </header>

      {/* 탭 */}
      <div className="flex gap-1 rounded-full bg-bg-card p-1 text-sm">
        <TabBtn active={tab === 'mine'} onClick={() => setTab('mine')} icon={<ListMusic size={14} />} label="내가 만든" />
        <TabBtn active={tab === 'liked'} onClick={() => setTab('liked')} icon={<Heart size={14} />} label="좋아요한 곡" />
        <TabBtn active={tab === 'followed'} onClick={() => setTab('followed')} icon={<Users size={14} />} label="팔로우한" />
      </div>

      {error ? (
        <ErrorRetry message={error} onRetry={() => void load()} />
      ) : loading ? (
        <div className="py-12 text-center text-sm text-ink-mute">불러오는 중…</div>
      ) : tab === 'mine' ? (
        mine.length === 0 ? (
          <Empty>아직 만든 플레이리스트가 없어요. "새 플리" 로 시작해보세요.</Empty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {mine.map((p) => (
              <Link key={p.id} to={`/my/playlist/${p.id}`} className="group block space-y-2">
                <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-1 group-hover:shadow-lift">
                  <AutoCover title={p.title} category={null} imageUrl={p.thumbnail_url} size="lg" />
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur">
                    {p.is_public ? <Globe size={9} /> : <Lock size={9} />}
                    {p.is_public ? '공개' : '비공개'}
                  </span>
                </div>
                <div className="space-y-0.5 px-0.5">
                  <h3 className="line-clamp-1 text-sm font-semibold">{p.title}</h3>
                  <p className="line-clamp-1 text-xs text-ink-mute">트랙 {p.track_count}</p>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : tab === 'liked' ? (
        likedTracks.length === 0 ? (
          <Empty>아직 좋아요한 곡이 없어요.</Empty>
        ) : (
          <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
            {likedTracks.map((t) => {
              const playable = isPlayableUrl(t.audio_url);
              return (
                <li key={t.id}>
                  <button
                    onClick={() => playable && playLiked(t.id)}
                    disabled={!playable}
                    className={`flex w-full items-center gap-3 border-b border-line/10 px-3 py-2.5 text-left last:border-b-0 ${
                      playable ? 'hover:bg-ink/5' : 'cursor-not-allowed opacity-50'
                    }`}
                  >
                    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
                      <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="sm" />
                      {playable && (
                        <span className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity hover:opacity-100">
                          <Play size={14} fill="currentColor" className="text-white" />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{t.title}</p>
                      <p className="truncate text-xs text-ink-mute">{t.artist ?? '—'}</p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : followed.length === 0 ? (
        <Empty>팔로우한 플레이리스트가 없어요.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {followed.map((p) => (
            <Link key={p.id} to={`/my/playlist/${p.id}`} className="group block space-y-2">
              <div className="relative aspect-square overflow-hidden rounded-2xl bg-bg-card shadow-card ring-1 ring-line/10 transition group-hover:-translate-y-1 group-hover:shadow-lift">
                <AutoCover title={p.title} category={null} imageUrl={p.thumbnail_url} size="lg" />
              </div>
              <div className="space-y-0.5 px-0.5">
                <h3 className="line-clamp-1 text-sm font-semibold">{p.title}</h3>
                <p className="line-clamp-1 text-xs text-ink-mute">트랙 {p.track_count}</p>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-semibold transition ${
        active ? 'bg-accent text-white shadow-card' : 'text-ink-mute hover:text-ink'
      }`}
    >
      {icon} {label}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-bg-card/60 p-8 text-center text-sm text-ink-mute ring-1 ring-line/10">
      {children}
    </div>
  );
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      await createUserPlaylist({ title: title.trim(), is_public: isPublic });
      toast.success('플레이리스트를 만들었어요.');
      onCreated();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">새 플레이리스트</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5" aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">제목</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 출근길 플레이리스트" className="input text-sm" autoFocus />
        </div>
        <button type="button" onClick={() => setIsPublic((v) => !v)} className="flex w-full items-center justify-between rounded-xl bg-bg-card px-3 py-2.5 text-sm ring-1 ring-line/10">
          <span className="flex items-center gap-2 text-ink-mute">
            {isPublic ? <Globe size={15} /> : <Lock size={15} />}
            {isPublic ? '공개' : '비공개'}
          </span>
          <span className={`relative h-5 w-9 rounded-full transition ${isPublic ? 'bg-accent' : 'bg-ink/15'}`}>
            <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${isPublic ? 'left-[1.125rem]' : 'left-0.5'}`} />
          </span>
        </button>
        <div className="flex gap-2">
          <button onClick={onClose} disabled={busy} className="btn-ghost flex-1 py-2.5 text-sm">취소</button>
          <button onClick={() => void submit()} disabled={busy} className="btn-primary flex-1 py-2.5 text-sm">{busy ? '만드는 중…' : '만들기'}</button>
        </div>
      </div>
    </div>
  );
}
