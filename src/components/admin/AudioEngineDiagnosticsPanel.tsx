/**
 * AudioEngineDiagnosticsPanel — Phase 7-1 · Phase 7-2 QA Hardening.
 *
 * 목적:
 *   Player 내부 Debug Overlay 로 확인하던 audio engine 진단 정보를 관리자
 *   전용 패널로 승격 + 운영 QA 정확도를 강화. 브라우저 세션 로컬 · super
 *   admin 전용 · read-only.
 *
 * 특징:
 *   • DB / API 사용 안 함 · Player 재생 로직 무변경
 *   • Player Dashboard 가 발행한 snapshot 을 subscribe 하여 표시
 *   • Debug/LongRun/BurnIn target 토글 (localStorage) · 두 종류 preset
 *   • QA Checklist (7 항목) · snapshot stale 감지
 *   • 3 종 JSON 복사 (Burn-in / Full snapshot / localStorage flags)
 *
 * 사용법:
 *   1. Controls 에서 "Debug QA preset" 클릭 (또는 각 flag 개별 토글)
 *   2. 매장 플레이어(StorePlayer) 를 열고 새로고침
 *   3. Player Dashboard 가 snapshot 을 publish → 이 패널에서 read-only 표시
 *   4. QA 완료 후 "Production quiet preset" 으로 flag 해제
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Activity, RefreshCw, ClipboardCopy, Trash2, Play, Info,
  CheckCircle2, XCircle, ShieldOff, Wand2,
} from 'lucide-react';
import { audioDebugWarn } from '@/lib/audioDebug';
import { useAudioDiagnosticsStore } from '@/store/audioDiagnosticsStore';
import { toast } from '@/store/toastStore';
import { adminTones } from '@/lib/adminTones';
import type { BurnInSummary } from '@/hooks/useAudioBurnInCertification';

const KEY_DEBUG = 'deudda.audioDebug';
const KEY_LONGRUN = 'deudda.audioLongRun';
const KEY_BURNIN_HOURS = 'deudda.audioBurnInHours';
/** Snapshot 이 이 값보다 오래되면 stale 로 간주 (Dashboard 는 1s tick 이므로 3s 여유). */
const SNAPSHOT_STALE_MS = 3000;

function readFlag(key: string): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem(key) === '1';
  } catch { return false; }
}

function readBurnInHours(): '12' | '24' {
  try {
    const raw = window.localStorage?.getItem(KEY_BURNIN_HOURS);
    if (raw === '24') return '24';
  } catch { /* silent */ }
  return '12';
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtMemMB(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—';
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function fmtTs(ts: number): string {
  const rel = ts - performance.now();
  return rel > -1000 ? 'now' : `${Math.round(-rel / 1000)}s ago`;
}

export default function AudioEngineDiagnosticsPanel(): JSX.Element {
  const snapshot = useAudioDiagnosticsStore((s) => s.snapshot);
  const resetSnapshot = useAudioDiagnosticsStore((s) => s.reset);
  const [debugOn, setDebugOn] = useState<boolean>(() => readFlag(KEY_DEBUG));
  const [longRunOn, setLongRunOn] = useState<boolean>(() => readFlag(KEY_LONGRUN));
  const [burnInHours, setBurnInHours] = useState<'12' | '24'>(() => readBurnInHours());
  const [burnInJsonPreview, setBurnInJsonPreview] = useState<string>('');
  // Phase 7-2 — snapshot age 표시용 소량 tick (패널 mount 시에만 · unmount 시 정리).
  // 새 audio interval 아님 · Player 로직과 무관.
  const [nowTick, setNowTick] = useState<number>(() => performance.now());
  useEffect(() => {
    const iv = window.setInterval(() => setNowTick(performance.now()), 1000);
    return () => window.clearInterval(iv);
  }, []);

  useEffect(() => {
    audioDebugWarn('[audio:admin-diagnostics:mount]', {
      hasSnapshot: !!snapshot,
      debugOn, longRunOn, burnInHours,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Phase 7-2 — snapshot 상태 3-state 판정.
  const snapshotAgeMs = snapshot ? nowTick - snapshot.publishedAt : Infinity;
  const snapshotStale = snapshot !== null && snapshotAgeMs > SNAPSHOT_STALE_MS;
  const snapshotFresh = snapshot !== null && !snapshotStale;
  const anyFlagOn = debugOn || longRunOn;
  const hasWindowBurnIn = typeof window !== 'undefined' &&
    typeof (window as unknown as { __audioBurnIn?: unknown }).__audioBurnIn === 'function';

  // Phase 7-2 — [audio:admin-diagnostics:qa-check] 는 상태가 변할 때만 log.
  useEffect(() => {
    audioDebugWarn('[audio:admin-diagnostics:qa-check]', {
      debugOn, longRunOn, burnInHours,
      hasSnapshot: !!snapshot,
      snapshotStale,
      hasWindowBurnIn,
      quietMode: !anyFlagOn,
    });
    // nowTick 은 의도적으로 dep 에서 제외 — 매초 log 폭주 방지.
  }, [debugOn, longRunOn, burnInHours, snapshot, snapshotStale, hasWindowBurnIn, anyFlagOn]);

  useEffect(() => {
    if (!snapshot) return;
    audioDebugWarn('[audio:admin-diagnostics:update]', {
      status: snapshot.burnIn?.status ?? 'n/a',
      sessionState: snapshot.session?.currentState ?? 'n/a',
      totalRecoveries: snapshot.recovery.totalRecoveries,
    });
  }, [snapshot]);

  const applyFlag = useCallback((key: string, value: boolean) => {
    try {
      if (value) window.localStorage.setItem(key, '1');
      else window.localStorage.removeItem(key);
    } catch { /* silent */ }
  }, []);

  const onToggleDebug = () => {
    const next = !debugOn;
    setDebugOn(next);
    applyFlag(KEY_DEBUG, next);
  };
  const onToggleLongRun = () => {
    const next = !longRunOn;
    setLongRunOn(next);
    applyFlag(KEY_LONGRUN, next);
  };
  const onChangeBurnInHours = (v: '12' | '24') => {
    setBurnInHours(v);
    try { window.localStorage.setItem(KEY_BURNIN_HOURS, v); } catch { /* silent */ }
  };
  const onClearAll = () => {
    try {
      window.localStorage.removeItem(KEY_DEBUG);
      window.localStorage.removeItem(KEY_LONGRUN);
      window.localStorage.removeItem(KEY_BURNIN_HOURS);
    } catch { /* silent */ }
    setDebugOn(false); setLongRunOn(false); setBurnInHours('12');
    resetSnapshot();
    toast.success('진단 flag 를 초기화했어요. 새로고침 필요.');
  };
  const onReloadHint = () => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  // Phase 7-2 — Preset: Debug QA (audioDebug + audioLongRun + burnInHours=24).
  const applyQAPreset = () => {
    try {
      window.localStorage.setItem(KEY_DEBUG, '1');
      window.localStorage.setItem(KEY_LONGRUN, '1');
      window.localStorage.setItem(KEY_BURNIN_HOURS, '24');
    } catch { /* silent */ }
    setDebugOn(true); setLongRunOn(true); setBurnInHours('24');
    audioDebugWarn('[audio:admin-diagnostics:preset]', { kind: 'debug-qa', apply: { audioDebug: '1', audioLongRun: '1', audioBurnInHours: '24' } });
    toast.success('Debug QA preset 적용. 매장 플레이어 세션을 새로고침해 주세요.');
  };
  // Phase 7-2 — Preset: Production quiet (audioDebug + audioLongRun 제거).
  // audioBurnInHours 는 로그를 유발하지 않으므로 유지 (기존 정책 유지).
  const applyProductionQuietPreset = () => {
    try {
      window.localStorage.removeItem(KEY_DEBUG);
      window.localStorage.removeItem(KEY_LONGRUN);
    } catch { /* silent */ }
    setDebugOn(false); setLongRunOn(false);
    resetSnapshot();
    audioDebugWarn('[audio:admin-diagnostics:preset]', { kind: 'production-quiet', apply: { audioDebug: 'removed', audioLongRun: 'removed', audioBurnInHours: 'kept' } });
    toast.success('Production quiet preset 적용. 새로고침 후 콘솔이 조용해집니다.');
  };

  const buildBurnInJson = useCallback((): string | null => {
    // 우선순위 1: 현재 브라우저 세션의 window.__audioBurnIn() (Player 가 열려 있으면 즉시 최신).
    try {
      const w = window as unknown as { __audioBurnIn?: () => BurnInSummary | null };
      if (typeof w.__audioBurnIn === 'function') {
        const s = w.__audioBurnIn();
        if (s) return JSON.stringify(s, null, 2);
      }
    } catch { /* fallthrough */ }
    // 우선순위 2: 최근 store snapshot 의 burnIn.
    if (snapshot?.burnIn) return JSON.stringify(snapshot.burnIn, null, 2);
    return null;
  }, [snapshot]);

  const onCopyBurnIn = async () => {
    const json = buildBurnInJson();
    if (!json) {
      toast.warning('아직 burn-in 데이터가 없어요. audioLongRun 을 켜고 매장 플레이어를 열어 주세요.');
      return;
    }
    try {
      await navigator.clipboard.writeText(json);
      audioDebugWarn('[audio:admin-diagnostics:copy]', { bytes: json.length });
      audioDebugWarn('[audio:admin-diagnostics:export]', { kind: 'burnin', bytes: json.length });
      toast.success('Burn-in JSON 을 클립보드에 복사했어요.');
    } catch {
      // Fallback — 화면에 표시.
      setBurnInJsonPreview(json);
      toast.warning('클립보드 접근 실패 · 아래에서 수동 복사해 주세요.');
    }
  };
  const onShowBurnInJson = () => {
    const json = buildBurnInJson();
    setBurnInJsonPreview(json ?? '');
    if (!json) toast.warning('아직 burn-in 데이터가 없어요.');
  };

  // Phase 7-2 — Full diagnostics snapshot JSON.
  const buildFullSnapshotJson = useCallback((): string | null => {
    if (!snapshot) return null;
    return JSON.stringify(
      { ...snapshot, snapshotAgeMs: nowTick - snapshot.publishedAt, snapshotStale, capturedAtTick: nowTick },
      null, 2,
    );
  }, [snapshot, nowTick, snapshotStale]);

  const onCopyFullSnapshot = async () => {
    const json = buildFullSnapshotJson();
    if (!json) {
      toast.warning('Snapshot 이 없어요. Debug 를 켜고 매장 플레이어를 열어 주세요.');
      return;
    }
    try {
      await navigator.clipboard.writeText(json);
      audioDebugWarn('[audio:admin-diagnostics:export]', { kind: 'full-snapshot', bytes: json.length });
      toast.success('Full snapshot JSON 을 복사했어요.');
    } catch {
      setBurnInJsonPreview(json);
      toast.warning('클립보드 접근 실패 · 아래에서 수동 복사해 주세요.');
    }
  };

  // Phase 7-2 — localStorage diagnostics flags JSON.
  const buildFlagsJson = useCallback((): string => {
    let raw: { audioDebug: string | null; audioLongRun: string | null; audioBurnInHours: string | null } = {
      audioDebug: null, audioLongRun: null, audioBurnInHours: null,
    };
    try {
      raw = {
        audioDebug: window.localStorage.getItem(KEY_DEBUG),
        audioLongRun: window.localStorage.getItem(KEY_LONGRUN),
        audioBurnInHours: window.localStorage.getItem(KEY_BURNIN_HOURS),
      };
    } catch { /* silent */ }
    return JSON.stringify({
      keys: { KEY_DEBUG, KEY_LONGRUN, KEY_BURNIN_HOURS },
      values: raw,
      derived: {
        debugOn: raw.audioDebug === '1',
        longRunOn: raw.audioLongRun === '1',
        burnInHours: raw.audioBurnInHours === '24' ? '24' : '12',
        quietMode: raw.audioDebug !== '1' && raw.audioLongRun !== '1',
      },
    }, null, 2);
  }, []);

  const onCopyFlags = async () => {
    const json = buildFlagsJson();
    try {
      await navigator.clipboard.writeText(json);
      audioDebugWarn('[audio:admin-diagnostics:export]', { kind: 'flags', bytes: json.length });
      toast.success('Diagnostics flags JSON 을 복사했어요.');
    } catch {
      setBurnInJsonPreview(json);
      toast.warning('클립보드 접근 실패 · 아래에서 수동 복사해 주세요.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Activity size={16} className={adminTones.info.icon} />
        <h2 className="text-base font-semibold text-neutral-100">오디오 엔진 진단 (Audio Engine Diagnostics)</h2>
      </div>
      <p className="text-xs text-neutral-400">
        매장 플레이어의 Recovery / Health / Session / Invalid State / Burn-in 상태를 관리자 전용으로 확인.
        DB / API 없이 브라우저 세션 로컬 상태만 사용. Debug OFF 세션에는 무영향.
      </p>

      {/* Phase 7-2 — QA Checklist */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
        <div className="text-sm font-medium text-neutral-100">QA Checklist</div>
        <ChecklistRow ok={debugOn} label="audioDebug ON" hint="콘솔 진단 로그 · Debug Overlay 활성" />
        <ChecklistRow ok={longRunOn} label="audioLongRun ON" hint="LongRun · Burn-in Certification 활성" />
        <ChecklistRow
          ok
          label={`audioBurnInHours 감지 = ${burnInHours}`}
          hint={burnInHours === '24' ? '24h target 저장됨' : '12h target 저장됨 (기본값 또는 명시)'}
          neutralOk
        />
        <ChecklistRow
          ok={snapshotFresh}
          label={snapshot ? (snapshotStale ? 'Player snapshot stale' : 'Player snapshot 수신 중') : 'Player snapshot 없음'}
          hint={snapshot ? `Last publish ${fmtTs(snapshot.publishedAt)} · age ${fmtMs(snapshotAgeMs)} · stale > ${fmtMs(SNAPSHOT_STALE_MS)}` : anyFlagOn ? '매장 플레이어를 열고 새로고침해 주세요.' : 'audioDebug 또는 audioLongRun 을 켠 뒤 매장 플레이어를 여세요.'}
        />
        <ChecklistRow
          ok={hasWindowBurnIn}
          label="__audioBurnIn() 사용 가능"
          hint={hasWindowBurnIn ? 'Player 세션이 같은 브라우저 세션에 등록되어 있음.' : '동일 브라우저에서 매장 플레이어가 열려 있어야 등록됨.'}
        />
        <ChecklistRow
          ok={!anyFlagOn}
          label="Production quiet 상태"
          hint={anyFlagOn ? 'Debug/LongRun 이 켜져 있어요. QA 종료 시 Production quiet preset 을 적용하세요.' : '콘솔 조용 · Dashboard/패널 침묵 상태.'}
          neutralOk
        />
        <ChecklistRow
          ok
          label="Last snapshot age"
          hint={snapshot ? `${fmtMs(snapshotAgeMs)} (${snapshotStale ? 'STALE' : 'fresh'})` : 'no snapshot'}
          neutralOk
        />
      </section>

      {/* Controls */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-100">
          <span>Controls</span>
        </div>
        {/* Phase 7-2 — Preset buttons */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={applyQAPreset}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.success.buttonSolid}`}
          >
            <Wand2 size={13} /> Debug QA preset (debug + longRun + 24h)
          </button>
          <button
            type="button"
            onClick={applyProductionQuietPreset}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.neutral.buttonSolid}`}
          >
            <ShieldOff size={13} /> Production quiet preset (flag off)
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" checked={debugOn} onChange={onToggleDebug} className="accent-sky-400" />
            <span>audioDebug (콘솔 진단 로그 · Debug Overlay 표시)</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" checked={longRunOn} onChange={onToggleLongRun} className="accent-sky-400" />
            <span>audioLongRun (LongRun · Burn-in Certification 활성)</span>
          </label>
          <div className="flex items-center gap-2 text-sm text-neutral-200">
            <span>Burn-in target</span>
            <select
              value={burnInHours}
              onChange={(e) => onChangeBurnInHours(e.target.value as '12' | '24')}
              className="rounded bg-neutral-900 border border-neutral-700 px-2 py-1 text-sm text-neutral-100"
            >
              <option value="12">12h</option>
              <option value="24">24h</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={onReloadHint}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.info.buttonGhost}`}
          >
            <RefreshCw size={13} /> 새로고침 (변경 적용)
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.danger.buttonGhost}`}
          >
            <Trash2 size={13} /> 진단 flag 초기화
          </button>
        </div>
        <div className="rounded-md border border-neutral-800 bg-neutral-900/50 p-2.5 text-xs text-neutral-400 flex items-start gap-2">
          <Info size={13} className={`${adminTones.info.icon} mt-0.5 shrink-0`} />
          <div>
            <div>1. audioDebug + audioLongRun 을 켠 뒤 새로고침.</div>
            <div>2. 매장 플레이어(StorePlayer) 를 열면 이 패널에서 Session / Recovery / Invalid State / Burn-in 이 실시간 표시.</div>
            <div>3. Burn-in JSON 은 아래 Export 섹션 또는 콘솔 <code className="text-sky-300">__audioBurnIn()</code>.</div>
          </div>
        </div>
      </section>

      {/* Snapshot */}
      {!snapshot ? (
        <section className={`rounded-lg border p-4 text-sm ${
          !anyFlagOn ? 'border-neutral-800 bg-neutral-950/60 text-neutral-400'
          : 'border-amber-500/40 bg-amber-500/20 text-amber-100'
        }`}>
          {!anyFlagOn ? (
            <>Debug/LongRun 이 꺼져 있어요. 위 <b>Debug QA preset</b> 을 적용하거나 개별 toggle 후 새로고침해 주세요.</>
          ) : (
            <>flag 는 켜져 있지만 아직 Player Debug Overlay 로부터 snapshot 을 받지 못했어요.
              같은 브라우저에서 <b>매장 플레이어(StorePlayer)</b> 를 여신 뒤 새로고침해 주세요.</>
          )}
        </section>
      ) : snapshotStale ? (
        <section className="rounded-lg border border-amber-500/40 bg-amber-500/20 p-4 text-sm text-amber-100 space-y-1">
          <div>Snapshot 이 <b>stale</b> 상태입니다. (age {fmtMs(snapshotAgeMs)} &gt; {fmtMs(SNAPSHOT_STALE_MS)})</div>
          <div className="text-xs opacity-80">매장 플레이어 탭이 닫혔거나 백그라운드일 수 있어요. 아래 정보는 마지막 발행 기준.</div>
        </section>
      ) : null}
      {snapshot && (
        <>
          {/* Current Session */}
          {snapshot.session && (
            <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
              <div className="text-sm font-medium text-neutral-100">Current Session</div>
              <KV k="State" v={snapshot.session.currentState} />
              <KV k="Previous" v={snapshot.session.previousState ?? '—'} />
              <KV k="In state for" v={fmtMs(snapshot.session.currentStateDurationMs)} />
              <KV k="Transitions" v={String(snapshot.session.transitionCount)} />
            </section>
          )}

          {/* Certification */}
          {snapshot.burnIn && (
            <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
              <div className="text-sm font-medium text-neutral-100">
                Certification {snapshot.burnIn.status === 'pass' ? '✓' : snapshot.burnIn.status === 'fail' ? '✗' : ''}
              </div>
              <KV k="Status" v={snapshot.burnIn.status} tone={
                snapshot.burnIn.status === 'pass' ? 'success'
                : snapshot.burnIn.status === 'fail' ? 'danger'
                : snapshot.burnIn.status === 'running' ? 'warning'
                : 'neutral'
              } />
              <KV k="Target" v={`${snapshot.burnIn.targetHours}h`} />
              <KV k="Progress" v={`${snapshot.burnIn.progressPct.toFixed(1)}%`} />
              <KV k="Elapsed" v={fmtMs(snapshot.burnIn.elapsedMs)} />
              <KV k="Recoveries" v={`${snapshot.burnIn.metrics.recoveries} (fail ${snapshot.burnIn.metrics.failedRecoveries})`} />
              <KV k="Escalations" v={String(snapshot.burnIn.metrics.escalations)} />
              <KV k="Invalid states" v={`${snapshot.burnIn.metrics.invalidStates} (corrected ${snapshot.burnIn.metrics.correctedInvalidStates})`} />
              <KV k="Listener diff" v={String(snapshot.burnIn.metrics.listenerDiff)} />
              <KV k="Heap growth" v={fmtMemMB(snapshot.burnIn.metrics.heapGrowthBytes)} />
              <KV k="Health rate" v={`${snapshot.burnIn.metrics.healthIssueRatePerHour.toFixed(2)}/h`} />
              <KV k="Track transitions" v={String(snapshot.burnIn.metrics.trackTransitions)} />
              {snapshot.burnIn.failReasons.length > 0 && (
                <div className={`mt-2 rounded px-2 py-1.5 text-xs ${adminTones.danger.badge}`}>
                  ✗ {snapshot.burnIn.failReasons.join(' · ')}
                </div>
              )}
              {snapshot.burnIn.warnings.length > 0 && (
                <div className={`mt-2 rounded px-2 py-1.5 text-xs ${adminTones.warning.badge}`}>
                  ⚠ {snapshot.burnIn.warnings.join(' · ')}
                </div>
              )}
            </section>
          )}

          {/* Recovery */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
            <div className="text-sm font-medium text-neutral-100">Recovery Summary</div>
            <KV k="Total" v={String(snapshot.recovery.totalRecoveries)} />
            <KV k="Success" v={String(snapshot.recovery.successCount)} tone={snapshot.recovery.successCount > 0 ? 'success' : 'neutral'} />
            <KV k="Failed" v={String(snapshot.recovery.failedCount)} tone={snapshot.recovery.failedCount > 0 ? 'danger' : 'neutral'} />
            <KV k="Skipped" v={String(snapshot.recovery.skippedCount)} />
            <KV k="Escalations" v={String(snapshot.recovery.escalationCount)} tone={snapshot.recovery.escalationCount > 0 ? 'danger' : 'neutral'} />
            <KV k="Cooldown" v={snapshot.recovery.currentCooldownMs > 0 ? fmtMs(snapshot.recovery.currentCooldownMs) : 'idle'} />
          </section>

          {/* Invalid State */}
          {snapshot.invalidState && (
            <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
              <div className="text-sm font-medium text-neutral-100">Invalid State</div>
              <KV k="Total invalid" v={String(snapshot.invalidState.totalInvalid)} tone={snapshot.invalidState.totalInvalid > 0 ? 'warning' : 'neutral'} />
              <KV k="Corrected" v={String(snapshot.invalidState.totalCorrected)} tone={snapshot.invalidState.totalCorrected > 0 ? 'success' : 'neutral'} />
              <KV k="Current issues" v={snapshot.invalidState.currentIssues.length > 0 ? snapshot.invalidState.currentIssues.join(', ') : 'none'} tone={snapshot.invalidState.currentIssues.length > 0 ? 'danger' : 'neutral'} />
              <KV k="Last issue" v={snapshot.invalidState.lastIssue ?? '—'} />
              <KV k="Last correction" v={snapshot.invalidState.lastCorrectionIssue ?? '—'} />
            </section>
          )}

          {/* Lifecycle */}
          {snapshot.lifecycle && (
            <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
              <div className="text-sm font-medium text-neutral-100">Lifecycle & Memory</div>
              <KV k="Elapsed" v={fmtMs(snapshot.lifecycle.elapsedMs)} />
              <KV k="Mounted audio" v={String(snapshot.lifecycle.mountedAudioCount)} />
              <KV k="Heap used" v={fmtMemMB(snapshot.lifecycle.heapUsedBytes)} />
              <KV k="Heap growth" v={fmtMemMB(snapshot.lifecycle.heapGrowthFromStartBytes)} />
              <KV k="Listener attach" v={String(snapshot.lifecycle.listenerAttachCount)} />
              <KV k="Listener detach" v={String(snapshot.lifecycle.listenerDetachCount)} />
              <KV k="Listener diff" v={String(snapshot.lifecycle.listenerDiff)} tone={snapshot.lifecycle.listenerDiff > 4 ? 'danger' : snapshot.lifecycle.listenerDiff > 0 ? 'warning' : 'success'} />
              {snapshot.lifecycle.potentialLeaks.length > 0 && (
                <div className={`mt-2 rounded px-2 py-1.5 text-xs ${adminTones.danger.badge}`}>
                  ⚠ {snapshot.lifecycle.potentialLeaks.join(' · ')}
                </div>
              )}
            </section>
          )}

          {/* LongRun */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
            <div className="text-sm font-medium text-neutral-100">LongRun Summary</div>
            <KV k="Active" v={snapshot.longRun.active ? 'ON' : 'off'} tone={snapshot.longRun.active ? 'success' : 'neutral'} />
            {snapshot.longRun.active && (
              <>
                <KV k="Elapsed" v={fmtMs(snapshot.longRun.elapsedMs)} />
                <KV k="Ticks" v={String(snapshot.longRun.ticks)} />
                <KV k="Track transitions" v={String(snapshot.longRun.trackTransitions)} />
                <KV k="Health issues" v={String(snapshot.longRun.healthIssueCount)} tone={snapshot.longRun.healthIssueCount > 0 ? 'warning' : 'neutral'} />
              </>
            )}
            <KV k="Published" v={fmtTs(snapshot.publishedAt)} />
          </section>

          {/* Recovery History */}
          <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-2">
            <div className="text-sm font-medium text-neutral-100">Recovery History ({snapshot.history.length})</div>
            {snapshot.history.length === 0 ? (
              <div className="text-xs text-neutral-500">기록 없음</div>
            ) : (
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {snapshot.history.slice().reverse().map((h, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 text-xs text-neutral-300">
                    <span className="text-neutral-500 min-w-16">{fmtTs(h.ts)}</span>
                    <span className="flex-1">{h.reason}</span>
                    <span className={h.outcome === 'success' ? adminTones.success.text : h.outcome === 'failed' ? adminTones.danger.text : adminTones.neutral.textMute}>
                      {h.outcome}
                    </span>
                    {h.sessionState && <span className="text-neutral-500">{h.sessionState}</span>}
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {/* Export */}
      <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-4 space-y-3">
        <div className="text-sm font-medium text-neutral-100">Export</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCopyBurnIn}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.info.buttonSolid}`}
          >
            <ClipboardCopy size={13} /> Burn-in JSON 복사
          </button>
          <button
            type="button"
            onClick={onCopyFullSnapshot}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.info.buttonGhost}`}
          >
            <ClipboardCopy size={13} /> Full snapshot JSON 복사
          </button>
          <button
            type="button"
            onClick={onCopyFlags}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.info.buttonGhost}`}
          >
            <ClipboardCopy size={13} /> Diagnostics flags 복사
          </button>
          <button
            type="button"
            onClick={onShowBurnInJson}
            className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium ${adminTones.neutral.buttonGhost}`}
          >
            <Play size={13} /> Burn-in JSON 미리보기
          </button>
        </div>
        {burnInJsonPreview && (
          <pre className="mt-2 max-h-80 overflow-auto rounded bg-neutral-900 p-2 text-[11px] text-neutral-200 leading-relaxed">
            {burnInJsonPreview}
          </pre>
        )}
        <p className="text-[11px] text-neutral-500">
          Player 세션이 열려 있으면 <code className="text-sky-300">window.__audioBurnIn()</code> 이 우선. 없으면 store snapshot fallback.
        </p>
      </section>
    </div>
  );
}

function KV({ k, v, tone = 'neutral' }: { k: string; v: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }): JSX.Element {
  const cls = tone === 'success' ? adminTones.success.text
    : tone === 'warning' ? adminTones.warning.text
    : tone === 'danger' ? adminTones.danger.text
    : tone === 'info' ? adminTones.info.text
    : adminTones.neutral.text;
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-neutral-400">{k}</span>
      <span className={`font-mono ${cls}`}>{v}</span>
    </div>
  );
}

/**
 * Phase 7-2 — QA Checklist row.
 * ok      : true 시 ✓ · false 시 ✗ 아이콘 표시
 * neutralOk : true 시 ok=true 여도 info tone 으로만 표시 (정보성 항목)
 */
function ChecklistRow({ ok, label, hint, neutralOk = false }: {
  ok: boolean; label: string; hint: string; neutralOk?: boolean;
}): JSX.Element {
  const iconCls = ok
    ? (neutralOk ? adminTones.info.icon : adminTones.success.icon)
    : adminTones.warning.icon;
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon size={14} className={`${iconCls} mt-0.5 shrink-0`} />
      <div className="min-w-0">
        <div className="text-neutral-100">{label}</div>
        <div className="text-neutral-500 text-[11px]">{hint}</div>
      </div>
    </div>
  );
}
