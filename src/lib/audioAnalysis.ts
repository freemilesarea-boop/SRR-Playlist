/**
 * audioAnalysis.ts — AI 큐레이션 오디오 분석기 (Phase 2 인터페이스 + v1 구현).
 *
 * 설계 노트:
 *  - 본격적인 DSP/ML 분석(Essentia/Musicnn 등)은 2차 작업. 이 파일은 그 자리에 끼울
 *    **인터페이스 + 안정적 v1**(브라우저 Web Audio 기반 기초 피처 + 휴리스틱)을 제공한다.
 *  - analyzer / analysis_version 필드를 남겨 이후 분석기 교체를 추적한다.
 *  - 분석 실패는 throw → 호출자(관리자 UI)가 status=failed 로 기록. 재생/검수/발매에는 영향 없음.
 *  - 테스트용 mock 피처 생성기도 제공(실제 분석 없이 파이프라인 검증 가능).
 */

export interface AudioFeatureValues {
  bpm?: number | null;
  key_name?: string | null;
  musical_key?: string | null;
  mode?: string | null;
  loudness?: number | null;
  rms?: number | null;
  peak?: number | null;
  dynamic_range?: number | null;
  energy?: number | null;
  danceability?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
  speechiness?: number | null;
  vocal_presence?: number | null;
  brightness?: number | null;
  tempo_stability?: number | null;
  spectral_centroid?: number | null;
  duration_seconds?: number | null;
  raw_features?: Record<string, number> | null;
  analyzer?: string;
  analysis_version?: string;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * 결정론적 mock 피처 — track_id seed 기반. 실제 분석 없이 큐레이션 파이프라인을 테스트할 때 사용.
 * analyzer='mock-v1' 로 표시되어 실제 분석 결과와 구분된다.
 */
export function generateMockFeatures(seed: string, durationSeconds?: number | null): AudioFeatureValues {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const r = (n: number) => ((h >>> (n * 3)) % 1000) / 1000;
  const energy = clamp01(0.2 + r(1) * 0.7);
  return {
    bpm: Math.round(70 + r(2) * 80),
    energy,
    danceability: clamp01(0.2 + r(3) * 0.7),
    acousticness: clamp01(r(4)),
    instrumentalness: clamp01(r(5)),
    speechiness: clamp01(r(6) * 0.4),
    vocal_presence: clamp01(0.2 + r(7) * 0.7),
    brightness: clamp01(0.2 + r(8) * 0.7),
    tempo_stability: clamp01(0.4 + r(9) * 0.5),
    loudness: -20 + r(2) * 14,
    rms: clamp01(0.1 + energy * 0.5),
    peak: clamp01(0.6 + r(3) * 0.4),
    dynamic_range: 4 + r(4) * 8,
    key_name: null,
    duration_seconds: durationSeconds ?? null,
    analyzer: 'mock-v1',
    analysis_version: 'v1',
  };
}

const ANALYZE_TIMEOUT_MS = 90_000;

/**
 * 실 DSP 분석 v1 (analyzer='webaudio-dsp-v1').
 * 메인 스레드: fetch → decodeAudioData → mono 다운믹스. 무거운 framewise FFT/피처는 WebWorker 에서.
 * 외부 의존성 없음(Essentia/Meyda 미사용 — iOS WASM 리스크 회피). 실패/timeout 시 throw + 정리.
 */
export async function analyzeAudioFromUrl(
  url: string,
  durationSeconds?: number | null,
): Promise<AudioFeatureValues> {
  const Ctx =
    typeof window !== 'undefined'
      ? window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctx) throw new Error('이 브라우저는 Web Audio 분석을 지원하지 않습니다.');

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`오디오 fetch 실패: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();

  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buf.slice(0));
  } catch (e) {
    throw new Error(`오디오 디코드 실패: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    void ctx.close();
  }

  // mono 다운믹스 (다중 채널 평균)
  const sr = audio.sampleRate;
  const len = audio.length;
  const mono = new Float32Array(len);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const cd = audio.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += cd[i];
  }
  if (audio.numberOfChannels > 1) for (let i = 0; i < len; i++) mono[i] /= audio.numberOfChannels;

  // WebWorker 로 오프로드 (transfer)
  const worker = new Worker(new URL('./audioAnalysisWorker.ts', import.meta.url), { type: 'module' });
  try {
    const features = await new Promise<AudioFeatureValues>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('오디오 분석 시간 초과')), ANALYZE_TIMEOUT_MS);
      worker.onmessage = (ev: MessageEvent<{ ok: boolean; features?: AudioFeatureValues; error?: string }>) => {
        window.clearTimeout(timer);
        if (ev.data.ok && ev.data.features) resolve(ev.data.features);
        else reject(new Error(ev.data.error || '분석 실패'));
      };
      worker.onerror = (err) => {
        window.clearTimeout(timer);
        reject(new Error(`worker 오류: ${err.message}`));
      };
      worker.postMessage({ pcm: mono, sampleRate: sr }, [mono.buffer]);
    });
    return {
      ...features,
      duration_seconds: durationSeconds ?? features.duration_seconds ?? Math.round(audio.duration),
    };
  } finally {
    worker.terminate();
  }
}
