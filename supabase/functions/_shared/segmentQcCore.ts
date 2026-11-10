// supabase/functions/_shared/segmentQcCore.ts
//
// 구간별 음질 분석 — 곡 전체 평균이 아니라 '구간마다' 소리를 재서, 검수 직원이 귀로 잡는
// 문제(후반부 음질 저하·노이즈·쇳소리·찢어짐·과한 마스터링·저음 울림)를 수치로 남긴다 (0548).
//
// 순수 함수만 둔다(Deno·브라우저·Node 공용). 디코딩은 호출하는 쪽에서 한다.
// 입력: 구간별 PCM(모노 또는 스테레오) + 샘플레이트 + 그 구간이 곡의 몇 초 지점인지.

export const SEGMENT_QC_VERSION = 'segqc-v1';

export interface SegmentInput {
  /** 구간 시작 시각(초) — 곡 안에서의 위치 */
  at: number;
  sampleRate: number;
  /** 채널별 PCM [-1, 1] */
  channels: Float32Array[];
}

export interface SegmentFeatures {
  at: number;
  seconds: number;
  rms_db: number;
  peak: number;
  crest_db: number;
  clip_ratio: number;
  centroid_hz: number;
  rolloff_hz: number;
  hf_ratio: number;
  air_ratio: number;
  flatness_high: number;
  sub_ratio: number;
  side_ratio: number;
}

export interface TrackSegmentSummary {
  version: string;
  windows: SegmentFeatures[];
  /** 곡 단위 요약 — 평균·최댓값·뒷부분−앞부분 차이 */
  features: Record<string, number>;
}

const FFT_SIZE = 2048;
const HOP = 1024;

function fftMag(re: Float64Array, im: Float64Array): void {
  // 제자리 radix-2 FFT
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar;
        im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar;
        im[i + k] += ai;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const HANN = (() => {
  const w = new Float64Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1));
  return w;
})();

const round = (v: number, d = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);

export function analyzeSegment(seg: SegmentInput): SegmentFeatures {
  const { sampleRate: sr } = seg;
  const left = seg.channels[0];
  const right = seg.channels[1] ?? seg.channels[0];
  const n = Math.min(left.length, right.length);

  let sumSq = 0;
  let peak = 0;
  let clip = 0;
  let midE = 0;
  let sideE = 0;
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const l = left[i];
    const r = right[i];
    const m = (l + r) / 2;
    const s = (l - r) / 2;
    mono[i] = m;
    midE += m * m;
    sideE += s * s;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > peak) peak = a;
    if (a >= 0.999) clip++;
    sumSq += m * m;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));

  // 평균 스펙트럼(파워)
  const bins = FFT_SIZE / 2;
  const power = new Float64Array(bins);
  let frames = 0;
  const re = new Float64Array(FFT_SIZE);
  const im = new Float64Array(FFT_SIZE);
  for (let start = 0; start + FFT_SIZE <= n; start += HOP) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = mono[start + i] * HANN[i];
      im[i] = 0;
    }
    fftMag(re, im);
    for (let k = 0; k < bins; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  const hz = (k: number) => (k * sr) / FFT_SIZE;
  let total = 0;
  let weighted = 0;
  let hf = 0;
  let air = 0;
  let sub = 0;
  for (let k = 1; k < bins; k++) {
    const p = power[k];
    total += p;
    weighted += p * hz(k);
    if (hz(k) >= 10000) hf += p;
    if (hz(k) >= 16000) air += p;
    if (hz(k) < 80) sub += p;
  }
  let acc = 0;
  let rolloff = 0;
  for (let k = 1; k < bins; k++) {
    acc += power[k];
    if (acc >= total * 0.85) {
      rolloff = hz(k);
      break;
    }
  }
  // 4–10kHz 스펙트럼 평탄도(1에 가까울수록 잡음처럼 평평 — 쇳소리·치찰·AI 잡음)
  let logSum = 0;
  let linSum = 0;
  let cnt = 0;
  for (let k = 1; k < bins; k++) {
    if (hz(k) < 4000 || hz(k) > 10000) continue;
    const p = power[k] / Math.max(1, frames) + 1e-12;
    logSum += Math.log(p);
    linSum += p;
    cnt++;
  }
  const flatness = cnt ? Math.exp(logSum / cnt) / (linSum / cnt) : 0;

  return {
    at: round(seg.at, 1),
    seconds: round(n / sr, 2),
    rms_db: round(20 * Math.log10(rms + 1e-9), 2),
    peak: round(peak, 4),
    crest_db: round(20 * Math.log10((peak + 1e-9) / (rms + 1e-9)), 2),
    clip_ratio: round(clip / Math.max(1, n), 6),
    centroid_hz: round(total ? weighted / total : 0, 0),
    rolloff_hz: round(rolloff, 0),
    hf_ratio: round(total ? hf / total : 0, 5),
    air_ratio: round(total ? air / total : 0, 6),
    flatness_high: round(flatness, 5),
    sub_ratio: round(total ? sub / total : 0, 5),
    side_ratio: round(midE ? sideE / midE : 0, 4),
  };
}

const KEYS: (keyof SegmentFeatures)[] = [
  'rms_db', 'peak', 'crest_db', 'clip_ratio', 'centroid_hz', 'rolloff_hz',
  'hf_ratio', 'air_ratio', 'flatness_high', 'sub_ratio', 'side_ratio',
];

/** 구간들을 곡 단위로 요약 — 평균(mean_), 최댓값(max_), 최솟값(min_), 뒷부분−앞부분(late_minus_early_). */
export function summarizeSegments(windows: SegmentFeatures[]): TrackSegmentSummary {
  const sorted = [...windows].sort((a, b) => a.at - b.at);
  const features: Record<string, number> = {};
  if (sorted.length === 0) return { version: SEGMENT_QC_VERSION, windows: sorted, features };
  const third = Math.max(1, Math.floor(sorted.length / 3));
  const early = sorted.slice(0, third);
  const late = sorted.slice(-third);
  const mean = (arr: SegmentFeatures[], k: keyof SegmentFeatures) => arr.reduce((s, w) => s + (w[k] as number), 0) / arr.length;
  for (const k of KEYS) {
    const vals = sorted.map((w) => w[k] as number);
    features[`mean_${k}`] = round(mean(sorted, k), 6);
    features[`max_${k}`] = round(Math.max(...vals), 6);
    features[`min_${k}`] = round(Math.min(...vals), 6);
    features[`late_minus_early_${k}`] = round(mean(late, k) - mean(early, k), 6);
  }
  features.windows = sorted.length;
  return { version: SEGMENT_QC_VERSION, windows: sorted, features };
}

/** 곡 길이·파일 크기로 분석할 구간 위치(초)를 고른다 — 5%~95% 사이 균등 n곳. */
export function pickWindowStarts(durationSec: number, count = 8, windowSec = 3): number[] {
  if (!(durationSec > windowSec * 2)) return [0];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = durationSec * (0.05 + (0.9 * i) / Math.max(1, count - 1));
    out.push(Math.max(0, Math.min(durationSec - windowSec, t)));
  }
  return out;
}
