/**
 * AudioDiagnosticsDashboard — Phase 4-2.
 *
 * Recovery Manager · LongRun · Health · Audio 상태를 실시간 확인용 overlay.
 * 운영 사용자에게는 절대 노출되지 않음 — `isAudioDebugEnabled()` true 일 때만 렌더.
 * 관측 전용 · Player · Recovery · Health · LongRun 로직 변경 없음.
 */
import { useEffect, useState } from 'react';
import { audioDebugWarn, isAudioDebugEnabled } from '@/lib/audioDebug';
import type {
  RecoveryHistoryEntry, RecoverySummary, RecoveryReason,
} from '@/hooks/useAudioRecoveryManager';
import type { LongRunSummary } from '@/hooks/useAudioLongRunDiagnostics';
import type { LifecycleSnapshot } from '@/hooks/useAudioLifecycleAudit';
import { useAudioOutputStore } from '@/store/audioOutputStore';

export interface DashboardInputs {
  audioARef: { current: HTMLAudioElement | null };
  audioBRef: { current: HTMLAudioElement | null };
  getActiveIdx: () => 0 | 1;
  getPlaying: () => boolean;
  getCrossfading: () => boolean;
  getSinkReady: () => boolean;
  getCurrentTrackId: () => string | null;
  getCurrentTrackTitle: () => string | null;
  getRecoverySummary: () => RecoverySummary;
  getRecoveryHistory: () => RecoveryHistoryEntry[];
  getLongRunSummary: () => LongRunSummary;
  // Phase 5-1 (optional · flag OFF 세션에는 필요 없으므로 nullable)
  getLifecycleSummary?: () => LifecycleSnapshot;
}

interface DashboardSnapshot {
  recovery: RecoverySummary;
  history: RecoveryHistoryEntry[];
  longRun: LongRunSummary;
  lifecycle: LifecycleSnapshot | null;
  audio: {
    activeIdx: 0 | 1;
    playing: boolean;
    crossfadeInProgress: boolean;
    sinkReady: boolean;
    currentTrackId: string | null;
    currentTrackTitle: string | null;
    activeSinkId: string;
    inactiveSinkId: string;
    desiredSinkId: string | null;
    activeCurrentTime: number;
    activeDuration: number;
    activePaused: boolean;
    inactivePaused: boolean;
    activeVolume: number;
    inactiveVolume: number;
  };
}

const HEALTH_REASONS: RecoveryReason[] = [
  'inactive-playing',
  'both-playing',
  'sink-mismatch',
  'stalled',
  'crossfade-stuck',
  'neither-playing',
  'media-error',
];

function createDashboardSnapshot(inputs: DashboardInputs): DashboardSnapshot {
  const activeIdx = inputs.getActiveIdx();
  const active = activeIdx === 0 ? inputs.audioARef.current : inputs.audioBRef.current;
  const inactive = activeIdx === 0 ? inputs.audioBRef.current : inputs.audioARef.current;
  const desiredSinkId = useAudioOutputStore.getState().sinkId;
  return {
    recovery: inputs.getRecoverySummary(),
    history: inputs.getRecoveryHistory(),
    longRun: inputs.getLongRunSummary(),
    lifecycle: inputs.getLifecycleSummary ? inputs.getLifecycleSummary() : null,
    audio: {
      activeIdx,
      playing: inputs.getPlaying(),
      crossfadeInProgress: inputs.getCrossfading(),
      sinkReady: inputs.getSinkReady(),
      currentTrackId: inputs.getCurrentTrackId(),
      currentTrackTitle: inputs.getCurrentTrackTitle(),
      activeSinkId: (active as HTMLAudioElement & { sinkId?: string })?.sinkId ?? '',
      inactiveSinkId: (inactive as HTMLAudioElement & { sinkId?: string })?.sinkId ?? '',
      desiredSinkId,
      activeCurrentTime: active?.currentTime ?? 0,
      activeDuration: Number.isFinite(active?.duration ?? NaN) ? (active?.duration ?? 0) : 0,
      activePaused: active?.paused ?? true,
      inactivePaused: inactive?.paused ?? true,
      activeVolume: active?.volume ?? 0,
      inactiveVolume: inactive?.volume ?? 0,
    },
  };
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

function fmtMemMB(bytes?: number): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fmtTs(ts: number): string {
  const rel = ts - performance.now();
  return rel > -1000 ? 'now' : `${Math.round(-rel / 1000)}s ago`;
}

function shortId(id: string): string {
  if (!id) return '""';
  if (id === 'default' || id === 'communications') return id;
  if (id.length <= 12) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

export function AudioDiagnosticsDashboard(props: DashboardInputs): JSX.Element | null {
  // 렌더 여부는 mount 시점 flag 로 확정 — 이후 토글은 새로고침 필요.
  const [enabled] = useState<boolean>(() => isAudioDebugEnabled());
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [collapsed, setCollapsed] = useState<boolean>(false);

  useEffect(() => {
    if (!enabled) return;
    audioDebugWarn('[audio:dashboard:mount]', { intervalMs: 1000 });
    const tick = () => {
      const snap = createDashboardSnapshot(props);
      setSnapshot(snap);
      audioDebugWarn('[audio:dashboard:update]', {
        totalRecoveries: snap.recovery.totalRecoveries,
        history: snap.history.length,
        activeSinkId: snap.audio.activeSinkId,
        desiredSinkId: snap.audio.desiredSinkId,
      });
    };
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => {
      window.clearInterval(iv);
      audioDebugWarn('[audio:dashboard:cleanup]', { finalHistoryCount: snapshot?.history.length ?? 0 });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;
  if (!snapshot) return null;

  const { recovery, history, longRun, audio, lifecycle } = snapshot;

  return (
    <div
      style={{
        position: 'fixed',
        top: 8,
        right: 8,
        zIndex: 2147483000,
        maxWidth: collapsed ? 180 : 380,
        maxHeight: collapsed ? 32 : '80vh',
        overflow: 'hidden',
        background: 'rgba(10, 12, 20, 0.92)',
        color: '#d4dbe6',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 10.5,
        lineHeight: 1.35,
        border: '1px solid rgba(120, 140, 180, 0.35)',
        borderRadius: 8,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        pointerEvents: 'auto',
      }}
      data-audio-diagnostics-dashboard=""
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'rgba(30, 40, 60, 0.9)',
          borderBottom: collapsed ? 'none' : '1px solid rgba(120, 140, 180, 0.35)',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setCollapsed((v) => !v)}
      >
        <span style={{ fontWeight: 700, color: '#8bb7ff' }}>[audio:diagnostics]</span>
        <span style={{ opacity: 0.65 }}>{collapsed ? '▸' : '▾'}</span>
      </div>
      {!collapsed && (
        <div style={{ padding: '8px 10px', overflowY: 'auto', maxHeight: 'calc(80vh - 40px)' }}>
          {/* Recovery Summary */}
          <Section title="Recovery Summary">
            <Row k="Total" v={String(recovery.totalRecoveries)} />
            <Row k="Success" v={String(recovery.successCount)} tone="success" />
            <Row k="Failed" v={String(recovery.failedCount)} tone={recovery.failedCount > 0 ? 'danger' : undefined} />
            <Row k="Skipped" v={String(recovery.skippedCount)} tone="dim" />
            <Row k="Escalations" v={String(recovery.escalationCount)} tone={recovery.escalationCount > 0 ? 'danger' : undefined} />
            <Row k="Cooldown" v={recovery.currentCooldownMs > 0 ? fmtMs(recovery.currentCooldownMs) : 'idle'} tone={recovery.currentCooldownMs > 0 ? 'warning' : 'dim'} />
          </Section>

          {/* Health Summary — recovery reason counts */}
          <Section title="Health Summary">
            {HEALTH_REASONS.map((r) => (
              <Row
                key={r}
                k={r}
                v={String(recovery.perReasonCounts[r] ?? 0)}
                tone={(recovery.perReasonCounts[r] ?? 0) > 0 ? 'warning' : 'dim'}
              />
            ))}
          </Section>

          {/* LongRun Summary */}
          <Section title="LongRun Summary">
            <Row k="Active" v={longRun.active ? 'ON' : 'off'} tone={longRun.active ? 'success' : 'dim'} />
            {longRun.active && (
              <>
                <Row k="Elapsed" v={fmtMs(longRun.elapsedMs)} />
                <Row k="Ticks" v={String(longRun.ticks)} />
                <Row k="TrackTx" v={String(longRun.trackTransitions)} />
                <Row k="HealthIssue" v={String(longRun.healthIssueCount)} tone={longRun.healthIssueCount > 0 ? 'warning' : 'dim'} />
              </>
            )}
            <Row k="Memory used" v={fmtMemMB(longRun.memory?.usedJSHeapSize)} />
            <Row k="Memory total" v={fmtMemMB(longRun.memory?.totalJSHeapSize)} />
            <Row k="Heap limit" v={fmtMemMB(longRun.memory?.jsHeapSizeLimit)} tone="dim" />
          </Section>

          {/* Audio Summary */}
          <Section title="Audio Summary">
            <Row k="Active slot" v={audio.activeIdx === 0 ? 'A' : 'B'} />
            <Row k="Inactive slot" v={audio.activeIdx === 0 ? 'B' : 'A'} tone="dim" />
            <Row k="Current track" v={audio.currentTrackTitle ?? audio.currentTrackId ?? '—'} />
            <Row k="Current sink" v={shortId(audio.activeSinkId)} tone={!audio.activeSinkId ? 'dim' : undefined} />
            <Row k="Desired sink" v={shortId(audio.desiredSinkId ?? '')} tone={audio.desiredSinkId ? undefined : 'dim'} />
            <Row k="Sink ready" v={audio.sinkReady ? 'yes' : 'no'} tone={audio.sinkReady ? 'success' : 'warning'} />
            <Row k="Crossfade" v={audio.crossfadeInProgress ? 'in progress' : 'idle'} tone={audio.crossfadeInProgress ? 'warning' : 'dim'} />
            <Row k="Playing" v={audio.playing ? 'yes' : 'no'} tone={audio.playing ? 'success' : 'dim'} />
            <Row k="Active ct" v={`${audio.activeCurrentTime.toFixed(1)} / ${audio.activeDuration ? audio.activeDuration.toFixed(1) : '—'}`} />
            <Row k="Active paused" v={audio.activePaused ? 'true' : 'false'} tone={audio.activePaused && audio.playing ? 'danger' : 'dim'} />
            <Row k="Inactive paused" v={audio.inactivePaused ? 'true' : 'false'} tone={!audio.inactivePaused && !audio.crossfadeInProgress ? 'danger' : 'dim'} />
            <Row k="Active vol" v={audio.activeVolume.toFixed(2)} />
            <Row k="Inactive vol" v={audio.inactiveVolume.toFixed(2)} tone="dim" />
          </Section>

          {/* Lifecycle / Memory (Phase 5-1) */}
          {lifecycle && (
            <Section title={`Lifecycle & Memory${lifecycle.potentialLeaks.length > 0 ? ' ⚠' : ''}`}>
              <Row k="Elapsed" v={fmtMs(lifecycle.elapsedMs)} />
              <Row k="Mounted audio" v={String(lifecycle.mountedAudioCount)} tone={lifecycle.mountedAudioCount === 2 ? 'success' : 'warning'} />
              <Row k="Active obj" v={shortId(lifecycle.activeAudioObjectId)} />
              <Row k="Inactive obj" v={shortId(lifecycle.inactiveAudioObjectId)} tone="dim" />
              <Row k="rAF active" v={lifecycle.rAFActive ? 'yes' : 'no'} tone={lifecycle.rAFActive && !lifecycle.crossfadeInProgress ? 'danger' : 'dim'} />
              <Row k="Timeout active" v={lifecycle.timeoutActive ? 'yes' : 'no'} tone={lifecycle.timeoutActive && !lifecycle.crossfadeInProgress ? 'danger' : 'dim'} />
              <Row k="LongRun active" v={lifecycle.longRunActive ? 'ON' : 'off'} tone={lifecycle.longRunActive ? 'success' : 'dim'} />
              <Row k="Dashboard active" v={lifecycle.dashboardActive ? 'yes' : 'no'} tone={lifecycle.dashboardActive ? 'success' : 'dim'} />
              <Row k="Heap used" v={fmtMemMB(lifecycle.heapUsedBytes)} tone={lifecycle.heapUsedBytes === 0 ? 'dim' : undefined} />
              <Row k="Heap growth" v={fmtMemMB(lifecycle.heapGrowthFromStartBytes)} tone={lifecycle.heapGrowthFromStartBytes > 150 * 1024 * 1024 ? 'danger' : lifecycle.heapGrowthFromStartBytes > 50 * 1024 * 1024 ? 'warning' : 'dim'} />
              <Row k="Listener attach" v={String(lifecycle.listenerAttachCount)} />
              <Row k="Listener detach" v={String(lifecycle.listenerDetachCount)} />
              <Row k="Listener diff" v={String(lifecycle.listenerDiff)} tone={lifecycle.listenerDiff > 4 ? 'danger' : lifecycle.listenerDiff > 0 ? 'warning' : 'success'} />
              {lifecycle.potentialLeaks.length > 0 && (
                <div style={{ marginTop: 4, padding: '3px 6px', background: 'rgba(255, 90, 90, 0.15)', borderRadius: 3, color: '#f88', fontSize: 10 }}>
                  ⚠ {lifecycle.potentialLeaks.join(' · ')}
                </div>
              )}
            </Section>
          )}

          {/* Recovery History */}
          <Section title={`Recovery History (${history.length})`}>
            {history.length === 0 ? (
              <div style={{ opacity: 0.5, padding: '3px 0' }}>—</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {history.slice().reverse().map((h, i) => (
                  <div key={i} style={{ display: 'flex', gap: 6, justifyContent: 'space-between' }}>
                    <span style={{ opacity: 0.55, minWidth: 42 }}>{fmtTs(h.ts)}</span>
                    <span style={{ flex: 1, color: h.outcome === 'success' ? '#7fdc98' : h.outcome === 'failed' ? '#f88' : '#c8c8c8' }}>
                      {h.reason}
                    </span>
                    <span style={{ opacity: 0.6 }}>{h.outcome}</span>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        fontSize: 9.5,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: '#7fa1cb',
        marginBottom: 3,
        fontWeight: 700,
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'success' | 'warning' | 'danger' | 'dim' }): JSX.Element {
  const color =
    tone === 'success' ? '#7fdc98' :
    tone === 'warning' ? '#f7c66b' :
    tone === 'danger'  ? '#f88' :
    tone === 'dim'     ? '#7a8595' :
    '#e2e6ef';
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '1px 0' }}>
      <span style={{ opacity: 0.7 }}>{k}</span>
      <span style={{ color, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );
}
