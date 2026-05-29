import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, RefreshCw, Play, Check, X, Wand2, ShieldAlert } from 'lucide-react';
import {
  listClapCurationPlaylists,
  listClapRecommendations,
  generateClapRecommendations,
  decideClapRecommendation,
  type ClapPlaylistRow,
  type ClapRecommendationRow,
} from '@/lib/clapCurationApi';
import { usePlayerStore } from '@/store/playerStore';
import { isPlayableUrl } from '@/lib/audio';
import AutoCover from '@/components/AutoCover';
import { toast } from '@/store/toastStore';
import type { TrackRow } from '@/types/db';

export default function ClapRecommendationPanel() {
  const [playlists, setPlaylists] = useState<ClapPlaylistRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [recommendations, setRecommendations] = useState<ClapRecommendationRow[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [loadingRecs, setLoadingRecs] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const setQueue = usePlayerStore((s) => s.setQueue);

  const reloadPlaylists = useCallback(async () => {
    setLoadingPlaylists(true);
    try {
      const rows = await listClapCurationPlaylists();
      setPlaylists(rows);
      if (rows.length > 0 && !selectedId) setSelectedId(rows[0].playlist_id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '플레이리스트 불러오기 실패');
    } finally {
      setLoadingPlaylists(false);
    }
  }, [selectedId]);

  const reloadRecs = useCallback(async () => {
    if (!selectedId) return;
    setLoadingRecs(true);
    try {
      const rows = await listClapRecommendations(selectedId, 20);
      setRecommendations(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '추천 불러오기 실패');
    } finally {
      setLoadingRecs(false);
    }
  }, [selectedId]);

  useEffect(() => { reloadPlaylists(); }, [reloadPlaylists]);
  useEffect(() => { reloadRecs(); }, [reloadRecs]);

  const selected = useMemo(
    () => playlists.find((p) => p.playlist_id === selectedId) ?? null,
    [playlists, selectedId],
  );

  async function handleGenerate() {
    if (!selectedId) return;
    setGenerating(true);
    try {
      const inserted = await generateClapRecommendations(selectedId, 10);
      toast.success(`${inserted}개 추천 후보 생성됨`);
      await Promise.all([reloadRecs(), reloadPlaylists()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '추천 생성 실패');
    } finally {
      setGenerating(false);
    }
  }

  async function handleDecide(rec: ClapRecommendationRow, approve: boolean) {
    setDecidingId(rec.id);
    try {
      await decideClapRecommendation(rec.id, approve);
      toast.success(approve ? `'${rec.title}' 플레이리스트에 추가됨` : `'${rec.title}' 반려됨`);
      setRecommendations((prev) => prev.filter((r) => r.id !== rec.id));
      reloadPlaylists();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '결정 실패');
    } finally {
      setDecidingId(null);
    }
  }

  function playFrom(idx: number) {
    const tracks: TrackRow[] = recommendations
      .filter((r) => isPlayableUrl(r.audio_url))
      .map((r) => ({
        id: r.track_id,
        title: r.title,
        artist: r.artist,
        genre: r.main_genre,
        mood: null,
        audio_url: r.audio_url,
        cover_url: r.cover_url,
        duration: r.duration,
        created_at: r.created_at,
      }));
    if (tracks.length === 0) {
      toast.info('재생 가능한 음원이 없어요.');
      return;
    }
    const start = isPlayableUrl(recommendations[idx]?.audio_url)
      ? tracks.findIndex((t) => t.id === recommendations[idx].track_id)
      : 0;
    setQueue(tracks, Math.max(0, start), null);
  }

  return (
    <section className="space-y-4">
      {/* 헤더 + 컨트롤 */}
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={14} className="text-accent" />
          <h3 className="text-sm font-bold tracking-tight">CLAP 추천 큐레이션</h3>
          <span className="ml-auto text-[10px] text-ink-dim">
            LAION-CLAP 512차원 임베딩 · 코사인 유사도 + Hard Block + 점수
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
          <label className="block">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-ink-dim">
              플레이리스트 선택
            </span>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              disabled={loadingPlaylists}
              className="input mt-1 text-xs"
            >
              {playlists.length === 0 && <option value="">— 임베딩된 플레이리스트 없음 —</option>}
              {playlists.map((p) => (
                <option key={p.playlist_id} value={p.playlist_id}>
                  {p.title}
                  {p.business_category ? ` · ${p.business_category}` : ''}
                  {' · '}{p.track_count}트랙
                  {p.centroid_track_count != null ? ` · centroid ${p.centroid_track_count}` : ' · centroid 없음'}
                  {p.pending_count > 0 ? ` · 대기 ${p.pending_count}` : ''}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={handleGenerate}
            disabled={generating || !selectedId || selected?.centroid_track_count == null}
            className="btn-primary mt-auto h-9"
            title={selected?.centroid_track_count == null ? '플레이리스트에 임베딩된 트랙이 없어 centroid 계산 불가' : ''}
          >
            <Wand2 size={14} />
            {generating ? '생성 중…' : '추천 생성 (10개)'}
          </button>

          <button onClick={reloadRecs} disabled={loadingRecs || !selectedId} className="btn-ghost mt-auto h-9">
            <RefreshCw size={14} className={loadingRecs ? 'animate-spin' : ''} />
            새로고침
          </button>
        </div>

        {selected && (
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
            <Stat label="등록 트랙" value={`${selected.track_count}`} />
            <Stat label="Centroid 트랙" value={selected.centroid_track_count != null ? `${selected.centroid_track_count}` : '—'} />
            <Stat
              label="Centroid 갱신"
              value={selected.centroid_updated_at ? new Date(selected.centroid_updated_at).toLocaleString() : '—'}
            />
          </div>
        )}
      </div>

      {/* 추천 리스트 */}
      <div className="rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="text-sm font-bold tracking-tight">
            추천 후보
            <span className="ml-2 text-xs text-ink-mute">
              {recommendations.length}개 대기 중
            </span>
          </h4>
          {recommendations.length === 0 && !loadingRecs && selectedId && (
            <span className="text-[11px] text-ink-dim">
              생성된 후보가 없습니다. "추천 생성" 버튼을 눌러주세요.
            </span>
          )}
        </div>

        {loadingRecs ? (
          <p className="py-8 text-center text-xs text-ink-mute">불러오는 중…</p>
        ) : recommendations.length === 0 ? (
          null
        ) : (
          <ul className="overflow-hidden rounded-xl bg-bg-soft ring-1 ring-line/10">
            {recommendations.map((r, i) => (
              <li key={r.id} className="border-b border-line/10 last:border-b-0">
                <div className="flex items-center gap-3 p-3">
                  <button
                    onClick={() => playFrom(i)}
                    className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10"
                    title="이 곡부터 재생"
                  >
                    <AutoCover
                      title={r.title}
                      category={r.main_genre ?? undefined}
                      imageUrl={r.cover_url}
                      size="sm"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition hover:opacity-100">
                      <Play size={14} fill="currentColor" className="text-white" />
                    </div>
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {r.title}
                      <span className="ml-2 text-[10px] text-ink-dim">{r.artist ?? '—'}</span>
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-ink-mute">
                      {r.main_genre && <Pill>{r.main_genre}</Pill>}
                      {r.sub_genre && <Pill>{r.sub_genre}</Pill>}
                      {r.energy_level && <Pill>에너지 {r.energy_level}</Pill>}
                      {r.audio_health_status && r.audio_health_status !== 'ok' && (
                        <Pill tone="warn">
                          <ShieldAlert size={9} className="inline" /> {r.audio_health_status}
                        </Pill>
                      )}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-2 text-[10px]">
                      <Score k="CLAP" v={r.clap_similarity.toFixed(2)} highlight />
                      <Score k="장르" v={`${r.genre_score}`} />
                      <Score k="에너지" v={`${r.energy_score}`} />
                      <Score k="품질" v={`${r.quality_score}`} />
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <div className="rounded-full bg-accent/15 px-2.5 py-0.5 text-sm font-bold text-accent">
                      {Number(r.total_score).toFixed(0)}
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDecide(r, false)}
                        disabled={decidingId === r.id}
                        className="rounded-lg bg-bg-card px-2 py-1 text-[11px] font-semibold text-ink-mute ring-1 ring-line/20 hover:bg-bg-hover hover:text-rose-400 disabled:opacity-50"
                        title="반려"
                      >
                        <X size={12} />
                      </button>
                      <button
                        onClick={() => handleDecide(r, true)}
                        disabled={decidingId === r.id}
                        className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50"
                        title="승인 — 플레이리스트에 추가"
                      >
                        <Check size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-bg-soft px-3 py-2 ring-1 ring-line/10">
      <div className="text-[9px] font-bold uppercase tracking-wider text-ink-dim">{label}</div>
      <div className="mt-0.5 truncate text-xs font-semibold">{value}</div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: 'warn' }) {
  return (
    <span
      className={
        tone === 'warn'
          ? 'rounded bg-amber-500/15 px-1.5 py-0.5 font-semibold text-amber-400'
          : 'rounded bg-bg-card px-1.5 py-0.5'
      }
    >
      {children}
    </span>
  );
}

function Score({ k, v, highlight }: { k: string; v: string; highlight?: boolean }) {
  return (
    <span
      className={
        highlight
          ? 'rounded bg-accent/15 px-1.5 py-0.5 font-bold text-accent'
          : 'rounded bg-bg-card px-1.5 py-0.5 text-ink-mute'
      }
    >
      {k} {v}
    </span>
  );
}
