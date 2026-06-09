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
import { safeExtension } from '@/lib/storagePath';
import { fetchPlaylist, fetchPlaylistTracks } from '@/lib/api';
import { fetchAllCurators, setPlaylistCurator, type CuratorListItem } from '@/lib/curatorApi';
import { usePlaylistLock } from '@/hooks/usePlaylistLock';
import { updateCuratorPlaylistThumbnail } from '@/lib/curatorStudioApi';
import AdminPlaylistTrackInspector from '@/components/admin/AdminPlaylistTrackInspector';
import type { PlaylistRow, TrackRow } from '@/types/db';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

interface Props {
  playlistId: string;
  allTracks: TrackRow[];
  onClose: () => void;
  /** 'curator' 면 큐레이터 연결 select 를 숨김 (큐레이터 본인 스튜디오에서 사용) */
  variant?: 'admin' | 'curator';
}

export default function PlaylistEditor({ playlistId, allTracks, onClose, variant = 'admin' }: Props) {
  const [playlist, setPlaylist] = useState<PlaylistRow | null>(null);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [curators, setCurators] = useState<CuratorListItem[]>([]);
  const [savingCurator, setSavingCurator] = useState(false);
  // 협업 advisory lock — 다른 큐레이터/관리자가 편집 중이면 경고 배너
  const lock = usePlaylistLock(playlistId);

  useEffect(() => {
    if (variant !== 'admin') return;
    let alive = true;
    void fetchAllCurators().then((list) => {
      if (alive) setCurators(list);
    });
    return () => {
      alive = false;
    };
  }, [variant]);

  async function onCuratorChange(nextId: string) {
    if (!playlist) return;
    setSavingCurator(true);
    const res = await setPlaylistCurator(playlistId, nextId || null);
    setSavingCurator(false);
    if (!res.ok) {
      toast.error(res.error ?? '큐레이터 변경 실패');
      return;
    }
    setPlaylist({ ...playlist, created_by_user_id: nextId || null });
    toast.success(nextId ? '큐레이터를 연결했어요' : '큐레이터 연결을 해제했어요');
  }

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
      toast.error(error.message);
      return;
    }
    setTracks((prev) => [...prev, track]);
    toast.success(`추가됨: ${track.title}`);
  }

  async function removeTrack(trackId: string) {
    const { error } = await supabase
      .from('playlist_tracks')
      .delete()
      .match({ playlist_id: playlistId, track_id: trackId });
    if (error) {
      toast.error(error.message);
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

    const updates = next.map((t, idx) =>
      supabase
        .from('playlist_tracks')
        .update({ order_index: idx })
        .match({ playlist_id: playlistId, track_id: t.id }),
    );
    const results = await Promise.all(updates);
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      toast.error(`순서 저장 실패: ${failed.error.message}`);
      // 실패 시 서버 상태로 롤백
      void reload();
    } else {
      toast.success('순서를 저장했어요.');
    }
  }

  async function uploadThumb(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('이미지 파일만 업로드할 수 있어요.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('썸네일은 5MB 이하 이미지만 가능해요.');
      return;
    }
    setThumbBusy(true);
    try {
      const ext = safeExtension(file.name, 'jpg');
      const path = `${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('covers').upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type || undefined,
      });
      if (upErr) throw new Error(`업로드 실패: ${upErr.message}`);
      const { data } = supabase.storage.from('covers').getPublicUrl(path);
      if (variant === 'curator') {
        // released 상태에서도 썸네일만 수정 가능하도록 RPC 경유 (RLS 우회 + 컬럼 제한)
        await updateCuratorPlaylistThumbnail(playlistId, data.publicUrl);
      } else {
        const { error } = await supabase
          .from('playlists')
          .update({ thumbnail_url: data.publicUrl })
          .eq('id', playlistId);
        if (error) throw new Error(`저장 실패: ${error.message}`);
      }
      await reload();
      toast.success('썸네일을 변경했어요.');
    } catch (e) {
      toast.error(friendlyError(e));
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

      {/* 협업 lock 배너 — 다른 사용자가 활성 편집 중일 때 경고 */}
      {!lock.loading && lock.otherUser && (
        <div className="flex items-start gap-2.5 rounded-2xl bg-yellow-500/10 p-3 ring-1 ring-yellow-500/30">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yellow-500/20 text-yellow-200">!</span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-yellow-100">
              <b>{lock.otherUser.nickname}</b> 님이 지금 편집 중이에요
            </p>
            <p className="mt-0.5 text-[11px] text-yellow-200/85">
              마지막 활동{' '}
              {(() => {
                const diff = Math.max(
                  0,
                  Math.floor((Date.now() - new Date(lock.otherUser.heartbeatAt).getTime()) / 60000),
                );
                if (diff === 0) return '방금 전';
                return `${diff}분 전`;
              })()}
              {' '}· 동시 편집 시 변경 사항이 덮어쓰일 수 있어요
            </p>
          </div>
          <button
            onClick={() => void lock.forceTakeover()}
            className="shrink-0 rounded-full bg-yellow-500/20 px-3 py-1.5 text-[11px] font-semibold text-yellow-100 ring-1 ring-yellow-300/30 hover:bg-yellow-500/30"
          >
            그래도 편집
          </button>
        </div>
      )}

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

      {/* 큐레이터 연결 — admin 모드에서만 */}
      {variant === 'admin' && (
        <div className="flex items-center gap-3 rounded-2xl bg-bg-card p-3">
          <div className="flex-1 text-xs text-ink-mute">큐레이터</div>
          <select
            value={playlist.created_by_user_id ?? ''}
            onChange={(e) => void onCuratorChange(e.target.value)}
            disabled={savingCurator}
            className="rounded-lg bg-bg-deep px-3 py-2 text-sm ring-1 ring-line/15 focus:outline-none focus:ring-accent/60"
          >
            <option value="">— 없음 —</option>
            {curators.map((c) => (
              <option key={c.user_id} value={c.user_id}>
                {c.display_name} (@{c.handle}){c.is_verified ? ' ✓' : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {playlist.is_auto && (
        <div className="rounded-xl bg-accent/10 p-3 text-xs leading-relaxed text-accent ring-1 ring-accent/20">
          ⚡ 자동(스마트) 플레이리스트예요. 트랙은 규칙(auto_rule)에 따라 실시간으로 채워지며
          수동으로 추가/삭제/순서 변경할 수 없어요. 규칙을 바꾸면 노출 트랙이 자동 갱신돼요.
        </div>
      )}

      {!playlist.is_auto && (
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink-mute">트랙 ({tracks.length})</h2>
          <button onClick={() => setPicker(true)} className="btn-primary text-xs">
            <Plus size={14} /> 트랙 추가
          </button>
        </div>
      )}

      {!playlist.is_auto && (

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
      )}

      {variant === 'admin' && (
        <div className="mt-4 border-t border-line/10 pt-4">
          <AdminPlaylistTrackInspector playlistId={playlistId} />
        </div>
      )}

      {picker && !playlist.is_auto && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center">
          <div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-bg-soft sm:rounded-2xl">
            <div className="flex items-center justify-between border-b border-line/10 p-4">
              <h3 className="text-sm font-semibold">트랙 선택</h3>
              <button onClick={() => setPicker(false)} aria-label="닫기">
                <X size={18} />
              </button>
            </div>
            <ul className="max-h-[60vh] divide-y divide-line/10 overflow-y-auto">
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
      className="flex items-center gap-3 border-b border-line/10 p-3 last:border-b-0"
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
