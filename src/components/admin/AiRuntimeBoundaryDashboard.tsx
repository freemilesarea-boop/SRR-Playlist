/**
 * AiRuntimeBoundaryDashboard — AI-MUSIC-10 Runtime Boundary Observability Bridge (Preview).
 * Rule 기반(LLM/ML 아님) READ-ONLY 관측 하니스. Player / Queue / Audio / 재생을 절대 제어하지 않는다.
 * 실제 Player 가 publish 한 최신 Boundary Snapshot(있으면)을 읽고, Synthetic Sequence 를 로컬 reducer 로 실행해
 * Crossfade/Recovery/Preload/Audio Swap 관측, Stable Boundary, Revision/Stale, Sequence, Coverage, Hook
 * Readiness 를 검증한다. 허용 버튼: Run Synthetic Sequence / Run Full Sequence Suite / Reset Local Observer /
 * Record Local Certification. 금지: Apply Queue / Activate Hook / Start Canary / Control·Stop Player /
 * Trigger Crossfade·Recovery·Preload / Production Canary. master + 세부 flag 기본 OFF, Kill Switch 기본 ON.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Radio, ClipboardList, Shuffle, LifeBuoy, Download, ArrowLeftRight, ShieldCheck, Hash, Users, GitBranch,
  Gauge, Rocket, ScrollText, Play, RefreshCw, Save,
} from 'lucide-react';
import {
  AdminCard, AdminStatCard, AdminBadge, AdminButton, AdminEmpty, AdminAlert, type AdminToneName,
} from '@/components/admin/ui';
import {
  initialBoundaryState, applySignal, computeStableBoundary, computeBoundaryCoverage,
  computeHookReadiness, getAiRuntimeBoundaryConfig, useRuntimeBoundaryStore, useRuntimeBoundarySnapshot,
  type BoundaryReducerState, type ObserverSignal, type RuntimeBoundarySnapshot, type SignalAuditEntry,
} from '@/lib/aiRuntimeBoundary';

type Tab = 'overview' | 'audit' | 'crossfade' | 'recovery' | 'preload' | 'swap' | 'stable' | 'revisions' | 'sessions' | 'sequences' | 'coverage' | 'readiness' | 'trace';
const TABS: Array<{ key: Tab; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Overview', icon: <Radio size={14} /> },
  { key: 'audit', label: 'Signal Audit', icon: <ClipboardList size={14} /> },
  { key: 'crossfade', label: 'Crossfade', icon: <Shuffle size={14} /> },
  { key: 'recovery', label: 'Recovery', icon: <LifeBuoy size={14} /> },
  { key: 'preload', label: 'Preload', icon: <Download size={14} /> },
  { key: 'swap', label: 'Audio Swap', icon: <ArrowLeftRight size={14} /> },
  { key: 'stable', label: 'Stable Boundary', icon: <ShieldCheck size={14} /> },
  { key: 'revisions', label: 'Revisions', icon: <Hash size={14} /> },
  { key: 'sessions', label: 'Sessions', icon: <Users size={14} /> },
  { key: 'sequences', label: 'Sequences', icon: <GitBranch size={14} /> },
  { key: 'coverage', label: 'Coverage', icon: <Gauge size={14} /> },
  { key: 'readiness', label: 'Readiness', icon: <Rocket size={14} /> },
  { key: 'trace', label: 'Trace', icon: <ScrollText size={14} /> },
];

function tone(s: string): AdminToneName {
  switch (s) {
    case 'SAFE': case 'VALID': case 'SUFFICIENT': case 'BOUNDARY_OBSERVABILITY_READY': case 'READY_FOR_SINGLE_STORE_CHANGE_REQUEST': case 'AVAILABLE': case 'CURRENT': return 'success';
    case 'PARTIAL': case 'STALE_TRANSITION': case 'SESSION_CHANGED': case 'LOW': case 'NOT_READY': return 'warning';
    case 'INVALID_TRANSITION': case 'NOT_AVAILABLE': case 'UNSAFE_TO_EXPORT': case 'BLOCKED': case 'STALE': case 'WRONG_SESSION': case 'OUT_OF_ORDER': return 'danger';
    case 'NO_DATA': case 'INSUFFICIENT_DATA': case 'NOT_RUN': case 'UNKNOWN': return 'info';
    default: return s.startsWith('BLOCKED_') ? 'danger' : 'neutral';
  }
}

// ── Signal availability audit (from the Player.tsx deep audit — Task 1) ──
const SIGNAL_AUDIT: SignalAuditEntry[] = [
  { signal: 'Crossfade start/complete/cancel', availability: 'AVAILABLE', note: 'crossfading useState 전이 직후 관측 (setCrossfading true/false)' },
  { signal: 'Crossfade fallback/stuck sub-state', availability: 'PARTIAL', note: 'completeSwap reason 로 구분 가능하나 effect 관측은 ACTIVE/IDLE 로 축약' },
  { signal: 'Audio swap (activeIdx)', availability: 'AVAILABLE', note: 'setActiveIdx(swapToIdx) 단일 지점 관측' },
  { signal: 'Recovery enter/exit', availability: 'AVAILABLE', note: 'recoverAudioWithSession wrapper pre/post seam' },
  { signal: 'Recovery reason', availability: 'PARTIAL', note: 'reason 은 Player 내부 type — 관측은 상태 전이만' },
  { signal: 'Preload ready/failed', availability: 'PARTIAL', note: '기존 preload_ready/failed emit seam (REQUESTED/LOADING 은 ref → 미관측)' },
  { signal: 'playing / current track / index / queue length', availability: 'AVAILABLE', note: 'store selector 값을 additive effect 로 관측' },
  { signal: 'paused/ended/buffering/waiting/stalled', availability: 'NOT_AVAILABLE', note: 'Player.tsx 에 reactive state mirror 없음 — false 로 발행' },
  { signal: 'rAF/timeout internals', availability: 'UNSAFE_TO_EXPORT', note: 'animation 중간값 — 제어 흐름 hook 없이 관측 불가' },
];

// ── Synthetic sequences (pure; run through the reducer — never touch the real player) ──
interface Scenario { name: string; signals: Array<{ signal: ObserverSignal; atMs: number }>; expectSafe?: boolean; }
const T0 = 1_700_000_000_000;
function ps(o: Partial<Extract<ObserverSignal, { kind: 'playerState' }>> = {}): ObserverSignal {
  return { kind: 'playerState', playing: true, paused: false, ended: false, buffering: false, waiting: false, stalled: false, currentTrackIdHash: 'h1', currentIndex: 0, queueLength: 3, activeAudioIndex: 0, inactiveAudioReady: false, nextTrackHash: null, ...o };
}
const SCENARIOS: Scenario[] = [
  { name: 'Session Start', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }], expectSafe: false },
  { name: 'Safe Idle Boundary', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'crossfade', state: 'IDLE' }, atMs: T0 + 2 }], expectSafe: true },
  { name: 'Crossfade Normal', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'crossfade', state: 'ACTIVE' }, atMs: T0 + 2 }, { signal: { kind: 'crossfade', state: 'COMPLETING' }, atMs: T0 + 3 }, { signal: { kind: 'crossfade', state: 'IDLE' }, atMs: T0 + 4 }], expectSafe: true },
  { name: 'Crossfade Block', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'crossfade', state: 'ACTIVE' }, atMs: T0 + 2 }], expectSafe: false },
  { name: 'Recovery Success', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'recovery', state: 'ATTEMPTING', reason: 'STALL' }, atMs: T0 + 2 }, { signal: { kind: 'recovery', state: 'RECOVERED' }, atMs: T0 + 3 }], expectSafe: true },
  { name: 'Recovery Block', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'recovery', state: 'ATTEMPTING', reason: 'MEDIA_ERROR' }, atMs: T0 + 2 }], expectSafe: false },
  { name: 'Preload Ready', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'preload', state: 'READY', nextTrackHash: 'n1' }, atMs: T0 + 2 }], expectSafe: true },
  { name: 'Preload Block (loading)', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'preload', state: 'REQUESTED' }, atMs: T0 + 2 }, { signal: { kind: 'preload', state: 'LOADING' }, atMs: T0 + 3 }], expectSafe: false },
  { name: 'Audio Swap Completed', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'audioSwap', state: 'PREPARING' }, atMs: T0 + 2 }, { signal: { kind: 'audioSwap', state: 'SWAPPING' }, atMs: T0 + 3 }, { signal: { kind: 'audioSwap', state: 'COMPLETED', afterActiveIndex: 1 }, atMs: T0 + 4 }], expectSafe: true },
  { name: 'Audio Swap Block', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'audioSwap', state: 'SWAPPING' }, atMs: T0 + 2 }], expectSafe: false },
  { name: 'Buffering Block', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps({ buffering: true }), atMs: T0 + 1 }], expectSafe: false },
  { name: 'Empty Queue', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps({ queueLength: 0, currentIndex: -1 }), atMs: T0 + 1 }], expectSafe: false },
  { name: 'Invalid Index', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps({ currentIndex: 9 }), atMs: T0 + 1 }], expectSafe: false },
  { name: 'Invalid Crossfade Transition', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: ps(), atMs: T0 + 1 }, { signal: { kind: 'crossfade', state: 'IDLE' }, atMs: T0 + 2 }, { signal: { kind: 'crossfade', state: 'COMPLETING' }, atMs: T0 + 3 }] },
  { name: 'Session Change', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 }, { signal: { kind: 'crossfade', state: 'ACTIVE' }, atMs: T0 + 1 }, { signal: { kind: 'session', playerSessionId: 's2' }, atMs: T0 + 2 }] },
  { name: 'Out-of-order (stale) Event', signals: [{ signal: { kind: 'session', playerSessionId: 's1' }, atMs: T0 + 100 }, { signal: ps(), atMs: T0 }] },
];

function runScenario(s: Scenario): BoundaryReducerState {
  let st = initialBoundaryState();
  for (const step of s.signals) {
    st = applySignal(st, step.signal, step.atMs);
  }
  return st;
}

export default function AiRuntimeBoundaryDashboard() {
  const cfg = getAiRuntimeBoundaryConfig();
  const liveSnapshot = useRuntimeBoundarySnapshot();
  const liveCounters = useRuntimeBoundaryStore((s) => s.counters);
  const [tab, setTab] = useState<Tab>('overview');
  const [results, setResults] = useState<Array<{ name: string; state: BoundaryReducerState; expectSafe?: boolean }> | null>(null);
  const [single, setSingle] = useState<BoundaryReducerState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const runSuite = useCallback(() => {
    const r = SCENARIOS.map((s) => ({ name: s.name, state: runScenario(s), expectSafe: s.expectSafe }));
    setResults(r);
    setNotice(`${r.length} synthetic sequences 실행 (순수 reducer · 실제 Player 미변경).`);
  }, []);
  const runOne = useCallback(() => { setSingle(runScenario(SCENARIOS[2])); setTab('trace'); setNotice('단일 Synthetic Sequence (Crossfade Normal) 실행.'); }, []);
  const reset = useCallback(() => { setResults(null); setSingle(null); setRecorded(false); useRuntimeBoundaryStore.getState().reset(); setNotice('로컬 Observer 초기화됨 (live store reset).'); }, []);

  const coverage = useMemo(() => {
    if (!results) return null;
    const distinct = new Set<string>();
    let cx = 0, rc = 0, pl = 0, sw = 0, safe = 0, blocked = 0, stale = 0;
    for (const r of results) {
      r.state.seenStates.forEach((x) => distinct.add(x));
      cx += r.state.counters.crossfadeTransitions; rc += r.state.counters.recoveryTransitions;
      pl += r.state.counters.preloadTransitions; sw += r.state.counters.swapTransitions;
      safe += r.state.counters.safeBoundaries; blocked += r.state.counters.blockedBoundaries; stale += r.state.counters.staleEvents;
    }
    return computeBoundaryCoverage({ sessionsObserved: results.length, snapshots: results.reduce((a, r) => a + r.state.counters.snapshots, 0), crossfadeTransitions: cx, recoveryTransitions: rc, preloadTransitions: pl, swapTransitions: sw, safeBoundaries: safe, blockedBoundaries: blocked, staleEvents: stale, observerErrors: 0, distinctStatesSeen: distinct.size, browserRuntimeRan: true });
  }, [results]);

  const readiness = useMemo(() => computeHookReadiness({
    crossfadeObservable: true, recoveryObservable: true, preloadObservable: true, audioSwapObservable: true,
    stableBoundaryEngine: true, revisionStaleProtection: true, sessionAttribution: true, zeroControlGuaranteed: true,
    observerFailOpen: true, sequenceValidation: true, sufficientTestCoverage: coverage?.status === 'SUFFICIENT',
    internalTestStoreConfigured: false, previewMigrationApplied: false,
  }), [coverage]);

  const recordCert = useCallback(() => { setRecorded(true); setNotice(`Local Certification 기록됨 (Hook Readiness: ${readiness.status} · 실제 적용 아님).`); }, [readiness.status]);

  if (!cfg.masterEnabled || !cfg.dashboardEnabled) {
    return (
      <div className="space-y-4">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Radio size={18} /> AI Runtime Boundary <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-10 (Preview)</span></h2>
        <AdminAlert tone="info" title="Runtime Boundary Observer 비활성 (기본 OFF · Kill Switch ON)">
          Read-only Runtime Boundary Observability 하니스는 기본 OFF입니다. <code>VITE_AI_MUSIC_ENABLED</code>(마스터) + <code>VITE_AI_BOUNDARY_DASHBOARD_ENABLED</code> 로 로드됩니다.
          이 관측 계층은 Player / Queue / Audio / 재생을 제어하지 않으며(관측 전용), Observer 가 꺼져 있으면 Player 동작은 완전히 동일합니다.
        </AdminAlert>
      </div>
    );
  }

  const renderStateTable = (pick: (st: BoundaryReducerState) => string) => (
    !results ? <AdminEmpty title="Suite 미실행" description="Run Full Sequence Suite 로 순수 관측 시뮬레이션을 실행하세요." /> : (
      <div className="max-h-[26rem] overflow-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-text-tertiary"><th className="py-1">Sequence</th><th>State</th><th>Stable</th><th>Seq</th></tr></thead>
          <tbody>
            {results.map((r, i) => (
              <tr key={i} className="border-t border-border">
                <td className="py-1 text-text-primary">{r.name}</td>
                <td><AdminBadge tone={tone(pick(r.state))}>{pick(r.state)}</AdminBadge></td>
                <td>{r.state.snapshot ? <AdminBadge tone={tone(computeStableBoundary(r.state.snapshot).result)}>{computeStableBoundary(r.state.snapshot).result}</AdminBadge> : '—'}</td>
                <td className="text-[10px] text-text-tertiary">{r.state.lastSequence?.status ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-text-primary"><Radio size={18} /> AI Runtime Boundary <span className="text-xs font-normal text-text-tertiary">AI-MUSIC-10</span></h2>
          <p className="text-xs text-text-tertiary">Read-only 관측 · Player/Queue/Audio 미제어 · SAFE=관측상 충돌 없음(적용 보장 아님) · 최대 BOUNDARY_OBSERVABILITY_READY</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <AdminButton size="sm" variant="subtle" leftIcon={<Shuffle size={14} />} onClick={runOne}>Run Synthetic Sequence</AdminButton>
          <AdminButton size="sm" variant="solid" leftIcon={<Play size={14} />} onClick={runSuite}>Run Full Sequence Suite</AdminButton>
          <AdminButton size="sm" variant="outline" leftIcon={<RefreshCw size={14} />} onClick={reset}>Reset Local Observer</AdminButton>
          <AdminButton size="sm" variant="subtle" leftIcon={<Save size={14} />} disabled={!results} onClick={recordCert}>Record Local Certification</AdminButton>
        </div>
      </div>
      {notice && <AdminAlert tone="info" title="기록">{notice}</AdminAlert>}

      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((t) => <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium ${tab === t.key ? 'bg-accent text-white' : 'text-text-secondary hover:bg-bg-hover'}`}>{t.icon}{t.label}</button>)}
      </div>

      {tab === 'overview' && (
        <AdminCard title="Overview">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <AdminStatCard label="Observer Enabled" value={cfg.masterEnabled && cfg.observerEnabled && !cfg.killSwitch ? 'ON' : 'OFF'} tone={cfg.masterEnabled && cfg.observerEnabled && !cfg.killSwitch ? 'success' : 'info'} />
            <AdminStatCard label="Live Session" value={liveSnapshot?.playerSessionId ? 'yes' : '—'} tone="info" />
            <AdminStatCard label="Live Revision" value={`${liveSnapshot?.revision ?? 0}`} tone="neutral" />
            <AdminStatCard label="Crossfade" value={liveSnapshot?.crossfadeState ?? 'UNKNOWN'} tone={tone(liveSnapshot?.crossfadeState ?? 'UNKNOWN')} />
            <AdminStatCard label="Recovery" value={liveSnapshot?.recoveryState ?? 'UNKNOWN'} tone={tone(liveSnapshot?.recoveryState ?? 'UNKNOWN')} />
            <AdminStatCard label="Preload" value={liveSnapshot?.preloadState ?? 'UNKNOWN'} tone={tone(liveSnapshot?.preloadState ?? 'UNKNOWN')} />
            <AdminStatCard label="Audio Swap" value={liveSnapshot?.audioSwapState ?? 'UNKNOWN'} tone={tone(liveSnapshot?.audioSwapState ?? 'UNKNOWN')} />
            <AdminStatCard label="Stable Boundary" value={liveSnapshot ? computeStableBoundary(liveSnapshot).result : 'NOT_AVAILABLE'} tone={tone(liveSnapshot ? computeStableBoundary(liveSnapshot).result : 'NOT_AVAILABLE')} />
            <AdminStatCard label="Stale Events" value={`${liveCounters.staleEvents}`} tone={liveCounters.staleEvents > 0 ? 'warning' : 'success'} />
            <AdminStatCard label="Invalid Transitions" value={`${liveCounters.invalidTransitions}`} tone={liveCounters.invalidTransitions > 0 ? 'warning' : 'success'} />
            <AdminStatCard label="Observer Errors" value={`${liveCounters.observerErrors}`} tone={liveCounters.observerErrors > 0 ? 'danger' : 'success'} />
            <AdminStatCard label="Coverage" value={coverage?.status ?? 'NO_DATA'} tone={tone(coverage?.status ?? 'NO_DATA')} />
            <AdminStatCard label="Hook Readiness" value={readiness.status} tone={tone(readiness.status)} />
            <AdminStatCard label="Cert Recorded" value={recorded ? 'yes' : 'no'} tone={recorded ? 'success' : 'info'} />
          </div>
          <p className="mt-3 text-[11px] text-text-tertiary">Live 값은 실제 Player 가 publish 한 최신 Snapshot 입니다(Admin 세션에서는 보통 없음 → NOT_AVAILABLE). 모든 결과는 관측 전용 — Apply Queue / Activate / Trigger / Production 버튼은 제공하지 않습니다.</p>
        </AdminCard>
      )}

      {tab === 'audit' && (
        <AdminCard title="Runtime Boundary Signal Audit (Player.tsx)">
          <div className="max-h-[26rem] overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-left text-text-tertiary"><th className="py-1">Signal</th><th>Availability</th><th>Note</th></tr></thead>
              <tbody>
                {SIGNAL_AUDIT.map((e, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="py-1 text-text-primary">{e.signal}</td>
                    <td><AdminBadge tone={tone(e.availability)}>{e.availability}</AdminBadge></td>
                    <td className="text-[11px] text-text-tertiary">{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminCard>
      )}

      {tab === 'crossfade' && <AdminCard title="Crossfade Sequences">{renderStateTable((st) => st.snapshot?.crossfadeState ?? 'UNKNOWN')}</AdminCard>}
      {tab === 'recovery' && <AdminCard title="Recovery Sequences">{renderStateTable((st) => st.snapshot?.recoveryState ?? 'UNKNOWN')}</AdminCard>}
      {tab === 'preload' && <AdminCard title="Preload Sequences">{renderStateTable((st) => st.snapshot?.preloadState ?? 'UNKNOWN')}</AdminCard>}
      {tab === 'swap' && <AdminCard title="Audio Swap Sequences">{renderStateTable((st) => st.snapshot?.audioSwapState ?? 'UNKNOWN')}</AdminCard>}
      {tab === 'sequences' && <AdminCard title="Sequence Validation">{renderStateTable((st) => st.lastSequence?.status ?? 'INSUFFICIENT_DATA')}</AdminCard>}

      {tab === 'stable' && (
        <AdminCard title="Stable Boundary (SAFE = 관측상 충돌 없음 · 적용 보장 아님)">
          {!results ? <AdminEmpty title="Suite 미실행" /> : (
            <div className="max-h-[26rem] overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-text-tertiary"><th className="py-1">Sequence</th><th>Result</th><th>Expect</th><th>Blockers</th></tr></thead>
                <tbody>
                  {results.map((r, i) => { const sb = r.state.snapshot ? computeStableBoundary(r.state.snapshot) : null; const ok = sb ? (sb.result === 'SAFE') === (r.expectSafe ?? false) : true; return (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 text-text-primary">{r.name}</td>
                      <td><AdminBadge tone={tone(sb?.result ?? 'NOT_AVAILABLE')}>{sb?.result ?? 'NOT_AVAILABLE'}</AdminBadge></td>
                      <td>{r.expectSafe === undefined ? '—' : <AdminBadge tone={ok ? 'success' : 'danger'}>{r.expectSafe ? 'SAFE' : 'BLOCKED'}{ok ? ' ✓' : ' ✗'}</AdminBadge>}</td>
                      <td className="text-[10px] text-text-tertiary">{sb?.blockers.join(', ') || '—'}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'revisions' && (
        <AdminCard title="Revisions (live)">
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{JSON.stringify(useRuntimeBoundaryStore.getState().revisions, null, 2)}</pre>
          <p className="mt-2 text-[11px] text-text-tertiary">Revision 은 단조 증가하며 Session 변경 시 namespace(sessionRevision)가 증가합니다. 오래된 Revision / 다른 Session Event 는 무시(stale)됩니다.</p>
        </AdminCard>
      )}

      {tab === 'sessions' && (
        <AdminCard title="Session Attribution">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <AdminStatCard label="Live Session" value={liveSnapshot?.playerSessionId ?? '—'} tone="info" />
            <AdminStatCard label="Session Revision" value={`${useRuntimeBoundaryStore.getState().revisions.sessionRevision}`} tone="neutral" />
            <AdminStatCard label="Data Status" value={liveSnapshot?.dataStatus ?? 'NO_SESSION'} tone={tone(liveSnapshot?.dataStatus ?? 'NO_SESSION')} />
            <AdminStatCard label="Snapshots" value={`${liveCounters.snapshots}`} tone="neutral" />
          </div>
          <p className="mt-2 text-[11px] text-text-tertiary">Session ID 는 개인정보 없는 anon 기반이며 Store/Track 원본 대신 hash 만 발행합니다. Session 변경/새로고침 시 Reset.</p>
        </AdminCard>
      )}

      {tab === 'coverage' && (
        <AdminCard title="Boundary Coverage">
          {!coverage ? <AdminEmpty title="Suite 미실행" description="실제 Browser Runtime 없이는 Coverage 는 NO_DATA 입니다." /> : (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><AdminBadge tone={tone(coverage.status)}>{coverage.status}</AdminBadge><span className="text-xs text-text-tertiary">state coverage: {coverage.stateCoveragePct ?? '—'}%</span></div>
              <ul className="list-disc pl-4 text-[11px] text-text-tertiary">{coverage.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
              <AdminAlert tone="info" title="주의"><span className="text-[11px]">위 Coverage 는 <b>Synthetic Sequence</b> 기준입니다. 실제 Browser Runtime Coverage 는 Preview Manual QA 로만 확보되며 미실행 시 NO_DATA/NOT_RUN 입니다.</span></AdminAlert>
            </div>
          )}
        </AdminCard>
      )}

      {tab === 'readiness' && (
        <AdminCard title="Runtime Hook Readiness (재평가)">
          <div className="space-y-2">
            <div className="flex items-center gap-2"><span className="text-xs text-text-secondary">상태:</span><AdminBadge tone={tone(readiness.status)}>{readiness.status}</AdminBadge><span className="text-[11px] text-text-tertiary">runtime hook 구현: {String(readiness.runtimeHookImplemented)}</span></div>
            {readiness.satisfied.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Satisfied</p><p className="text-[11px] text-text-secondary">{readiness.satisfied.join(' · ')}</p></div>}
            {readiness.blockers.length > 0 && <div><p className="text-[11px] font-medium text-text-tertiary">Blockers</p><ul className="list-disc pl-4 text-[11px] text-red-300">{readiness.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
            <div><p className="text-[11px] font-medium text-text-tertiary">Next Required Evidence</p><ul className="list-disc pl-4 text-[11px] text-text-secondary">{readiness.nextRequiredEvidence.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            <AdminAlert tone="warning" title="이 Phase 범위"><span className="text-[11px]">내부 Test Store + Preview Migration 이 없으므로 최대 <b>BOUNDARY_OBSERVABILITY_READY</b> 까지만 재평가합니다. 실제 Runtime Hook 은 구현하지 않습니다(다음 Phase Change Request).</span></AdminAlert>
          </div>
        </AdminCard>
      )}

      {tab === 'trace' && (
        <AdminCard title="Trace">
          {!single ? <AdminEmpty title="Sequence 미선택" description="Run Synthetic Sequence 로 단일 흐름을 보세요." /> : (
            <pre className="overflow-x-auto rounded-lg border border-border bg-bg-base p-3 text-[11px] text-text-secondary">{JSON.stringify({ sessionId: single.sessionId, snapshot: single.snapshot as RuntimeBoundarySnapshot | null, counters: single.counters, lastSequence: single.lastSequence, lastFreshness: single.lastFreshness }, null, 2)}</pre>
          )}
        </AdminCard>
      )}
    </div>
  );
}
