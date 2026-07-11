/**
 * AiAdaptiveLearningDashboard — AI-MUSIC-3 적응형 학습 & 연속 학습 루프 (Preview). Rule 기반(LLM/RL 모델
 * 아님)으로 실제 재생/반응 데이터를 학습해 Playlist 점수·트랙 평판·드리프트를 계속 개선 *제안* 한다.
 * Recommendation Only — 기존 Player/Playback/Queue/Playlist/Ranking/Settlement/Streaming/Governance 는
 * READ-ONLY, 운영자 승인 전까지 실제 반영 없음. master flag + 세부 flag 기본 OFF(opt-in).
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Brain, Activity, GitBranch, Compass, Award, CalendarClock, ScrollText, Save, TrendingUp } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminSearch, type AdminToneName,
} from '@/components/admin/ui';
import { getAiStoreList, type AiWindow, type AiStoreListItem } from '@/lib/api/aiMusicApi';
import {
  runStoreLearningLoop, getTrackReputations, getPlaylistEvolution, getDriftHistory, getAdaptiveHistory,
  saveLearningSnapshot, saveTrackReputation,
  type LearningLoopBundle, type DriftRow, type AdaptiveRow,
} from '@/lib/api/aiLearningApi';
import {
  getAiLearningConfig, explorationPlan, seasonalLearning, timeLearning, seasonForMonth, dayPartForHour, buildExplainV2,
  type TrackReputation, type PlaylistEvolution, type ExplainV2,
} from '@/lib/aiLearning';

type Tab = 'learning' | 'evolution' | 'drift' | 'discovery' | 'reputation' | 'seasonal' | 'explainability';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'learning', label: 'Learning', icon: <Activity size={14} /> },
  { key: 'evolution', label: 'Evolution', icon: <GitBranch size={14} /> },
  { key: 'drift', label: 'Drift', icon: <TrendingUp size={14} /> },
  { key: 'discovery', label: 'Discovery', icon: <Compass size={14} /> },
  { key: 'reputation', label: 'Reputation', icon: <Award size={14} /> },
  { key: 'seasonal', label: 'Seasonal', icon: <CalendarClock size={14} /> },
  { key: 'explainability', label: 'Explainability', icon: <ScrollText size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'EXCELLENT': case 'GOOD': case 'READY': case 'RISING': case 'LOW': return 'success';
    case 'RECOVERING': case 'MEDIUM': case 'FLAT': return 'warning';
    case 'WEAK': case 'FALLING': case 'HIGH': return 'danger';
    case 'INSUFFICIENT_DATA': case 'NO_DATA': case 'NOT_AVAILABLE': return 'info';
    default: return 'neutral';
  }
}
function pct(n: number | null | undefined): string { return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

export default function AiAdaptiveLearningDashboard() {
  const cfg = getAiLearningConfig();
  const [tab, setTab] = useState<Tab>('learning');
  const [win, setWin] = useState<AiWindow>('30d');
  const [stores, setStores] = useState<AiStoreListItem[]>([]);
  const [storeFilter, setStoreFilter] = useState('');
  const [selected, setSelected] = useState<AiStoreListItem | null>(null);
  const [priorScore, setPriorScore] = useState(82);
  const [month, setMonth] = useState(4);
  const [hour, setHour] = useState(8);

  const [loop, setLoop] = useState<LearningLoopBundle | null>(null);
  const [reputations, setReputations] = useState<TrackReputation[]>([]);
  const [evolution, setEvolution] = useState<PlaylistEvolution | null>(null);
  const [drift, setDrift] = useState<DriftRow[]>([]);
  const [adaptive, setAdaptive] = useState<AdaptiveRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    if (!cfg.masterEnabled) return;
    try { setStores(await getAiStoreList(win)); } catch { setError('매장 목록을 불러오지 못했습니다(마이그레이션 0464~0466 미적용 시 NO DATA).'); }
  }, [win, cfg.masterEnabled]);
  useEffect(() => { void loadStores(); }, [loadStores]);

  const loadStore = useCallback(async (s: AiStoreListItem) => {
    setSelected(s); setLoop(null); setReputations([]); setEvolution(null); setDrift([]); setAdaptive([]);
    setLoading(true); setError(null); setNotice(null);
    try {
      const [lp, reps, evo, dr, ad] = await Promise.allSettled([
        runStoreLearningLoop(s.storeId, priorScore, 14),
        getTrackReputations(s.storeType, 80),
        getPlaylistEvolution(s.storeId, null),
        getDriftHistory(s.storeId, 50),
        getAdaptiveHistory(s.storeId, 100),
      ]);
      if (lp.status === 'fulfilled') setLoop(lp.value);
      if (reps.status === 'fulfilled') setReputations(reps.value);
      if (evo.status === 'fulfilled') setEvolution(evo.value.evolution);
      if (dr.status === 'fulfilled') setDrift(dr.value);
      if (ad.status === 'fulfilled') setAdaptive(ad.value);
    } catch { setError('학습 데이터 조회 실패.'); }
    finally { setLoading(false); }
  }, [priorScore]);

  const saveLoop = useCallback(async () => {
    if (!selected || !loop?.loop || loop.loop.status !== 'READY') return; setNotice(null);
    try { await saveLearningSnapshot(selected.storeId, `store:${selected.storeId}`, loop.loop); setNotice('학습 스냅샷 저장됨(권고 전용, 반영 아님).'); const ad = await getAdaptiveHistory(selected.storeId, 100); setAdaptive(ad); }
    catch { setNotice('저장 실패(권한/마이그레이션 확인).'); }
  }, [selected, loop]);

  const saveRep = useCallback(async (rep: TrackReputation) => {
    if (!selected) return; setNotice(null);
    try { await saveTrackReputation(rep, selected.storeType, null); setNotice(`평판 스냅샷 저장: ${rep.title ?? rep.trackId.slice(0, 8)} (${rep.band}).`); }
    catch { setNotice('평판 저장 실패.'); }
  }, [selected]);

  if (!cfg.masterEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Brain size={18} /> AI Adaptive Learning <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-3 (Preview)</span></h2>
        <AdminAlert tone="info" title="AI Music 비활성 (기본 OFF · opt-in)">
          Rule 기반 적응형 학습은 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_LEARNING_ENGINE_ENABLED</code> 를 켜면 (읽기 전용) 학습 분석이 로드됩니다.
          AI는 Recommendation 만 제공하며 실제 Playlist/재생/노출/정산을 변경하지 않습니다.
        </AdminAlert>
      </div>
    );
  }

  const stFiltered = stores.filter((s) => !storeFilter.trim() || `${s.storeName ?? ''} ${s.storeType ?? ''} ${s.storeId}`.toLowerCase().includes(storeFilter.toLowerCase()));
  const explore = explorationPlan(reputations.length || 20);
  const seasonNow = seasonForMonth(month);
  const partNow = dayPartForHour(hour);
  const seasonL = seasonalLearning({});   // no seasonal source this phase → INSUFFICIENT_DATA (honest)
  const timeL = timeLearning({});
  const explainSamples: ExplainV2[] = reputations.slice(0, 12).map((r) => buildExplainV2({
    trackId: r.trackId, title: r.title, genreMatch: null, moodMatch: null, energyFit: null,
    learningScore: r.score == null ? null : r.score / 100, discoveryScore: null, industryFit: null, timeFit: null,
    confidence: r.score,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Brain size={18} /> AI Adaptive Learning <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-3</span></h2>
          <p className="text-xs text-text-tertiary">Rule 기반(LLM/RL 아님) · 읽기 전용 · Recommendation Only · 운영자 승인 전 실제 반영 없음</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(['7d', '30d'] as AiWindow[]).map((w) => <button key={w} onClick={() => setWin(w)} className={`px-3 py-1.5 text-xs font-medium ${win === w ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{w}</button>)}
          </div>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void loadStores()}>새로고침</AdminButton>
        </div>
      </div>
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <AdminCard title="매장 · 학습 파라미터">
        <AdminSearch value={storeFilter} onChange={setStoreFilter} placeholder="매장 이름/업종/UUID 검색" />
        {stFiltered.length === 0 ? <AdminEmpty title="NO DATA" description="재생 이벤트가 있는 매장 없음" /> : (
          <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {stFiltered.slice(0, 40).map((s) => (
              <button key={s.storeId} onClick={() => void loadStore(s)} className={`rounded-lg border px-3 py-1.5 text-xs ${selected?.storeId === s.storeId ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>
                {s.storeName ?? s.storeId.slice(0, 8)} <span className="text-text-tertiary">· {s.storeType ?? '?'} · {s.plays}p</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-text-secondary">Prior Score
            <input type="number" min={0} max={100} value={priorScore} onChange={(e) => setPriorScore(Math.max(0, Math.min(100, Number(e.target.value) || 70)))} className="w-16 rounded border border-border bg-bg-card px-2 py-1 text-text-primary" />
          </label>
          <label className="flex items-center gap-1.5 text-text-secondary">월
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} className="rounded border border-border bg-bg-card px-2 py-1 text-text-primary">{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}월</option>)}</select>
          </label>
          <label className="flex items-center gap-1.5 text-text-secondary">시
            <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="rounded border border-border bg-bg-card px-2 py-1 text-text-primary">{Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{i}시</option>)}</select>
          </label>
        </div>
      </AdminCard>

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {loading && <AdminSkeleton className="h-40" />}
      {!selected && !loading && <AdminEmpty title="매장을 선택하세요" description="위에서 매장을 선택하면 학습 분석이 로드됩니다" />}

      {selected && !loading && tab === 'learning' && (
        !loop?.loop ? <AdminEmpty title="NO DATA" />
        : loop.loop.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">{loop.loop.notes.join(' · ')}</AdminAlert>
        : (
          <AdminCard title="Continuous Learning (Reinforcement → Adaptive Score)" action={<AdminButton size="sm" variant="outline" leftIcon={<Save size={14} />} onClick={() => void saveLoop()}>스냅샷 저장</AdminButton>}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <AdminStatCard label="Yesterday" value={n1(loop.loop.adaptiveScore.yesterday)} tone="info" />
              <AdminStatCard label="Today" value={n1(loop.loop.adaptiveScore.today)} tone={tone(loop.loop.adaptiveScore.trend)} />
              <AdminStatCard label="Next" value={n1(loop.loop.adaptiveScore.next)} tone="info" />
              <AdminStatCard label="Trend" value={loop.loop.adaptiveScore.trend} tone={tone(loop.loop.adaptiveScore.trend)} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <AdminBadge tone="success">Reward {pct(loop.loop.reinforcement.reward)}</AdminBadge>
              <AdminBadge tone="danger">Penalty {pct(loop.loop.reinforcement.penalty)}</AdminBadge>
              <AdminBadge tone={tone(loop.loop.adaptiveScore.trend)}>Net {n1(loop.loop.reinforcement.net)}</AdminBadge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {Object.entries(loop.loop.reinforcement.breakdown).map(([k, v]) => <span key={k} className="rounded border border-border bg-bg-card px-2 py-1 text-text-tertiary">{k}: {(v * 100).toFixed(0)}%</span>)}
            </div>
            <p className="mt-2 text-[11px] text-text-tertiary">{loop.loop.notes.join(' · ')}</p>
          </AdminCard>
        )
      )}

      {selected && !loading && tab === 'evolution' && (
        <AdminCard title="Playlist Evolution (V1 → Vn)">
          {!evolution || evolution.status === 'INSUFFICIENT_DATA' ? <AdminEmpty title="버전 부족" description="AI Playlist Builder 제안을 버전으로 기록하면 진화 이력이 쌓입니다" />
            : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs"><AdminBadge tone={tone(evolution.overallTrend)}>{evolution.overallTrend}</AdminBadge><span className="text-text-secondary">{evolution.summary} · latest {n1(evolution.latestScore)}</span></div>
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-text-tertiary"><th className="py-1">Ver</th><th>Score</th><th>Δ</th><th>Tracks</th><th>Diversity</th><th>Label</th></tr></thead>
                  <tbody>
                    {evolution.versions.map((v) => (
                      <tr key={v.version} className="border-t border-border">
                        <td className="py-1 text-text-primary">V{v.version}</td><td>{n1(v.score)}</td>
                        <td className={v.delta == null ? '' : v.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}>{v.delta == null ? '—' : (v.delta >= 0 ? `+${v.delta}` : v.delta)}</td>
                        <td>{v.trackCount}</td><td>{pct(v.diversity)}</td><td className="text-text-tertiary">{v.label ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </AdminCard>
      )}

      {selected && !loading && tab === 'drift' && (
        <AdminCard title="Playlist Drift (원래 목적 대비 이탈)">
          {drift.length === 0 ? <AdminEmpty title="드리프트 기록 없음" description="원본 대비 현재 분포 비교 스냅샷이 저장되면 표시됩니다" />
            : (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">When</th><th>Drift</th><th>Band</th><th>Genre</th><th>Mood</th><th>Energy</th></tr></thead>
                <tbody>
                  {drift.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="py-1 text-text-tertiary">{d.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td className="text-text-primary">{pct(d.drift)}</td><td><AdminBadge tone={tone(d.band ?? '')}>{d.band ?? '—'}</AdminBadge></td>
                      <td>{pct(d.genreDrift)}</td><td>{pct(d.moodDrift)}</td><td>{pct(d.energyDrift)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </AdminCard>
      )}

      {selected && !loading && tab === 'discovery' && (
        <AdminCard title="Exploration vs Exploitation + Discovery Expansion">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <AdminStatCard label="Pool" value={n1(explore.poolSize)} tone="info" />
            <AdminStatCard label="Exploit (Best)" value={`${explore.exploitCount}`} tone="success" />
            <AdminStatCard label="Explore (Discovery)" value={`${explore.exploreCount}`} tone="warning" />
          </div>
          <p className="mt-2 text-xs text-text-secondary">{explore.note}</p>
          <div className="mt-3 flex flex-wrap items-center gap-1 text-xs">
            {['PILOT', 'SMALL_GROUP', 'MEDIUM', 'LARGE', 'GLOBAL_RECOMMENDATION'].map((s, i) => (
              <span key={s} className="flex items-center gap-1"><AdminBadge tone="neutral">{s}</AdminBadge>{i < 4 && <span className="text-text-tertiary">→</span>}</span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">확대는 완주율↑·스킵↓ 기준 충족 시 다음 단계 *권고* — 자동 배포 없음(운영자 승인 필요).</p>
        </AdminCard>
      )}

      {selected && !loading && tab === 'reputation' && (
        <AdminCard title="Track Reputation (Excellent / Good / Weak / Recovering)">
          {reputations.length === 0 ? <AdminEmpty title="NO DATA" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Track</th><th>Score</th><th>Band</th><th>Trend</th><th>Why</th><th></th></tr></thead>
                <tbody>
                  {reputations.filter((r) => r.status === 'READY').slice(0, 60).map((r) => (
                    <tr key={r.trackId} className="border-t border-border">
                      <td className="py-1 text-text-primary">{r.title ?? r.trackId.slice(0, 8)}</td><td>{n1(r.score)}</td>
                      <td><AdminBadge tone={tone(r.band)}>{r.band}</AdminBadge></td>
                      <td><AdminBadge tone={tone(r.trend)}>{r.trend}</AdminBadge></td>
                      <td className="text-text-tertiary">{r.reasons.join(', ')}</td>
                      <td><AdminButton size="sm" variant="outline" onClick={() => void saveRep(r)}>기록</AdminButton></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {selected && !loading && tab === 'seasonal' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <AdminCard title="Seasonal Learning">
            <div className="mb-2 flex items-center gap-2 text-xs"><AdminBadge tone="neutral">현재: {seasonNow}</AdminBadge><span className="text-text-tertiary">봄/여름/가을/겨울 규칙 매핑</span></div>
            {seasonL.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">계절별 집계 소스 미연동 — 학습 보류(정직)</AdminAlert> : <div className="text-xs text-text-secondary">{seasonL.note}</div>}
          </AdminCard>
          <AdminCard title="Time Learning">
            <div className="mb-2 flex items-center gap-2 text-xs"><AdminBadge tone="neutral">현재: {partNow}</AdminBadge><span className="text-text-tertiary">아침/점심/퇴근/심야 규칙 매핑</span></div>
            {timeL.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">시간대별 집계 소스 미연동 — 학습 보류</AdminAlert> : <div className="text-xs text-text-secondary">{timeL.note}</div>}
          </AdminCard>
        </div>
      )}

      {selected && !loading && tab === 'explainability' && (
        <AdminCard title="Explainability v2 (Genre / Mood / Energy / Learning / Discovery / Industry / Time / Confidence)">
          {explainSamples.length === 0 ? <AdminEmpty title="NO DATA" description="트랙 평판 데이터가 로드되면 8-factor 설명이 표시됩니다" /> : (
            <div className="space-y-2">
              {explainSamples.map((e) => (
                <div key={e.trackId} className="rounded-lg border border-border bg-bg-card p-2 text-xs">
                  <div className="font-medium text-text-primary">{e.title ?? e.trackId.slice(0, 8)} <span className="text-text-tertiary">— {e.summary}</span></div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {e.factors.map((f) => <span key={f.key} className={`rounded border border-border px-1.5 py-0.5 ${f.score == null ? 'text-text-tertiary' : 'text-text-secondary'}`}>{f.label}: {f.score == null ? 'NO_DATA' : f.score}</span>)}
                  </div>
                </div>
              ))}
              <p className="text-[11px] text-text-tertiary">완전한 8-factor(Genre/Mood/Energy/Industry/Time 포함)는 AI Playlist Builder 생성 시 곡마다 산출됩니다. 여기선 학습/신뢰도 신호를 표시하며 없는 신호는 정직하게 NO_DATA.</p>
            </div>
          )}
        </AdminCard>
      )}

      {adaptive.length > 0 && tab === 'learning' && (
        <AdminCard title="Adaptive Score History (저장된 스냅샷)">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-text-tertiary"><th className="py-1">When</th><th>Y</th><th>Today</th><th>Next</th><th>Net</th><th>Trend</th></tr></thead>
            <tbody>
              {adaptive.slice(0, 20).map((h) => (
                <tr key={h.id} className="border-t border-border">
                  <td className="py-1 text-text-tertiary">{h.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>{n1(h.yesterday)}</td><td className="text-text-primary">{n1(h.today)}</td><td>{n1(h.next)}</td><td>{n1(h.net)}</td>
                  <td><AdminBadge tone={tone(h.trend ?? '')}>{h.trend ?? '—'}</AdminBadge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminCard>
      )}

      <p className="text-[11px] text-text-tertiary">
        모든 결과는 규칙 기반 학습 추천입니다. AI는 Playlist 를 자동 반영·배포하거나 재생/큐/노출/정산을 변경하지 않으며, 기존 데이터는 읽기 전용입니다(운영자 승인 필요).
      </p>
    </div>
  );
}
