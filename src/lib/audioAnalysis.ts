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
  duration_seconds?: number | null;
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

/**
 * v1 실분석(beta) — 브라우저 Web Audio 로 오디오를 디코드해 기초 피처를 추출한다.
 * 추출: duration, rms, peak, dynamic_range, energy(=rms 기반), brightness(고역/전역 에너지비),
 *       bpm(에너지 플럭스 자기상관), tempo_stability, danceability(휴리스틱).
 * key/mode/vocal 정밀 분석은 미지원(2차) — vocal_presence/acousticness/instrumentalness 는 휴리스틱.
 * 실패 시 throw.
 */
export async function analyzeAudioFromUrl(
  url: string,
  durationSeconds?: number | null,
): Promise<AudioFeatureValues> {
  if (typeof window === 'undefined' || !(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext)) {
    throw new Error('이 브라우저는 Web Audio 분석을 지원하지 않습니다.');
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`오디오 fetch 실패: HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();

  const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new Ctx();
  let audio: AudioBuffer;
  try {
    audio = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    void ctx.close();
  }

  const ch = audio.getChannelData(0);
  const sr = audio.sampleRate;
  const dur = audio.duration;

  // RMS / peak
  let sumSq = 0;
  let peak = 0;
  const step = Math.max(1, Math.floor(ch.length / 500_000)); // 대용량 다운샘플
  let n = 0;
  for (let i = 0; i < ch.length; i += step) {
    const v = ch[i];
    sumSq += v * v;
    const a = Math.abs(v);
    if (a > peak) peak = a;
    n++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  const dynamic_range = peak > 0 ? 20 * Math.log10(peak / Math.max(rms, 1e-6)) : 0;
  const loudness = 20 * Math.log10(Math.max(rms, 1e-6));
  const energy = clamp01(rms * 3.2); // rms→energy 매핑(경험적)

  // brightness: 1차 차분(고역 에너지) / 전체 에너지 비
  let hi = 0;
  let lo = 0;
  for (let i = 1; i < ch.length; i += step) {
    const d = ch[i] - ch[i - 1];
    hi += d * d;
    lo += ch[i] * ch[i];
  }
  const brightness = clamp01(Math.sqrt(hi / Math.max(lo, 1e-9)) * 0.8);

  // BPM: 에너지 플럭스 onset envelope 자기상관 (60~180 BPM)
  const bpm = estimateBpm(ch, sr);

  // 휴리스틱(2차에서 ML 로 대체)
  const danceability = clamp01(0.3 + energy * 0.4 + (bpm && bpm >= 100 && bpm <= 130 ? 0.2 : 0));
  const acousticness = clamp01(1 - brightness * 0.6 - energy * 0.3);
  const vocal_presence = clamp01(0.3 + brightness * 0.4);
  const instrumentalness = clamp01(1 - vocal_presence);
  const tempo_stability = 0.6; // 단일 패스 추정 — 2차에서 정밀화

  return {
    bpm: bpm ?? null,
    energy,
    danceability,
    acousticness,
    instrumentalness,
    speechiness: clamp01(vocal_presence * 0.3),
    vocal_presence,
    brightness,
    tempo_stability,
    loudness: Math.round(loudness * 10) / 10,
    rms: Math.round(rms * 1000) / 1000,
    peak: Math.round(peak * 1000) / 1000,
    dynamic_range: Math.round(dynamic_range * 10) / 10,
    key_name: null,
    duration_seconds: durationSeconds ?? Math.round(dur),
    analyzer: 'webaudio-v1',
    analysis_version: 'v1',
  };
}

/** 에너지 플럭스 onset envelope 자기상관으로 BPM 추정. 실패 시 null. */
function estimateBpm(ch: Float32Array, sr: number): number | null {
  try {
    const hop = 512;
    const frames = Math.floor(ch.length / hop);
    if (frames < 8) return null;
    const env = new Float32Array(frames);
    let prev = 0;
    for (let f = 0; f < frames; f++) {
      let e = 0;
      const base = f * hop;
      for (let i = 0; i < hop; i++) e += Math.abs(ch[base + i] || 0);
      const flux = Math.max(0, e - prev);
      env[f] = flux;
      prev = e;
    }
    const envSr = sr / hop;
    const minBpm = 60;
    const maxBpm = 180;
    const minLag = Math.floor((60 / maxBpm) * envSr);
    const maxLag = Math.floor((60 / minBpm) * envSr);
    let bestLag = -1;
    let bestVal = 0;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = 0; i + lag < frames; i++) sum += env[i] * env[i + lag];
      if (sum > bestVal) {
        bestVal = sum;
        bestLag = lag;
      }
    }
    if (bestLag <= 0) return null;
    const bpm = (60 * envSr) / bestLag;
    return Math.round(Math.max(minBpm, Math.min(maxBpm, bpm)));
  } catch {
    return null;
  }
}
