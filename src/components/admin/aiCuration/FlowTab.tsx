import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  computeAllPlaylistFlows,
  computePlaylistFlow,
  playlistFlowSummary,
  getPlaylistFlow,
  type FlowSummaryRow,
  type FlowTransition,
} from '@/lib/aiCuration';
import { toast } from '@/store/toastStore';
import { FLOW_ISSUE_LABELS, flowColor } from './shared';

export default function FlowTab() {
  const [summary, setSummary] = useState<FlowSummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transitions, setTransitions] = useState<FlowTransition[] | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setSummary(await playlistFlowSummary()); }
    catch (e) { toast.error(`불러오기 실패: ${(e as Error).message}`); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function runAll() {
    setRunning(true);
    try { const r = await computeAllPlaylistFlows(); toast.success(`흐름 분석 완료 — ${r.playlists_scored}개 플레이리스트`); await load(); }
    catch (e) { toast.error(`분석 실패: ${(e as Error).message}`); }
    finally { setRunning(false); }
  }
  async function recomputeOne(id: string) {
    setBusyId(id);
    try { await computePlaylistFlow(id); toast.success('재분석 완료'); await load(); if (expanded === id) await openDetail(id, true); }
    catch (e) { toast.error(`실패: ${(e as Error).message}`); }
    finally { setBusyId(null); }
  }
  async function openDetail(id: string, force = false) {
    if (expanded === id && !force) { setExpanded(null); setTransitions(null); return; }
    setExpanded(id); setTransitions(null); setDetailLoading(true);
    try { const d = await getPlaylistFlow(id); setTransitions(d.transitions); }
    catch (e) { toast.error(`상세 실패: ${(e as Error).message}`); }
    finally { setDetailLoading(false); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => void runAll()} disabled={running}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-bold text-black disabled:opacity-50">{running ? '분석 중…' : '전체 흐름 분석'}</button>
        <button onClick={() => void load()} className="inline-flex items-center gap-1 rounded-lg bg-bg-card px-2.5 py-2 text-xs font-semibold hover:bg-bg-hover"><RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 새로고침</button>
      </div>
      <p className="text-[11px] text-ink-dim">곡 단위 적합도가 아닌 <b>곡↔곡 전환 흐름</b>을 평가합니다. BPM/에너지/밝기/보컬 급변, 무드 충돌, 에너지 급락, 과도한 유사(단조), 전환 피로를 계산해 playlist_flow_score(0–100)를 생성합니다. 순서/내용은 변경하지 않습니다.</p>

      {summary.length === 0 ? (
        <p className="rounded-xl bg-bg-card px-4 py-8 text-center text-sm text-ink-dim">{loading ? '불러오는 중…' : '아직 분석 결과가 없어요. "전체 흐름 분석"을 실행하세요.'}</p>
      ) : (
        <ul className="space-y-2">
          {summary.map((p) => (
            <li key={p.playlist_id} className="rounded-xl bg-bg-card p-3">
              <div className="flex items-center gap-2">
                <span className={`w-12 shrink-0 text-center text-xl font-extrabold ${flowColor(p.flow_score)}`}>{p.flow_score ?? '—'}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{p.title ?? '(제목없음)'}</p>
                  <p className="text-[10px] text-ink-dim">{p.n_tracks}곡 · 전환 {p.n_transitions} · 평균 {p.avg_transition ?? '—'} · 감정연속성 {p.emotional_continuity ?? '—'}</p>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {p.rough_transitions > 0 && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">거친 전환 {p.rough_transitions}</span>}
                    {p.repetitive_count > 0 && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-300">단조 {p.repetitive_count}</span>}
                    {p.drop_shock_count > 0 && <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-orange-600">급락 {p.drop_shock_count}</span>}
                    {p.mood_collision_count > 0 && <span className="rounded bg-purple-500/10 px-1.5 py-0.5 text-purple-600">무드충돌 {p.mood_collision_count}</span>}
                    {p.fatigue_index > 0 && <span className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">피로 -{p.fatigue_index}</span>}
                    {p.monotony_index > 0 && <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-amber-300">단조 -{p.monotony_index}</span>}
                  </div>
                </div>
                <span className="flex shrink-0 flex-col gap-1">
                  <button onClick={() => void openDetail(p.playlist_id)} className="rounded bg-bg-soft px-2 py-1 text-[10px] font-semibold text-ink-mute hover:bg-bg-hover">{expanded === p.playlist_id ? '접기' : '전환 상세'}</button>
                  <button disabled={busyId === p.playlist_id} onClick={() => void recomputeOne(p.playlist_id)} className="rounded bg-accent/15 px-2 py-1 text-[10px] font-semibold text-accent disabled:opacity-40">재분석</button>
                </span>
              </div>

              {expanded === p.playlist_id && (
                <div className="mt-3 rounded-lg bg-bg-soft p-2 text-[10px]">
                  {detailLoading || !transitions ? <p className="text-ink-dim">{detailLoading ? '불러오는 중…' : ''}</p> : transitions.length === 0 ? (
                    <p className="text-ink-dim">전환 없음 (곡 2개 미만).</p>
                  ) : (
                    <ul className="space-y-1">
                      {transitions.map((t) => (
                        <li key={t.position} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded px-2 py-1 ${t.issues.length > 0 ? 'bg-bg-card' : ''}`}>
                          <span className={`w-7 text-center font-bold ${flowColor(t.transition_score)}`}>{t.transition_score}</span>
                          <span className="min-w-0 flex-1 truncate text-ink-mute">{t.from_title ?? '?'} <span className="text-ink-dim">→</span> {t.to_title ?? '?'}</span>
                          <span className="text-ink-dim">ΔBPM {t.bpm_jump} · ΔE {t.energy_jump} · ΔB {t.brightness_jump}{t.energy_drop != null && t.energy_drop > 0.3 ? ` · 급락 ${t.energy_drop}` : ''}</span>
                          {t.issues.map((iss) => <span key={iss} className="rounded bg-rose-500/25 px-1.5 py-0.5 text-rose-300">{FLOW_ISSUE_LABELS[iss] ?? iss}</span>)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
