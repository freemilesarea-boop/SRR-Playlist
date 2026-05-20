import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Play, GripVertical, Trash2, Pencil, Lock, Globe, X, Music2, Heart,
} from 'lucide-react';
import {
  DndContext, closestCenter, type DragEndEvent, PointerSensor, TouchSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  fetchUserPlaylistDetail,
  removeTrackFromUserPlaylist,
  reorderUserPlaylistTracks,
  updateUserPlaylistMeta,
  deleteUserPlaylist,
  toggleUserPlaylistFollow,
  type UserPlaylistDetail,
} from '@/lib/userPlaylistApi';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { errorMessage } from '@/lib/errorMessage';
import { toast } from '@/store/toastStore';
import type { TrackRow } from '@/types/db';
import AutoCover from '@/components/AutoCover';
import ErrorRetry from '@/components/common/ErrorRetry';
import { withTimeout } from '@/lib/withTimeout';

type DetailTrack = TrackRow & { order_index: number };

export default function UserPlaylistDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const setQueue = usePlayerStore((s) => s.setQueue);
  const [data, setData] = useState<UserPlaylistDetail | null>(null);
  const [tracks, setTracks] = useState<DetailTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await withTimeout(fetchUserPlaylistDetail(id), 12_000, '플레이리스트');
      if (!d) {
        setError('플레이리스트를 찾을 수 없어요.');
        setData(null);
      } else {
        setData(d);
        setTracks(d.tracks);
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useFreshFetch(load, [id]);

  function playAll(startId?: string) {
    const { playable } = filterPlayableTracks(tracks);
    if (playable.length === 0) {
      toast.info('재생 가능한 곡이 없어요.');
      return;
    }
    const idx = startId ? Math.max(0, playable.findIndex((t) => t.id === startId)) : 0;
    setQueue(playable, idx, null, { type: 'user', id });
  }

  async function onRemove(trackId: string) {
    const prev = tracks;
    setTracks((t) => t.filter((x) => x.id !== trackId)); // optimistic
    try {
      await removeTrackFromUserPlaylist(id, trackId);
    } catch (e) {
      setTracks(prev);
      toast.error(errorMessage(e));
    }
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = tracks.findIndex((t) => t.id === active.id);
    const newIdx = tracks.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(tracks, oldIdx, newIdx);
    setTracks(next); // optimistic
    try {
      await reorderUserPlaylistTracks(id, next.map((t) => t.id));
    } catch (err) {
      toast.error(errorMessage(err));
      void load(); // rollback to server
    }
  }

  async function onFollow() {
    if (!data) return;
    const wasFollowing = data.is_following;
    setData({ ...data, is_following: !wasFollowing, follower_count: data.follower_count + (wasFollowing ? -1 : 1) });
    try {
      await toggleUserPlaylistFollow(id);
    } catch (e) {
      setData({ ...data });
      toast.error(errorMessage(e));
    }
  }

  if (loading) return <div className="px-4 py-16 text-center text-sm text-ink-mute sm:px-6">불러오는 중…</div>;
  if (error) {
    return (
      <div className="px-4 py-10 sm:px-6">
        <ErrorRetry message={error} onRetry={() => void load()} />
        <div className="mt-3 text-center">
          <button onClick={() => navigate(-1)} className="btn-ghost text-sm"><ArrowLeft size={14} /> 뒤로</button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <Music2 size={32} className="text-ink-dim" />
        <p className="text-sm text-ink-mute">플레이리스트를 찾을 수 없어요.</p>
        <button onClick={() => navigate(-1)} className="btn-ghost mt-2 text-sm"><ArrowLeft size={14} /> 뒤로</button>
      </div>
    );
  }

  const hasPlayable = tracks.some((t) => isPlayableUrl(t.audio_url));

  return (
    <div className="space-y-5 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-xs text-ink-mute hover:text-ink">
        <ArrowLeft size={14} /> 뒤로
      </button>

      {/* 헤더 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <div className="aspect-square w-32 shrink-0 overflow-hidden rounded-2xl shadow-elevated ring-1 ring-line/10 sm:w-44">
          <AutoCover title={data.title} category={null} imageUrl={data.thumbnail_url} size="xl" />
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <span className="flex items-center gap-1 text-[11px] font-medium text-ink-mute">
            {data.is_public ? <Globe size={11} /> : <Lock size={11} />}
            {data.is_public ? '공개 플레이리스트' : '비공개 플레이리스트'}
          </span>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{data.title}</h1>
          <p className="text-sm font-medium text-ink-mute">
            {data.creator_is_curator ? '큐레이터 ' : 'by '}
            {data.creator_handle ? (
              <Link to={`/curator/${data.creator_handle}`} className="hover:text-accent">{data.creator_name}</Link>
            ) : (
              data.creator_name
            )}
          </p>
          {data.description && <p className="text-sm text-ink-mute">{data.description}</p>}
          <p className="text-xs text-ink-dim">
            트랙 {tracks.length} · 팔로워 {data.follower_count} · 조회수 {data.total_views.toLocaleString()}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button onClick={() => playAll()} disabled={!hasPlayable} className="btn-primary px-5 py-2.5 disabled:opacity-50">
              <Play size={16} fill="currentColor" /> 재생
            </button>
            {data.is_owner ? (
              <button onClick={() => setEditing(true)} className="btn-ghost px-3 py-2.5">
                <Pencil size={16} />
              </button>
            ) : (
              <button onClick={() => void onFollow()} className={`btn-ghost px-4 py-2.5 ${data.is_following ? 'text-accent' : ''}`}>
                <Heart size={16} fill={data.is_following ? 'currentColor' : 'none'} /> {data.is_following ? '팔로잉' : '팔로우'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 트랙 목록 */}
      {tracks.length === 0 ? (
        <div className="rounded-2xl bg-bg-card/60 p-8 text-center text-sm text-ink-mute ring-1 ring-line/10">
          아직 곡이 없어요. 곡 상세나 플레이어에서 "담기" 를 눌러 추가해보세요.
        </div>
      ) : data.is_owner ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
            <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
              {tracks.map((t) => (
                <SortableTrack key={t.id} track={t} onRemove={() => void onRemove(t.id)} onPlay={() => playAll(t.id)} />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
          {tracks.map((t) => {
            const playable = isPlayableUrl(t.audio_url);
            return (
              <li key={t.id}>
                <button onClick={() => playable && playAll(t.id)} disabled={!playable} className={`flex w-full items-center gap-3 border-b border-line/10 px-3 py-2.5 text-left last:border-b-0 ${playable ? 'hover:bg-ink/5' : 'cursor-not-allowed opacity-50'}`}>
                  <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
                    <AutoCover title={t.title} category={t.genre} imageUrl={t.cover_url} size="sm" />
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
      )}

      {editing && data.is_owner && (
        <EditModal
          detail={data}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); }}
          onDeleted={() => navigate('/my/playlists', { replace: true })}
        />
      )}
    </div>
  );
}

function SortableTrack({ track, onRemove, onPlay }: { track: DetailTrack; onRemove: () => void; onPlay: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const playable = isPlayableUrl(track.audio_url);
  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2 border-b border-line/10 px-3 py-2.5 last:border-b-0">
      <button {...attributes} {...listeners} className="cursor-grab touch-none text-ink-dim active:cursor-grabbing" aria-label="순서 변경">
        <GripVertical size={16} />
      </button>
      <button onClick={onPlay} disabled={!playable} className={`flex min-w-0 flex-1 items-center gap-3 text-left ${playable ? '' : 'opacity-50'}`}>
        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
          <AutoCover title={track.title} category={track.genre} imageUrl={track.cover_url} size="sm" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{track.title}</p>
          <p className="truncate text-xs text-ink-mute">{track.artist ?? '—'}</p>
        </div>
      </button>
      <button onClick={onRemove} className="rounded-md p-2 text-red-300 hover:bg-red-500/10" aria-label="제거">
        <Trash2 size={15} />
      </button>
    </li>
  );
}

function EditModal({
  detail, onClose, onSaved, onDeleted,
}: {
  detail: UserPlaylistDetail;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(detail.description ?? '');
  const [isPublic, setIsPublic] = useState(detail.is_public);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save() {
    if (!title.trim()) { toast.error('제목을 입력해주세요.'); return; }
    setBusy(true);
    try {
      await updateUserPlaylistMeta(detail.id, {
        title: title.trim(),
        description: description.trim() || null,
        is_public: isPublic,
      });
      toast.success('변경했어요.');
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteUserPlaylist(detail.id);
      toast.success('플레이리스트를 삭제했어요.');
      onDeleted();
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
          <h2 className="text-base font-bold">플레이리스트 편집</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5" aria-label="닫기"><X size={16} /></button>
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">제목</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="input text-sm" />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">설명</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="input resize-none text-sm" />
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
          <button onClick={() => void save()} disabled={busy} className="btn-primary flex-1 py-2.5 text-sm">{busy ? '저장 중…' : '저장'}</button>
        </div>
        {confirmDelete ? (
          <div className="flex items-center gap-2 rounded-xl bg-red-500/10 p-3">
            <span className="flex-1 text-xs text-red-200">정말 삭제할까요? 되돌릴 수 없어요.</span>
            <button onClick={() => setConfirmDelete(false)} disabled={busy} className="text-xs text-ink-mute">취소</button>
            <button onClick={() => void remove()} disabled={busy} className="rounded-full bg-red-500/90 px-3 py-1.5 text-xs font-bold text-white">삭제</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="w-full text-center text-xs text-red-300 hover:underline">
            플레이리스트 삭제
          </button>
        )}
      </div>
    </div>
  );
}
