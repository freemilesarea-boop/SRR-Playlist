import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Music2, Rocket, EyeOff, Pencil, X, ArrowLeft } from 'lucide-react';
import { fetchTracks } from '@/lib/api';
import {
  fetchMyCuratorPlaylists,
  createCuratorPlaylist,
  releaseCuratorPlaylist,
  unreleaseCuratorPlaylist,
  type MyCuratorPlaylist,
} from '@/lib/curatorStudioApi';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import { useAuthStore } from '@/store/authStore';
import { errorMessage } from '@/lib/errorMessage';
import { toast } from '@/store/toastStore';
import type { TrackRow } from '@/types/db';
import PlaylistEditor from '@/components/admin/PlaylistEditor';
import ErrorRetry from '@/components/common/ErrorRetry';
import { withTimeout } from '@/lib/withTimeout';

const CATEGORIES = ['카페', '와인바', '레스토랑', '필라테스', '드라이브', '집중', '휴식', '운동'];

export default function CuratorStudioPage() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isCurator = useAuthStore((s) => s.profile?.is_curator ?? false);
  const [playlists, setPlaylists] = useState<MyCuratorPlaylist[]>([]);
  const [allTracks, setAllTracks] = useState<TrackRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [pls, trs] = await withTimeout(
        Promise.all([fetchMyCuratorPlaylists(), fetchTracks()]),
        12_000,
        '스튜디오',
      );
      setPlaylists(pls);
      setAllTracks(trs);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useFreshFetch(load, [userId]);

  async function onRelease(p: MyCuratorPlaylist) {
    setBusyId(p.id);
    try {
      await releaseCuratorPlaylist(p.id);
      toast.success(`"${p.title}" 출시 완료 — 홈에 노출돼요`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  async function onUnrelease(p: MyCuratorPlaylist) {
    setBusyId(p.id);
    try {
      await unreleaseCuratorPlaylist(p.id);
      toast.success(`"${p.title}" 출시를 내렸어요`);
      await load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyId(null);
    }
  }

  // 편집 모드 — 기존 admin PlaylistEditor 재사용 (variant='curator')
  if (editingId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <PlaylistEditor
          playlistId={editingId}
          allTracks={allTracks}
          variant="curator"
          onClose={() => {
            setEditingId(null);
            void load();
          }}
        />
      </div>
    );
  }

  if (!isCurator) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <Music2 size={32} className="text-ink-dim" />
        <p className="text-base font-bold">큐레이터 전용 공간이에요</p>
        <p className="text-sm text-ink-mute">
          큐레이터 권한이 있어야 플레이리스트를 제작할 수 있어요.<br />
          문의: freemilesarea@gmail.com
        </p>
        <Link to="/" className="btn-ghost mt-2 text-sm">
          <ArrowLeft size={14} /> 홈으로
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-accent">큐레이터 스튜디오</p>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">내 플레이리스트</h1>
          <p className="mt-0.5 text-sm text-ink-mute">직접 제작하고 출시해보세요.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary shrink-0">
          <Plus size={16} /> 새 플리
        </button>
      </header>

      {error ? (
        <ErrorRetry message={error} onRetry={() => void load()} />
      ) : loading ? (
        <div className="py-12 text-center text-sm text-ink-mute">불러오는 중…</div>
      ) : playlists.length === 0 ? (
        <div className="rounded-2xl bg-bg-card/60 p-8 text-center text-sm text-ink-mute ring-1 ring-line/10">
          아직 만든 플레이리스트가 없어요.<br />
          "새 플리" 를 눌러 첫 플레이리스트를 만들어보세요.
        </div>
      ) : (
        <ul className="space-y-2">
          {playlists.map((p) => (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-2xl bg-bg-card p-3 ring-1 ring-line/10"
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-bg-hover">
                {p.thumbnail_url ? (
                  <img src={p.thumbnail_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-ink-dim">
                    <Music2 size={18} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold">{p.title}</p>
                  <StatusChip status={p.status} />
                </div>
                <p className="truncate text-xs text-ink-mute">
                  {p.category} · 트랙 {p.track_count} · 팔로워 {p.follower_count}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  onClick={() => setEditingId(p.id)}
                  className="flex h-9 items-center gap-1 rounded-full bg-bg-hover px-3 text-xs font-semibold hover:bg-ink/10"
                >
                  <Pencil size={13} /> 편집
                </button>
                {p.status === 'draft' ? (
                  <button
                    onClick={() => void onRelease(p)}
                    disabled={busyId === p.id || p.track_count === 0}
                    className="flex h-9 items-center gap-1 rounded-full bg-accent px-3 text-xs font-bold text-white ring-1 ring-white/15 transition hover:bg-accent-soft disabled:opacity-40"
                    title={p.track_count === 0 ? '트랙을 1개 이상 추가해주세요' : '출시'}
                  >
                    <Rocket size={13} /> 출시
                  </button>
                ) : (
                  <button
                    onClick={() => void onUnrelease(p)}
                    disabled={busyId === p.id}
                    className="flex h-9 items-center gap-1 rounded-full bg-bg-hover px-3 text-xs font-semibold text-ink-mute hover:bg-ink/10 disabled:opacity-40"
                  >
                    <EyeOff size={13} /> 내리기
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {showCreate && (
        <CreateModal
          categories={CATEGORIES}
          onClose={() => setShowCreate(false)}
          onCreated={(id) => {
            setShowCreate(false);
            void load();
            setEditingId(id);
          }}
        />
      )}
    </div>
  );
}

function StatusChip({ status }: { status: 'draft' | 'released' }) {
  if (status === 'released') {
    return (
      <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-bold text-accent ring-1 ring-accent/25">
        출시됨
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-bold text-ink-mute">
      작성 중
    </span>
  );
}

function CreateModal({
  categories,
  onClose,
  onCreated,
}: {
  categories: string[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(categories[0]);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!title.trim()) {
      toast.error('제목을 입력해주세요.');
      return;
    }
    setBusy(true);
    try {
      const id = await createCuratorPlaylist({
        title: title.trim(),
        category,
        description: description.trim() || null,
      });
      toast.success('플레이리스트를 만들었어요. 트랙을 추가해보세요.');
      onCreated(id);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">새 플레이리스트</h2>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5" aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">제목</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 비 오는 날의 재즈"
            className="input text-sm"
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">카테고리</label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="input text-sm"
          >
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-bold uppercase tracking-wider text-ink-mute">설명 (선택)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="이 플레이리스트를 한 줄로 소개해주세요"
            rows={2}
            className="input resize-none text-sm"
          />
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} disabled={busy} className="btn-ghost flex-1 py-2.5 text-sm">
            취소
          </button>
          <button onClick={() => void submit()} disabled={busy} className="btn-primary flex-1 py-2.5 text-sm">
            {busy ? '만드는 중…' : '만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
