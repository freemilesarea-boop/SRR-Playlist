/**
 * audioOutput — Audio Output Device Manager (Phase 1)
 *
 * 목표: Windows 기본 출력과 DEUDDA 음악 출력을 분리해서
 *       매장 운영 프로그램과 BGM 이 서로 간섭하지 않도록 지원.
 *
 * 절대 규칙:
 *   • 새 DB / API / RPC / polling 도입 0
 *   • Player 재생 로직 변경 최소 (setSinkId 만 반영)
 *   • Enterprise 기존 기능 영향 0
 *
 * 브라우저 지원:
 *   • Chrome / Edge / Electron / PWA — setSinkId + enumerateDevices 지원
 *   • Firefox — setSinkId 미지원 (감지 후 안내)
 *   • Safari  — setSinkId 미지원 (감지 후 안내)
 */

/** setSinkId API 지원 여부 (HTMLAudioElement 기준). */
export function isSetSinkIdSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof HTMLAudioElement === 'undefined') return false;
  return typeof (HTMLAudioElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function';
}

/** enumerateDevices API 지원 여부 (mediaDevices 유무). */
export function isEnumerateDevicesSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  const md = (navigator as unknown as { mediaDevices?: { enumerateDevices?: unknown } }).mediaDevices;
  return typeof md?.enumerateDevices === 'function';
}

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

/**
 * audiooutput 목록 조회.
 * 브라우저가 미지원이면 빈 배열 반환.
 * label 이 비어있는 경우 (권한 미부여) label='(권한 필요)' 로 대체.
 */
export async function enumerateAudioOutputs(): Promise<AudioOutputDevice[]> {
  if (!isEnumerateDevicesSupported()) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audiooutput')
      .map((d) => ({
        deviceId: d.deviceId,
        label: d.label && d.label.length > 0 ? d.label : '(이름 미공개)',
        groupId: d.groupId,
      }));
  } catch (e) {
    console.warn('[audioOutput] enumerateDevices failed', e);
    return [];
  }
}

/**
 * 마이크 권한을 임시 요청해서 audio device label 을 노출하도록 한다.
 * 브라우저는 마이크 권한을 부여받아야 audiooutput label 을 공개함 (Chrome 정책).
 * 성공/실패 무관하게 즉시 stream stop.
 */
export async function requestDeviceLabelPermission(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const md = (navigator as unknown as { mediaDevices?: { getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream> } }).mediaDevices;
  if (typeof md?.getUserMedia !== 'function') return false;
  try {
    const stream = await md.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch (e) {
    console.warn('[audioOutput] getUserMedia denied/failed', e);
    return false;
  }
}

/**
 * HTMLAudioElement 에 setSinkId 적용.
 * 미지원/실패 시 false 반환 (throw 하지 않음 — Player 재생 로직 영향 최소화).
 */
export async function applySinkId(audio: HTMLAudioElement, deviceId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSetSinkIdSupported()) return { ok: false, error: 'unsupported' };
  const withSink = audio as unknown as { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId !== 'function') return { ok: false, error: 'unsupported' };
  try {
    await withSink.setSinkId(deviceId);
    return { ok: true };
  } catch (e) {
    const err = e as { name?: string; message?: string };
    console.warn('[audioOutput] setSinkId failed', err);
    return { ok: false, error: err.name ?? err.message ?? 'unknown' };
  }
}

/**
 * 3초 테스트음 재생 — 440Hz sine wave.
 * WebAudio oscillator → MediaStreamDestination → HTMLAudioElement 로 라우팅해
 * setSinkId 를 실제 반영 (AudioContext.destination 은 setSinkId 미준수).
 * deviceId 지정 시 해당 장치로만 재생.
 */
export interface TestToneHandle {
  stop: () => void;
  finished: Promise<void>;
}

export function playTestTone(deviceId: string | null, durationMs = 3000): TestToneHandle {
  if (typeof window === 'undefined') {
    return { stop: () => {}, finished: Promise.resolve() };
  }
  const AudioCtor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) {
    return { stop: () => {}, finished: Promise.resolve() };
  }

  const ctx = new AudioCtor();
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const gain = ctx.createGain();
  // -12dB 정도로 완만하게 fade in/out — 스피커 팝 방지
  gain.gain.value = 0.0001;
  const now = ctx.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.05);
  gain.gain.setValueAtTime(0.12, now + durationMs / 1000 - 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);

  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain);
  gain.connect(dest);

  const audio = new Audio();
  audio.srcObject = dest.stream;

  let stopped = false;
  let resolveFinished: (() => void) | null = null;
  const finished = new Promise<void>((res) => { resolveFinished = res; });

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try { osc.stop(); } catch { /* noop */ }
    try { audio.pause(); } catch { /* noop */ }
    try { audio.srcObject = null; } catch { /* noop */ }
    try { void ctx.close(); } catch { /* noop */ }
    resolveFinished?.();
  };

  const timer = window.setTimeout(cleanup, durationMs);

  void (async () => {
    if (deviceId) {
      // setSinkId 실패는 무시 — 기본 장치로 fallback (사용자가 인지할 수 있게 UI 는 별도 안내)
      await applySinkId(audio, deviceId);
    }
    try {
      osc.start();
      await audio.play();
    } catch (e) {
      console.warn('[audioOutput] test tone play failed', e);
      window.clearTimeout(timer);
      cleanup();
    }
  })();

  return {
    stop: () => { window.clearTimeout(timer); cleanup(); },
    finished,
  };
}
