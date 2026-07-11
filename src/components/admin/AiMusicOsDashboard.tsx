/**
 * AiMusicOsDashboard — AI-MUSIC-1 지능형 음악 OS 기반 (Preview). Rule 기반(LLM 아님)으로 매장/트랙 프로필,
 * 호환성, 추천, 디스커버리, 러닝, 시뮬레이션, 신뢰도를 요약한다. 기존 Player/Playback/Playlist/정산/노출은
 * READ-ONLY — AI는 추천/시뮬레이션만 제공하며 Playlist 를 자동 생성·배포하거나 정책을 실행하지 않는다.
 * master flag(ai_music_enabled)는 기본 OFF(opt-in). 신호가 없으면 NO_DATA/INSUFFICIENT_DATA 로 표시한다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Brain, Store, Music2, GitCompare, Compass, Lightbulb, GraduationCap, FlaskConical, Gauge } from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminSkeleton, AdminAlert, AdminSearch, type AdminToneName,
} from '@/components/admin/ui';
import {
  getAiStoreList, getAiStoreIntelligence, getAiDiscovery, saveDiscoveryCandidate, saveRecommendation,
  type AiWindow, type AiStoreListItem, type AiStoreIntelligence, type AiDiscoveryRow,
} from '@/lib/api/aiMusicApi';
import { getAiMusicConfig, type DiscoveryCandidate } from '@/lib/aiMusic';

const WINDOWS: AiWindow[] = ['7d', '30d'];
type Tab = 'stores' | 'tracks' | 'compatibility' | 'discovery' | 'recommendations' | 'learning' | 'simulation' | 'confidence';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'stores', label: 'Stores', icon: <Store size={14} /> },
  { key: 'tracks', label: 'Tracks', icon: <Music2 size={14} /> },
  { key: 'compatibility', label: 'Compatibility', icon: <GitCompare size={14} /> },
  { key: 'discovery', label: 'Discovery', icon: <Compass size={14} /> },
  { key: 'recommendations', label: 'Recommendations', icon: <Lightbulb size={14} /> },
  { key: 'learning', label: 'Learning', icon: <GraduationCap size={14} /> },
  { key: 'simulation', label: 'Simulation', icon: <FlaskConical size={14} /> },
  { key: 'confidence', label: 'Confidence', icon: <Gauge size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'EXCELLENT': case 'GOOD': case 'HIGH': case 'READY': case 'POSITIVE': case 'STRONG': return 'success';
    case 'ACCEPTABLE': case 'MEDIUM': case 'OK': case 'MODERATE': case 'NEUTRAL': return 'warning';
    case 'WEAK': case 'UNSUITABLE': case 'LOW': case 'NEGATIVE': case 'POOR': return 'danger';
    case 'INSUFFICIENT_DATA': case 'NO_DATA': case 'NOT_AVAILABLE': return 'info';
    default: return 'neutral';
  }
}
function pct(n: number | null | undefined): string { return n == null ? '—' : `${(n * 100).toFixed(1)}%`; }
function n1(n: number | null | undefined): string { return n == null ? '—' : `${n}`; }

export default function AiMusicOsDashboard() {
  const cfg = getAiMusicConfig();
  const [tab, setTab] = useState<Tab>('stores');
  const [win, setWin] = useState<AiWindow>('30d');
  const [stores, setStores] = useState<AiStoreListItem[]>([]);
  const [storeFilter, setStoreFilter] = useState('');
  const [selected, setSelected] = useState<AiStoreListItem | null>(null);
  const [bundle, setBundle] = useState<AiStoreIntelligence | null>(null);
  const [discovery, setDiscovery] = useState<{ raw: AiDiscoveryRow[]; evaluated: DiscoveryCandidate[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const loadStores = useCallback(async () => {
    if (!cfg.aiMusicEnabled) return;
    try { setStores(await getAiStoreList(win)); } catch { setError('매장 목록을 불러오지 못했습니다(마이그레이션 0464 미적용 시 NO DATA).'); }
  }, [win, cfg.aiMusicEnabled]);

  useEffect(() => { void loadStores(); }, [loadStores]);
  useEffect(() => { if (cfg.discoveryEnabled && cfg.aiMusicEnabled) getAiDiscovery().then(setDiscovery).catch(() => setDiscovery(null)); }, [cfg.discoveryEnabled, cfg.aiMusicEnabled]);

  const loadStore = useCallback(async (s: AiStoreListItem) => {
    setSelected(s); setBundle(null); const myReq = ++reqSeq.current; setLoading(true); setError(null);
    try {
      const b = await getAiStoreIntelligence(s.storeId, s.storeType, win);
      if (myReq !== reqSeq.current) return;
      setBundle(b);
      if (!b) setError('매장 인텔리전스를 계산할 데이터가 없습니다.');
    } catch { if (myReq === reqSeq.current) setError('매장 인텔리전스 조회 실패.'); }
    finally { if (myReq === reqSeq.current) setLoading(false); }
  }, [win]);

  const saveRec = useCallback(async (kind: string, targetId: string, label: string, score: number | null, reason: string, confidence: string) => {
    if (!selected) return; setNotice(null);
    try { await saveRecommendation({ scope: `store:${selected.storeId}`, storeId: selected.storeId, kind, targetId, label, score, reason, confidence }); setNotice('추천 스냅샷 저장됨(권고 전용, 실행 아님).'); }
    catch { setNotice('저장 실패(권한/마이그레이션 확인).'); }
  }, [selected]);

  const advanceDiscovery = useCallback(async (d: AiDiscoveryRow, stage: string) => {
    setNotice(null);
    try { await saveDiscoveryCandidate(d.trackId, stage, d.pilotStores, d.pilotPlays, `advance→${stage}`); setNotice(`디스커버리 단계 기록: ${stage} (자동 배포 아님).`); const dd = await getAiDiscovery(); setDiscovery(dd); }
    catch { setNotice('디스커버리 저장 실패.'); }
  }, []);

  if (!cfg.aiMusicEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Brain size={18} /> AI Music OS <span className="text-xs font-normal text-text-tertiary">Foundation (Preview)</span></h2>
        <AdminAlert tone="info" title="AI Music 비활성 (기본 OFF · opt-in)">
          Rule 기반 AI Music OS는 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code> 를 켜면 (읽기 전용) 분석이 로드됩니다.
          AI는 추천/시뮬레이션만 제공하며 Playlist 자동 배포·정책 실행은 하지 않습니다.
        </AdminAlert>
      </div>
    );
  }

  const stFiltered = stores.filter((s) => !storeFilter.trim() || `${s.storeName ?? ''} ${s.storeType ?? ''} ${s.storeId}`.toLowerCase().includes(storeFilter.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Brain size={18} /> AI Music OS <span className="text-xs font-normal text-text-tertiary">Foundation</span></h2>
          <p className="text-xs text-text-tertiary">Rule 기반(LLM 아님) · 읽기 전용 · 추천/시뮬레이션 전용 · 자동 배포/정책 실행 없음</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {WINDOWS.map((w) => <button key={w} onClick={() => setWin(w)} className={`px-3 py-1.5 text-xs font-medium ${win === w ? 'bg-accent text-white' : 'bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>{w}</button>)}
          </div>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={() => void loadStores()}>새로고침</AdminButton>
        </div>
      </div>
      {error && <AdminAlert tone="warning" title="데이터 로드 경고">{error}</AdminAlert>}
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      {/* Store selector */}
      <AdminCard title="매장 선택">
        <AdminSearch value={storeFilter} onChange={setStoreFilter} placeholder="매장 이름/업종/UUID 검색" />
        {stFiltered.length === 0 ? <AdminEmpty title="NO DATA" description="재생 이벤트가 있는 매장 없음" /> : (
          <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
            {stFiltered.slice(0, 40).map((s) => (
              <button key={s.storeId} onClick={() => void loadStore(s)} className={`rounded-lg border px-3 py-1.5 text-xs ${selected?.storeId === s.storeId ? 'border-accent bg-accent/10 text-text-primary' : 'border-border bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>
                {s.storeName ?? s.storeId.slice(0, 8)} <span className="text-text-tertiary">· {s.storeType ?? '?'} · {s.plays}p</span>
              </button>
            ))}
          </div>
        )}
      </AdminCard>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {loading && <AdminSkeleton className="h-40" />}

      {/* Discovery is store-independent */}
      {tab === 'discovery' && (
        <AdminCard title="Discovery Pool (게이트 · 자동 배포 없음)">
          {!cfg.discoveryEnabled ? <AdminAlert tone="info" title="비활성">discovery flag off</AdminAlert>
            : !discovery || discovery.raw.length === 0 ? <AdminEmpty title="후보 없음" description="Candidate → Pilot → Evaluation → Recommended → Approved → General (모두 승인 필요)" />
            : (
              <div className="space-y-2">
                {discovery.evaluated.map((d, i) => (
                  <div key={discovery.raw[i].id} className="rounded-lg border border-border bg-bg-card p-3 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <AdminBadge tone="neutral">{d.stage}</AdminBadge>
                      <span className="font-medium text-text-primary">{d.title ?? d.trackId.slice(0, 8)}</span>
                      <span className="text-text-tertiary">pilot {d.pilotStores} stores · {d.pilotPlays} plays</span>
                    </div>
                    <p className="mt-1 text-text-secondary">{d.recommendation}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {['PILOT', 'EVALUATION', 'RECOMMENDED_EXPANSION', 'APPROVED'].map((st) => (
                        <AdminButton key={st} size="sm" variant="outline" onClick={() => void advanceDiscovery(discovery.raw[i], st)}>{st}</AdminButton>
                      ))}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-text-tertiary">단계 이동은 기록일 뿐, 실제 배포/재생은 운영자 승인 후 별도 수행됩니다(자동 없음).</p>
              </div>
            )}
        </AdminCard>
      )}

      {!bundle && tab !== 'discovery' && !loading && <AdminEmpty title="매장을 선택하세요" description="위에서 매장을 선택하면 AI 분석이 로드됩니다" />}

      {bundle && tab === 'stores' && (
        <AdminCard title={`Store Intelligence Profile — ${selected?.storeName ?? selected?.storeId.slice(0, 8)}`}>
          {bundle.store.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">표본 부족 — 프로필 계산 불가</AdminAlert> : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <AdminStatCard label="Skip Rate" value={pct(bundle.store.skipRate)} tone="info" />
                <AdminStatCard label="Completion" value={pct(bundle.store.completionRate)} tone="info" />
                <AdminStatCard label="Instrumental" value={pct(bundle.store.instrumentalPreference)} tone="info" />
                <AdminStatCard label="Energy" value={pct(bundle.store.energyPreference)} tone="info" />
              </div>
              <div className="flex flex-wrap gap-2">
                {bundle.store.genrePreference.map((g) => <AdminBadge key={g.key} tone={tone(g.strength)}>{g.key} {(g.share * 100).toFixed(0)}%</AdminBadge>)}
              </div>
              <p className="text-[11px] text-text-tertiary">Seasonal/Weather/Holiday: NOT_AVAILABLE (rule placeholder) · Active hours: {bundle.store.activeHours.join(', ') || '—'}</p>
            </div>
          )}
        </AdminCard>
      )}

      {bundle && tab === 'tracks' && (
        <AdminCard title="Track Intelligence Profile (candidates)">
          {bundle.trackProfiles.length === 0 ? <AdminEmpty title="NO DATA" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Track</th><th>Genre</th><th>BPM</th><th>Skip</th><th>Compl</th><th>Replay</th><th>QC</th></tr></thead>
                <tbody>
                  {bundle.trackProfiles.slice(0, 60).map((t) => (
                    <tr key={t.trackId} className="border-t border-border">
                      <td className="py-1 text-text-primary">{t.title ?? t.trackId.slice(0, 8)}</td><td>{t.genre ?? '—'}</td><td>{t.bpmBucket}</td>
                      <td><AdminBadge tone={tone(t.skipPerformance)}>{t.skipPerformance}</AdminBadge></td>
                      <td><AdminBadge tone={tone(t.completionPerformance)}>{t.completionPerformance}</AdminBadge></td>
                      <td><AdminBadge tone={tone(t.replayPerformance)}>{t.replayPerformance}</AdminBadge></td>
                      <td>{t.qcStatus ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {bundle && tab === 'compatibility' && (
        <AdminCard title="Store ↔ Track Compatibility (추천 전용)">
          {bundle.compatibilities.length === 0 ? <AdminEmpty title="NO DATA" /> : (
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Track</th><th>Score</th><th>Band</th><th>Reasons</th></tr></thead>
                <tbody>
                  {[...bundle.compatibilities].sort((a, b) => (b.compat.score ?? -1) - (a.compat.score ?? -1)).slice(0, 60).map((c) => (
                    <tr key={c.trackId} className="border-t border-border">
                      <td className="py-1 text-text-primary">{c.title ?? c.trackId.slice(0, 8)}</td><td>{n1(c.compat.score)}</td>
                      <td><AdminBadge tone={tone(c.compat.band)}>{c.compat.band}</AdminBadge></td>
                      <td className="text-text-tertiary">{c.compat.reasons.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {bundle && tab === 'recommendations' && (
        <AdminCard title="Recommendation Engine (advisory only)">
          {!cfg.recommendationsEnabled ? <AdminAlert tone="info" title="비활성">recommendations flag off</AdminAlert>
            : bundle.recommendations.length === 0 ? <AdminEmpty title="권고 없음" /> : (
              <div className="space-y-1.5">
                {bundle.recommendations.map((r) => (
                  <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <AdminBadge tone={r.kind === 'EXCLUDE_TRACK' ? 'danger' : 'success'}>{r.kind}</AdminBadge>
                    <span className="font-medium text-text-primary">{r.label}</span>
                    <span className="text-text-secondary">{r.reason}</span>
                    <AdminButton size="sm" variant="outline" onClick={() => void saveRec(r.kind, r.targetId, r.label, r.score, r.reason, r.confidence)}>기록</AdminButton>
                  </div>
                ))}
                <p className="text-[11px] text-text-tertiary">추천은 권고이며 자동 배포/재생되지 않습니다(운영자 승인 필요).</p>
              </div>
            )}
        </AdminCard>
      )}

      {bundle && tab === 'learning' && (
        <div className="grid gap-3 lg:grid-cols-2">
          <AdminCard title="Learning Engine">
            {bundle.learning.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">신호 부족</AdminAlert> : (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2"><AdminBadge tone={tone(bundle.learning.band)}>{bundle.learning.band}</AdminBadge><span className="text-text-secondary">affinity {n1(bundle.learning.affinityScore)} · signals {bundle.learning.signalCount}</span></div>
                <div className="flex flex-wrap gap-2">{Object.entries(bundle.learning.breakdown).map(([k, v]) => <span key={k} className="rounded border border-border bg-bg-card px-2 py-1 text-text-tertiary">{k}: {v.toFixed(1)}</span>)}</div>
              </div>
            )}
          </AdminCard>
          <AdminCard title="AI Music Director (Rule 기반)">
            <div className="space-y-1.5 text-xs">
              <div className="text-text-tertiary">{bundle.director.storeType} · source {bundle.director.source}</div>
              {bundle.director.slots.map((s, i) => (
                <div key={i} className="rounded border border-border bg-bg-card p-2"><span className="font-medium text-text-primary">{s.part}</span> <span className="text-text-tertiary">({s.hours})</span> — {s.mood.join('/')} · {s.energy}<div className="text-text-tertiary">{s.note}</div></div>
              ))}
            </div>
          </AdminCard>
        </div>
      )}

      {bundle && tab === 'simulation' && (
        <AdminCard title="Playlist Simulation (Simulation Only)">
          {!cfg.simulationEnabled ? <AdminAlert tone="info" title="비활성">simulation flag off</AdminAlert>
            : bundle.simulation.status === 'INSUFFICIENT_DATA' ? <AdminAlert tone="info" title="INSUFFICIENT_DATA">표본/트랙 부족</AdminAlert> : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <AdminStatCard label="Pred. Skip" value={pct(bundle.simulation.predictedSkipRate)} tone="info" />
                  <AdminStatCard label="Pred. Completion" value={pct(bundle.simulation.predictedCompletion)} tone="info" />
                  <AdminStatCard label="Diversity" value={pct(bundle.simulation.diversity)} tone="info" />
                  <AdminStatCard label="Mean Compat" value={n1(bundle.simulation.meanCompatibility)} tone={tone(bundle.simulation.band)} />
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <AdminBadge tone={tone(bundle.playlistIntelligence.fatigueBand)}>Fatigue {bundle.playlistIntelligence.fatigueBand}</AdminBadge>
                  {bundle.playlistIntelligence.instrumentalRatio != null && <span className="text-text-tertiary">Instrumental {(bundle.playlistIntelligence.instrumentalRatio * 100).toFixed(0)}%</span>}
                </div>
                <p className="text-[11px] text-text-tertiary">{bundle.simulation.notes.join(' · ')}</p>
              </div>
            )}
        </AdminCard>
      )}

      {bundle && tab === 'confidence' && (
        <AdminCard title="AI Confidence">
          <div className="mb-2 flex items-center gap-2"><AdminBadge tone={tone(bundle.confidence.level)}>{bundle.confidence.level}</AdminBadge><span className="text-sm font-semibold text-text-primary">{bundle.confidence.value == null ? 'INSUF' : bundle.confidence.value}</span></div>
          <div className="flex flex-wrap gap-2">
            {bundle.confidence.parts.map((p) => <div key={p.key} className="rounded-lg border border-border bg-bg-card px-3 py-2 text-xs"><div className="text-text-tertiary">{p.label}</div><div className="font-semibold text-text-primary">{p.score}</div></div>)}
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">Sample / Store History / Track History / Learning Coverage / Signal Coverage 규칙 블렌드(≤94, 확실성 아님).</p>
        </AdminCard>
      )}

      <p className="text-[11px] text-text-tertiary">
        모든 결과는 규칙 기반 추천/시뮬레이션입니다. AI는 Playlist 를 자동 생성·배포하거나 운영 정책을 실행하지 않으며, 기존 음악/재생/정산/노출 데이터는 변경하지 않습니다.
      </p>
    </div>
  );
}
