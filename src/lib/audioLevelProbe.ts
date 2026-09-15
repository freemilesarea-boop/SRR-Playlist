/**
 * audioLevelProbe.ts — "지금 이 기기에서 이 파일이 실제로 몇 LUFS 인가" 를 잰다.
 *
 * 매장에서 소리가 작다는 제보가 오면 원인은 셋 중 하나다:
 *   (1) 음원이 작다                 → 여기서 잰 값이 작게 나온다
 *   (2) 플레이어가 볼륨을 깎는다     → 잰 값은 정상인데 audio.volume 이 1 이 아니다
 *   (3) 기기/OS 가 깎는다           → 둘 다 정상인데 스피커만 작다
 * 셋을 숫자로 갈라놓으려고 만들었다. 추측 대신 logcat 에 한 줄을 남긴다.
 *
 * 재생 경로는 건드리지 않는다. 재생 중인 <audio> 에 createMediaElementSource 를
 * 걸면 출력이 Web Audio 그래프로 넘어가고 되돌릴 수 없다. 그래서 같은 파일을
 * 따로 디코딩해서 잰다 — 재생에는 아무 영향이 없다.
 *
 * 측정 자체는 업로드 QC 와 같은 computeLoudness 를 쓴다. 같은 자를 대야
 * DB 에 적힌 값과 바로 견줄 수 있다.
 *
 * 기본은 꺼져 있다. 제보를 쫓는 동안만 켜는 도구다 — isLevelProbeEnabled 참고.
 */
import { isAudioDebugEnabled } from './audioDebug';
import { computeLoudness, type LoudnessResult } from './loudness';

/** 한 번에 디코딩할 최대 길이. 매장 태블릿 메모리를 오래 잡지 않도록 끊는다. */
export const MAX_PROBE_SECONDS = 60;

/** 유튜브·스포티파이가 맞추는 재생 기준. 비교 기준선으로만 쓴다. */
export const STREAMING_REFERENCE_LUFS = -14;

/**
 * 진단 스위치.
 *
 * 이 측정은 공짜가 아니다 — 파일을 한 번 더 디코딩한다. 원인을 가르는 동안만
 * 켜두고, 답이 나오면 끈다. 기본은 OFF 고, 매장 태블릿은 아무것도 더 하지 않는다.
 *
 * 켜는 법 (셋 중 하나):
 *   • URL `?levelDiag=1`            — 웹/PWA 에서 그 자리에서
 *   • localStorage `deudda.levelDiag` = `'1'` — 다음 실행까지 유지
 *   • 빌드 시 `VITE_LEVEL_DIAG=1`   — 네이티브(앱) QA 처럼 주소창이 없는 데서
 * `?audioDebug=1` 로 오디오 디버그를 켠 세션이면 따로 켤 필요 없다.
 */
export const LEVEL_DIAG_STORAGE_KEY = 'deudda.levelDiag';
export const LEVEL_DIAG_QUERY_KEY = 'levelDiag';

export interface LevelProbeGateInput {
  /** `window.location.search` (예: `?levelDiag=1`). */
  search?: string;
  /** localStorage 대용. 없으면 없는 대로 본다. */
  storage?: Pick<Storage, 'getItem'> | null;
  /** 빌드 타임 플래그 (`import.meta.env.VITE_LEVEL_DIAG`). */
  buildFlag?: string | undefined;
  /** 오디오 디버그 세션이면 같이 켠다. */
  audioDebug?: boolean;
}

/** 순수 판정 — 테스트에서 window 없이 그대로 부를 수 있게 분리. */
export function resolveLevelProbeEnabled(input: LevelProbeGateInput = {}): boolean {
  const truthy = (v: string | null | undefined) => v === '1' || v === 'true';
  if (input.audioDebug) return true;
  if (truthy(input.buildFlag)) return true;
  try {
    const q = new URLSearchParams(input.search ?? '').get(LEVEL_DIAG_QUERY_KEY);
    if (truthy(q)) return true;
  } catch { /* 이상한 search 문자열은 없는 셈 친다 */ }
  try {
    if (truthy(input.storage?.getItem(LEVEL_DIAG_STORAGE_KEY))) return true;
  } catch { /* 저장소 접근이 막힌 브라우저 */ }
  return false;
}

/** 지금 이 세션에서 레벨 진단을 돌릴지. */
export function isLevelProbeEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  let storage: Pick<Storage, 'getItem'> | null;
  try { storage = window.localStorage; } catch { storage = null; }
  return resolveLevelProbeEnabled({
    search: window.location?.search ?? '',
    storage,
    buildFlag: import.meta.env?.VITE_LEVEL_DIAG as string | undefined,
    audioDebug: isAudioDebugEnabled(),
  });
}

type AudioCtor = typeof AudioContext;

function audioCtor(): AudioCtor | null {
  const w = globalThis as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export interface ProbeResult {
  url: string;
  bytes: number;
  loudness: LoudnessResult;
  /** 재생 기준(-14 LUFS) 대비 몇 dB 인지. 음수면 그만큼 조용하다. */
  vsReferenceDb: number | null;
  verdict: 'silent' | 'too-quiet' | 'quiet' | 'normal' | 'loud';
}

/** 잰 LUFS 를 사람이 읽을 판정으로. 기준은 우리 QC 통과 밴드(-14~-9). */
export function classifyLoudness(lufs: number | null): ProbeResult['verdict'] {
  if (lufs === null) return 'silent';
  if (lufs < -25) return 'too-quiet';
  if (lufs < -14) return 'quiet';
  if (lufs > -7) return 'loud';
  return 'normal';
}

/**
 * URL 하나를 받아 실제 라우드니스를 잰다.
 *
 * blob: URL 을 넘기면 네트워크를 다시 타지 않는다 — 재생 캐시가 이미 받아둔
 * 파일(playbackSrcFor 가 주는 그 URL)을 재는 게 가장 정확하고 싸다.
 */
export async function probeAudioLevel(url: string, maxSeconds = MAX_PROBE_SECONDS): Promise<ProbeResult> {
  const AC = audioCtor();
  if (!AC) throw new Error('이 환경에는 Web Audio 가 없습니다');

  const res = await fetch(url);
  if (!res.ok) throw new Error(`파일을 받지 못했습니다 (HTTP ${res.status})`);
  const bytes = await res.arrayBuffer();

  // 디코딩만 하고 바로 닫는다. 재생용 컨텍스트가 아니다.
  const ctx = new AC();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes.slice(0));
  } finally {
    void Promise.resolve(ctx.close()).catch(() => { /* 이미 닫혔으면 신경 안 씀 */ });
  }

  // computeLoudness 는 샘플레이트마다 필터를 새로 설계하므로 리샘플이 필요 없다.
  const frames = Math.min(decoded.length, Math.round(maxSeconds * decoded.sampleRate));
  const channels: Float32Array[] = [];
  for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c += 1) {
    channels.push(decoded.getChannelData(c).slice(0, frames));
  }

  const loudness = computeLoudness(channels, decoded.sampleRate);
  const lufs = loudness.integrated_lufs;

  return {
    url,
    bytes: bytes.byteLength,
    loudness,
    vsReferenceDb: lufs === null ? null : Math.round((lufs - STREAMING_REFERENCE_LUFS) * 10) / 10,
    verdict: classifyLoudness(lufs),
  };
}

/** 플레이어가 지금 실제로 걸고 있는 볼륨 — 저장값과 엘리먼트 값이 같은지 본다. */
export interface PlayerVolumeSnapshot {
  storeVolume: number;
  activeIdx: number;
  activeElementVolume: number | null;
  inactiveElementVolume: number | null;
  activeMuted: boolean | null;
  /** 저장값과 엘리먼트 값이 어긋나 있으면 true — 이러면 플레이어 쪽 문제다. */
  mismatch: boolean;
}

export function snapshotPlayerVolume(
  storeVolume: number,
  activeIdx: number,
  a: HTMLAudioElement | null,
  b: HTMLAudioElement | null,
): PlayerVolumeSnapshot {
  const active = activeIdx === 0 ? a : b;
  const inactive = activeIdx === 0 ? b : a;
  const activeElementVolume = active ? active.volume : null;
  return {
    storeVolume,
    activeIdx,
    activeElementVolume,
    inactiveElementVolume: inactive ? inactive.volume : null,
    activeMuted: active ? active.muted : null,
    mismatch: activeElementVolume !== null && Math.abs(activeElementVolume - storeVolume) > 0.01,
  };
}

/**
 * 원인을 한 줄로 지목한다. 측정값과 플레이어 상태를 같이 보고 셋 중 하나로 가른다.
 *
 * 이 판정이 이 모듈의 존재 이유다 — logcat 한 줄만 보고 어디를 파야 할지 알 수 있어야 한다.
 */
export function diagnoseLevel(probe: ProbeResult, vol: PlayerVolumeSnapshot): {
  cause: 'source' | 'player' | 'device-or-ok';
  message: string;
} {
  if (vol.mismatch || vol.activeMuted === true) {
    return {
      cause: 'player',
      message: `플레이어가 볼륨을 깎고 있습니다 (슬라이더 ${Math.round(vol.storeVolume * 100)} vs audio.volume ${vol.activeElementVolume}, muted=${vol.activeMuted})`,
    };
  }
  if (probe.verdict === 'too-quiet' || probe.verdict === 'quiet') {
    return {
      cause: 'source',
      message: `음원 자체가 조용합니다 (${probe.loudness.integrated_lufs} LUFS, 기준 대비 ${probe.vsReferenceDb}dB)`,
    };
  }
  return {
    cause: 'device-or-ok',
    message: `앱은 원본 레벨 그대로 내보내고 있습니다 (${probe.loudness.integrated_lufs} LUFS, audio.volume=${vol.activeElementVolume}) — 더 작게 들린다면 기기/OS 쪽입니다`,
  };
}

/**
 * logcat 한 줄 요약.
 *
 * 프로덕션 빌드는 console.log/debug/info 를 지우고 warn/error 만 남기므로
 * 부르는 쪽에서 console.warn 으로 내보내야 기기에서 보인다.
 */
export function formatLevelReport(probe: ProbeResult, vol: PlayerVolumeSnapshot): string {
  const l = probe.loudness;
  const lufs = l.integrated_lufs === null ? '무음' : `${l.integrated_lufs} LUFS`;
  const peak = l.true_peak_dbtp === null ? '—' : `${l.true_peak_dbtp} dBTP`;
  const vs = probe.vsReferenceDb === null ? '—' : `${probe.vsReferenceDb > 0 ? '+' : ''}${probe.vsReferenceDb}dB`;
  const { cause, message } = diagnoseLevel(probe, vol);
  return [
    `[레벨진단:${cause}]`,
    `음원=${lufs}(피크 ${peak}, 기준대비 ${vs}, ${probe.verdict}, ${l.channels}ch ${l.sample_rate}Hz)`,
    `슬라이더=${Math.round(vol.storeVolume * 100)}`,
    `audio.volume=${vol.activeElementVolume ?? '—'}`,
    `muted=${vol.activeMuted ?? '—'}`,
    `→ ${message}`,
  ].join(' · ');
}
