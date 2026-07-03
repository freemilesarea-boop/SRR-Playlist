/**
 * AudioOutputSection — Phase 1 UI.
 *
 * Player Settings 안에 audio output 선택 UI 추가.
 * setSinkId 즉시 적용 · 3초 테스트음 · 브라우저 미지원 안내 · 권한 안내.
 *
 * DB / API / RPC / polling 도입 0. Enterprise 기존 기능 영향 0.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Headphones, RefreshCw, Volume2, AlertTriangle, CheckCircle2, ShieldAlert, Speaker } from 'lucide-react';
import { useAudioOutputDevices } from '@/hooks/useAudioOutputDevices';
import { useAudioOutputStore } from '@/store/audioOutputStore';
import { playTestTone, type TestToneHandle } from '@/lib/audioOutput';

export default function AudioOutputSection() {
  const {
    devices, loading, supportEnum, supportSink, needPermission, refresh, requestLabelPermission,
  } = useAudioOutputDevices();
  const sinkId = useAudioOutputStore((s) => s.sinkId);
  const sinkLabel = useAudioOutputStore((s) => s.sinkLabel);
  const setSink = useAudioOutputStore((s) => s.setSink);

  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [permBusy, setPermBusy] = useState(false);
  const testHandleRef = useRef<TestToneHandle | null>(null);

  // 컴포넌트 unmount 시 테스트음 중지
  useEffect(() => {
    return () => { testHandleRef.current?.stop(); };
  }, []);

  const onChangeDevice = useCallback((deviceId: string) => {
    if (deviceId === '') {
      setSink(null, null);
    } else {
      const dev = devices.find((d) => d.deviceId === deviceId);
      setSink(deviceId, dev?.label ?? null);
    }
  }, [devices, setSink]);

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
            <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/30 text-amber-100" aria-hidden>
              <AlertTriangle size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-amber-100">
                이 브라우저는 출력 장치 선택을 지원하지 않습니다.
              </p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-amber-50/85">
                Chrome / Edge / Electron 환경에서만 USB DAC · HDMI · 외부 앰프 등을 매장 스피커 전용 출력으로 지정할 수 있습니다.
                Safari · Firefox 는 브라우저 정책상 미지원 — 크롬 계열 브라우저에서 재접속해 주세요.
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
        {/* 현재 출력 장치 표시 */}
        <div className="flex items-center gap-2 rounded-xl bg-emerald-500/20 p-2.5 ring-1 ring-emerald-500/40">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/30 text-emerald-100" aria-hidden>
            <Headphones size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-100">현재 출력</p>
            <p className="mt-0.5 truncate text-[13px] font-bold text-ink" title={activeLabel}>{activeLabel}</p>
          </div>
          <CheckCircle2 size={16} className="text-emerald-200" />
        </div>

        {/* 권한 안내 (label 이 안 보이는 경우) */}
        {needPermission && (
          <div className="mt-2 rounded-xl bg-sky-500/20 p-2.5 ring-1 ring-sky-500/40">
            <div className="flex items-start gap-2">
              <ShieldAlert size={14} className="mt-0.5 shrink-0 text-sky-200" />
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-bold text-sky-100">장치 이름을 표시하려면 권한이 필요합니다.</p>
                <p className="mt-0.5 text-[10.5px] leading-relaxed text-sky-50/85">
                  브라우저 정책상 마이크 권한을 임시로 확인한 후에만 스피커/USB 이름이 노출됩니다. 마이크는 실제로 사용하지 않습니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onRequestPermission()}
                disabled={permBusy}
                className="shrink-0 rounded-md bg-sky-500/40 px-2.5 py-1 text-[10.5px] font-bold text-sky-50 ring-1 ring-sky-400/60 transition hover:bg-sky-500/50 disabled:opacity-60"
              >
                {permBusy ? '요청 중…' : '권한 허용'}
              </button>
            </div>
          </div>
        )}

        {/* 장치 선택 dropdown */}
        <div className="mt-3 space-y-1.5">
          <label className="block text-[11px] font-semibold text-ink-mute" htmlFor="audio-output-select">
            출력 장치 선택
          </label>
          <select
            id="audio-output-select"
            value={sinkId ?? ''}
            onChange={(e) => onChangeDevice(e.target.value)}
            className="w-full appearance-none rounded-lg bg-bg-soft px-3 py-2 text-[12px] text-ink ring-1 ring-line/20 outline-none focus:ring-accent/60"
          >
            <option value="">기본 장치 (Windows 기본 출력)</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label} {d.deviceId === 'default' ? '· default' : ''}
              </option>
            ))}
          </select>
          <p className="text-[10px] leading-relaxed text-ink-dim">
            매장 스피커 전용 출력으로 지정하면 매장 운영 프로그램(주문/결제/알림)의 소리와 완전히 분리됩니다.
            선택 즉시 재생 중인 곡에도 적용됩니다.
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
                ? 'bg-rose-500/40 text-rose-50 ring-rose-400/60 hover:bg-rose-500/50'
                : 'bg-emerald-500/40 text-emerald-50 ring-emerald-400/60 hover:bg-emerald-500/50'
            }`}
          >
            <Volume2 size={11} /> {testing ? '중지' : '테스트'}
          </button>
        </div>

        {testError && (
          <p className="mt-2 rounded-md bg-rose-500/25 px-2 py-1 text-[10.5px] text-rose-100 ring-1 ring-rose-500/45">
            테스트음 실패: {testError}
          </p>
        )}

        {devices.length === 0 && !loading && (
          <p className="mt-2 rounded-md bg-bg-soft px-2 py-1.5 text-[10.5px] text-ink-mute ring-1 ring-line/15">
            감지된 출력 장치가 없습니다. USB DAC / HDMI / 블루투스 스피커 연결 후 새로고침을 눌러 주세요.
          </p>
        )}
      </div>
    </section>
  );
}
