/**
 * PlaylistBuilderWorkspace — Phase AI-PLAYLIST-ADMIN-UX-1 + UX-2
 *
 * 관리자 플레이리스트 빌더. 시작(Preset-First) → 3-Pane Builder.
 *
 * 안전/불변식(그대로 유지):
 *   - 드래그·추가·삭제·순서제안·대체 중 DB write 없음(로컬 편집만).
 *   - "저장" 시에만 최종 집합/순서를 트랜잭션 1회로 반영(admin_save_playlist_tracks, 0466).
 *   - 미리듣기는 정산·학습·큐에 반영되지 않음(자체 audio element).
 *   - AI 는 제안만; 관리자가 적용/저장/배포를 결정. Production 자동 배포 없음.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Music,
  RefreshCw,
  ArrowLeft,
  PlayCircle,
  SlidersHorizontal,
  Repeat,
  CheckSquare,
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
import { SortableContext, arrayMove, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PlaylistRow } from '@/types/db';
import { fetchPlaylists, fetchPlaylistCounts } from '@/lib/api';
import { listAdminTracksWithAi } from '@/lib/adminTrackApi';
import {
  savePlaylistTracks,
  loadPlacedTracks,
  loadCandidatePool,
  listStoreProfiles,
} from '@/lib/api/playlistBuilderApi';
import {
  type BuilderTrack,
  type CandidateFilters,
  mapAdminTrack,
  enrichWithCandidatePool,
  markAlreadyIn,
  filterCandidates,
  runQualityCheck,
  hasBlockingIssues,
  suggestOrder,
  toSaveTrackIds,
  effectiveScore,
  totalDuration,
  formatTotalDuration,
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
import {
  type BuilderPreset,
  type PresetConditions,
  profileToPreset,
  presetToFilters,
} from '@/lib/playlistPresets';
import {
  loadRecentConditions,
  pushRecentCondition,
  clearRecentConditions,
  RECENT_VERSION,
  type RecentCondition,
} from '@/lib/playlistBuilderRecent';
import { saveReviewSummary, unsavedChangeSummary, sortByScore } from '@/lib/playlistBuilderInsights';
import {
  recommendationTags,
  isSelectable,
  toggleSelection,
  selectAllOnPage,
  deselectPage,
  invertSelection,
  selectionSummary,
  findReplacements,
} from '@/lib/playlistBuilderSelection';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';
import { StartPanel, type StartMeta } from '@/components/admin/playlistBuilder/StartPanel';
import { TemplateLibrary } from '@/components/admin/playlistBuilder/TemplateLibrary';
import { QualityDashboard } from '@/components/admin/playlistBuilder/QualityDashboard';
import { PreviewDrawer } from '@/components/admin/playlistBuilder/PreviewDrawer';
import { SaveReviewDialog, OrderDiffDialog, ReplacementDialog } from '@/components/admin/playlistBuilder/dialogs';
import { TagBadges } from '@/components/admin/playlistBuilder/parts';

function isManualPlaylist(p: PlaylistRow): boolean {
  return p.is_auto !== true && p.is_auto_generated !== true;
}

const CANDIDATE_PAGE = 100; // 현재 페이지에 노출하는 후보 수(전체 무제한 로드 금지)

export default function PlaylistBuilderWorkspace() {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const [mode, setMode] = useState<'start' | 'builder'>('start');
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const [presets, setPresets] = useState<BuilderPreset[]>([]);
  const [recents, setRecents] = useState<RecentCondition[]>([]);
  const [startLoading, setStartLoading] = useState(true);

  const [selectedId, setSelectedId] = useState('');
  const [conditions, setConditions] = useState<PresetConditions | null>(null);
  const [catalog, setCatalog] = useState<BuilderTrack[]>([]);
  const [history, setHistory] = useState<History<BuilderTrack[]>>(() => createHistory<BuilderTrack[]>([]));
  const [savedIds, setSavedIds] = useState<string[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [hideAlreadyIn, setHideAlreadyIn] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<{ ids: Set<string>; label: string } | null>(null);
  const [showConditions, setShowConditions] = useState(false);

  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [orderDiffOpen, setOrderDiffOpen] = useState(false);
  const [saveReviewOpen, setSaveReviewOpen] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState<BuilderTrack | null>(null);
  const [mobileTab, setMobileTab] = useState<'candidates' | 'playlist' | 'quality'>('playlist');

  const present = history.present;
  const selectedPlaylist = useMemo(() => playlists.find((p) => p.id === selectedId) ?? null, [playlists, selectedId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
  );

  // ---- 시작 데이터 로드(플리 목록/카운트/Preset/최근) ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [rows, cnt, profiles] = await Promise.all([
          fetchPlaylists(),
          fetchPlaylistCounts().catch(() => new Map<string, number>()),
          listStoreProfiles().catch(() => []),
        ]);
        if (!alive) return;
        setPlaylists(rows.filter(isManualPlaylist));
        setCounts(cnt instanceof Map ? cnt : new Map());
        setPresets(profiles.map(profileToPreset));
      } catch (e) {
        if (alive) toast.error(friendlyError(e, '초기 데이터를 불러오지 못했습니다.'));
      } finally {
        if (alive) setStartLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setRecents(loadRecentConditions(userId));
  }, [userId]);

  // ---- 선택 플리 데이터 로드 ----
  const loadData = useCallback(async (playlistId: string) => {
    setLoadingData(true);
    try {
      const [catalogRows, placed] = await Promise.all([listAdminTracksWithAi(1000), loadPlacedTracks(playlistId)]);
      const byId = new Map(catalogRows.map((r) => [r.id, r]));
      const center: BuilderTrack[] = placed.map((row) => {
        const cat = byId.get(row.track_id);
        return cat
          ? { ...mapAdminTrack(cat), alreadyInPlaylist: true }
          : { ...mapAdminTrack({ id: row.track_id, title: row.title, artist: row.artist, cover_url: row.cover_url }), alreadyInPlaylist: true };
      });
      let cat: BuilderTrack[] = catalogRows.map((r) => mapAdminTrack(r));
      try {
        const pool = await loadCandidatePool(playlistId);
        if (pool.length > 0) {
          cat = enrichWithCandidatePool(cat, pool);
          const ec = enrichWithCandidatePool(center, pool);
          center.splice(0, center.length, ...ec);
        }
      } catch {
        /* 점수 없음 */
      }
      const centerIds = new Set(center.map((t) => t.track_id));
      setCatalog(markAlreadyIn(cat, centerIds));
      setHistory(createHistory(center));
      setSavedIds(center.map((t) => t.track_id));
      setSelected(new Set());
      setSelectedTrackId(null);
      setFlagged(null);
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
    if (mode === 'builder' && selectedId) void loadData(selectedId);
  }, [mode, selectedId, loadData]);

  // ---- 시작 콜백 ----
  const handleStart = useCallback(
    (playlistId: string, cond: PresetConditions | null, meta: StartMeta) => {
      setConditions(cond);
      setSelectedId(playlistId);
      setShowConditions(!!cond && meta.openEditor);
      setMode('builder');
      if (cond) {
        const next = pushRecentCondition(userId, {
          v: RECENT_VERSION,
          storeKey: meta.storeKey,
          label: meta.label,
          conditions: cond,
        });
        setRecents(next);
      }
    },
    [userId],
  );

  const handleEdit = useCallback((playlistId: string) => {
    setConditions(null);
    setSelectedId(playlistId);
    setShowConditions(false);
    setMode('builder');
  }, []);

  const backToStart = useCallback(() => {
    setMode('start');
    setSelectedId('');
    setConditions(null);
    setHistory(createHistory<BuilderTrack[]>([]));
  }, []);

  // ---- 편집 액션(로컬) ----
  const commit = useCallback((next: BuilderTrack[]) => setHistory((h) => pushHistory(h, next)), []);

  const syncCatalogMarks = useCallback((ids: string[]) => {
    setCatalog((c) => markAlreadyIn(c, new Set(ids)));
  }, []);

  const addTrack = useCallback(
    (t: BuilderTrack) => {
      if (present.some((p) => p.track_id === t.track_id)) return;
      const next = [...present, { ...t, alreadyInPlaylist: true }];
      commit(next);
      syncCatalogMarks(next.map((p) => p.track_id));
    },
    [present, commit, syncCatalogMarks],
  );

  const addSelected = useCallback(() => {
    const toAdd = catalog.filter((t) => selected.has(t.track_id) && isSelectable(t) && !present.some((p) => p.track_id === t.track_id));
    if (toAdd.length === 0) return;
    const next = [...present, ...toAdd.map((t) => ({ ...t, alreadyInPlaylist: true }))];
    commit(next);
    syncCatalogMarks(next.map((p) => p.track_id));
    setSelected(new Set());
    toast.success(`${toAdd.length}곡 추가(미저장)`);
  }, [catalog, selected, present, commit, syncCatalogMarks]);

  const removeTrack = useCallback(
    (trackId: string) => {
      const next = present.filter((p) => p.track_id !== trackId);
      commit(next);
      syncCatalogMarks(next.map((p) => p.track_id));
      if (selectedTrackId === trackId) setSelectedTrackId(null);
    },
    [present, commit, syncCatalogMarks, selectedTrackId],
  );

  const removeFlagged = useCallback(() => {
    if (!flagged) return;
    const next = present.filter((p) => !flagged.ids.has(p.track_id));
    commit(next);
    syncCatalogMarks(next.map((p) => p.track_id));
    setFlagged(null);
    toast.success('선택한 문제 트랙을 제거했습니다(미저장).');
  }, [flagged, present, commit, syncCatalogMarks]);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const oldI = present.findIndex((t) => t.track_id === active.id);
      const newI = present.findIndex((t) => t.track_id === over.id);
      if (oldI < 0 || newI < 0) return;
      commit(arrayMove(present, oldI, newI));
    },
    [present, commit],
  );

  const replaceTrack = useCallback(
    (candidateId: string) => {
      if (!replaceTarget) return;
      const cand = catalog.find((t) => t.track_id === candidateId);
      if (!cand) return;
      const idx = present.findIndex((t) => t.track_id === replaceTarget.track_id);
      if (idx < 0) return;
      const next = [...present];
      next[idx] = { ...cand, alreadyInPlaylist: true };
      commit(next);
      syncCatalogMarks(next.map((p) => p.track_id));
      setReplaceTarget(null);
      toast.success('트랙을 교체했습니다(미저장).');
    },
    [replaceTarget, catalog, present, commit, syncCatalogMarks],
  );

  // ---- 저장 ----
  const currentIds = useMemo(() => present.map((t) => t.track_id), [present]);
  const unsaved = useMemo(() => hasUnsavedTrackChanges(savedIds, currentIds), [savedIds, currentIds]);
  const unsavedSummary = useMemo(() => unsavedChangeSummary(savedIds, currentIds), [savedIds, currentIds]);
  const targetDurationSec = conditions?.targetDurationSec ?? null;
  const issues = useMemo(() => runQualityCheck(present, { targetDurationSec }), [present, targetDurationSec]);
  const blocking = hasBlockingIssues(issues);
  const reviewSummary = useMemo(() => saveReviewSummary(savedIds, present, issues), [savedIds, present, issues]);

  const doSave = useCallback(async () => {
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
      setLastSavedAt(new Date().toLocaleTimeString());
      setSaveReviewOpen(false);
      setCounts((m) => new Map(m).set(selectedId, res.track_count));
      toast.success(`저장 완료 — ${res.track_count}곡(삭제 ${res.removed})`);
    } catch (e) {
      toast.error(friendlyError(e, '저장에 실패했습니다.'));
    } finally {
      setSaving(false);
    }
  }, [selectedId, saving, blocking, present]);

  // ---- 렌더 데이터 ----
  const candidateFilter: CandidateFilters = useMemo(() => {
    const base = conditions
      ? presetToFilters(conditions, { query: search, excludeAlreadyIn: hideAlreadyIn })
      : { query: search, excludeAlreadyIn: hideAlreadyIn };
    return base;
  }, [conditions, search, hideAlreadyIn]);

  const visibleCandidates = useMemo(() => {
    const filtered = filterCandidates(catalog, candidateFilter);
    const sorted = sortByScore(filtered, conditions?.candidateSort ?? 'fit');
    return sorted.slice(0, CANDIDATE_PAGE);
  }, [catalog, candidateFilter, conditions]);

  const selSummary = useMemo(() => selectionSummary(catalog, selected), [catalog, selected]);
  const selectedTrack = useMemo(() => present.find((t) => t.track_id === selectedTrackId) ?? null, [present, selectedTrackId]);
  const suggested = useMemo(() => (present.length > 1 ? suggestOrder(present).order : present), [present]);

  const openReplace = useCallback(
    (t: BuilderTrack) => {
      setReplaceTarget(t);
    },
    [],
  );
  const replaceCandidates = useMemo(
    () => (replaceTarget ? findReplacements(catalog, replaceTarget, currentIds) : []),
    [replaceTarget, catalog, currentIds],
  );

  // =====================================================================
  if (mode === 'start') {
    return (
      <>
        <StartPanel
          presets={presets}
          recents={recents}
          playlists={playlists}
          loading={startLoading}
          onStart={handleStart}
          onEdit={handleEdit}
          onOpenTemplates={() => setTemplatesOpen(true)}
          onClearRecents={() => {
            clearRecentConditions(userId);
            setRecents([]);
          }}
        />
        <TemplateLibrary
          open={templatesOpen}
          onClose={() => setTemplatesOpen(false)}
          playlists={playlists}
          counts={counts}
          onCloned={(newId) => {
            setTemplatesOpen(false);
            handleEdit(newId);
          }}
        />
      </>
    );
  }

  // =====================================================================
  return (
    <div className="flex flex-col gap-3">
      {/* 헤더 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line/10 bg-bg-card p-3">
        <button className="btn-ghost h-8 gap-1 px-2 text-sm" onClick={backToStart}>
          <ArrowLeft size={15} /> 시작
        </button>
        <Music size={16} className="text-accent" />
        <select
          className="input h-8 max-w-[15rem] text-sm"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          aria-label="플레이리스트 선택"
        >
          <option value="">플레이리스트 선택…</option>
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
              selectedPlaylist.status === 'released' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
            }`}
          >
            {selectedPlaylist.status === 'released' ? '발매됨' : '초안'}
          </span>
        )}
        {conditions && (
          <button
            className="btn-ghost h-8 gap-1 px-2 text-xs"
            onClick={() => setShowConditions((v) => !v)}
            title="Preset 조건 수정"
          >
            <SlidersHorizontal size={13} /> 조건
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {unsaved && (
            <span className="hidden text-[11px] text-amber-300 sm:inline">
              미저장 · 추가 {unsavedSummary.added} · 삭제 {unsavedSummary.removed} · 순서 {unsavedSummary.reordered}
            </span>
          )}
          {lastSavedAt && !unsaved && <span className="hidden text-[11px] text-ink-dim sm:inline">저장됨 {lastSavedAt}</span>}
          <button className="btn-ghost h-8 px-2" onClick={() => setHistory((h) => undo(h))} disabled={!canUndo(history)} aria-label="실행 취소" title="실행 취소">
            <Undo2 size={15} />
          </button>
          <button className="btn-ghost h-8 px-2" onClick={() => setHistory((h) => redo(h))} disabled={!canRedo(history)} aria-label="다시 실행" title="다시 실행">
            <Redo2 size={15} />
          </button>
          <button className="btn-ghost h-8 gap-1 px-2 text-sm" onClick={() => setTemplatesOpen(true)}>
            <Copy size={14} /> Template
          </button>
          <button
            className="btn-primary h-8 gap-1 px-3 text-sm disabled:opacity-50"
            onClick={() => setSaveReviewOpen(true)}
            disabled={!selectedId || !unsaved || saving || blocking}
            title={blocking ? '오류 항목을 먼저 해결하세요' : undefined}
          >
            <Save size={14} /> 저장
            {unsaved && <span className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-300" />}
          </button>
        </div>
      </div>

      {conditions && showConditions && (
        <ConditionsEditor conditions={conditions} onChange={setConditions} />
      )}

      {flagged && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-500/5 p-2 text-xs">
          <span className="text-amber-300">
            “{flagged.label}” {flagged.ids.size}곡 선택됨
          </span>
          <button className="btn-ghost ml-auto h-7 px-2 text-xs text-red-300" onClick={removeFlagged}>
            선택 트랙 제거
          </button>
          <button className="btn-ghost h-7 px-2 text-xs" onClick={() => setFlagged(null)}>
            해제
          </button>
        </div>
      )}

      {!selectedId ? (
        <div className="rounded-xl border border-dashed border-line/20 p-10 text-center text-sm text-ink-mute">
          편집할 플레이리스트를 선택하세요.
        </div>
      ) : loadingData ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-line/10 p-10 text-sm text-ink-mute">
          <RefreshCw size={16} className="animate-spin" /> 불러오는 중…
        </div>
      ) : (
        <>
          {/* 모바일 탭 */}
          <div className="flex gap-1 rounded-lg border border-line/10 bg-bg-card p-1 text-xs lg:hidden">
            {(['candidates', 'playlist', 'quality'] as const).map((t) => (
              <button
                key={t}
                className={`flex-1 rounded-md px-2 py-1.5 ${mobileTab === t ? 'bg-accent/15 text-accent' : 'text-ink-mute'}`}
                onClick={() => setMobileTab(t)}
              >
                {t === 'candidates' ? '후보' : t === 'playlist' ? '플레이리스트' : '품질'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
            {/* 좌: 후보 */}
            <section className={`${mobileTab === 'candidates' ? 'flex' : 'hidden'} min-h-[24rem] flex-col rounded-xl border border-line/10 bg-bg-card lg:flex`}>
              <div className="space-y-2 border-b border-line/10 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  후보 트랙 <span className="text-ink-mute">({visibleCandidates.length})</span>
                  {conditions && <span className="ml-auto text-[10px] text-ink-dim">Preset 조건 적용</span>}
                </div>
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-dim" />
                  <input className="input h-8 w-full pl-7 text-sm" placeholder="제목·아티스트·장르 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <label className="flex items-center gap-1.5 text-xs text-ink-mute">
                  <input type="checkbox" checked={hideAlreadyIn} onChange={(e) => setHideAlreadyIn(e.target.checked)} />
                  이미 포함된 곡 숨기기
                </label>
                {/* Bulk 선택 툴바 */}
                <div className="flex flex-wrap items-center gap-1 text-[11px]">
                  <button className="btn-ghost h-6 px-1.5" onClick={() => setSelected((s) => selectAllOnPage(s, visibleCandidates))}>
                    <CheckSquare size={12} className="mr-1 inline" />
                    페이지 선택
                  </button>
                  <button className="btn-ghost h-6 px-1.5" onClick={() => setSelected((s) => invertSelection(s, visibleCandidates))}>
                    반전
                  </button>
                  <button className="btn-ghost h-6 px-1.5" onClick={() => setSelected((s) => deselectPage(s, visibleCandidates))}>
                    해제
                  </button>
                  {selSummary.count > 0 && (
                    <button className="btn-primary ml-auto h-6 gap-1 px-2" onClick={addSelected}>
                      <Plus size={12} /> {selSummary.count}곡 추가 · {formatTotalDuration(selSummary.totalDurationSec)}
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-ink-dim">현재 페이지({CANDIDATE_PAGE}곡) 범위 내 선택입니다.</p>
              </div>
              <ul className="flex-1 divide-y divide-line/10 overflow-y-auto">
                {visibleCandidates.map((t) => (
                  <CandidateRow
                    key={t.track_id}
                    track={t}
                    checked={selected.has(t.track_id)}
                    onToggle={() => setSelected((s) => toggleSelection(s, t.track_id, isSelectable(t)))}
                    onAdd={() => addTrack(t)}
                  />
                ))}
                {visibleCandidates.length === 0 && <li className="p-6 text-center text-xs text-ink-mute">일치하는 후보가 없습니다.</li>}
              </ul>
            </section>

            {/* 중: 현재 플리 */}
            <section className={`${mobileTab === 'playlist' ? 'flex' : 'hidden'} min-h-[24rem] flex-col rounded-xl border border-line/10 bg-bg-card lg:flex`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-line/10 p-3">
                <span className="text-sm font-medium">현재 트랙 ({present.length})</span>
                <span className="text-xs text-ink-mute">{formatTotalDuration(totalDuration(present))}</span>
                <div className="ml-auto flex items-center gap-1">
                  <button className="btn-ghost h-7 gap-1 px-2 text-xs" onClick={() => setPreviewOpen(true)} disabled={present.length === 0}>
                    <PlayCircle size={13} /> 미리듣기
                  </button>
                  <button className="btn-ghost h-7 gap-1 px-2 text-xs" onClick={() => setOrderDiffOpen(true)} disabled={present.length < 2} title="정책 기반 순서 제안 비교">
                    <Wand2 size={13} /> 순서 제안
                  </button>
                </div>
              </div>
              {present.length === 0 ? (
                <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-ink-mute">좌측에서 트랙을 추가하세요.</div>
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
                          flagged={flagged?.ids.has(t.track_id) ?? false}
                          playlist={present}
                          onSelect={() => setSelectedTrackId(t.track_id)}
                          onRemove={() => removeTrack(t.track_id)}
                        />
                      ))}
                    </ol>
                  </SortableContext>
                </DndContext>
              )}
            </section>

            {/* 우: 품질/상세 */}
            <section className={`${mobileTab === 'quality' ? 'flex' : 'hidden'} min-h-[24rem] flex-col gap-3 lg:flex`}>
              <QualityDashboard tracks={present} targetDurationSec={targetDurationSec} onFlag={(ids, label) => setFlagged({ ids: new Set(ids), label })} />
              {selectedTrack && <InspectorPanel track={selectedTrack} playlist={present} onReplace={() => openReplace(selectedTrack)} />}
            </section>
          </div>
        </>
      )}

      {/* 모달들 */}
      <TemplateLibrary
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        playlists={playlists}
        counts={counts}
        onCloned={(newId) => {
          setTemplatesOpen(false);
          handleEdit(newId);
        }}
      />
      <PreviewDrawer open={previewOpen} onClose={() => setPreviewOpen(false)} tracks={present} />
      <OrderDiffDialog
        open={orderDiffOpen}
        onClose={() => setOrderDiffOpen(false)}
        current={present}
        suggested={suggested}
        onApply={(order) => {
          commit(order);
          setOrderDiffOpen(false);
          toast.success('추천 순서를 적용했습니다(미저장, Undo 가능).');
        }}
      />
      <ReplacementDialog open={!!replaceTarget} onClose={() => setReplaceTarget(null)} target={replaceTarget} candidates={replaceCandidates} onReplace={replaceTrack} />
      {selectedPlaylist && (
        <SaveReviewDialog
          open={saveReviewOpen}
          onClose={() => setSaveReviewOpen(false)}
          summary={reviewSummary}
          playlistTitle={selectedPlaylist.title}
          afterStatusLabel={selectedPlaylist.status === 'released' ? '발매됨(유지)' : '초안(유지)'}
          saving={saving}
          onConfirm={() => void doSave()}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function ScoreBadge({ track }: { track: BuilderTrack }) {
  const eff = effectiveScore(track);
  if (eff == null) return null;
  return (
    <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent" title="적용 점수(adaptive ?? fit)">
      {Math.round(eff)}
    </span>
  );
}

function CandidateRow({
  track,
  checked,
  onToggle,
  onAdd,
}: {
  track: BuilderTrack;
  checked: boolean;
  onToggle: () => void;
  onAdd: () => void;
}) {
  const tags = recommendationTags(track);
  return (
    <li className="flex items-center gap-2 p-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        disabled={!isSelectable(track)}
        aria-label={`${track.title ?? '트랙'} 선택`}
        className="shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{track.title ?? '제목 없음'}</p>
        <p className="truncate text-xs text-ink-mute">
          {track.artist ?? '—'}
          {track.genre ? ` · ${track.genre}` : ''}
        </p>
        {tags.length > 0 && (
          <div className="mt-1">
            <TagBadges tags={tags} max={4} />
          </div>
        )}
      </div>
      <ScoreBadge track={track} />
      <button className="btn-ghost h-7 gap-1 px-2 text-xs" onClick={onAdd} disabled={track.alreadyInPlaylist} aria-label={`${track.title ?? '트랙'} 추가`}>
        <Plus size={13} /> {track.alreadyInPlaylist ? '포함됨' : '추가'}
      </button>
    </li>
  );
}

function SortablePlaylistRow({
  track,
  index,
  selected,
  flagged,
  playlist,
  onSelect,
  onRemove,
}: {
  track: BuilderTrack;
  index: number;
  selected: boolean;
  flagged: boolean;
  playlist: BuilderTrack[];
  onSelect: () => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: track.track_id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const tags = recommendationTags(track, playlist);
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 border-b border-line/10 p-2.5 last:border-b-0 ${selected ? 'bg-accent/5' : ''} ${flagged ? 'ring-1 ring-inset ring-amber-400/40' : ''}`}
    >
      <button {...attributes} {...listeners} className="cursor-grab touch-none text-ink-dim active:cursor-grabbing" aria-label="순서 변경">
        <GripVertical size={15} />
      </button>
      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-dim">{index + 1}</span>
      <button className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <p className="truncate text-sm">{track.title ?? '제목 없음'}</p>
        <p className="truncate text-xs text-ink-mute">{track.artist ?? '—'}</p>
        {tags.length > 0 && (
          <div className="mt-1">
            <TagBadges tags={tags} max={3} />
          </div>
        )}
      </button>
      <ScoreBadge track={track} />
      <button onClick={onRemove} className="rounded-md px-2 py-1 text-xs text-red-300 hover:bg-rose-500/20" aria-label="제거">
        <X size={14} />
      </button>
    </li>
  );
}

function InspectorPanel({ track, playlist, onReplace }: { track: BuilderTrack; playlist: BuilderTrack[]; onReplace: () => void }) {
  const tags = recommendationTags(track, playlist);
  const num = (v: number | null) => (v == null ? '—' : String(Math.round(v)));
  const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const stat = (label: string, value: string) => (
    <div className="flex justify-between text-xs">
      <span className="text-ink-mute">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="space-y-2 rounded-xl border border-line/10 bg-bg-card p-3">
      <p className="truncate text-sm font-medium">{track.title ?? '제목 없음'}</p>
      <p className="truncate text-xs text-ink-mute">{track.artist ?? '—'}</p>
      {tags.length > 0 && <TagBadges tags={tags} />}
      <div className="space-y-1 border-t border-line/10 pt-2">
        {stat('Fit', num(track.fitScore))}
        {stat('Adaptive', num(track.adaptiveScore))}
        {stat('완주율', pct(track.completionRate))}
        {stat('스킵율', pct(track.skipRate))}
        {stat('표본 수', num(track.sampleCount))}
        {stat('BPM', num(track.bpm))}
        {stat('에너지', num(track.energyLevel))}
      </div>
      <button className="btn-ghost h-8 w-full gap-1 text-xs" onClick={onReplace}>
        <Repeat size={13} /> 대체 후보 보기
      </button>
    </div>
  );
}

function ConditionsEditor({ conditions, onChange }: { conditions: PresetConditions; onChange: (c: PresetConditions) => void }) {
  const set = (patch: Partial<PresetConditions>) => onChange({ ...conditions, ...patch });
  const numField = (label: string, key: keyof PresetConditions, min = 0, max = 300) => (
    <label className="flex items-center gap-1 text-xs">
      <span className="w-16 text-ink-mute">{label}</span>
      <input
        type="number"
        className="input h-7 w-20 text-xs"
        min={min}
        max={max}
        value={(conditions[key] as number | null) ?? ''}
        onChange={(e) => set({ [key]: e.target.value === '' ? null : Number(e.target.value) } as Partial<PresetConditions>)}
      />
    </label>
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line/10 bg-bg-card p-3">
      <span className="text-xs font-medium">Preset 조건</span>
      {numField('BPM 최소', 'bpmMin')}
      {numField('BPM 최대', 'bpmMax')}
      {numField('Energy 최소', 'energyMin', 1, 5)}
      {numField('Energy 최대', 'energyMax', 1, 5)}
      {numField('최소 Fit', 'fitMin', 0, 100)}
      <label className="flex items-center gap-1 text-xs">
        <span className="text-ink-mute">Vocal</span>
        <select className="input h-7 text-xs" value={conditions.vocal} onChange={(e) => set({ vocal: e.target.value as PresetConditions['vocal'] })}>
          <option value="any">제한 없음</option>
          <option value="vocal">보컬</option>
          <option value="instrumental">연주곡</option>
        </select>
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-mute">
        <input type="checkbox" checked={conditions.excludeExplicit} onChange={(e) => set({ excludeExplicit: e.target.checked })} />
        Explicit 제외
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-mute">
        <input type="checkbox" checked={conditions.excludePenalized} onChange={(e) => set({ excludePenalized: e.target.checked })} />
        Penalized 제외
      </label>
    </div>
  );
}
