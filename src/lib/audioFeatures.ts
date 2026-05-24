/**
 * audioFeatures.ts — 순수 DSP 피처 추출(브라우저 API 비의존, Node 테스트 가능).
 * Float32Array(mono PCM) + sampleRate → 오디오 피처. WebWorker 에서 호출한다.
 *
 * analyzer='webaudio-dsp-v1'. 실 FFT 기반 spectral 특징 + onset BPM.
 * 외부 의존성 없음(Essentia/Meyda 미사용) — iOS WASM 리스크 회피 + Node 단위테스트 가능.
 */

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));

/** 제자리 반복 radix-2 Cooley–Tukey FFT. re/im 길이는 2의 거듭제곱. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k];
        const ai = im[i + k];
        const br = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi;
        const bi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const ncwr = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = ncwr;
      }
    }
  }
}

export interface ExtractedFeatures {
  bpm: number | null;
  rms: number;
  peak: number;
  loudness: number;
  dynamic_range: number;
  energy: number;
  brightness: number;
  spectral_centroid: number;
  danceability: number;
  acousticness: number;
  instrumentalness: number;
  vocal_presence: number;
  tempo_stability: number;
  duration_seconds: number;
  raw_features: Record<string, number>;
  analyzer: string;
  analysis_version: string;
}

/**
 * mono PCM 에서 피처 추출.
 * frame 2048 / hop 1024 / Hann. spectral centroid·rolloff·flatness, ZCR, 밴드 에너지, onset BPM.
 */
export function computeFeaturesFromPCM(ch: Float32Array, sampleRate: number): ExtractedFeatures {
  const N = ch.length;
  const duration = N / sampleRate;

  // 전역 RMS / peak / ZCR
  let sumSq = 0;
  let peak = 0;
  let zc = 0;
  for (let i = 0; i < N; i++) {
    const v = ch[i];
    sumSq += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    if (i > 0 && ((ch[i - 1] < 0 && v >= 0) || (ch[i - 1] >= 0 && v < 0))) zc++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, N));
  const loudness = 20 * Math.log10(Math.max(rms, 1e-6));
  const dynamic_range = peak > 0 ? 20 * Math.log10(peak / Math.max(rms, 1e-6)) : 0;
  const zcr = zc / Math.max(1, N);

  // framewise FFT
  const FRAME = 2048;
  const HOP = 1024;
  const hann = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1));
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  const half = FRAME / 2;
  const binHz = sampleRate / FRAME;

  let frames = 0;
  let centroidAcc = 0;
  let rolloffAcc = 0;
  let flatnessAcc = 0;
  let lowBand = 0; // 0-200Hz
  let midBand = 0; // 200-4000Hz (보컬/멜로디)
  let highBand = 0; // >4000Hz
  let prevMag: Float64Array | null = null;
  const flux: number[] = [];

  for (let start = 0; start + FRAME <= N; start += HOP) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = ch[start + i] * hann[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    const mag = new Float64Array(half);
    let magSum = 0;
    let logSum = 0;
    let centNum = 0;
    let frameFlux = 0;
    for (let k = 0; k < half; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      mag[k] = m;
      magSum += m;
      logSum += Math.log(m + 1e-9);
      const hz = k * binHz;
      centNum += hz * m;
      if (hz < 200) lowBand += m;
      else if (hz < 4000) midBand += m;
      else highBand += m;
      if (prevMag) {
        const d = m - prevMag[k];
        if (d > 0) frameFlux += d;
      }
    }
    if (magSum > 1e-6) {
      centroidAcc += centNum / magSum;
      // rolloff 85%
      let cum = 0;
      let rollHz = 0;
      const thr = 0.85 * magSum;
      for (let k = 0; k < half; k++) {
        cum += mag[k];
        if (cum >= thr) { rollHz = k * binHz; break; }
      }
      rolloffAcc += rollHz;
      // spectral flatness (geo mean / arith mean)
      const geo = Math.exp(logSum / half);
      const arith = magSum / half;
      flatnessAcc += arith > 0 ? geo / arith : 0;
      frames++;
    }
    if (prevMag) flux.push(frameFlux);
    prevMag = mag;
  }

  const nyquist = sampleRate / 2;
  const centroid = frames > 0 ? centroidAcc / frames : 0;
  const rolloff = frames > 0 ? rolloffAcc / frames : 0;
  const flatness = frames > 0 ? flatnessAcc / frames : 0;
  const bandTotal = lowBand + midBand + highBand || 1;

  const brightness = clamp01(centroid / (nyquist * 0.5));
  const energy = clamp01(rms * 3.0 + (loudness > -14 ? 0.15 : 0));
  // acousticness: 낮은 flatness(tonal) + 적은 고역 → 어쿠스틱 경향
  const acousticness = clamp01(1 - flatness * 4 - (highBand / bandTotal) * 0.6);
  // instrumentalness: 보컬 대역(mid) 비중 낮고 ZCR 낮으면 instrumental 경향
  const vocalBandRatio = midBand / bandTotal;
  const vocal_presence = clamp01(vocalBandRatio * 1.2 + (zcr > 0.05 && zcr < 0.15 ? 0.15 : 0));
  const instrumentalness = clamp01(1 - vocal_presence);
  // BPM + tempo_stability (onset flux 자기상관)
  const { bpm, tempoStability } = estimateBpmFromFlux(flux, sampleRate / HOP);
  // danceability: 비트 강도 + energy
  const danceability = clamp01(0.25 + tempoStability * 0.35 + energy * 0.4);

  return {
    bpm,
    rms: round3(rms),
    peak: round3(peak),
    loudness: round1(loudness),
    dynamic_range: round1(dynamic_range),
    energy: round3(energy),
    brightness: round3(brightness),
    spectral_centroid: Math.round(centroid),
    danceability: round3(danceability),
    acousticness: round3(acousticness),
    instrumentalness: round3(instrumentalness),
    vocal_presence: round3(vocal_presence),
    tempo_stability: round3(tempoStability),
    duration_seconds: Math.round(duration),
    raw_features: {
      zcr: round3(zcr),
      spectral_rolloff: Math.round(rolloff),
      spectral_flatness: round3(flatness),
      low_band_ratio: round3(lowBand / bandTotal),
      mid_band_ratio: round3(midBand / bandTotal),
      high_band_ratio: round3(highBand / bandTotal),
      frames,
    },
    analyzer: 'webaudio-dsp-v1',
    analysis_version: 'v1',
  };
}

function estimateBpmFromFlux(flux: number[], envSr: number): { bpm: number | null; tempoStability: number } {
  const n = flux.length;
  if (n < 16) return { bpm: null, tempoStability: 0.4 };
  // 평균 차감(detrend)
  let mean = 0;
  for (const f of flux) mean += f;
  mean /= n;
  const env = flux.map((f) => Math.max(0, f - mean));
  const minBpm = 50;
  const maxBpm = 180;
  const minLag = Math.max(1, Math.floor((60 / maxBpm) * envSr));
  const maxLag = Math.floor((60 / minBpm) * envSr);
  let bestLag = -1;
  let bestVal = 0;
  let secondVal = 0;
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += env[i] * env[i + lag];
    if (s > bestVal) { secondVal = bestVal; bestVal = s; bestLag = lag; }
    else if (s > secondVal) secondVal = s;
  }
  if (bestLag <= 0 || bestVal <= 0) return { bpm: null, tempoStability: 0.4 };
  const bpm = Math.round((60 * envSr) / bestLag);
  // tempo_stability: 1차/2차 피크 비율 (뚜렷한 주기성일수록 높음)
  const tempoStability = clamp01(1 - secondVal / (bestVal + 1e-9));
  return { bpm: Math.max(minBpm, Math.min(maxBpm, bpm)), tempoStability: round3(0.4 + tempoStability * 0.5) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
