import { useEffect, useState } from 'react';
import { Wand2, RefreshCw, Sparkles, Play, X, ChevronDown, ChevronRight } from 'lucide-react';
import {
  adminGenerateAutoPlaylists,
  adminRunAutoPlacement,
  adminListAutoPlaylists,
  adminPlaylistPlacedTracks,
  adminRemovePlacedTrack,
  setAutoPlacementEnabled,
  getAutoPlacementEnabled,
  type AutoPlaylistRow,
  type PlacedTrack,
} from '@/lib/autoPlaylistApi';
import { toast } from '@/store/toastStore';
import Alert from '@/components/Alert';
import { friendlyError } from '@/lib/errorMessages';

export default function AutoPlaylistManager() {
  const [rows, setRows] = useState<AutoPlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [bizFilter, setBizFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [list, en] = await Promise.all([adminListAutoPlaylists(), getAutoPlacementEnabled()]);
      setRows(list);
      setEnabled(en);
    } catch (e) {
      toast.error(friendlyError(e, '조회 실패'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);

  async function generate() {
    setBusy(true);
    try {
      const r = await adminGenerateAutoPlaylists();
      toast.success(`자동 플레이리스트 ${r.created}개 생성 (이미 있으면 건너뜀)`);
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '생성 실패'));
    } finally { setBusy(false); }
  }

  async function runPlacement() {
    setBusy(true);
    try {
      const r = await adminRunAutoPlacement(null);
      toast.success(`자동 배치 완료 — ${r.tracks_processed ?? 0}곡 처리 · ${r.total_placed ?? 0}건 배치`);
      await load();
    } catch (e) {
      toast.error(friendlyError(e, '배치 실패'));
    } finally { setBusy(false); }
  }

  async function toggleEnabled() {
    try {
      const r = await setAutoPlacementEnabled(!enabled);
      setEnabled(r.enabled);
      toast.success(r.enabled ? '신규 발매 시 자동 배치 ON' : '자동 배치 OFF');
    } catch (e) {
      toast.error(friendlyError(e, '설정 실패'));
    }
  }

  const businesses = Array.from(new Set(rows.map((r) => r.business_category).filter(Boolean))) as string[];
  const filtered = bizFilter ? rows.filter((r) => r.business_category === bizFilter) : rows;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight">
            <Wand2 size={16} className="text-accent" /> 자동 플레이리스트 / 배치
          </h2>
          <p className="text-xs text-ink-mute">{rows.length}개 자동 생성 플레이리스트 · 업종/시간대/분위기 기반</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10 hover:bg-bg-hover">
            <RefreshCw size={12} /> 새로고침
          </button>
          <button onClick={() => void generate()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-accent/15 px-3 py-2 text-xs font-semibold text-accent ring-1 ring-accent/30 hover:bg-accent/25 disabled:opacity-50">
            <Sparkles size={12} /> 플레이리스트 자동 생성
          </button>
          <button onClick={() => void runPlacement()} disabled={busy} className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black hover:bg-accent/90 disabled:opacity-50">
            <Play size={12} /> 전체 자동 배치 실행
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold ring-1 ring-line/10">
          <input type="checkbox" checked={enabled} onChange={toggleEnabled} />
          신규 발매 시 자동 배치 {enabled ? 'ON' : 'OFF'}
        </label>
        {businesses.length > 0 && (
          <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="input w-auto text-xs">
            <option value="">전체 업종</option>
            {businesses.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
      </div>

      {!loading && rows.length === 0 && (
        <Alert tone="info" title="자동 플레이리스트가 없어요">
          "플레이리스트 자동 생성" 버튼을 눌러 업종/시간대/분위기 기반 플레이리스트를 만들어주세요.
        </Alert>
      )}

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        {loading ? (
          <div className="p-8 text-center text-xs text-ink-mute">불러오는 중…</div>
        ) : (
          <ul className="divide-y divide-line/10">
            {filtered.map((p) => {
              const open = expandedId === p.id;
              return (
                <li key={p.id} className="p-3">
                  <button onClick={() => setExpandedId(open ? null : p.id)} className="flex w-full items-center gap-2 text-left">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.title}</p>
                      <p className="truncate text-[11px] text-ink-mute">
                        {p.business_category ?? '—'} · {p.daypart ?? '—'} · {(p.mood_tags ?? []).join('/')} · {(p.genre_tags ?? []).join('/')}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-bg-soft px-2 py-0.5 text-[10px] font-semibold text-ink-mute">
                      {p.track_count}곡 (auto {p.auto_count})
                    </span>
                  </button>
                  {open && <PlacedList playlistId={p.id} onChanged={load} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function PlacedList({ playlistId, onChanged }: { playlistId: string; onChanged: () => void | Promise<void> }) {
  const [tracks, setTracks] = useState<PlacedTrack[] | null>(null);
  useEffect(() => {
    let alive = true;
    adminPlaylistPlacedTracks(playlistId).then((t) => { if (alive) setTracks(t); }).catch(() => setTracks([]));
    return () => { alive = false; };
  }, [playlistId]);

  async function remove(trackId: string) {
    try {
      await adminRemovePlacedTrack(playlistId, trackId);
      setTracks((prev) => (prev ? prev.filter((t) => t.track_id !== trackId) : prev));
      void onChanged();
    } catch (e) {
      toast.error(friendlyError(e, '제거 실패'));
    }
  }

  if (tracks === null) return <p className="px-6 py-2 text-[11px] text-ink-dim">불러오는 중…</p>;
  if (tracks.length === 0) return <p className="px-6 py-2 text-[11px] text-ink-dim">배치된 곡이 없어요. (released 음원이 생기면 자동 배치됩니다)</p>;

  return (
    <ul className="mt-2 space-y-1 rounded-lg bg-bg-soft/50 p-2">
      {tracks.map((t) => (
        <li key={t.track_id} className="flex items-center gap-2 text-[11px]">
          <span className="w-10 shrink-0 text-right font-mono text-ink-dim">{t.match_score ?? '—'}</span>
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
            t.placed_by === 'auto' ? 'bg-accent/15 text-accent' : t.placed_by === 'admin' ? 'bg-sky-500/15 text-sky-300' : 'bg-ink/10 text-ink-dim'
          }`}>{t.placed_by}</span>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-ink">{t.title}</span>
            <span className="text-ink-mute"> · {t.artist ?? '—'}</span>
            {t.placement_reason && <span className="text-ink-dim"> · {t.placement_reason}</span>}
          </span>
          <button onClick={() => void remove(t.track_id)} className="shrink-0 rounded p-1 text-ink-dim hover:bg-red-500/10 hover:text-red-400" title="제거">
            <X size={12} />
          </button>
        </li>
      ))}
    </ul>
  );
}
