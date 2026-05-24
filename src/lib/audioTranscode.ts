/**
 * audioTranscode.ts
 *
 * ffmpeg.wasm 을 이용한 클라이언트 사이드 오디오 → 표준 MP3 변환.
 *
 * 출력 사양 (스펙):
 *   - codec: libmp3lame
 *   - bitrate: 192kbps
 *   - sample rate: 44.1kHz
 *   - channels: 2 (stereo)
 *   - metadata: stripped (-map_metadata -1)
 *   - file type: audio/mpeg, .mp3
 *
 * 사용:
 *   const std = await transcodeToStandardMp3(file, {
 *     onProgress: (r) => setProgress(r),
 *     onLog: (m) => console.debug(m),
 *   });
 *
 * 주의:
 *   - ffmpeg.wasm 은 무거우므로 (~25MB) 이 모듈은 lazy import 권장.
 *     TrackUploader 에서 await import('@/lib/audioTranscode') 패턴 사용.
 */

import type { FFmpeg } from '@ffmpeg/ffmpeg';

/**
 * 단일 스레드 ffmpeg-core (SharedArrayBuffer 불필요).
 * CDN(unpkg/jsdelivr) 제거 — 앱 내부 self-hosting(public/ffmpeg/) 만 사용.
 * CSP/connect-src/모듈 import 문제를 원천 차단(전부 same-origin).
 */
function ffmpegBase(): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}/ffmpeg`;
}

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

/** 인스턴스 1회만 로드. 동시 호출은 같은 promise 공유. 로컬 asset 만 사용(단계별 에러 메시지). */
async function getFfmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const base = ffmpegBase();
    let FFmpeg: typeof import('@ffmpeg/ffmpeg').FFmpeg;
    let toBlobURL: typeof import('@ffmpeg/util').toBlobURL;
    try {
      ({ FFmpeg } = await import('@ffmpeg/ffmpeg'));
      ({ toBlobURL } = await import('@ffmpeg/util'));
    } catch (e) {
      throw new Error(`ffmpeg 모듈 import 실패: ${e instanceof Error ? e.message : String(e)}`);
    }

    const ff = new FFmpeg();
    if (onLog) ff.on('log', ({ message }: { message: string }) => onLog(message));

    // 1) core.js (same-origin) — 없으면 local asset missing
    let coreURL: string;
    try {
      // eslint-disable-next-line no-console
      console.info('[ffmpeg] fetch core.js start', { url: `${base}/ffmpeg-core.js` });
      coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript');
      // eslint-disable-next-line no-console
      console.info('[ffmpeg] core.js loaded');
    } catch (e) {
      throw new Error(`ffmpeg core.js 로드 실패 (local asset missing: ${base}/ffmpeg-core.js): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 2) core.wasm (same-origin)
    let wasmURL: string;
    try {
      // eslint-disable-next-line no-console
      console.info('[ffmpeg] fetch wasm start', { url: `${base}/ffmpeg-core.wasm` });
      wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm');
      // eslint-disable-next-line no-console
      console.info('[ffmpeg] wasm loaded');
    } catch (e) {
      throw new Error(`ffmpeg wasm fetch 실패 (${base}/ffmpeg-core.wasm): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3) load — @ffmpeg/ffmpeg 워커는 type:'module' 로 생성되어 importScripts 가 막히고
    //    내부적으로 `import(coreURL).default` 로 ESM core 를 로드한다. 따라서 ESM 빌드
    //    (public/ffmpeg/ffmpeg-core.js = export default createFFmpegCore) 를 사용해야 한다.
    try {
      // eslint-disable-next-line no-console
      console.info('[ffmpeg] load() start (module worker 생성 + ESM core import)');
      await ff.load({ coreURL, wasmURL });
      // eslint-disable-next-line no-console
      console.info('[ffmpeg] load success (worker + ESM core + wasm)');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(
        `ffmpeg worker/core 초기화 실패 (module worker 의 ESM core import 단계): ${msg} ` +
          '— public/ffmpeg/ffmpeg-core.js 가 ESM(export default) 빌드인지 확인',
      );
    }

    ffmpegInstance = ff;
    return ff;
  })();

  try {
    return await loadPromise;
  } catch (e) {
    loadPromise = null; // 다음 시도 가능하도록
    throw e;
  }
}

export interface TranscodeOptions {
  /** 0~1 진행률 */
  onProgress?: (ratio: number) => void;
  /** ffmpeg 로그 (디버그용) */
  onLog?: (msg: string) => void;
  bitrateKbps?: number;
  sampleRate?: number;
  channels?: 1 | 2;
}

/**
 * 임의 입력 오디오 → 표준 MP3 File 반환.
 * 실패 시 throw.
 */
export async function transcodeToStandardMp3(
  file: File,
  options: TranscodeOptions = {},
): Promise<File> {
  const {
    onProgress,
    onLog,
    bitrateKbps = 192,
    sampleRate = 44100,
    channels = 2,
  } = options;

  const { fetchFile } = await import('@ffmpeg/util');
  const ff = await getFfmpeg(onLog);

  const progressHandler = ({ progress }: { progress: number }) => {
    if (onProgress) onProgress(Math.max(0, Math.min(1, progress)));
  };
  ff.on('progress', progressHandler);

  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
  const inputName = `input.${ext.replace(/[^a-z0-9]/g, '') || 'bin'}`;
  const outputName = 'output.mp3';

  try {
    await ff.writeFile(inputName, await fetchFile(file));

    const args = [
      '-i', inputName,
      '-vn',                      // 비디오 트랙 제거
      '-map_metadata', '-1',      // 메타데이터 제거 (id3 등)
      '-acodec', 'libmp3lame',
      '-b:a', `${bitrateKbps}k`,
      '-ar', String(sampleRate),
      '-ac', String(channels),
      '-f', 'mp3',
      '-y',                        // 덮어쓰기
      outputName,
    ];

    const code = await ff.exec(args);
    if (code !== 0) {
      throw new Error(`ffmpeg exec failed (exit ${code})`);
    }

    const data = await ff.readFile(outputName);
    if (!(data instanceof Uint8Array)) {
      throw new Error('ffmpeg readFile returned non-binary data');
    }

    // ffmpeg FS 정리
    try { await ff.deleteFile(inputName); } catch { /* noop */ }
    try { await ff.deleteFile(outputName); } catch { /* noop */ }

    const baseName = file.name.replace(/\.[^.]+$/, '') || 'audio';
    // 파일명 안전화 (영문/한글/숫자/하이픈/언더스코어만)
    const safeBase = baseName.replace(/[^\p{L}\p{N}\-_]/gu, '_').slice(0, 60) || 'audio';

    // 깨끗한 ArrayBuffer 로 복사 (Uint8Array<SharedArrayBuffer> → Uint8Array<ArrayBuffer>)
    const cleanBytes = new Uint8Array(data.byteLength);
    cleanBytes.set(data);
    return new File([cleanBytes], `${safeBase}_standard.mp3`, { type: 'audio/mpeg' });
  } finally {
    try { ff.off('progress', progressHandler); } catch { /* noop */ }
  }
}

/** 진행 중인 변환을 중단 (지원되면) */
export async function cancelTranscode(): Promise<void> {
  if (!ffmpegInstance) return;
  try {
    ffmpegInstance.terminate();
  } catch {
    /* noop */
  }
  ffmpegInstance = null;
  loadPromise = null;
}
