/**
 * AudioOutputSection — Phase 1 + Phase 2.
 *
 * Phase 1: 장치 선택 UI · 미지원 안내 · 3초 테스트음.
 * Phase 2 확장:
 *   • Connection Status Badge (🟢 연결 / 🟡 기본 / 🔴 제거)
 *   • Status Card (저장/적용/지원 여부/이벤트 요약)
 *   • User Actions (현재 장치 다시 적용 / 기본 출력 / 새로 검색)
 *   • Auto restore 는 AppShell 의 useAudioOutputAutoRestore 에서 담당.
 *
 * 새 DB / API / RPC / polling 도입 0. Enterprise 기존 기능 영향 0.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Headphones, RefreshCw, Volume2, AlertTriangle, ShieldAlert, Speaker,
  Circle, RotateCcw, Trash2, ListChecks, Eye, EyeOff, PhoneCall,
} from 'lucide-react';
import { useAudioOutputDevices } from '@/hooks/useAudioOutputDevices';
import { useAudioOutputStore, type AudioConnectionStatus } from '@/store/audioOutputStore';
import { playTestTone, type TestToneHandle, type AudioOutputDeviceKind } from '@/lib/audioOutput';
import { audioDebugWarn } from '@/lib/audioDebug';

export default function AudioOutputSection() {
  const {
    devices, loading, supportEnum, supportSink, needPermission, refresh, requestLabelPermission,
  } = useAudioOutputDevices();
  const sinkId = useAudioOutputStore((s) => s.sinkId);
  const sinkLabel = useAudioOutputStore((s) => s.sinkLabel);
  const savedAt = useAudioOutputStore((s) => s.savedAt);
  const lastAppliedAt = useAudioOutputStore((s) => s.lastAppliedAt);
  const effectiveSinkId = useAudioOutputStore((s) => s.effectiveSinkId);
  const connectionStatus = useAudioOutputStore((s) => s.connectionStatus);
  const setSink = useAudioOutputStore((s) => s.setSink);
  const resetToDefault = useAudioOutputStore((s) => s.resetToDefault);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [permBusy, setPermBusy] = useState(false);
  // Phase 2-2 hotfix — Windows communications 장치는 기본 UI 에서 숨긴다.
  const [showAdvanced, setShowAdvanced] = useState(false);
  const testHandleRef = useRef<TestToneHandle | null>(null);

  // 컴포넌트 unmount 시 테스트음 중지
  useEffect(() => {
    return () => { testHandleRef.current?.stop(); };
  }, []);

  const onChangeDevice = useCallback((deviceId: string) => {
    const dev = devices.find((d) => d.deviceId === deviceId);
    const selectedLabel = dev?.label ?? (deviceId === '' ? '(default)' : null);
    if (deviceId === '') {
      resetToDefault();
    } else {
      setSink(deviceId, dev?.label ?? null);
    }
    // Phase 2-6 진단 로그 A — UI 선택값이 store 와 localStorage 에 실제로 반영되는지 검증.
    let storageValue: string | null = null;
    try {
      storageValue = window.localStorage.getItem('deudda.audioOutput.v1');
    } catch { /* silent */ }
    audioDebugWarn('[audio:sink:ui-select]', {
      selectedLabel,
      selectedDeviceId: deviceId,
      storeSinkIdAfterSelect: useAudioOutputStore.getState().sinkId,
      storeSinkLabelAfterSelect: useAudioOutputStore.getState().sinkLabel,
      storageValue,
    });
  }, [devices, setSink, resetToDefault]);

  const onTest = useCallback(() => {
    if (testing) {
      testHandleRef.current?.stop();
      testHandleRef.current = null;
      setTesting(false);
      return;
    }
    setTestError(null);
    setTesting(true);
    const handle = playTestTone(sinkId, 3000);
    testHandleRef.current = handle;
    handle.finished.then(() => {
      setTesting(false);
      testHandleRef.current = null;
    }).catch((e) => {
      setTestError((e as Error).message);
      setTesting(false);
      testHandleRef.current = null;
    });
  }, [sinkId, testing]);

  const onRequestPermission = useCallback(async () => {
    setPermBusy(true);
    try { await requestLabelPermission(); }
    finally { setPermBusy(false); }
  }, [requestLabelPermission]);

  // Phase 2 — 저장된 sinkId 를 강제 재적용 (label 이 바뀌었을 수도 있으므로 최신 label 사용)
  const onReapply = useCallback(() => {
    if (!sinkId) return;
    const dev = devices.find((d) => d.deviceId === sinkId);
    // setSink 는 lastAppliedAt 을 갱신하므로 Player useEffect 가 재실행
    setSink(sinkId, dev?.label ?? sinkLabel);
  }, [sinkId, sinkLabel, devices, setSink]);

  // Hook rules — 모든 useMemo/useCallback 은 early return 이전에 호출한다.
  const commsCount = useMemo(() => devices.filter((d) => d.kind === 'communications').length, [devices]);
  const visibleDevices = useMemo(
    () => (showAdvanced ? devices : devices.filter((d) => d.kind !== 'communications')),
    [devices, showAdvanced],
  );

  // ============================================================
  // Unsupported browser
  // ============================================================
  if (!supportSink || !supportEnum) {
    return (
      <section className="space-y-2">
        <div className="flex items-end justify-between px-1">
          <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
            <Speaker size={14} /> 오디오 출력 장치
          </h2>
        </div>
        <div className="rounded-2xl bg-amber-500/25 p-4 ring-1 ring-amber-500/40">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/30 text-slate-900 dark:text-amber-100" aria-hidden>
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-slate-900 dark:text-amber-100">
                이 브라우저는 출력 장치 선택을 지원하지 않습니다.
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-slate-700 dark:text-amber-50/85">
                Chrome / Edge / Electron 환경에서만 USB DAC · HDMI · 외부 앰프 등을 매장 스피커 전용 출력으로 지정할 수 있습니다.
                Safari · Firefox 는 브라우저 정책상 미지원 — 크롬 계열 브라우저에서 재접속해 주세요.
              </p>
              <p className="mt-1 text-[10.5px] text-slate-700 dark:text-amber-50/70">
                자동으로 브라우저 기본 출력 장치를 사용합니다.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ============================================================
  // Supported
  // ============================================================
  const activeDevice = devices.find((d) => d.deviceId === sinkId) ?? null;
  const activeLabel = activeDevice?.label ?? sinkLabel ?? '기본 장치';
  const badge = connectionBadge(connectionStatus);
  const activeKind: AudioOutputDeviceKind | null = activeDevice?.kind ?? (sinkId ? null : 'default');
  const activeIsComms = activeKind === 'communications';

  return (
    <section className="space-y-2">
      <div className="flex items-end justify-between px-1">
        <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-tight">
          <Speaker size={14} /> 오디오 출력 장치
        </h2>
        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-ink-mute hover:text-ink"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> 새로고침
        </button>
      </div>

      <div className="rounded-2xl bg-bg-card p-3 ring-1 ring-line/10">
        {/* 현재 출력 장치 표시 + Phase 2 Connection Badge */}
        <div className={`flex items-center gap-2 rounded-xl p-2.5 ring-1 transition ${badge.bg} ${badge.ring}`}>
          <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${badge.chip}`} aria-hidden>
            <Headphones size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-[10px] font-bold uppercase tracking-wider ${badge.textLabel}`}>현재 출력</p>
            <p className="mt-0.5 truncate text-[13px] font-bold text-ink" title={activeLabel}>
              {connectionStatus === 'disconnected'
                ? `${sinkLabel ?? '저장된 장치'} (연결 안됨)`
                : activeLabel}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9.5px] font-bold ring-1 ${badge.chip}`}>
            <Circle size={7} className={badge.dot} fill="currentColor" />
            {badge.label}
          </span>
        </div>

        {/* 권한 안내 */}
        {needPermission && (
          <div className="mt-2 rounded-xl bg-sky-500/20 p-2.5 ring-1 ring-sky-500/40">
            <div className="flex items-start gap-2">
              <ShieldAlert size={14} className="mt-0.5 shrink-0 text-slate-900 dark:text-sky-200" />
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-bold text-slate-900 dark:text-sky-100">장치 이름을 표시하려면 권한이 필요합니다.</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-slate-700 dark:text-sky-50/85">
                  브라우저 정책상 마이크 권한을 임시로 확인한 후에만 스피커/USB 이름이 노출됩니다. 마이크는 실제로 사용하지 않습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onRequestPermission()}
                disabled={permBusy}
                className="shrink-0 rounded-md bg-sky-500/40 px-2.5 py-1 text-[10.5px] font-bold text-slate-900 dark:text-sky-50 ring-1 ring-sky-400/60 transition hover:bg-sky-500/50 disabled:opacity-60"
              >
                {permBusy ? '요청 중…' : '권한 허용'}
              </button>
            </div>
          </div>
        )}

        {/* 장치 선택 dropdown */}
        <div className="mt-3 space-y-1.5">
          <div className="flex items-end justify-between gap-2">
            <label className="block text-[11px] font-semibold text-ink-mute" htmlFor="audio-output-select">
              출력 장치 선택
            </label>
            {commsCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="inline-flex items-center gap-1 rounded-md bg-bg-soft px-1.5 py-0.5 text-[9.5px] font-semibold text-ink-mute ring-1 ring-line/15 transition hover:bg-bg-hover hover:text-ink"
                title={showAdvanced
                  ? '커뮤니케이션 장치를 숨깁니다'
                  : `${commsCount}개의 커뮤니케이션(통화용) 장치가 숨겨져 있습니다`}
              >
                {showAdvanced ? <EyeOff size={10} /> : <Eye size={10} />}
                {showAdvanced ? '통화용 숨김' : `고급 (+${commsCount})`}
              </button>
            )}
          </div>
          <select
            id="audio-output-select"
            value={sinkId ?? ''}
            onChange={(e) => onChangeDevice(e.target.value)}
            className="w-full appearance-none rounded-lg bg-bg-soft px-3 py-2 text-[12px] text-ink ring-1 ring-line/20 outline-none focus:ring-accent/60"
          >
            <option value="">기본 장치 (Windows 기본 출력)</option>
            {visibleDevices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
                {d.deviceId === 'default' ? ' · default' : ''}
                {d.kind === 'communications' ? ' · ⚠ 통화용' : ''}
              </option>
            ))}
          </select>

          {/* Phase 2-2 hotfix — 커뮤니케이션 장치 선택 시 인라인 경고 */}
          {activeIsComms && (
            <div className="mt-1.5 rounded-lg bg-amber-500/20 p-2 ring-1 ring-amber-500/40">
              <div className="flex items-start gap-1.5">
                <PhoneCall size={12} className="mt-0.5 shrink-0 text-slate-900 dark:text-amber-200" />
                <div className="min-w-0 text-[10.5px] leading-relaxed">
                  <p className="font-bold text-slate-900 dark:text-amber-100">
                    커뮤니케이션 장치는 통화/알림용 장치입니다.
                  </p>
                  <p className="mt-0.5 text-slate-700 dark:text-amber-50/85">
                    매장 BGM 출력에는 권장하지 않습니다. 새로고침 시 같은 물리 장치의 일반 출력으로 자동 보정됩니다.
                  </p>
                </div>
              </div>
            </div>
          )}

          <p className="text-[10px] leading-relaxed text-ink-dim">
            매장 스피커 전용 출력으로 지정하면 매장 운영 프로그램(주문/결제/알림)의 소리와 완전히 분리됩니다.
            선택 즉시 재생 중인 곡에도 적용되고, 앱 재실행 후에도 자동 복원됩니다.
          </p>
        </div>

        {/* Test button */}
        <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-bg-soft px-3 py-2 ring-1 ring-line/15">
          <div className="flex items-center gap-2">
            <Volume2 size={13} className="text-ink-mute" />
            <p className="text-[11px] text-ink">
              3초 테스트음 (440Hz) 을 선택한 장치로 재생합니다.
            </p>
          </div>
          <button
            type="button"
            onClick={onTest}
            className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-bold ring-1 transition ${
              testing
                ? 'bg-rose-500/40 text-slate-900 dark:text-rose-50 ring-rose-400/60 hover:bg-rose-500/50'
                : 'bg-emerald-500/40 text-slate-900 dark:text-emerald-50 ring-emerald-400/60 hover:bg-emerald-500/50'
            }`}
          >
            <Volume2 size={11} /> {testing ? '중지' : '테스트'}
          </button>
        </div>

        {testError && (
          <p className="mt-2 rounded-md bg-rose-500/25 px-2 py-1 text-[10.5px] text-slate-900 dark:text-rose-100 ring-1 ring-rose-500/45">
            테스트음 실패: {testError}
          </p>
        )}

        {devices.length === 0 && !loading && (
          <p className="mt-2 rounded-md bg-bg-soft px-2 py-1.5 text-[10.5px] text-ink-mute ring-1 ring-line/15">
            감지된 출력 장치가 없습니다. USB DAC / HDMI / 블루투스 스피커 연결 후 새로고침을 눌러 주세요.
          </p>
        )}

        {/* Phase 2 spec 10 — User Actions */}
        <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
          <ActionBtn
            icon={<RotateCcw size={11} />}
            label="현재 장치 다시 적용"
            onClick={onReapply}
            disabled={!sinkId}
          />
          <ActionBtn
            icon={<Trash2 size={11} />}
            label="기본 출력으로 변경"
            onClick={() => resetToDefault()}
            disabled={!sinkId}
          />
          <ActionBtn
            icon={<ListChecks size={11} />}
            label="장치 새로 검색"
            onClick={() => void refresh()}
          />
        </div>

        {/* Phase 2 spec 9 — Diagnostics */}
        <DiagnosticsCard
          sinkId={sinkId}
          sinkLabel={sinkLabel}
          savedAt={savedAt}
          lastAppliedAt={lastAppliedAt}
          effectiveSinkId={effectiveSinkId}
          supportEnum={supportEnum}
          supportSink={supportSink}
          connectionStatus={connectionStatus}
          deviceCount={devices.length}
          commsCount={commsCount}
          activeKind={activeKind}
        />
      </div>
    </section>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ActionBtn({ icon, label, onClick, disabled }: {
  icon: JSX.Element; label: string; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-start gap-1.5 rounded-lg bg-bg-soft px-2.5 py-1.5 text-[11px] font-semibold text-ink ring-1 ring-line/20 transition hover:bg-bg-hover hover:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <span className="text-slate-900 dark:text-violet-200">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function DiagnosticsCard({
  sinkId, sinkLabel, savedAt, lastAppliedAt, effectiveSinkId, supportEnum, supportSink, connectionStatus, deviceCount,
  commsCount, activeKind,
}: {
  sinkId: string | null; sinkLabel: string | null;
  savedAt: string | null; lastAppliedAt: string | null; effectiveSinkId: string | null;
  supportEnum: boolean; supportSink: boolean;
  connectionStatus: AudioConnectionStatus; deviceCount: number;
  commsCount: number; activeKind: AudioOutputDeviceKind | null;
}) {
  const kindTone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' =
    activeKind === 'physical'       ? 'success'
    : activeKind === 'communications' ? 'danger'
    : activeKind === 'default'        ? 'info'
    : 'neutral';
  const kindLabel =
    activeKind === 'physical'       ? '일반 장치 (권장)'
    : activeKind === 'communications' ? '커뮤니케이션 ⚠'
    : activeKind === 'default'        ? '기본 출력'
    : '—';
  const rows = useMemo(() => [
    { label: 'setSinkId',      value: supportSink ? '지원'   : '미지원',  tone: supportSink ? 'success' : 'danger'   as const },
    { label: 'enumerateDevices', value: supportEnum ? '지원' : '미지원',  tone: supportEnum ? 'success' : 'danger'   as const },
    { label: 'devicechange',   value: supportEnum ? '구독 중' : '미지원', tone: supportEnum ? 'success' : 'neutral'  as const },
    { label: '연결 상태',      value: statusLabelKo(connectionStatus),   tone: statusTone(connectionStatus) },
    { label: '장치 종류',      value: kindLabel,                            tone: kindTone },
    { label: '감지된 장치',    value: `${deviceCount} 개${commsCount > 0 ? ` (통화용 ${commsCount})` : ''}`, tone: 'neutral' as const },
    { label: '저장 Sink ID',   value: sinkId ? shortenId(sinkId) : '없음', tone: sinkId ? 'info' : 'neutral' as const },
    { label: '저장 Label',     value: sinkLabel ?? '—',                    tone: 'neutral' as const },
    { label: '실제 적용 ID',   value: effectiveSinkId ? shortenId(effectiveSinkId) : '기본 출력', tone: effectiveSinkId ? 'success' : 'neutral' as const },
    { label: '저장 시각',      value: fmtLocal(savedAt),                   tone: 'neutral' as const },
    { label: '적용 시각',      value: fmtLocal(lastAppliedAt),             tone: 'neutral' as const },
  ], [supportSink, supportEnum, connectionStatus, deviceCount, sinkId, sinkLabel, effectiveSinkId, savedAt, lastAppliedAt, commsCount, kindLabel, kindTone]);

  return (
    <div className="mt-3 rounded-xl bg-bg-soft p-2.5 ring-1 ring-line/15">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-mute">Diagnostics (read-only)</p>
      <dl className="grid grid-cols-1 gap-x-3 gap-y-1 text-[10.5px] sm:grid-cols-2">
        {rows.map((r) => {
          const cls = r.tone === 'success' ? 'text-slate-900 dark:text-emerald-200'
                    : r.tone === 'warning' ? 'text-slate-900 dark:text-amber-200'
                    : r.tone === 'danger'  ? 'text-slate-900 dark:text-rose-200'
                    : r.tone === 'info'    ? 'text-slate-900 dark:text-sky-200'
                    : 'text-ink';
          return (
            <div key={r.label} className="flex items-center justify-between gap-2">
              <dt className="text-ink-mute">{r.label}</dt>
              <dd className={`truncate font-mono ${cls}`} title={r.value}>{r.value}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

interface ConnectionBadgeVisual {
  label: string;
  bg: string;
  ring: string;
  chip: string;
  dot: string;
  textLabel: string;
}

function connectionBadge(status: AudioConnectionStatus): ConnectionBadgeVisual {
  switch (status) {
    case 'connected':
      return {
        label: '연결됨', bg: 'bg-emerald-500/20', ring: 'ring-emerald-500/40',
        chip: 'bg-emerald-500/30 text-slate-900 dark:text-emerald-100 ring-emerald-500/45',
        dot: 'text-emerald-300', textLabel: 'text-slate-900 dark:text-emerald-100',
      };
    case 'disconnected':
      return {
        label: '장치 제거', bg: 'bg-rose-500/20', ring: 'ring-rose-500/40',
        chip: 'bg-rose-500/30 text-slate-900 dark:text-rose-100 ring-rose-500/45',
        dot: 'text-rose-300', textLabel: 'text-slate-900 dark:text-rose-100',
      };
    case 'unsupported':
      return {
        label: '미지원', bg: 'bg-amber-500/20', ring: 'ring-amber-500/40',
        chip: 'bg-amber-500/30 text-slate-900 dark:text-amber-100 ring-amber-500/45',
        dot: 'text-amber-300', textLabel: 'text-slate-900 dark:text-amber-100',
      };
    case 'default':
    default:
      return {
        label: '기본 출력', bg: 'bg-amber-500/20', ring: 'ring-amber-500/40',
        chip: 'bg-amber-500/30 text-slate-900 dark:text-amber-100 ring-amber-500/45',
        dot: 'text-amber-300', textLabel: 'text-slate-900 dark:text-amber-100',
      };
  }
}

function statusLabelKo(s: AudioConnectionStatus): string {
  return s === 'connected' ? '연결됨'
       : s === 'disconnected' ? '장치 제거됨'
       : s === 'unsupported' ? '미지원'
       : '기본 출력 사용';
}

function statusTone(s: AudioConnectionStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  return s === 'connected' ? 'success'
       : s === 'disconnected' ? 'danger'
       : s === 'unsupported' ? 'warning'
       : 'warning';
}

function shortenId(id: string): string {
  if (id.length <= 16) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function fmtLocal(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '—'; }
}
