import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Wand2, ListMusic } from 'lucide-react';
import {
  recomputePlaylistFitScores,
  getAiRecommendedTracksForPlaylist,
  generateAiSuggestions,
  listAiSuggestions,
  decideAiSuggestion,
  listStoreProfiles,
  setPlaylistStoreKey,
  type FitScoreRow,
  type AiSuggestion,
  type StoreProfileOption,
} from '@/lib/aiCuration';
import { fetchPlaylists } from '@/lib/api';
import type { PlaylistRow } from '@/types/db';
import { toast } from '@/store/toastStore';

export default function FitTab() {
  const [playlists, setPlaylists] = useState<PlaylistRow[]>([]);
  const [pid, setPid] = useState<string>('');
  const [rows, setRows] = useState<FitScoreRow[]>([]);
  const [suggestions, setSuggestions] = useState<AiSuggestion[]>([]);
  const [storeProfiles, setStoreProfiles] = useState<StoreProfileOption[]>([]);
  const [storeKey, setStoreKey] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchPlaylists().then((p) => { setPlaylists(p); if (p[0]) setPid(p[0].id); }).catch((e) => {
    console.warn('[FitTab] fetchPlaylists failed:', e);
  }); }, []);
  useEffect(() => { listStoreProfiles().then(setStoreProfiles).catch((e) => {
    console.warn('[FitTab] listStoreProfiles failed:', e);
  }); }, []);
  useEffect(() => {
    const pl = playlists.find((p) => p.id === pid) as (PlaylistRow & { ai_store_key?: string | null }) | undefined;
    setStoreKey(pl?.ai_store_key ?? '');
  }, [pid, playlists]);

  async function saveStoreKey(key: string) {
    setStoreKey(key);
    if (!pid) return;
    try {
      await setPlaylistStoreKey(pid, key || null);
      toast.success(key ? `매장 유형을 ${key} 로 지정했어요.` : '매장 유형 지정 해제');
      await recompute();
    } catch (e) { toast.error(`지정 실패: ${(e as Error).message}`); }
  }

  const load = useCallback(async () => {
    if (!pid) return;
    setLoading(true);
    try {
      const [recs, sugs] = await Promise.all([getAiRecommendedTracksForPlaylist(pid, 100), listAiSuggestions(pid, 'pending')]);
      setRows(recs); setSuggestions(sugs);
    } catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, [pid]);
  useEffect(() => { void load(); }, [load]);

  async function recompute() {
    if (!pid) return;
    setBusy(true);
    try {
      const res = await recomputePlaylistFitScores(pid);
      toast.success(`적합도 재계산 완료 — ${res.tracks_scored}곡`);
      await load();
    } catch (e) { toast.error(`재계산 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function genSuggestions() {
    if (!pid) return;
    setBusy(true);
    try {
      const res = await generateAiSuggestions(pid);
      toast.success(`추천 제안 ${res.suggestions}건 생성 (승인 전까지 공개 안 됨)`);
      await load();
    } catch (e) { toast.error(`제안 생성 실패: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }
  async function decide(id: string, approve: boolean) {
    try {
      await decideAiSuggestion(id, approve);
      toast.success(approve ? '승인 — 플레이리스트에 추가했어요.' : '제외했어요.');
      await load();
    } catch (e) { toast.error(`처리 실패: ${(e as Error).message}`); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select value={pid} onChange={(e) => setPid(e.target.value)}
          className="rounded-lg bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
          {playlists.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
        <select value={storeKey} onChange={(e) => void saveStoreKey(e.target.value)} title="매장 유형 (fit 계산 기준)"
          className="rounded-lg bg-bg-card px-3 py-2 text-xs ring-1 ring-line/10">
          <option value="">매장 유형: 자동</option>
          {storeProfiles.map((s) => <option key={s.store_key} value={s.store_key}>{s.store_label}</option>)}
        </select>
        <button onClick={() => void recompute()} disabled={busy || !pid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">
          <ListMusic size={13} /> 적합도 재계산
        </button>
        <button onClick={() => void genSuggestions()} disabled={busy || !pid}
          className="inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-xs font-semibold hover:bg-bg-hover disabled:opacity-50">
          <Wand2 size={13} /> 추천 제안 생성
        </button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>
      <p className="text-[11px] text-ink-dim">fit_score ≥ 70 추천 후보만 표시됩니다. 자동 공개되지 않으며, "추천 제안 생성" 후 아래에서 승인해야 플레이리스트에 추가됩니다.</p>

      {suggestions.length > 0 && (
        <div className="rounded-xl bg-accent/5 p-3 ring-1 ring-accent/15">
          <h4 className="mb-2 text-xs font-bold text-accent">승인 대기 제안 ({suggestions.length}) — 승인 전까지 비공개</h4>
          <ul className="space-y-1">
            {suggestions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate">{s.title ?? '(제목없음)'} · <span className="text-ink-dim">{s.artist ?? ''}</span></span>
                <span className="shrink-0 font-bold tabular-nums text-emerald-600">{s.fit_score}</span>
                <span className="flex shrink-0 gap-1">
                  <button onClick={() => void decide(s.id, true)} className="rounded bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-600 hover:bg-emerald-500/25">승인</button>
                  <button onClick={() => void decide(s.id, false)} className="rounded bg-ink/5 px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-ink/10">제외</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '추천 후보가 없어요. (재계산을 눌러보세요)'}</p>
      ) : (
        <ul className="divide-y divide-line/10 rounded-xl bg-bg-card">
          {rows.map((r) => {
            const aiBoost = r.ai_boost_total ?? 0;
            const manual = r.manual_score;
            return (
              <li key={r.track_id} className="flex flex-col gap-1 px-3 py-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate">
                    {r.title ?? '(제목없음)'} · <span className="text-ink-dim">{r.artist ?? ''}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-dim">{r.reason}</span>
                  <span className="shrink-0 font-bold tabular-nums text-emerald-600">{r.fit_score}</span>
                </div>
                {(manual != null || aiBoost > 0) && (
                  <div className="flex flex-wrap items-center gap-1.5 pl-1 text-[10px] text-ink-dim">
                    {manual != null && (
                      <span className="rounded bg-bg-soft px-1.5 py-0.5 font-mono">manual {manual}</span>
                    )}
                    {aiBoost > 0 && (
                      <span className="rounded bg-violet-500/15 px-1.5 py-0.5 font-mono text-violet-300">
                        +AI {aiBoost} (g{r.ai_genre_score ?? 0}/m{r.ai_mood_score ?? 0}/s{r.ai_store_score ?? 0})
                      </span>
                    )}
                    {r.normalized_store_slug && (
                      <span className="rounded bg-bg-soft px-1.5 py-0.5 font-mono">{r.normalized_store_slug}</span>
                    )}
                    {r.reason_codes && r.reason_codes.length > 0 && (
                      <span className="font-mono">{r.reason_codes.slice(0, 3).join(' / ')}</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
