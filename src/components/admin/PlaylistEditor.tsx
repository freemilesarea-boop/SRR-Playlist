import { useEffect, useState } from 'react';
import { ArrowLeft, GripVertical, Plus, Music, X, ImageIcon } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { supabase } from '@/lib/supabase';
import { fetchPlaylist, fetchPlaylistTracks } from '@/lib/api';
import type { PlaylistRow, TrackRow } from '@/types/db';

interface Props {
  playlistId: string;
  allTracks: TrackRow[];
  onClose: () => void;
}

export default function PlaylistEditor({ playlistId, allTracks, onClose }: Props) {
  const [playlist, setPlaylist] = useState<PlaylistRow | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [thumbBusy, setThumbBusy] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  async function reload() {
    const [p, t] = await Promise.all([fetchPlaylist(playlistId), fetchPlaylistTracks(playlistId)]);
    setPlaylist(p);
    setTracks(t);
  }

  useEffect(() => {
    setLoading(true);
    reload().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  async function addTrack(track: TrackRow) {
    const maxOrder = tracks.length;
    const { error } = await supabase.from('playlist_tracks').insert({
      playlist_id: playlistId,
      track_id: track.id,
      order_index: maxOrder,
    });
    if (error) {
      alert(error.message);
      return;
    }
    setTracks((prev) => [...prev, track]);
  }

  async function removeTrack(trackId: string) {
    const { error } = await supabase
      .from('playlist_tracks')
      .delete()
      .match({ playlist_id: playlistId, track_id: trackId });
    if (error) {
      alert(error.message);
      return;
    }
    setTracks((prev) => prev.filter((t) => t.id !== trackId));
  }

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = tracks.findIndex((t) => t.id === active.id);
    const newIdx = tracks.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = arrayMove(tracks, oldIdx, newIdx);
    setTracks(next);

    // persist new order_index values
    const updates = next.map((t, idx) =>
      supabase
        .from('playlist_tracks')
        .update({ order_index: idx })
        .match({ playlist_id: playlistId, track_id: t.id }),
    );
    await Promise.all(updates);
  }

  async function uploadThumb(file: File) {
    setThumbBusy(true);
    try {
      const ext = file.name.split('.').pop() ?? 'jpg';
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('covers').upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
      });
      if (upErr) throw upErr;
      const { data } = supabase.storage.from('covers').getPublicUrl(path);
      const { error } = await supabase
        .from('playlists')
        .update({ thumbnail_url: data.publicUrl })
        .eq('id', playlistId);
      if (error) throw error;
      await reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setThumbBusy(false);
    }
  }

  const existingIds = new Set(tracks.map((t) => t.id));
  const candidates = allTracks.filter((t) => !existingIds.has(t.id));

  if (loading || !playlist) {
    return <div className="p-6 text-ink-mute">불러오는 중…</div>;
  }

  return (
    <div className="space-y-5 px-4 pb-8 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <button
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card"
          aria-label="뒤로"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold">{playlist.title}</h1>
          <p className="text-xs text-ink-mute">{playlist.category}</p>
        </div>
      </header>

      <div className="flex items-center gap-3 rounded-2xl bg-bg-card p-3">
        <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-bg-hover">
          {playlist.thumbnail_url ? (
            <img src={playlist.thumbnail_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-ink-dim">
              <ImageIcon size={18} />
            </div>
          )}
        </div>
        <div className="flex-1 text-xs text-ink-mute">썸네일</div>
        <label className="btn-ghost cursor-pointer text-xs">
          {thumbBusy ? '업로드…' : '변경'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadThumb(f);
            }}
          />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-mute">트랙 ({tracks.length})</h2>
        <button onClick={() => setPicker(true)} className="btn-primary text-xs">
          <Plus size={14} /> 트랙 추가
        </button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={tracks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <ul className="overflow-hidden rounded-2xl bg-bg-card">
            {tracks.map((t) => (
              <SortableTrack key={t.id} track={t} onRemove={() => removeTrack(t.id)} />
            ))}
            {tracks.length === 0 && (
              <li className="p-6 text-center text-sm text-ink-mute">
                트랙이 없어요. ‘트랙 추가’를 눌러보세요.
              </li>
            )}
          </ul>
        </SortableContext>
      </DndContext>

      {picker && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-bg-soft sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-white/5 p-4">
              <h3 className="text-sm font-semibold">트랙 선택</h3>
              <button onClick={() => setPicker(false)} aria-label="닫기">
                <X size={18} />
              </button>
            </div>
            <ul className="max-h-[60vh] divide-y divide-white/5 overflow-y-auto">
              {candidates.map((t) => (
                <li
                  key={t.id}
                  className="flex cursor-pointer items-center gap-3 p-3 hover:bg-bg-hover"
                  onClick={() => {
                    void addTrack(t);
                    setPicker(false);
                  }}
                >
                  <Music size={14} className="text-ink-dim" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{t.title}</p>
                    <p className="truncate text-xs text-ink-mute">{t.artist ?? '—'}</p>
                  </div>
                </li>
              ))}
              {candidates.length === 0 && (
                <li className="p-6 text-center text-sm text-ink-mute">
                  추가할 수 있는 트랙이 없어요.
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableTrack({ track, onRemove }: { track: TrackRow; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 border-b border-white/5 p-3 last:border-b-0"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-ink-dim active:cursor-grabbing"
        aria-label="순서 변경"
      >
        <GripVertical size={16} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{track.title}</p>
        <p className="truncate text-xs text-ink-mute">{track.artist ?? '—'}</p>
      </div>
      <button
        onClick={onRemove}
        className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-red-500/10"
        aria-label="제거"
      >
        제거
      </button>
    </li>
  );
}
