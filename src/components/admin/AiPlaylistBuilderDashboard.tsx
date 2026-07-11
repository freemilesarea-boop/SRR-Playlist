/**
 * AiPlaylistBuilderDashboard — AI-MUSIC-2 지능형 Playlist 생성/최적화 (Preview). Rule 기반(LLM 아님)으로
 * AI-MUSIC-1 프로필/호환성 + 업종/시간/에너지커브/피로 규칙을 조합해 Playlist 를 *제안* 한다.
 * SIMULATION ONLY — 운영자 승인 전까지 실제 Playlist/Queue/Player 는 절대 변경하지 않는다. master flag
 * (ai_music_enabled) + builder flag 는 기본 OFF(opt-in). 신호가 없으면 INSUFFICIENT_DATA 로 표시한다.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, ListMusic, FlaskConical, GitCompare, Shuffle, Compass, Gauge, Sparkles, Save } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminSearch, type AdminToneName,
} from '@/components/admin/ui';
import { getAiStoreList, type AiWindow, type AiStoreListItem } from '@/lib/api/aiMusicApi';
import {
  generateWithSimulation, compareStorePlaylists, getGeneratedPlaylists, saveGeneratedPlaylist, saveComparison, saveSimulation,
  type AiPlaylistBundleInput, type AiGeneratedPlaylistRow,
} from '@/lib/api/aiPlaylistApi';
import { getAiPlaylistConfig, optimizeDiversity, measureDiversity, type GeneratedPlaylist, type CandidateComparison, type PlaylistTrackPick, type BuildStrategy, type DiversityMetrics } from '@/lib/aiPlaylist';
import type { PlaylistSimulation } from '@/lib/aiMusic';

type Tab = 'builder' | 'simulation' | 'compare' | 'optimize' | 'discovery' | 'confidence';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'builder', label: 'Builder', icon: <ListMusic size={14} /> },
  { key: 'simulation', label: 'Simulation', icon: <FlaskConical size={14} /> },
  { key: 'compare', label: 'Compare', icon: <GitCompare size={14} /> },
  { key: 'optimize', label: 'Optimize', icon: <Shuffle size={14} /> },
  { key: 'discovery', label: 'Discovery', icon: <Compass size={14} /> },
  { key: 'confidence', label: 'Confidence', icon: <Gauge size={14} /> },
];
const STRATEGIES: Array<{ key: BuildStrategy; label: string }> = [
  { key: 'BALANCED', label: 'Balanced' },
  { key: 'COMPATIBILITY_FIRST', label: 'Compatibility First' },
  { key: 'DISCOVERY_FORWARD', label: 'Discovery Forward' },
];
const HOURS = ['whole', '8', '12', '15', '18', '22'];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'EXCELLENT': case 'GOOD': case 'HIGH': case 'READY': return 'success';
    case 'ACCEPTABLE': case 'MEDIUM': return 'warning';
    case 'WEAK': case 'UNSUITABLE': case 'LOW': return 'danger';
    case 'INSUFFICIENT_DATA': case 'NO_DATA': return 'info';
    default: return 'neutral';
  }
}
function pct(n: number | null | undefined): string { return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

/** Small inline actual-vs-target energy curve bars (theme tokens only). */
function EnergyCurve({ actual, target }: { actual: number[]; target: number[] }) {
  if (actual.length === 0) return <span className="text-text-tertiary">—</span>;
  return (
    <div className="flex items-end gap-0.5" style={{ height: 48 }}>
      {actual.map((a, i) => {
        const h = a < 0 ? 0 : Math.round(a * 44) + 2;
        const t = target[i] != null ? Math.round(target[i] * 44) + 2 : 0;
        return (
          <div key={i} className="relative flex w-2 items-end" style={{ height: 46 }} title={`#${i + 1} energy ${a < 0 ? 'NO_DATA' : a.toFixed(2)} · target ${target[i]?.toFixed(2) ?? '—'}`}>
            <div className="w-full rounded-sm bg-accent/70" style={{ height: h }} />
            <div className="absolute left-0 w-full border-t border-text-tertiary" style={{ bottom: t }} />
          </div>
        );
      })}
    </div>
  );
}

export default function AiPlaylistBuilderDashboard() {
  const cfg = getAiPlaylistConfig();
  const [tab, setTab] = useState<Tab>('builder');
  const [win, setWin] = useState<AiWindow>('30d');
  const [stores, setStores] = useState<AiStoreListItem[]>([]);
  const [storeFilter, setStoreFilter] = useState('');
  const [selected, setSelected] = useState<AiStoreListItem | null>(null);
  const [hour, setHour] = useState<string>('8');
  const [targetLength, setTargetLength] = useState(20);
  const [strategy, setStrategy] = useState<BuildStrategy>('BALANCED');

  const [playlist, setPlaylist] = useState<GeneratedPlaylist | null>(null);
  const [simulation, setSimulation] = useState<PlaylistSimulation | null>(null);
  const [comparison, setComparison] = useState<CandidateComparison | null>(null);
  const [optimized, setOptimized] = useState<{ picks: PlaylistTrackPick[]; before: DiversityMetrics; after: DiversityMetrics } | null>(null);
  const [saved, setSaved] = useState<AiGeneratedPlaylistRow[]>([]);
  const [lastSavedId, setLastSavedId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    if (!cfg.masterEnabled) return;
    try { setStores(await getAiStoreList(win)); } catch { setError('매장 목록을 불러오지 못했습니다(마이그레이션 0464/0465 미적용 시 NO DATA).'); }
  }, [win, cfg.masterEnabled]);
  useEffect(() => { void loadStores(); }, [loadStores]);

  const input = useCallback((): AiPlaylistBundleInput | null => {
    if (!selected) return null;
    return { storeId: selected.storeId, storeType: selected.storeType, hour: hour === 'whole' ? null : Number(hour), targetLength };
  }, [selected, hour, targetLength]);

  const doBuild = useCallback(async () => {
    const inp = input(); if (!inp) return;
    setLoading(true); setError(null); setNotice(null); setPlaylist(null); setSimulation(null); setOptimized(null); setLastSavedId(null);
    try {
      const { playlist: pl, simulation: sim } = await generateWithSimulation(inp, strategy);
      setPlaylist(pl); setSimulation(sim);
      if (pl.status === 'INSUFFICIENT_DATA') setNotice(pl.notes.join(' · '));
    } catch { setError('Playlist 생성 실패(권한/마이그레이션 확인).'); }
    finally { setLoading(false); }
  }, [input, strategy]);

  const doCompare = useCallback(async () => {
    const inp = input(); if (!inp) return;
    setLoading(true); setError(null); setNotice(null); setComparison(null);
    try { setComparison(await compareStorePlaylists(inp)); } catch { setError('후보 비교 실패.'); }
    finally { setLoading(false); }
  }, [input]);

  const doOptimize = useCallback(() => {
    if (!playlist || playlist.picks.length === 0) return;
    const before = measureDiversity(playlist.picks);
    const { picks, metrics } = optimizeDiversity(playlist.picks);
    setOptimized({ picks, before, after: metrics });
    setNotice('다양성 최적화(로컬) — 제안 순서만 재배열. 실제 배포 없음.');
  }, [playlist]);

  const loadSaved = useCallback(async () => {
    if (!selected) return;
    try { setSaved(await getGeneratedPlaylists(selected.storeId, 50)); } catch { setSaved([]); }
  }, [selected]);
  useEffect(() => { if (tab === 'discovery') void loadSaved(); }, [tab, loadSaved]);

  const savePlaylist = useCallback(async () => {
    if (!playlist || playlist.status !== 'READY') return; setNotice(null);
    try { const id = await saveGeneratedPlaylist(playlist); setLastSavedId(id); setNotice('제안 저장됨(Simulation Only, 배포 아님).'); void loadSaved(); }
    catch { setNotice('저장 실패(권한/마이그레이션 확인).'); }
  }, [playlist, loadSaved]);

  const saveSim = useCallback(async () => {
    if (!selected || !simulation || simulation.status !== 'READY') return; setNotice(null);
    try {
      await saveSimulation({ storeId: selected.storeId, playlistId: lastSavedId, predictedSkip: simulation.predictedSkipRate, predictedCompletion: simulation.predictedCompletion, diversity: simulation.diversity, fatigueRisk: simulation.fatigueRisk, meanCompatibility: simulation.meanCompatibility, band: simulation.band, confidence: simulation.confidence, notes: simulation.notes });
      setNotice('시뮬레이션 스냅샷 저장됨(예측 전용).');
    } catch { setNotice('시뮬레이션 저장 실패.'); }
  }, [selected, simulation, lastSavedId]);

  const saveCmp = useCallback(async () => {
    if (!comparison) return; setNotice(null);
    try { await saveComparison(comparison); setNotice('후보 비교 저장됨(자동 배포 아님).'); }
    catch { setNotice('비교 저장 실패.'); }
  }, [comparison]);

  if (!cfg.masterEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Sparkles size={18} /> AI Playlist Builder <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-2 (Preview)</span></h2>
        <AdminAlert tone="info" title="AI Music 비활성 (기본 OFF · opt-in)">
          Rule 기반 Playlist Builder는 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_PLAYLIST_BUILDER_ENABLED</code> 를 켜면 (읽기 전용) 생성이 로드됩니다.
          AI는 제안/시뮬레이션만 제공하며 실제 Playlist 를 자동 생성·배포하지 않습니다.
        </AdminAlert>
      </div>
    );
  }

  const stFiltered = stores.filter((s) => !storeFilter.trim() || `${s.storeName ?? ''} ${s.storeType ?? ''} ${s.storeId}`.toLowerCase().includes(storeFilter.toLowerCase()));
  const builderOff = !cfg.builderEnabled;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Sparkles size={18} /> AI Playlist Builder <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-2</span></h2>
          <p className="text-xs text-text-tertiary">Rule 기반(LLM 아님) · 읽기 전용 · Simulation Only · 운영자 승인 전 실제 Playlist 변경 없음</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(['7d', '30d'] as AiWindow[]).map((w) => <button key={w} onClick={() => setWin(w)} className={`px-3 py-1.5 text-xs font-medium ${win === w ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{w}</button>)}
          </div>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void loadStores()}>새로고침</AdminButton>
        </div>
      </div>
      {builderOff && <AdminAlert tone="info" title="Builder flag off">마스터는 켜졌지만 <code>VITE_AI_PLAYLIST_BUILDER_ENABLED</code> 가 OFF 입니다 — 생성 버튼이 비활성화됩니다.</AdminAlert>}
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      {/* Store + params */}
      <AdminCard title="매장 · 생성 파라미터">
        <AdminSearch value={storeFilter} onChange={setStoreFilter} placeholder="매장 이름/업종/UUID 검색" />
        {stFiltered.length === 0 ? <AdminEmpty title="NO DATA" description="재생 이벤트가 있는 매장 없음" /> : (
          <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
            {stFiltered.slice(0, 40).map((s) => (
              <button key={s.storeId} onClick={() => setSelected(s)} className={`rounded-lg border px-3 py-1.5 text-xs ${selected?.storeId === s.storeId ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>
                {s.storeName ?? s.storeId.slice(0, 8)} <span className="text-text-tertiary">· {s.storeType ?? '?'} · {s.plays}p</span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5 text-text-secondary">시간대
            <select value={hour} onChange={(e) => setHour(e.target.value)} className="rounded border border-border bg-bg-card px-2 py-1 text-text-primary">
              {HOURS.map((h) => <option key={h} value={h}>{h === 'whole' ? '전일' : `${h}시`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-text-secondary">길이
            <input type="number" min={5} max={60} value={targetLength} onChange={(e) => setTargetLength(Math.max(5, Math.min(60, Number(e.target.value) || 20)))} className="w-16 rounded border border-border bg-bg-card px-2 py-1 text-text-primary" />
          </label>
          <label className="flex items-center gap-1.5 text-text-secondary">전략
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as BuildStrategy)} className="rounded border border-border bg-bg-card px-2 py-1 text-text-primary">
              {STRATEGIES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <AdminButton size="sm" variant="solid" leftIcon={<ListMusic size={14} />} disabled={!selected || builderOff} onClick={() => void doBuild()}>생성</AdminButton>
        </div>
      </AdminCard>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {loading && <AdminSkeleton className="h-40" />}

      {tab === 'builder' && !loading && (
        !playlist ? <AdminEmpty title="매장을 선택하고 생성하세요" description="Store → Time → Industry → Mood → Energy → Learning → Playlist" />
        : playlist.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">{playlist.notes.join(' · ')}</AdminAlert>
        : (
          <AdminCard title={`Generated Playlist — ${playlist.industryRule.storeType} · ${playlist.timeSlot?.label ?? '전일'} · ${playlist.strategy}`}
            action={<AdminButton size="sm" variant="outline" leftIcon={<Save size={14} />} onClick={() => void savePlaylist()}>제안 저장</AdminButton>}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <AdminStatCard label="Tracks" value={n1(playlist.trackCount)} tone="info" />
              <AdminStatCard label="Diversity" value={pct(playlist.diversity)} tone="info" />
              <AdminStatCard label="Fatigue Risk" value={pct(playlist.fatigueRisk)} tone={playlist.fatigueRisk != null && playlist.fatigueRisk >= 0.35 ? 'danger' : 'info'} />
              <AdminStatCard label="Curve Fit" value={pct(playlist.curveFit)} tone="info" />
            </div>
            <div className="mt-3">
              <div className="mb-1 text-xs text-text-tertiary">Energy Curve (막대=실제 · 선=목표 Low→High→Low)</div>
              <EnergyCurve actual={playlist.energyCurve} target={playlist.targetEnergyCurve} />
            </div>
            <div className="mt-3 max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">#</th><th>Track</th><th>Genre</th><th>Mood</th><th>Energy</th><th>Compat</th><th>Pick</th><th>Why</th></tr></thead>
                <tbody>
                  {playlist.picks.map((p) => (
                    <tr key={p.trackId} className="border-t border-border">
                      <td className="py-1 text-text-tertiary">{p.position}</td>
                      <td className="text-text-primary">{p.title ?? p.trackId.slice(0, 8)}</td>
                      <td>{p.genre ?? '—'}</td><td>{p.mood ?? '—'}</td><td>{p.energy == null ? '—' : p.energy.toFixed(2)}</td>
                      <td>{n1(p.compatScore)}</td><td>{p.pickScore}</td>
                      <td className="text-text-tertiary">{p.explain.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-text-tertiary">{playlist.notes.join(' · ')}</p>
          </AdminCard>
        )
      )}

      {tab === 'simulation' && !loading && (
        !cfg.simulationEnabled ? <AdminAlert tone="info" title="비활성">simulation flag off (<code>VITE_AI_PLAYLIST_SIMULATION_ENABLED</code>)</AdminAlert>
        : !simulation ? <AdminEmpty title="먼저 생성하세요" description="Builder 탭에서 Playlist 를 생성하면 시뮬레이션이 표시됩니다" />
        : simulation.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">{simulation.notes.join(' · ')}</AdminAlert>
        : (
          <AdminCard title="Playlist Simulation (Simulation Only)" action={<AdminButton size="sm" variant="outline" leftIcon={<Save size={14} />} onClick={() => void saveSim()}>기록</AdminButton>}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <AdminStatCard label="Pred. Skip" value={pct(simulation.predictedSkipRate)} tone="info" />
              <AdminStatCard label="Pred. Complete" value={pct(simulation.predictedCompletion)} tone="info" />
              <AdminStatCard label="Diversity" value={pct(simulation.diversity)} tone="info" />
              <AdminStatCard label="Fatigue" value={pct(simulation.fatigueRisk)} tone="info" />
              <AdminStatCard label="Mean Compat" value={n1(simulation.meanCompatibility)} tone={tone(simulation.band)} />
            </div>
            <p className="mt-2 text-[11px] text-text-tertiary">{simulation.notes.join(' · ')}</p>
          </AdminCard>
        )
      )}

      {tab === 'compare' && !loading && (
        !cfg.compareEnabled ? <AdminAlert tone="info" title="비활성">compare flag off (<code>VITE_AI_PLAYLIST_COMPARE_ENABLED</code>)</AdminAlert>
        : (
          <AdminCard title="Candidate Comparison (A / B / C → Best)"
            action={<div className="flex gap-2"><AdminButton size="sm" variant="solid" leftIcon={<GitCompare size={14} />} disabled={!selected} onClick={() => void doCompare()}>비교 생성</AdminButton>{comparison && <AdminButton size="sm" variant="outline" leftIcon={<Save size={14} />} onClick={() => void saveCmp()}>저장</AdminButton>}</div>}>
            {!comparison ? <AdminEmpty title="비교 없음" description="비교 생성을 눌러 A/B/C 후보를 만드세요" />
              : (
                <div className="space-y-2">
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-text-tertiary"><th className="py-1">후보</th><th>전략</th><th>Score</th><th>Compat</th><th>Diversity</th><th>Fatigue</th><th>CurveFit</th><th>Conf</th><th></th></tr></thead>
                    <tbody>
                      {comparison.candidates.map((c) => (
                        <tr key={c.label} className={`border-t border-border ${c.isBest ? 'bg-accent/10' : ''}`}>
                          <td className="py-1 font-medium text-text-primary">{c.label}{c.isBest && <AdminBadge tone="success">Best</AdminBadge>}</td>
                          <td className="text-text-tertiary">{c.strategy}</td><td className="text-text-primary">{n1(c.score)}</td>
                          <td>{n1(c.metrics.compatibility)}</td><td>{pct(c.metrics.diversity)}</td><td>{pct(c.metrics.fatigueRisk)}</td>
                          <td>{pct(c.metrics.curveFit)}</td><td>{n1(c.metrics.confidence)}</td>
                          <td>{c.playlist.status === 'INSUFFICIENT_DATA' ? <AdminBadge tone="info">INSUF</AdminBadge> : <AdminBadge tone="neutral">{c.playlist.trackCount}곡</AdminBadge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="text-[11px] text-text-tertiary">{comparison.notes.join(' · ')}</p>
                </div>
              )}
          </AdminCard>
        )
      )}

      {tab === 'optimize' && !loading && (
        <AdminCard title="Diversity Optimizer (제안 재배열 — 배포 없음)" action={<AdminButton size="sm" variant="outline" leftIcon={<Shuffle size={14} />} disabled={!playlist || playlist.status !== 'READY'} onClick={doOptimize}>최적화</AdminButton>}>
          {!playlist || playlist.status !== 'READY' ? <AdminEmpty title="먼저 생성하세요" description="Builder 탭에서 Playlist 를 생성한 뒤 최적화하세요" />
            : !optimized ? <AdminAlert tone="info" title="최적화 대기">최적화를 누르면 Artist/Genre/Mood/BPM/Energy 다양성을 재배열합니다.</AdminAlert>
            : (
              <div className="grid gap-3 md:grid-cols-2">
                {([['Before', optimized.before], ['After', optimized.after]] as const).map(([label, m]) => (
                  <div key={label} className="rounded-lg border border-border bg-bg-card p-3">
                    <div className="mb-2 text-xs font-semibold text-text-primary">{label}</div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="text-text-tertiary">Artist(≈Genre): <span className="text-text-primary">{pct(m.artistDiversity)}</span></div>
                      <div className="text-text-tertiary">Genre: <span className="text-text-primary">{pct(m.genreDiversity)}</span></div>
                      <div className="text-text-tertiary">Mood: <span className="text-text-primary">{pct(m.moodDiversity)}</span></div>
                      <div className="text-text-tertiary">BPM: <span className="text-text-primary">{pct(m.bpmDiversity)}</span></div>
                      <div className="text-text-tertiary">Energy Spread: <span className="text-text-primary">{pct(m.energySpread)}</span></div>
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-text-tertiary md:col-span-2">Artist 다양성은 genre proxy(실제 artist id 미보유 — deferred). 재배열은 제안일 뿐 실제 Playlist 변경 아님.</p>
              </div>
            )}
        </AdminCard>
      )}

      {tab === 'discovery' && !loading && (
        <AdminCard title="Saved Proposals (제안 히스토리 · 자동 배포 없음)" action={<AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} disabled={!selected} onClick={() => void loadSaved()}>새로고침</AdminButton>}>
          {!selected ? <AdminEmpty title="매장을 선택하세요" />
            : saved.length === 0 ? <AdminEmpty title="저장된 제안 없음" description="Builder 탭에서 생성 후 저장하면 여기에 표시됩니다" />
            : (
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-text-tertiary"><th className="py-1">전략</th><th>Slot</th><th>Tracks</th><th>Diversity</th><th>Fatigue</th><th>Conf</th><th>When</th></tr></thead>
                  <tbody>
                    {saved.map((g) => (
                      <tr key={g.id} className="border-t border-border">
                        <td className="py-1 text-text-primary">{g.strategy}</td><td>{g.timeSlot ?? '전일'}</td><td>{g.trackCount}</td>
                        <td>{pct(g.diversity)}</td><td>{pct(g.fatigueRisk)}</td>
                        <td><AdminBadge tone={tone(g.confidence ?? '')}>{g.confidence ?? '—'}</AdminBadge></td>
                        <td className="text-text-tertiary">{g.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </AdminCard>
      )}

      {tab === 'confidence' && !loading && (
        !playlist || playlist.status !== 'READY' ? <AdminEmpty title="먼저 생성하세요" description="Builder 탭에서 Playlist 를 생성하면 신뢰도가 표시됩니다" />
        : (
          <AdminCard title="Playlist Confidence (HIGH / MEDIUM / LOW)">
            <div className="mb-2 flex items-center gap-2"><AdminBadge tone={tone(playlist.confidence.level)}>{playlist.confidence.level}</AdminBadge><span className="text-sm font-semibold text-text-primary">{playlist.confidence.value == null ? 'INSUF' : playlist.confidence.value}</span></div>
            <div className="flex flex-wrap gap-2">
              {playlist.confidence.parts.map((p) => <div key={p.key} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs"><div className="text-text-tertiary">{p.label}</div><div className="font-semibold text-text-primary">{p.score}</div></div>)}
            </div>
            <p className="mt-2 text-[11px] text-text-tertiary">Pool / Store Readiness / Compatibility / Learning Coverage / Energy Curve Fit 규칙 블렌드(≤92, 확실성 아님).</p>
          </AdminCard>
        )
      )}

      <p className="text-[11px] text-text-tertiary">
        모든 결과는 규칙 기반 제안/시뮬레이션입니다. AI는 Playlist 를 자동 생성·배포하거나 Queue/Player 를 변경하지 않으며, 기존 음악/재생/정산/노출 데이터는 변경하지 않습니다(운영자 승인 필요).
      </p>
    </div>
  );
}
