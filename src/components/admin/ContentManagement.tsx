import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Music, ListMusic, Upload, Play, Pencil, Trash2, Save, X, Search } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { supabase } from '@/lib/supabase';
import { fetchPlaylists, fetchTracks } from '@/lib/api';
import { fetchAllCurators, fetchMyCuratorProfile, type CuratorListItem } from '@/lib/curatorApi';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import { useFreshFetch } from '@/hooks/useFreshFetch';
import type { PlaylistRow, TrackRow } from '@/types/db';
import TrackUploader from '@/components/admin/TrackUploader';
import PlaylistEditor from '@/components/admin/PlaylistEditor';
import { adminHardDeleteTrack, adminUpdateTrackMetadataFull, getAdminTrackDetail, listAdminTracksWithAi, aiCorrectionStats, listSevereMismatches, bulkDeleteSevereMismatches, type AdminTrackMetadataFullInput, type AdminTrackDetail, type AdminTrackWithAi, type AiCorrectionStat, type MetadataMismatch } from '@/lib/adminTrackApi';
import { bulkApplyHighConfidence } from '@/lib/trackAiPredictionsApi';
import { toast } from '@/store/toastStore';
import { friendlyError } from '@/lib/errorMessages';

type SubTab = 'playlists' | 'tracks';

export default function ContentManagement() {
  const [subTab, setSubTab] = useState<SubTab>('playlists');
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [tracks, setTracks] = useState<TrackRow[]>([]);
  const [aiTracks, setAiTracks] = useState<AdminTrackWithAi[]>([]);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [creatingPlaylist, setCreatingPlaylist] = useState(false);
  const [showUploader, setShowUploader] = useState(false);

  // WEB-OPT-6 — AI 메타(최대 1500행)는 tracks 서브탭에서만 사용된다. 기본 서브탭이
  //   'playlists' 이므로, 이전에는 콘텐츠관리 진입/포커스마다 불필요하게 대용량 AI 조회를
  //   함께 실행했다. AI 조회를 분리해 tracks 탭 활성일 때만 수행한다(playlists/tracks
  //   목록 조회 및 mutation 후 refresh 의미는 그대로 유지).
  async function refreshAiTracks() {
    const aiTs = await listAdminTracksWithAi(1500).catch((e) => {
      console.warn('[ContentManagement] listAdminTracksWithAi failed — AI 메타 컬럼 비활성:', e);
      return [] as AdminTrackWithAi[];
    });
    setAiTracks(aiTs);
  }

  async function refresh() {
    const [pls, trs] = await Promise.all([fetchPlaylists(), fetchTracks()]);
    setPlaylists(pls);
    setTracks(trs);
    // tracks 탭이 활성일 때만 AI 메타 갱신 — 곡 mutation(삭제/수정/업로드) 후 정합성 유지.
    if (subTab === 'tracks') await refreshAiTracks();
  }

  // 재로그인 / 새로고침 / 탭 복귀 시 항상 DB 에서 최신 fetch
  useFreshFetch(refresh, []);

  // tracks 서브탭으로 전환 시 AI 메타를 지연 로드(진입 전에는 조회하지 않음).
  useEffect(() => {
    if (subTab === 'tracks') void refreshAiTracks();
  }, [subTab]);

  async function createPlaylist(form: {
    title: string;
    category: string;
    description: string;
    is_business_only: boolean;
    business_category: string | null;
    time_slot: string | null;
    created_by_user_id: string | null;
  }) {
    if (!form.title.trim()) {
      toast.error('플레이리스트 제목은 필수예요.');
      return;
    }
    if (!form.category.trim()) {
      toast.error('카테고리는 필수예요.');
      return;
    }
    const { data, error } = await supabase
      .from('playlists')
      .insert({
        title: form.title.trim(),
        category: form.category.trim(),
        description: form.description.trim() || null,
        is_business_only: form.is_business_only,
        business_category: form.business_category?.trim() || null,
        time_slot: (form.time_slot as PlaylistRow['time_slot']) || null,
        created_by_user_id: form.created_by_user_id,
      })
      // WEB-OPT-6 — insert 반환 row 에서 실제로 쓰는 건 id 뿐(setEditingPlaylistId).
      //   select('*') → select('id') 로 축소(응답 의미 불변).
      .select('id')
      .single();
    if (error) {
      toast.error(`생성 실패: ${error.message}`);
      return;
    }
    toast.success('플레이리스트를 만들었어요.');
    await refresh();
    setCreatingPlaylist(false);
    if (data) setEditingPlaylistId(data.id);
  }

  async function deletePlaylist(id: string) {
    if (!confirm('정말 삭제하시겠어요?')) return;
    const { error } = await supabase.from('playlists').delete().eq('id', id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('플레이리스트를 삭제했어요.');
    await refresh();
  }

  async function deleteTrack(id: string, title: string) {
    if (!confirm(
      `'${title}' 을 완전히 삭제할까요?\n\n` +
      `· 음원 파일 (audio/cover) 즉시 제거 → 사이트 어디서도 재생 불가\n` +
      `· 정산/수익 기록이 없으면 DB 행도 완전 제거\n` +
      `· 정산 기록이 있으면 회계 보존 위해 행은 hidden 으로 남기지만 재생은 불가\n` +
      `· 되돌릴 수 없습니다.`,
    )) return;
    try {
      const result = await adminHardDeleteTrack(id);
      if (result.mode === 'soft_due_to_revenue') {
        toast.success(`'${title}' 음원 제거 (정산 보존을 위해 DB 행은 숨김 상태로 보존)`);
      } else {
        toast.success(`'${title}' 완전 삭제 완료`);
      }
      await refresh();
    } catch (e) {
      toast.error(friendlyError(e, '삭제 실패'));
    }
  }

  if (editingPlaylistId) {
    return (
      <PlaylistEditor
        playlistId={editingPlaylistId}
        allTracks={tracks}
        onClose={() => {
          setEditingPlaylistId(null);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <SubTabBtn active={subTab === 'playlists'} onClick={() => setSubTab('playlists')} icon={<ListMusic size={14} />}>
          플레이리스트 ({playlists.length})
        </SubTabBtn>
        <SubTabBtn active={subTab === 'tracks'} onClick={() => setSubTab('tracks')} icon={<Music size={14} />}>
          트랙 ({tracks.length})
        </SubTabBtn>
      </div>

      {subTab === 'playlists' && (
        <div className="space-y-3">
          {creatingPlaylist ? (
            <CreatePlaylistForm onSubmit={createPlaylist} onCancel={() => setCreatingPlaylist(false)} />
          ) : (
            <button onClick={() => setCreatingPlaylist(true)} className="btn-primary">
              <Plus size={14} /> 새 플레이리스트
            </button>
          )}

          <ul className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card">
            {playlists.map((p) => (
              <li key={p.id} className="flex items-center gap-3 p-3 hover:bg-bg-hover">
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-accent-soft/40 to-black">
                  {p.thumbnail_url ? (
                    <img src={p.thumbnail_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-ink-dim">
                      <ListMusic size={14} />
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="truncate text-xs text-ink-mute">
                    {p.category}
                    {p.is_business_only && ' · 사업자'}
                    {p.time_slot && ` · ${p.time_slot}`}
                  </p>
                </div>
                <button
                  onClick={() => setEditingPlaylistId(p.id)}
                  className="rounded-md px-3 py-1.5 text-xs hover:bg-ink/10"
                >
                  편집
                </button>
                <button
                  onClick={() => deletePlaylist(p.id)}
                  className="rounded-md px-3 py-1.5 text-xs text-red-300 hover:bg-rose-500/20"
                >
                  삭제
                </button>
              </li>
            ))}
            {playlists.length === 0 && (
              <li className="p-6 text-center text-sm text-ink-mute">
                플레이리스트가 없어요. 새로 만들어보세요.
              </li>
            )}
          </ul>
        </div>
      )}

      {subTab === 'tracks' && (
        <AdminTrackList
          tracks={tracks}
          aiTracks={aiTracks}
          showUploader={showUploader}
          setShowUploader={setShowUploader}
          onUploaded={async () => { setShowUploader(false); await refresh(); }}
          onDelete={(id, title) => deleteTrack(id, title)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}

/** 트랙 리스트 + 검색 + 페이지네이션 + AI 정확도 패널. */
function AdminTrackList({
  tracks, aiTracks, showUploader, setShowUploader, onUploaded, onDelete, onUpdated,
}: {
  tracks: TrackRow[];
  aiTracks: AdminTrackWithAi[];
  showUploader: boolean;
  setShowUploader: (b: boolean) => void;
  onUploaded: () => Promise<void>;
  onDelete: (id: string, title: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const PAGE_SIZE = 50;
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<AiCorrectionStat[]>([]);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [mismatches, setMismatches] = useState<MetadataMismatch[] | null>(null);
  const [showMismatch, setShowMismatch] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [bulkDraft, setBulkDraft] = useState<AdminTrackMetadataFullInput>({});
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  const aiByTrackId = useMemo(() => {
    const m = new Map<string, AdminTrackWithAi>();
    for (const a of aiTracks) m.set(a.id, a);
    return m;
  }, [aiTracks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.artist ?? '').toLowerCase().includes(q),
    );
  }, [tracks, query]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * PAGE_SIZE;
  const visible = filtered.slice(start, start + PAGE_SIZE);

  useEffect(() => { setPage(1); }, [query]);

  useEffect(() => {
    if (!showStats) return;
    aiCorrectionStats().then(setStats).catch((e) => {
      console.warn('[ContentManagement] aiCorrectionStats failed:', e);
      setStats([]);
    });
  }, [showStats]);

  async function loadMismatches() {
    setShowMismatch(true);
    try {
      const rows = await listSevereMismatches(200);
      setMismatches(rows);
    } catch (e) {
      toast.error(friendlyError(e, '불일치 조회 실패'));
    }
  }

  async function handleBulkApplyAi() {
    if (!confirm(
      'AI 예측 confidence ≥ 0.6 인 모든 트랙의 빈 메타데이터 (에너지/BPM/템포) 를 일괄 적용할까요?\n\n' +
      '· 이미 값이 있는 필드는 덮어쓰지 않습니다.\n' +
      '· 적용 후에는 AI 정확도 통계가 갱신됩니다.',
    )) return;
    setBulkApplying(true);
    try {
      const count = await bulkApplyHighConfidence(0.6, 1000);
      toast.success(`${count}개 트랙 AI 메타 일괄 적용 완료`);
      await new Promise((r) => setTimeout(r, 500));
      window.location.reload();
    } catch (e) {
      toast.error(friendlyError(e, '일괄 적용 실패'));
    } finally {
      setBulkApplying(false);
    }
  }

  async function handleAutoClean() {
    if (!mismatches || mismatches.length === 0) {
      toast.info('자동 삭제할 불일치 트랙이 없습니다.');
      return;
    }
    if (!confirm(
      `불일치 ${mismatches.length}개 트랙을 자동 삭제합니다 (confidence ≥ 0.6 만).\n\n` +
      `· 정산 기록 없으면 완전 삭제, 있으면 hidden 처리\n` +
      `· 사이트 어디서도 재생 불가\n` +
      `· 되돌릴 수 없음`,
    )) return;
    setCleaning(true);
    try {
      const r = await bulkDeleteSevereMismatches(0.6, 200);
      toast.success(`완전삭제 ${r.deleted_count} · 보존삭제 ${r.soft_deleted_count}`);
      await new Promise((res) => setTimeout(res, 500));
      window.location.reload();
    } catch (e) {
      toast.error(friendlyError(e, '자동 정리 실패'));
    } finally {
      setCleaning(false);
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function togglePage() {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOnPage = visible.every((t) => next.has(t.id));
      if (allOnPage) visible.forEach((t) => next.delete(t.id));
      else visible.forEach((t) => next.add(t.id));
      return next;
    });
  }
  function selectAllFiltered() {
    setSelected(new Set(filtered.map((t) => t.id)));
  }
  function clearSelection() { setSelected(new Set()); }

  async function handleBulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(
      `선택한 ${selected.size}개 트랙을 일괄 삭제합니다.\n\n` +
      `· 정산 없는 트랙: 완전 삭제 (DB + 스토리지)\n` +
      `· 정산 있는 트랙: hidden 처리 + 스토리지 파일 제거\n` +
      `· 어느 경우든 재생 불가\n· 되돌릴 수 없습니다.`,
    )) return;
    const ids = Array.from(selected);
    setBulkProgress({ done: 0, total: ids.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i++) {
      try { await adminHardDeleteTrack(ids[i]); ok++; }
      catch { fail++; }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setBulkProgress(null);
    setSelected(new Set());
    toast.success(`일괄 삭제 완료: 성공 ${ok}, 실패 ${fail}`);
    await onUpdated();
  }

  function openBulkEdit() {
    if (selected.size === 0) return;
    setBulkDraft({});
    setShowBulkEdit(true);
  }
  async function applyBulkEdit() {
    const draft = bulkDraft;
    // 빈 값/null 이 아닌 필드만 모음
    const patched: AdminTrackMetadataFullInput = {};
    (Object.keys(draft) as (keyof AdminTrackMetadataFullInput)[]).forEach((k) => {
      const v = draft[k];
      if (v === null || v === undefined) return;
      if (typeof v === 'string' && v.trim() === '') return;
      if (Array.isArray(v) && v.length === 0) return;
      (patched as Record<string, unknown>)[k] = v;
    });
    if (Object.keys(patched).length === 0) {
      toast.info('적용할 변경사항이 없습니다. 최소 1개 필드를 채워주세요.');
      return;
    }
    if (!confirm(`선택한 ${selected.size}개 트랙에 다음 필드를 일괄 적용합니다:\n\n${Object.keys(patched).join(', ')}\n\n진행할까요?`)) return;

    const ids = Array.from(selected);
    setBulkProgress({ done: 0, total: ids.length });
    let ok = 0, fail = 0;
    for (let i = 0; i < ids.length; i++) {
      try { await adminUpdateTrackMetadataFull(ids[i], patched); ok++; }
      catch { fail++; }
      setBulkProgress({ done: i + 1, total: ids.length });
    }
    setBulkProgress(null);
    setShowBulkEdit(false);
    toast.success(`일괄 수정 완료: 성공 ${ok}, 실패 ${fail}`);
    await onUpdated();
  }

  return (
    <div className="space-y-3">
      {showUploader ? (
        <TrackUploader onUploaded={onUploaded} onCancel={() => setShowUploader(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setShowUploader(true)} className="btn-primary">
            <Upload size={14} /> 트랙 업로드
          </button>
          <div className="flex flex-1 items-center gap-2 rounded-xl bg-bg-card px-3 py-1.5 ring-1 ring-line/10">
            <Search size={14} className="text-ink-dim" />
            <input
              type="text"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="제목/아티스트로 검색…"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-dim"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-ink-dim hover:text-ink">
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowStats((s) => !s)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ${
              showStats ? 'bg-accent/15 text-accent ring-accent/30' : 'bg-bg-card text-ink-mute ring-line/10 hover:bg-bg-hover'
            }`}
            title="AI 가 admin 수정을 통해 얼마나 학습되고 있는지"
          >
            AI 정확도
          </button>
          <button
            onClick={handleBulkApplyAi}
            disabled={bulkApplying}
            className="rounded-full bg-emerald-500/25 px-3 py-1.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/50 hover:bg-emerald-500/25 disabled:opacity-50"
            title="confidence ≥ 0.6 인 AI 예측을 빈 필드에 일괄 적용"
          >
            {bulkApplying ? '적용 중…' : 'AI 메타 일괄 적용'}
          </button>
          <button
            onClick={loadMismatches}
            className="rounded-full bg-rose-500/25 px-3 py-1.5 text-xs font-semibold text-rose-300 ring-1 ring-rose-500/50 hover:bg-rose-500/25"
            title="메타데이터와 AI 분석이 심하게 충돌하는 트랙 자동 정리"
          >
            심한 불일치 검사
          </button>
          <span className="text-[11px] text-ink-mute">
            {filtered.length === tracks.length
              ? `${tracks.length}개`
              : `${filtered.length}/${tracks.length}개`}
          </span>
        </div>
      )}

      {showMismatch && (
        <div className="rounded-2xl bg-rose-500/5 p-4 ring-1 ring-rose-500/50">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-bold text-rose-300">
              심한 불일치 트랙 — 등록 메타 vs AI 분석 결과 모순
              <span className="ml-2 font-normal text-ink-mute">({mismatches?.length ?? 0}개)</span>
            </p>
            <div className="flex gap-1.5">
              {(mismatches?.length ?? 0) > 0 && (
                <button
                  onClick={handleAutoClean}
                  disabled={cleaning}
                  className="rounded-full bg-rose-500/20 px-3 py-1 text-[11px] font-bold text-rose-300 ring-1 ring-rose-500/50 hover:bg-rose-500/30 disabled:opacity-50"
                >
                  {cleaning ? '삭제 중…' : `${mismatches?.length} 자동 삭제`}
                </button>
              )}
              <button onClick={() => { setShowMismatch(false); setMismatches(null); }} className="rounded-full bg-bg-card px-3 py-1 text-[11px] text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover">
                닫기
              </button>
            </div>
          </div>
          {!mismatches ? (
            <p className="py-4 text-center text-xs text-ink-mute">조회 중…</p>
          ) : mismatches.length === 0 ? (
            <p className="py-4 text-center text-xs text-emerald-300">심한 불일치 트랙 없음 — 메타와 AI 가 잘 맞고 있어요.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-y-auto">
              {mismatches.map((m) => (
                <li key={m.track_id} className="flex items-center gap-2 rounded bg-bg-card px-2 py-1.5 text-[10px]">
                  <span className="min-w-0 flex-1 truncate font-semibold">{m.title}</span>
                  <span className="truncate text-ink-mute">{m.artist ?? '—'}</span>
                  <span className="rounded bg-bg-soft px-1.5 py-0.5 text-ink-mute">{m.declared_genre ?? '—'} / {m.declared_mood ?? '—'}</span>
                  <span className="rounded bg-accent/15 px-1.5 py-0.5 text-accent">E{m.ai_energy ?? '—'} · {m.ai_bpm ?? '—'}BPM</span>
                  <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">{m.reasons}</span>
                  {m.ai_confidence != null && (
                    <span className="text-[9px] text-ink-dim">{Number(m.ai_confidence).toFixed(2)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {showStats && (
        <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
            AI 정확도 — admin 수정 기록 기반 (학습 시그널)
          </p>
          {stats.length === 0 ? (
            <p className="text-xs text-ink-mute">아직 수정 기록이 없습니다. 트랙 메타데이터를 편집/저장하면 AI 가 예측한 값과 admin 의 최종 값이 비교되어 여기에 누적됩니다.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {stats.map((s) => (
                <div key={s.field_name} className="rounded-lg bg-bg-soft p-3 ring-1 ring-line/10">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold">{FIELD_LABELS[s.field_name] ?? s.field_name}</p>
                    {s.accuracy_pct != null && (
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        s.accuracy_pct >= 70 ? 'bg-emerald-500/25 text-emerald-300'
                          : s.accuracy_pct >= 40 ? 'bg-amber-500/25 text-amber-300'
                          : 'bg-rose-500/25 text-rose-300'
                      }`}>
                        정확도 {s.accuracy_pct}%
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[10px] text-ink-mute">
                    총 {s.total_corrections}건 · AI 일치 {s.exact_matches} · 수정 {s.changed}
                    {s.avg_numeric_delta != null && ` · 평균 오차 ±${s.avg_numeric_delta}`}
                    {s.recent_corrections > 0 && ` · 30일 ${s.recent_corrections}건`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl bg-accent/15 px-3 py-2 ring-1 ring-accent/30 backdrop-blur">
          <span className="text-xs font-bold text-accent">선택 {selected.size}개</span>
          {selected.size < filtered.length && (
            <button onClick={selectAllFiltered} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover">
              필터 전체 ({filtered.length}) 선택
            </button>
          )}
          <button onClick={clearSelection} className="rounded-full bg-bg-card px-2.5 py-1 text-[11px] text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover">
            해제
          </button>
          <div className="ml-auto flex gap-1.5">
            <button
              onClick={openBulkEdit}
              disabled={bulkProgress != null}
              className="rounded-full bg-accent px-3 py-1 text-[11px] font-bold text-black hover:bg-accent/90 disabled:opacity-50"
            >
              일괄 편집
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={bulkProgress != null}
              className="rounded-full bg-rose-500/20 px-3 py-1 text-[11px] font-bold text-rose-300 ring-1 ring-rose-500/50 hover:bg-rose-500/30 disabled:opacity-50"
            >
              일괄 삭제
            </button>
          </div>
          {bulkProgress && (
            <span className="w-full text-[11px] text-ink-mute">
              진행 중 {bulkProgress.done}/{bulkProgress.total}…
            </span>
          )}
        </div>
      )}

      {showBulkEdit && (
        <BulkEditPanel
          count={selected.size}
          draft={bulkDraft}
          onChange={setBulkDraft}
          onCancel={() => setShowBulkEdit(false)}
          onApply={applyBulkEdit}
          running={bulkProgress != null}
        />
      )}

      <ul className="divide-y divide-line/10 overflow-hidden rounded-2xl bg-bg-card">
        {visible.length > 0 && (
          <li className="flex items-center gap-2 bg-bg-soft/60 px-3 py-2 text-[11px] text-ink-mute">
            <input
              type="checkbox"
              checked={visible.every((t) => selected.has(t.id))}
              ref={(el) => {
                if (el) el.indeterminate = visible.some((t) => selected.has(t.id)) && !visible.every((t) => selected.has(t.id));
              }}
              onChange={togglePage}
              className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent"
            />
            <span>이 페이지 전체 선택 ({visible.length}개)</span>
          </li>
        )}
        {visible.map((t) => (
          <AdminTrackRow
            key={t.id}
            track={t}
            ai={aiByTrackId.get(t.id) ?? null}
            selected={selected.has(t.id)}
            onToggle={() => toggleOne(t.id)}
            onDelete={onDelete}
            onUpdated={onUpdated}
          />
        ))}
        {filtered.length === 0 && (
          <li className="p-6 text-center text-sm text-ink-mute">
            {query ? '검색 결과가 없어요.' : '업로드된 트랙이 없어요.'}
          </li>
        )}
      </ul>

      <Pagination
        page={safePage}
        totalPages={totalPages}
        onPage={(p) => { setPage(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
      />
    </div>
  );
}

/** 숫자 페이지네이션 — 1, 2, 3, … 형태. 현재 페이지 주변 5개 + 첫/마지막. */
/** 선택된 N개 트랙에 공통 적용할 메타 폼 — 비워둔 필드는 변경 안 함. */
function BulkEditPanel({
  count, draft, onChange, onCancel, onApply, running,
}: {
  count: number;
  draft: AdminTrackMetadataFullInput;
  onChange: (next: AdminTrackMetadataFullInput) => void;
  onCancel: () => void;
  onApply: () => Promise<void> | void;
  running: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalA11y(dialogRef, { onClose: onCancel });
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-bg-card ring-1 ring-line/20 sm:max-h-[90vh] sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line/10 bg-bg-card px-4 py-3">
          <div>
            <h2 className="text-sm font-bold tracking-tight">일괄 편집 ({count}개)</h2>
            <p className="text-[10px] text-ink-dim">비워둔 필드는 변경되지 않습니다. 채운 필드만 일괄 적용.</p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-1.5 text-ink-mute hover:bg-bg-hover hover:text-ink">
            <X size={14} />
          </button>
        </header>

        <div className="space-y-3 p-4">
          <Section label="장르 / 무드">
            <Field label="메인 장르">
              <select value={draft.main_genre ?? ''} onChange={(e) => onChange({ ...draft, main_genre: e.target.value || null })} className="input h-8 text-xs">
                <option value="">— 변경 안 함 —</option>
                {GENRE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </Field>
            <Field label="서브 장르">
              <input value={draft.sub_genre ?? ''} onChange={(e) => onChange({ ...draft, sub_genre: e.target.value })} placeholder="예: City Pop" className="input h-8 text-xs" />
            </Field>
            <Field label="무드">
              <select value={draft.mood ?? ''} onChange={(e) => onChange({ ...draft, mood: e.target.value || null })} className="input h-8 text-xs">
                <option value="">— 변경 안 함 —</option>
                {MOOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
            <Field label="템포감">
              <select value={draft.tempo_feel ?? ''} onChange={(e) => onChange({ ...draft, tempo_feel: e.target.value || null })} className="input h-8 text-xs">
                <option value="">— 변경 안 함 —</option>
                {TEMPO_OPTIONS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
            </Field>
            <Field label="에너지 (1-5)">
              <input type="number" min={1} max={5} value={draft.energy_level ?? ''} onChange={(e) => onChange({ ...draft, energy_level: e.target.value ? Number(e.target.value) : null })} className="input h-8 text-xs" placeholder="— 변경 안 함" />
            </Field>
            <Field label="BPM">
              <input type="number" min={0} max={400} value={draft.bpm ?? ''} onChange={(e) => onChange({ ...draft, bpm: e.target.value ? Number(e.target.value) : null })} className="input h-8 text-xs" placeholder="— 변경 안 함" />
            </Field>
            <Field label="언어">
              <input value={draft.language ?? ''} onChange={(e) => onChange({ ...draft, language: e.target.value })} placeholder="ko / en / ja" className="input h-8 text-xs" />
            </Field>
            <Field label="적합 매장">
              <input value={draft.suitable_store ?? ''} onChange={(e) => onChange({ ...draft, suitable_store: e.target.value })} placeholder="예: 카페" className="input h-8 text-xs" />
            </Field>
          </Section>

          <Section label="태그 (쉼표로 구분)">
            <TagField label="장르 태그" value={draft.genre_tags} onChange={(arr) => onChange({ ...draft, genre_tags: arr })} colSpan={2} />
            <TagField label="무드 태그" value={draft.mood_tags} onChange={(arr) => onChange({ ...draft, mood_tags: arr })} colSpan={2} />
            <TagField label="업종 태그" value={draft.business_tags} onChange={(arr) => onChange({ ...draft, business_tags: arr })} colSpan={2} />
            <TagField label="추천 시간대" value={draft.recommended_dayparts} onChange={(arr) => onChange({ ...draft, recommended_dayparts: arr })} colSpan={2} />
            <TagField label="시간 슬롯" value={draft.time_slots} onChange={(arr) => onChange({ ...draft, time_slots: arr })} colSpan={2} />
            <TagField label="상황 태그" value={draft.situation_tags} onChange={(arr) => onChange({ ...draft, situation_tags: arr })} colSpan={2} />
            <TagField label="시즌 태그" value={draft.season_tags} onChange={(arr) => onChange({ ...draft, season_tags: arr })} colSpan={2} />
          </Section>
        </div>

        <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line/10 bg-bg-card px-4 py-3">
          <button onClick={onCancel} className="btn-ghost h-9 text-xs">
            <X size={12} /> 취소
          </button>
          <button onClick={() => onApply()} disabled={running} className="btn-primary h-9 text-xs">
            <Save size={12} /> {running ? '적용 중…' : `${count}개에 적용`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  const pages: (number | '…')[] = [];
  const add = (n: number) => { if (!pages.includes(n)) pages.push(n); };
  add(1);
  for (let i = page - 2; i <= page + 2; i++) {
    if (i > 1 && i < totalPages) add(i);
  }
  if (totalPages > 1) add(totalPages);
  // gap 삽입
  const withGaps: (number | '…')[] = [];
  pages.forEach((n, i) => {
    if (i > 0 && typeof n === 'number' && typeof pages[i - 1] === 'number' && (n - (pages[i - 1] as number)) > 1) {
      withGaps.push('…');
    }
    withGaps.push(n);
  });

  return (
    <nav className="flex items-center justify-center gap-1">
      <button
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={page === 1}
        className="rounded-lg bg-bg-card px-2.5 py-1.5 text-xs text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-30"
      >
        ‹
      </button>
      {withGaps.map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-xs text-ink-dim">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 ${
              p === page ? 'bg-accent text-black ring-accent' : 'bg-bg-card text-ink-mute ring-line/10 hover:bg-bg-hover hover:text-ink'
            }`}
          >
            {p}
          </button>
        ),
      )}
      <button
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="rounded-lg bg-bg-card px-2.5 py-1.5 text-xs text-ink-mute ring-1 ring-line/10 hover:bg-bg-hover disabled:opacity-30"
      >
        ›
      </button>
    </nav>
  );
}

const FIELD_LABELS: Record<string, string> = {
  energy_level: '에너지 (1-5)',
  bpm: 'BPM',
  tempo_feel: '템포감',
  main_genre: '메인 장르',
  mood: '무드',
};

const GENRE_OPTIONS = ['POP','House','R&B','K-POP','J-Pop','Lo-fi','Jazz','Indie Pop','Jazzhop','Hip-Hop','K-HipHop','Phonk','Chillhop','Ballad','Retro Pop','Instrumental','Electronic','Ambient','Classical','Lounge','Soul','Funk'] as const;
const MOOD_OPTIONS = ['차분한','밝은','트렌디한','따뜻한','몽환적인','신나는','감각적인','고급스러운','활기찬','편안한','세련된'] as const;
const TEMPO_OPTIONS = [{ v: 'slow', l: '느림' }, { v: 'mid', l: '중간' }, { v: 'fast', l: '빠름' }] as const;

/** 단일 트랙 행 — 재생/편집/삭제 + 메타 풀 비교 + 인라인 수정 + 다중 선택. */
function AdminTrackRow({
  track, ai, selected, onToggle, onDelete, onUpdated,
}: {
  track: TrackRow;
  ai: AdminTrackWithAi | null;
  selected: boolean;
  onToggle: () => void;
  onDelete: (id: string, title: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id ?? null);
  const isPlaying = usePlayerStore((s) => s.playing);
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<AdminTrackDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AdminTrackMetadataFullInput>({});

  // 짧은 라벨용 raw 캐스팅 (collapsed 상태에서 빠른 표시)
  const raw = track as unknown as TrackRow & {
    main_genre?: string | null; sub_genre?: string | null; mood?: string | null;
    energy_level?: number | null; bpm?: number | null; tempo_feel?: string | null;
  };

  const playable = isPlayableUrl(track.audio_url);
  const isThisPlaying = currentTrackId === track.id && isPlaying;

  async function openEdit() {
    setEditing(true);
    setLoadingDetail(true);
    try {
      const d = await getAdminTrackDetail(track.id);
      if (d) {
        setDetail(d);
        setDraft({
          title: d.title, artist: d.artist, album_name: d.album_name,
          main_genre: d.main_genre, sub_genre: d.sub_genre, mood: d.mood,
          suitable_store: d.suitable_store, lyrics: d.lyrics, language: d.language,
          explicit_content: d.explicit_content, instrumental: d.instrumental,
          energy_level: d.energy_level, bpm: d.bpm, tempo_feel: d.tempo_feel,
          vocal_type: d.vocal_type, vocal_presence: d.vocal_presence,
          emotional_intensity: d.emotional_intensity, brightness_level: d.brightness_level,
          mood_tags: d.mood_tags, genre_tags: d.genre_tags,
          business_tags: d.business_tags,
          recommended_dayparts: d.recommended_dayparts, time_slots: d.time_slots,
          situation_tags: d.situation_tags, season_tags: d.season_tags,
        });
      }
    } catch (e) {
      toast.error(friendlyError(e, '메타데이터 불러오기 실패'));
    } finally {
      setLoadingDetail(false);
    }
  }

  function play() {
    if (!playable) { toast.info('재생 가능한 음원이 없어요.'); return; }
    setQueue([track], 0, null);
  }

  function applyAiEnergy() {
    if (detail?.ai_predicted_energy_level != null) {
      setDraft((d) => ({ ...d, energy_level: detail.ai_predicted_energy_level }));
    }
  }
  function applyAiBpm() {
    if (detail?.ai_predicted_bpm != null) {
      setDraft((d) => ({ ...d, bpm: detail.ai_predicted_bpm }));
    }
  }
  function applyAiTempo() {
    if (detail?.ai_predicted_tempo_feel) {
      setDraft((d) => ({ ...d, tempo_feel: detail.ai_predicted_tempo_feel }));
    }
  }

  async function save() {
    setSaving(true);
    try {
      await adminUpdateTrackMetadataFull(track.id, draft);
      toast.success('메타데이터 저장 완료');
      setEditing(false);
      await onUpdated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : ((e as { message?: string })?.message ?? '저장 실패'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className={`border-b border-line/5 last:border-b-0 ${selected ? 'bg-accent/5' : ''}`}>
      <div className="flex items-center gap-3 p-3 hover:bg-bg-hover">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="h-4 w-4 shrink-0 rounded border-line/30 bg-bg-card accent-accent"
          title="선택"
        />
        <button
          onClick={play} disabled={!playable}
          className={`relative h-10 w-10 shrink-0 overflow-hidden rounded-md ${playable ? 'ring-1 ring-line/10' : 'opacity-50'}`}
          title={playable ? '재생' : '재생 불가'}
        >
          {track.cover_url ? (
            <img src={track.cover_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-bg-hover text-ink-dim">
              <Music size={14} />
            </div>
          )}
          <div className={`absolute inset-0 flex items-center justify-center bg-black/40 ${isThisPlaying ? 'opacity-100' : 'opacity-0 hover:opacity-100'} transition`}>
            <Play size={14} fill="currentColor" className="text-white" />
          </div>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {track.title}
            {isThisPlaying && <span className="ml-1.5 text-[10px] text-accent">▶ 재생 중</span>}
          </p>
          <p className="truncate text-xs text-ink-mute">
            {track.artist ?? '—'}
            {(raw.main_genre || raw.sub_genre) && (
              <span className="ml-1.5 text-ink-dim">· {raw.main_genre ?? ''}{raw.sub_genre ? ` / ${raw.sub_genre}` : ''}</span>
            )}
          </p>
          {/* 현재 vs AI 비교 라인 */}
          <p className="mt-1 flex flex-wrap gap-1 text-[10px]">
            <ComparePair
              label="E" current={raw.energy_level ?? null} ai={ai?.ai_predicted_energy_level ?? null}
              confidence={ai?.ai_energy_confidence ?? null}
            />
            <ComparePair
              label="BPM" current={raw.bpm ?? null} ai={ai?.ai_predicted_bpm ?? null}
            />
            <ComparePair
              label="템포" current={raw.tempo_feel ? (TEMPO_OPTIONS.find((t) => t.v === raw.tempo_feel)?.l ?? raw.tempo_feel) : null}
              ai={ai?.ai_predicted_tempo_feel ? (TEMPO_OPTIONS.find((t) => t.v === ai.ai_predicted_tempo_feel)?.l ?? ai.ai_predicted_tempo_feel) : null}
            />
            {ai?.ai_applied_at && (
              <span className="rounded bg-emerald-500/25 px-1 text-[9px] font-bold text-emerald-300">AI 적용됨</span>
            )}
          </p>
        </div>

        <span className={`hidden rounded-full px-2 py-0.5 text-[10px] sm:inline ${playable ? 'bg-emerald-500/25 text-slate-900 dark:text-emerald-200' : 'bg-yellow-500/25 text-slate-900 dark:text-yellow-200'}`}>
          {playable ? '재생가능' : '음원 없음'}
        </span>

        <button
          onClick={() => editing ? setEditing(false) : openEdit()}
          className={`rounded-md px-2.5 py-1.5 text-xs ${editing ? 'bg-accent text-black' : 'text-ink-mute hover:bg-ink/10 hover:text-ink'}`}
          title="메타데이터 편집"
        >
          <Pencil size={12} className="inline" /> 편집
        </button>
        <button
          onClick={() => onDelete(track.id, track.title)}
          className="rounded-md px-2.5 py-1.5 text-xs text-red-300 hover:bg-rose-500/20"
          title="완전 삭제 (DB + 스토리지)"
        >
          <Trash2 size={12} className="inline" /> 삭제
        </button>
      </div>

      {editing && (
        <div className="border-t border-line/10 bg-bg-soft px-3 py-3">
          {loadingDetail ? (
            <p className="py-4 text-center text-xs text-ink-mute">메타데이터 불러오는 중…</p>
          ) : !detail ? (
            <p className="py-4 text-center text-xs text-rose-300">불러오기 실패</p>
          ) : (
            <div className="space-y-3">
              {/* 발매/소스 상태 */}
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <Pill tone="info">{detail.source_label}</Pill>
                {detail.release_status && <Pill tone="info">상태: {detail.release_status}</Pill>}
                {detail.visibility_status && <Pill>가시: {detail.visibility_status}</Pill>}
                {detail.audio_health_status && <Pill tone={detail.audio_health_status === 'ok' ? 'good' : 'warn'}>오디오: {detail.audio_health_status}</Pill>}
                {detail.metadata_source && <Pill>메타소스: {detail.metadata_source}</Pill>}
                {detail.isrc && <Pill>ISRC: {detail.isrc}</Pill>}
                {detail.release_date && <Pill>발매일: {detail.release_date}</Pill>}
                {detail.release_type && <Pill>{detail.release_type}</Pill>}
                {detail.duration != null && <Pill>{Math.round(detail.duration)}초</Pill>}
              </div>

              {/* AI 분석 vs 현재 — 핵심 비교 */}
              <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/10">
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-dim">
                  AI 분석 결과 (CLAP + librosa)
                  {detail.ai_predicted_at && (
                    <span className="ml-2 font-normal normal-case text-ink-dim">
                      {new Date(detail.ai_predicted_at).toLocaleDateString()}
                      {detail.ai_applied_at && ' · 이미 반영됨'}
                    </span>
                  )}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <Compare
                    label="에너지 (1-5)" current={draft.energy_level} predicted={detail.ai_predicted_energy_level}
                    confidence={detail.ai_energy_confidence} onApply={applyAiEnergy}
                  />
                  <Compare
                    label="BPM" current={draft.bpm} predicted={detail.ai_predicted_bpm} onApply={applyAiBpm}
                  />
                  <Compare
                    label="템포감" current={draft.tempo_feel ? (TEMPO_OPTIONS.find((t) => t.v === draft.tempo_feel)?.l ?? draft.tempo_feel) : null}
                    predicted={detail.ai_predicted_tempo_feel ? (TEMPO_OPTIONS.find((t) => t.v === detail.ai_predicted_tempo_feel)?.l ?? detail.ai_predicted_tempo_feel) : null}
                    onApply={applyAiTempo}
                  />
                </div>
              </div>

              {/* 식별 정보 */}
              <Section label="기본 정보">
                <Field label="제목" colSpan={2}>
                  <input value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="input h-8 text-xs" />
                </Field>
                <Field label="아티스트" colSpan={2}>
                  <input value={draft.artist ?? ''} onChange={(e) => setDraft({ ...draft, artist: e.target.value })} className="input h-8 text-xs" />
                </Field>
                <Field label="앨범" colSpan={2}>
                  <input value={draft.album_name ?? ''} onChange={(e) => setDraft({ ...draft, album_name: e.target.value })} className="input h-8 text-xs" />
                </Field>
                <Field label="언어" colSpan={1}>
                  <input value={draft.language ?? ''} onChange={(e) => setDraft({ ...draft, language: e.target.value })} placeholder="ko / en / ja" className="input h-8 text-xs" />
                </Field>
                <Field label="권리자" colSpan={1}>
                  <input value={detail.rights_holder_name ?? '—'} readOnly className="input h-8 cursor-not-allowed text-xs opacity-60" />
                </Field>
              </Section>

              {/* 장르/무드 */}
              <Section label="장르 / 무드">
                <Field label="메인 장르">
                  <select value={draft.main_genre ?? ''} onChange={(e) => setDraft({ ...draft, main_genre: e.target.value || null })} className="input h-8 text-xs">
                    <option value="">—</option>
                    {GENRE_OPTIONS.map((g) => <option key={g} value={g}>{g}</option>)}
                  </select>
                </Field>
                <Field label="서브 장르">
                  <input value={draft.sub_genre ?? ''} onChange={(e) => setDraft({ ...draft, sub_genre: e.target.value })} placeholder="예: City Pop" className="input h-8 text-xs" />
                </Field>
                <Field label="무드">
                  <select value={draft.mood ?? ''} onChange={(e) => setDraft({ ...draft, mood: e.target.value || null })} className="input h-8 text-xs">
                    <option value="">—</option>
                    {MOOD_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="템포감">
                  <select value={draft.tempo_feel ?? ''} onChange={(e) => setDraft({ ...draft, tempo_feel: e.target.value || null })} className="input h-8 text-xs">
                    <option value="">—</option>
                    {TEMPO_OPTIONS.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
                  </select>
                </Field>
                <Field label="에너지 (1-5)">
                  <input type="number" min={1} max={5} value={draft.energy_level ?? ''} onChange={(e) => setDraft({ ...draft, energy_level: e.target.value ? Number(e.target.value) : null })} className="input h-8 text-xs" />
                </Field>
                <Field label="BPM">
                  <input type="number" min={0} max={400} value={draft.bpm ?? ''} onChange={(e) => setDraft({ ...draft, bpm: e.target.value ? Number(e.target.value) : null })} className="input h-8 text-xs" />
                </Field>
                <Field label="적합 매장">
                  <input value={draft.suitable_store ?? ''} onChange={(e) => setDraft({ ...draft, suitable_store: e.target.value })} placeholder="예: 카페" className="input h-8 text-xs" />
                </Field>
                <Field label="Instrumental">
                  <label className="flex h-8 items-center gap-2 text-xs">
                    <input type="checkbox" checked={!!draft.instrumental} onChange={(e) => setDraft({ ...draft, instrumental: e.target.checked })} className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent" />
                    가사 없음
                  </label>
                </Field>
                <Field label="Explicit">
                  <label className="flex h-8 items-center gap-2 text-xs">
                    <input type="checkbox" checked={!!draft.explicit_content} onChange={(e) => setDraft({ ...draft, explicit_content: e.target.checked })} className="h-4 w-4 rounded border-line/30 bg-bg-card accent-accent" />
                    성인 컨텐츠
                  </label>
                </Field>
              </Section>

              {/* 보컬/감정 */}
              <Section label="보컬 / 감정">
                <Field label="보컬 타입">
                  <input value={draft.vocal_type ?? ''} onChange={(e) => setDraft({ ...draft, vocal_type: e.target.value })} placeholder="male / female / mixed" className="input h-8 text-xs" />
                </Field>
                <Field label="보컬 비중 (1-5)">
                  <input type="number" min={1} max={5} value={draft.vocal_presence ?? ''} onChange={(e) => setDraft({ ...draft, vocal_presence: e.target.value ? Number(e.target.value) : null })} className="input h-8 text-xs" />
                </Field>
                <Field label="감정 강도 (1-5)">
                  <input type="number" min={1} max={5} value={draft.emotional_intensity ?? ''} onChange={(e) => setDraft({ ...draft, emotional_intensity: e.target.value ? Number(e.target.value) : null })} className="input h-8 text-xs" />
                </Field>
                <Field label="밝기 (1-5)">
                  <input type="number" min={1} max={5} value={draft.brightness_level ?? ''} onChange={(e) => setDraft({ ...draft, brightness_level: e.target.value ? Number(e.target.value) : null })} className="input h-8 text-xs" />
                </Field>
              </Section>

              {/* 태그 (배열) */}
              <Section label="태그 (쉼표로 구분)">
                <TagField label="장르 태그" value={draft.genre_tags} onChange={(arr) => setDraft({ ...draft, genre_tags: arr })} colSpan={2} />
                <TagField label="무드 태그" value={draft.mood_tags} onChange={(arr) => setDraft({ ...draft, mood_tags: arr })} colSpan={2} />
                <TagField label="업종 태그" value={draft.business_tags} onChange={(arr) => setDraft({ ...draft, business_tags: arr })} colSpan={2} />
                <TagField label="추천 시간대" value={draft.recommended_dayparts} onChange={(arr) => setDraft({ ...draft, recommended_dayparts: arr })} colSpan={2} />
                <TagField label="시간 슬롯" value={draft.time_slots} onChange={(arr) => setDraft({ ...draft, time_slots: arr })} colSpan={2} />
                <TagField label="상황 태그" value={draft.situation_tags} onChange={(arr) => setDraft({ ...draft, situation_tags: arr })} colSpan={2} />
                <TagField label="시즌 태그" value={draft.season_tags} onChange={(arr) => setDraft({ ...draft, season_tags: arr })} colSpan={2} />
              </Section>

              {/* 가사 */}
              <Section label="가사" cols={1}>
                <label className="col-span-full block space-y-1">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-ink-dim">
                    가사 ({draft.lyrics?.length ?? 0}자) {detail.lyric_type && `· ${detail.lyric_type}`}
                  </span>
                  <textarea
                    value={draft.lyrics ?? ''} onChange={(e) => setDraft({ ...draft, lyrics: e.target.value })}
                    className="input min-h-[100px] resize-y text-xs"
                    placeholder="가사 입력"
                  />
                </label>
              </Section>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={() => setEditing(false)} className="btn-ghost h-8 text-xs">
                  <X size={11} /> 취소
                </button>
                <button onClick={save} disabled={saving} className="btn-primary h-8 text-xs">
                  <Save size={11} /> {saving ? '저장 중…' : '저장'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Section({ label, children, cols = 4 }: { label: string; children: React.ReactNode; cols?: 1 | 2 | 4 }) {
  const gridClass = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4';
  return (
    <div className="rounded-lg bg-bg-card p-2.5 ring-1 ring-line/10">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-dim">{label}</p>
      <div className={`grid ${gridClass} gap-2`}>{children}</div>
    </div>
  );
}

/** 행 안의 컴팩트 비교 배지 — 현재값 / AI 값을 나란히. */
function ComparePair({
  label, current, ai, confidence,
}: {
  label: string;
  current: number | string | null;
  ai: number | string | null;
  confidence?: number | null;
}) {
  const has = current != null || ai != null;
  if (!has) return null;
  const same = current != null && ai != null && String(current) === String(ai);
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-bg-card px-1 ring-1 ring-line/5">
      <span className="text-[9px] font-bold text-ink-dim">{label}</span>
      <span className="font-semibold text-ink">{current ?? '—'}</span>
      <span className="text-ink-dim">/</span>
      <span className={ai == null ? 'text-ink-dim' : (same ? 'text-emerald-300' : 'text-accent')}>
        AI {ai ?? '—'}
      </span>
      {confidence != null && ai != null && (
        <span className="text-[8px] text-ink-dim">·{Number(confidence).toFixed(2)}</span>
      )}
    </span>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'info' | 'good' | 'warn' }) {
  const cls =
    tone === 'good' ? 'bg-emerald-500/25 text-emerald-300 ring-emerald-500/50' :
    tone === 'warn' ? 'bg-amber-500/25 text-amber-300 ring-amber-500/50' :
    tone === 'info' ? 'bg-accent/15 text-accent ring-accent/20' :
    'bg-bg-soft text-ink-mute ring-line/10';
  return <span className={`rounded-full px-2 py-0.5 ring-1 ${cls}`}>{children}</span>;
}

function Compare({
  label, current, predicted, confidence, onApply,
}: {
  label: string;
  current: number | string | null | undefined;
  predicted: number | string | null | undefined;
  confidence?: number | null;
  onApply: () => void;
}) {
  const same = predicted != null && current != null && String(predicted) === String(current);
  const hasPrediction = predicted != null;
  return (
    <div className="rounded-md bg-bg-soft p-2 ring-1 ring-line/5">
      <p className="text-[9px] font-bold uppercase tracking-wider text-ink-dim">
        {label}
        {confidence != null && (
          <span className="ml-1 rounded bg-accent/15 px-1 text-[8px] text-accent">{Number(confidence).toFixed(2)}</span>
        )}
      </p>
      <div className="mt-1 flex items-center gap-1.5 text-xs">
        <span className="text-ink-mute">현재 <span className="font-semibold text-ink">{current ?? '—'}</span></span>
        <span className="text-ink-dim">→</span>
        <span className={`font-semibold ${hasPrediction ? (same ? 'text-emerald-300' : 'text-accent') : 'text-ink-dim'}`}>
          AI <span>{predicted ?? '—'}</span>
        </span>
        {hasPrediction && !same && (
          <button onClick={onApply} className="ml-auto rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold text-accent hover:bg-accent/25">
            적용
          </button>
        )}
      </div>
    </div>
  );
}

function TagField({
  label, value, onChange, colSpan = 1,
}: {
  label: string;
  value: string[] | null | undefined;
  onChange: (arr: string[] | null) => void;
  colSpan?: 1 | 2;
}) {
  const [text, setText] = useState((value ?? []).join(', '));
  // 값 외부 갱신 동기화
  useEffect(() => { setText((value ?? []).join(', ')); }, [value]);
  return (
    <label className={`block space-y-1 ${colSpan === 2 ? 'col-span-2' : ''}`}>
      <span className="text-[9px] font-bold uppercase tracking-wider text-ink-dim">{label}</span>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const arr = text.split(',').map((s) => s.trim()).filter(Boolean);
          onChange(arr.length === 0 ? null : arr);
        }}
        className="input h-8 text-xs" placeholder="태그1, 태그2"
      />
    </label>
  );
}

function Field({ label, children, colSpan = 1 }: { label: string; children: React.ReactNode; colSpan?: 1 | 2 }) {
  return (
    <label className={`block space-y-1 ${colSpan === 2 ? 'col-span-2' : ''}`}>
      <span className="text-[9px] font-bold uppercase tracking-wider text-ink-dim">{label}</span>
      {children}
    </label>
  );
}

function SubTabBtn({
  children,
  active,
  onClick,
  icon,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
        active ? 'bg-accent text-black' : 'bg-bg-card text-ink-mute hover:text-ink'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function CreatePlaylistForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (f: {
    title: string;
    category: string;
    description: string;
    is_business_only: boolean;
    business_category: string | null;
    time_slot: string | null;
    created_by_user_id: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('카페 음악');
  const [description, setDescription] = useState('');
  const [businessOnly, setBusinessOnly] = useState(false);
  const [businessCategory, setBusinessCategory] = useState('');
  const [timeSlot, setTimeSlot] = useState('');
  const [curators, setCurators] = useState<CuratorListItem[]>([]);
  const [createdBy, setCreatedBy] = useState<string>('');
  const [busy, setBusy] = useState(false);

  // 큐레이터 목록 + 기본값 (로그인 사용자가 큐레이터 프로필 있으면 본인)
  useEffect(() => {
    let alive = true;
    void fetchAllCurators().then(async (list) => {
      if (!alive) return;
      setCurators(list);
      if (userId) {
        const mine = await fetchMyCuratorProfile(userId);
        if (alive && mine) {
          // 본인 user_id 가 목록에 있으면 자동 선택
          const me = list.find((c) => c.user_id === userId);
          if (me) setCreatedBy(userId);
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        await onSubmit({
          title,
          category,
          description,
          is_business_only: businessOnly,
          business_category: businessOnly ? businessCategory || null : null,
          time_slot: timeSlot || null,
          created_by_user_id: createdBy || null,
        });
        setBusy(false);
      }}
      className="space-y-3 rounded-2xl bg-bg-card p-4"
    >
      <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="플레이리스트 제목" className="input" />
      <input required value={category} onChange={(e) => setCategory(e.target.value)} placeholder="카테고리 (예: 카페 음악)" className="input" />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="설명 (선택)" className="input min-h-[80px]" />

      <label className="block space-y-1">
        <span className="block text-[11px] font-semibold uppercase tracking-wider text-ink-mute">큐레이터</span>
        <select
          value={createdBy}
          onChange={(e) => setCreatedBy(e.target.value)}
          className="input"
        >
          <option value="">— 큐레이터 없음 —</option>
          {curators.map((c) => (
            <option key={c.user_id} value={c.user_id}>
              {c.display_name} (@{c.handle}){c.is_verified ? ' ✓' : ''}
            </option>
          ))}
        </select>
        {curators.length === 0 && (
          <span className="block text-[11px] text-ink-dim">
            아직 큐레이터 프로필이 없어요. 프로필 페이지에서 본인 큐레이터 프로필을 먼저 만들어주세요.
          </span>
        )}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={businessOnly} onChange={(e) => setBusinessOnly(e.target.checked)} />
        사업자 전용
      </label>
      {businessOnly && (
        <input value={businessCategory} onChange={(e) => setBusinessCategory(e.target.value)} placeholder="업종 (예: 카페, 와인바)" className="input" />
      )}
      <select value={timeSlot} onChange={(e) => setTimeSlot(e.target.value)} className="input">
        <option value="">시간대 (선택 없음)</option>
        <option value="morning">오전</option>
        <option value="afternoon">오후</option>
        <option value="evening">저녁</option>
        {/* 'night' 옵션은 0215 마이그에서 evening 으로 흡수됨 — 매장 schedules 모델과 일치 */}
      </select>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1">
          {busy ? '생성 중…' : '만들기'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          취소
        </button>
      </div>
    </form>
  );
}
