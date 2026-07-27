/**
 * PlaylistBuilderWorkspace — Phase AI-PLAYLIST-ADMIN-UX-1
 *
 * 관리자 "플레이리스트 빌더" 작업 공간(3-pane, 반응형).
 *   좌: 후보 카탈로그(검색/필터 → 추가)   중: 현재 플리(드래그 재정렬)   우: 품질/분포/상세
 *
 * 핵심 원칙:
 *   - 드래그·추가·삭제 중에는 DB write 를 하지 않는다(로컬 편집만).
 *   - "저장" 버튼을 눌렀을 때만 최종 트랙 집합/순서를 트랜잭션 1회로 반영
 *     (admin_save_playlist_tracks, 0466). Undo/Redo 는 로컬 히스토리.
 *   - 복제(admin_clone_playlist) 는 새 draft 플리를 만든다(원본 불변).
 *   - AI 는 자동 편집/배포하지 않는다. 순서 "제안"만 하고 적용은 관리자가 결정.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  X,
  GripVertical,
  Save,
  Copy,
  Undo2,
  Redo2,
  Search,
  Wand2,
  AlertTriangle,
  Music,
  RefreshCw,
} from 'lucide-react';
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
import type { PlaylistRow } from '@/types/db';
import { fetchPlaylists } from '@/lib/api';
import { listAdminTracksWithAi } from '@/lib/adminTrackApi';
import {
  savePlaylistTracks,
  clonePlaylist,
  loadPlacedTracks,
  loadCandidatePool,
} from '@/lib/api/playlistBuilderApi';
import {
  type BuilderTrack,
  mapAdminTrack,
  enrichWithCandidatePool,
  markAlreadyIn,
  filterCandidates,
  runQualityCheck,
  hasBlockingIssues,
  summarizeIssues,
  suggestOrder,
  toSaveTrackIds,
  suggestCloneTitle,
  effectiveScore,
  totalDuration,
  formatTotalDuration,
  artistDistribution,
  genreDistribution,
  energyDistribution,
  generateWarnings,
  type QualityIssue,
  type DistributionBucket,
} from '@/lib/playlistBuilder';
import {
  type History,
  createHistory,
  pushHistory,
  undo,
  redo,
  canUndo,
  canRedo,
  resetHistory,
  hasUnsavedTrackChanges,
} from '@/lib/playlistBuilderHistory';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { useModalA11y } from '@/hooks/useModalA11y';

/** 수동 편집 가능한 플리인지(auto/스마트 제외). */
function isManualPlaylist(p: PlaylistRow): boolean {
  return p.is_auto !== true && p.is_auto_generated !== true;
}

/** placed 행(카탈로그에 없을 때 대비)으로 최소 BuilderTrack 구성. */
function placedToBuilderTrack(row: {
  track_id: string;
  title: string | null;
  artist: string | null;
  cover_url: string | null;
}): BuilderTrack {
  return {
    ...mapAdminTrack({ id: row.track_id, title: row.title, artist: row.artist, cover_url: row.cover_url }),
    alreadyInPlaylist: true,
  };
}

export default function PlaylistBuilderWorkspace() {
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [catalog, setCatalog] = useState<BuilderTrack[]>([]);
  const [history, setHistory] = useState<History<BuilderTrack[]>>(() => createHistory<BuilderTrack[]>([]));
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [hideAlreadyIn, setHideAlreadyIn] = useState(true);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);

  const present = history.present;
  const selectedPlaylist = useMemo(
    () => playlists.find((p) => p.id === selectedId) ?? null,
    [playlists, selectedId],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );

  // ---- 플리 목록 로드 -------------------------------------------------------
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await fetchPlaylists();
        if (!alive) return;
        setPlaylists(rows.filter(isManualPlaylist));
      } catch (e) {
        if (alive) toast.error(friendlyError(e, '플레이리스트 목록을 불러오지 못했습니다.'));
      } finally {
        if (alive) setLoadingList(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // ---- 선택 플리의 데이터 로드(카탈로그 + 배치 트랙 + 후보 점수) --------------
  const loadData = useCallback(async (playlistId: string) => {
    setLoadingData(true);
    try {
      const [catalogRows, placed] = await Promise.all([
        listAdminTracksWithAi(1000),
        loadPlacedTracks(playlistId),
      ]);
      const byId = new Map(catalogRows.map((r) => [r.id, r]));
      // 중앙(현재 플리): placed 순서 유지, 카탈로그의 피처가 있으면 사용.
      const center: BuilderTrack[] = placed.map((row) => {
        const cat = byId.get(row.track_id);
        return cat ? { ...mapAdminTrack(cat), alreadyInPlaylist: true } : placedToBuilderTrack(row);
      });
      let cat: BuilderTrack[] = catalogRows.map((r) => mapAdminTrack(r));

      // 후보 점수(fit/adaptive/guardrail) — 부가 정보이므로 실패해도 무시.
      try {
        const pool = await loadCandidatePool(playlistId);
        if (pool.length > 0) {
          cat = enrichWithCandidatePool(cat, pool);
          const enrichedCenter = enrichWithCandidatePool(center, pool);
          center.splice(0, center.length, ...enrichedCenter);
        }
      } catch {
        /* 점수 없음 — 그대로 진행 */
      }

      const centerIds = new Set(center.map((t) => t.track_id));
      setCatalog(markAlreadyIn(cat, centerIds));
      setHistory(createHistory(center));
      setSavedIds(center.map((t) => t.track_id));
      setSelectedTrackId(null);
    } catch (e) {
      toast.error(friendlyError(e, '플레이리스트 데이터를 불러오지 못했습니다.'));
      setCatalog([]);
      setHistory(createHistory<BuilderTrack[]>([]));
      setSavedIds([]);
    } finally {
      setLoadingData(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) void loadData(selectedId);
  }, [selectedId, loadData]);

  // ---- 편집 액션(로컬만) ----------------------------------------------------
  const commit = useCallback((next: BuilderTrack[]) => {
    setHistory((h) => pushHistory(h, next));
  }, []);

  const addTrack = useCallback(
    (t: BuilderTrack) => {
      if (present.some((p) => p.track_id === t.track_id)) return;
      commit([...present, { ...t, alreadyInPlaylist: true }]);
      setCatalog((c) => markAlreadyIn(c, new Set([...present.map((p) => p.track_id), t.track_id])));
    },
    [present, commit],
  );

  const removeTrack = useCallback(
    (trackId: string) => {
      const next = present.filter((p) => p.track_id !== trackId);
      commit(next);
      setCatalog((c) => markAlreadyIn(c, new Set(next.map((p) => p.track_id))));
      if (selectedTrackId === trackId) setSelectedTrackId(null);
    },
    [present, commit, selectedTrackId],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldIndex = present.findIndex((t) => t.track_id === active.id);
      const newIndex = present.findIndex((t) => t.track_id === over.id);
      if (oldIndex < 0 || newIndex < 0) return;
      commit(arrayMove(present, oldIndex, newIndex));
    },
    [present, commit],
  );

  const applySuggestedOrder = useCallback(() => {
    const res = suggestOrder(present);
    if (!res.changed) {
      toast.info('이미 제안된 순서입니다.');
      return;
    }
    commit(res.order);
    toast.success(`순서 제안 적용 — ${res.movedCount}곡 이동(미저장)`);
  }, [present, commit]);

  // ---- 저장(트랜잭션 1회) ---------------------------------------------------
  const currentIds = useMemo(() => present.map((t) => t.track_id), [present]);
  const unsaved = useMemo(() => hasUnsavedTrackChanges(savedIds, currentIds), [savedIds, currentIds]);

  const issues = useMemo(() => runQualityCheck(present), [present]);
  const blocking = hasBlockingIssues(issues);

  const save = useCallback(async () => {
    if (!selectedId || saving) return;
    if (blocking) {
      toast.error('오류 항목을 먼저 해결해주세요.');
      return;
    }
    setSaving(true);
    try {
      const ids = toSaveTrackIds(present);
      const res = await savePlaylistTracks(selectedId, ids);
      setSavedIds(ids);
      setHistory((h) => resetHistory(h));
      toast.success(`저장 완료 — ${res.track_count}곡(삭제 ${res.removed})`);
    } catch (e) {
      toast.error(friendlyError(e, '저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  }, [selectedId, saving, blocking, present]);

  // ---- 렌더 데이터 ----------------------------------------------------------
  const visibleCandidates = useMemo(
    () => filterCandidates(catalog, { query: search, excludeAlreadyIn: hideAlreadyIn }),
    [catalog, search, hideAlreadyIn],
  );
  const selectedTrack = useMemo(
    () => present.find((t) => t.track_id === selectedTrackId) ?? null,
    [present, selectedTrackId],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line/10 bg-bg-card p-3">
        <div className="flex items-center gap-2">
          <Music size={16} className="text-accent" />
          <h2 className="text-sm font-semibold">플레이리스트 빌더</h2>
        </div>
        <select
          className="input h-8 max-w-[16rem] text-sm"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          disabled={loadingList}
          aria-label="플레이리스트 선택"
        >
          <option value="">{loadingList ? '불러오는 중…' : '플레이리스트 선택…'}</option>
          {playlists.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.status === 'draft' ? ' (초안)' : ''}
            </option>
          ))}
        </select>
        {selectedPlaylist && (
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              selectedPlaylist.status === 'released'
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-amber-500/15 text-amber-300'
            }`}
          >
            {selectedPlaylist.status === 'released' ? '발매됨' : '초안'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            className="btn-ghost h-8 px-2"
            onClick={() => setHistory((h) => undo(h))}
            disabled={!canUndo(history)}
            aria-label="실행 취소"
            title="실행 취소"
          >
            <Undo2 size={15} />
          </button>
          <button
            className="btn-ghost h-8 px-2"
            onClick={() => setHistory((h) => redo(h))}
            disabled={!canRedo(history)}
            aria-label="다시 실행"
            title="다시 실행"
          >
            <Redo2 size={15} />
          </button>
          <button
            className="btn-ghost h-8 gap-1 px-2 text-sm"
            onClick={() => setCloneOpen(true)}
            disabled={!selectedId || loadingData}
          >
            <Copy size={14} /> 복제
          </button>
          <button
            className="btn-primary h-8 gap-1 px-3 text-sm disabled:opacity-50"
            onClick={() => void save()}
            disabled={!selectedId || !unsaved || saving || blocking}
            title={blocking ? '오류 항목을 먼저 해결하세요' : undefined}
          >
            <Save size={14} /> {saving ? '저장 중…' : '저장'}
            {unsaved && !saving && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />}
          </button>
        </div>
      </div>

      {!selectedId ? (
        <div className="rounded-xl border border-dashed border-line/20 p-10 text-center text-sm text-ink-mute">
          편집할 플레이리스트를 선택하세요. (자동/스마트 플레이리스트는 목록에서 제외됩니다.)
        </div>
      ) : loadingData ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-line/10 p-10 text-sm text-ink-mute">
          <RefreshCw size={16} className="animate-spin" /> 불러오는 중…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
          {/* 좌: 후보 */}
          <section className="flex min-h-[24rem] flex-col rounded-xl border border-line/10 bg-bg-card">
            <div className="border-b border-line/10 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                후보 트랙 <span className="text-ink-mute">({visibleCandidates.length})</span>
              </div>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
                <input
                  className="input h-8 w-full pl-7 text-sm"
                  placeholder="제목·아티스트·장르 검색"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <label className="mt-2 flex items-center gap-1.5 text-xs text-ink-mute">
                <input
                  type="checkbox"
                  checked={hideAlreadyIn}
                  onChange={(e) => setHideAlreadyIn(e.target.checked)}
                />
                이미 포함된 곡 숨기기
              </label>
            </div>
            <ul className="flex-1 divide-y divide-line/10 overflow-y-auto">
              {visibleCandidates.slice(0, 300).map((t) => (
                <CandidateRow key={t.track_id} track={t} onAdd={() => addTrack(t)} />
              ))}
              {visibleCandidates.length === 0 && (
                <li className="p-6 text-center text-xs text-ink-mute">일치하는 후보가 없습니다.</li>
              )}
            </ul>
          </section>

          {/* 중: 현재 플리 */}
          <section className="flex min-h-[24rem] flex-col rounded-xl border border-line/10 bg-bg-card">
            <div className="flex items-center gap-2 border-b border-line/10 p-3">
              <span className="text-sm font-medium">현재 트랙 ({present.length})</span>
              <span className="text-xs text-ink-mute">{formatTotalDuration(totalDuration(present))}</span>
              <button
                className="btn-ghost ml-auto h-7 gap-1 px-2 text-xs"
                onClick={applySuggestedOrder}
                disabled={present.length < 2}
                title="정책 기반 순서 초안 제안(미저장)"
              >
                <Wand2 size={13} /> AI 순서 제안
              </button>
            </div>
            {present.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-ink-mute">
                좌측에서 트랙을 추가하세요.
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                <SortableContext items={present.map((t) => t.track_id)} strategy={verticalListSortingStrategy}>
                  <ol className="flex-1 overflow-y-auto">
                    {present.map((t, idx) => (
                      <SortablePlaylistRow
                        key={t.track_id}
                        track={t}
                        index={idx}
                        selected={t.track_id === selectedTrackId}
                        onSelect={() => setSelectedTrackId(t.track_id)}
                        onRemove={() => removeTrack(t.track_id)}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            )}
          </section>

          {/* 우: 품질/분포/상세 */}
          <section className="flex min-h-[24rem] flex-col gap-3">
            <QualityPanel issues={issues} />
            <DistributionPanel tracks={present} />
            {selectedTrack && <InspectorPanel track={selectedTrack} playlist={present} />}
          </section>
        </div>
      )}

      {cloneOpen && selectedPlaylist && (
        <CloneDialog
          source={selectedPlaylist}
          onClose={() => setCloneOpen(false)}
          onCloned={async (newId, title) => {
            setCloneOpen(false);
            toast.success(`복제 완료 — "${title}" (초안)`);
            try {
              const rows = await fetchPlaylists();
              setPlaylists(rows.filter(isManualPlaylist));
            } catch {
              /* 목록 새로고침 실패는 치명적 아님 */
            }
            setSelectedId(newId);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBadges({ track }: { track: BuilderTrack }) {
  const eff = effectiveScore(track);
  return (
    <div className="flex shrink-0 items-center gap-1">
      {eff != null && (
        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent" title="적용 점수(adaptive ?? fit)">
          {Math.round(eff)}
        </span>
      )}
      {track.guardrailBlocked && (
        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-300" title="가드레일 차단">
          차단
        </span>
      )}
    </div>
  );
}

function CandidateRow({ track, onAdd }: { track: BuilderTrack; onAdd: () => void }) {
  return (
    <li className="flex items-center gap-2 p-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{track.title ?? '제목 없음'}</p>
        <p className="truncate text-xs text-ink-mute">
          {track.artist ?? '—'}
          {track.genre ? ` · ${track.genre}` : ''}
        </p>
      </div>
      <ScoreBadges track={track} />
      <button
        className="btn-ghost h-7 gap-1 px-2 text-xs"
        onClick={onAdd}
        disabled={track.alreadyInPlaylist}
        aria-label={`${track.title ?? '트랙'} 추가`}
      >
        <Plus size={13} /> {track.alreadyInPlaylist ? '포함됨' : '추가'}
      </button>
    </li>
  );
}

function SortablePlaylistRow({
  track,
  index,
  selected,
  onSelect,
  onRemove,
}: {
  track: BuilderTrack;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: track.track_id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const warnings = generateWarnings(track);
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border-b border-line/10 p-2.5 last:border-b-0 ${
        selected ? 'bg-accent/5' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab touch-none text-ink-dim active:cursor-grabbing"
        aria-label="순서 변경"
      >
        <GripVertical size={15} />
      </button>
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-dim">{index + 1}</span>
      <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <p className="truncate text-sm">{track.title ?? '제목 없음'}</p>
        <p className="truncate text-xs text-ink-mute">
          {track.artist ?? '—'}
          {warnings.length > 0 && (
            <span className="ml-1 text-amber-300" title={warnings.join('\n')}>
              ⚠ {warnings.length}
            </span>
          )}
        </p>
      </button>
      <ScoreBadges track={track} />
      <button
        onClick={onRemove}
        className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-rose-500/20"
        aria-label="제거"
      >
        <X size={14} />
      </button>
    </li>
  );
}

function QualityPanel({ issues }: { issues: QualityIssue[] }) {
  const counts = summarizeIssues(issues);
  return (
    <div className="rounded-xl border border-line/10 bg-bg-card p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <AlertTriangle size={14} className="text-amber-300" /> 품질 검사
        <span className="ml-auto text-xs text-ink-mute">
          오류 {counts.error} · 경고 {counts.warning} · 정보 {counts.info}
        </span>
      </div>
      {issues.length === 0 ? (
        <p className="text-xs text-emerald-300">문제 없음 — 저장 가능합니다.</p>
      ) : (
        <ul className="space-y-1">
          {issues.map((it, i) => (
            <li
              key={`${it.code}-${i}`}
              className={`text-xs ${
                it.severity === 'error'
                  ? 'text-rose-300'
                  : it.severity === 'warning'
                    ? 'text-amber-300'
                    : 'text-ink-mute'
              }`}
            >
              {it.severity === 'error' ? '● ' : it.severity === 'warning' ? '▲ ' : '· '}
              {it.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Bars({ title, buckets }: { title: string; buckets: DistributionBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-ink-mute">{title}</p>
      <ul className="space-y-1">
        {buckets.slice(0, 5).map((b) => (
          <li key={b.key} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 truncate">{b.key}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/10">
              <span className="block h-full rounded-full bg-accent/60" style={{ width: `${Math.round(b.ratio * 100)}%` }} />
            </span>
            <span className="w-9 shrink-0 text-right tabular-nums text-ink-dim">{Math.round(b.ratio * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DistributionPanel({ tracks }: { tracks: BuilderTrack[] }) {
  if (tracks.length === 0) return null;
  return (
    <div className="space-y-3 rounded-xl border border-line/10 bg-bg-card p-3">
      <p className="text-sm font-medium">구성 분포</p>
      <Bars title="아티스트" buckets={artistDistribution(tracks)} />
      <Bars title="장르" buckets={genreDistribution(tracks)} />
      <Bars title="에너지" buckets={energyDistribution(tracks)} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-ink-mute">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

function pct(v: number | null): string {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}
function numOr(v: number | null): string {
  return v == null ? '—' : String(Math.round(v));
}

function InspectorPanel({ track, playlist }: { track: BuilderTrack; playlist: BuilderTrack[] }) {
  const warnings = generateWarnings(track, playlist);
  return (
    <div className="space-y-2 rounded-xl border border-line/10 bg-bg-card p-3">
      <p className="truncate text-sm font-medium">{track.title ?? '제목 없음'}</p>
      <p className="truncate text-xs text-ink-mute">{track.artist ?? '—'}</p>
      <div className="space-y-1 border-t border-line/10 pt-2">
        <Stat label="Fit" value={numOr(track.fitScore)} />
        <Stat label="Adaptive" value={numOr(track.adaptiveScore)} />
        <Stat label="완주율" value={pct(track.completionRate)} />
        <Stat label="스킵율" value={pct(track.skipRate)} />
        <Stat label="표본 수" value={numOr(track.sampleCount)} />
        <Stat label="BPM" value={numOr(track.bpm)} />
        <Stat label="에너지" value={numOr(track.energyLevel)} />
      </div>
      {warnings.length > 0 && (
        <ul className="space-y-0.5 border-t border-line/10 pt-2">
          {warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-amber-300">
              ▲ {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CloneDialog({
  source,
  onClose,
  onCloned,
}: {
  source: PlaylistRow;
  onClose: () => void;
  onCloned: (newId: string, title: string) => void | Promise<void>;
}) {
  const [title, setTitle] = useState(() => suggestCloneTitle(source.title));
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useModalA11y(ref, { onClose });

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      toast.error('새 제목을 입력하세요.');
      return;
    }
    setBusy(true);
    try {
      const res = await clonePlaylist(source.id, t, 'draft');
      await onCloned(res.new_playlist_id, t);
    } catch (e) {
      toast.error(friendlyError(e, '복제에 실패했습니다.'));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="플레이리스트 복제"
        className="w-full max-w-md rounded-xl border border-line/10 bg-bg-card p-4 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <Copy size={16} className="text-accent" />
          <h3 className="text-sm font-semibold">플레이리스트 복제</h3>
          <button className="btn-ghost ml-auto h-7 px-2" onClick={onClose} aria-label="닫기">
            <X size={15} />
          </button>
        </div>
        <p className="mb-2 text-xs text-ink-mute">
          &ldquo;{source.title}&rdquo; 의 메타데이터와 트랙 목록을 새 초안 플레이리스트로 복사합니다. 원본은 변경되지 않습니다.
        </p>
        <label className="mb-1 block text-xs text-ink-mute">새 제목</label>
        <input
          className="input mb-3 h-9 w-full text-sm"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <div className="flex justify-end gap-2">
          <button className="btn-ghost h-8 px-3 text-sm" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn-primary h-8 px-3 text-sm disabled:opacity-50" onClick={() => void submit()} disabled={busy}>
            {busy ? '복제 중…' : '복제'}
          </button>
        </div>
      </div>
    </div>
  );
}
