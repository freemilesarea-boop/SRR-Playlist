/**
 * loudness.ts — ITU-R BS.1770 / EBU R128 라우드니스 측정 (순수 JS, 의존성 0, Node 테스트 가능).
 * Integrated LUFS + True Peak(dBTP) + Loudness Range(LRA) + clipping.
 * WebWorker 에서 호출(메인 스레드 블로킹 방지). ffmpeg.wasm 미사용(iOS 안정성).
 *
 * 보정 검증: 1kHz -23dBFS 사인(L=R) → ≈ -23 LUFS (EBU Tech 3341).
 */

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

// RBJ high-shelf (K-weighting stage 1): f0=1681.974, gain≈+3.9998dB, Q=0.70717
function designHighShelf(fs: number): Biquad {
  const f0 = 1681.9744509555319;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const A = Math.pow(10, G / 40);
  const w0 = (2 * Math.PI * f0) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  const sa = 2 * Math.sqrt(A) * alpha;
  const a0 = (A + 1) - (A - 1) * cw + sa;
  return {
    b0: (A * ((A + 1) + (A - 1) * cw + sa)) / a0,
    b1: (-2 * A * ((A - 1) + (A + 1) * cw)) / a0,
    b2: (A * ((A + 1) + (A - 1) * cw - sa)) / a0,
    a1: (2 * ((A - 1) - (A + 1) * cw)) / a0,
    a2: ((A + 1) - (A - 1) * cw - sa) / a0,
  };
}

// RBJ high-pass (K-weighting stage 2): f0=38.135, Q=0.50033
function designHighPass(fs: number): Biquad {
  const f0 = 38.13547087602444;
  const Q = 0.5003270373238773;
  const w0 = (2 * Math.PI * f0) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Q);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cw) / 2) / a0,
    b1: (-(1 + cw)) / a0,
    b2: ((1 + cw) / 2) / a0,
    a1: (-2 * cw) / a0,
    a2: (1 - alpha) / a0,
  };
}

function applyBiquad(x: Float32Array, c: Biquad): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    y[i] = yi;
    x2 = x1; x1 = xi; y2 = y1; y1 = yi;
  }
  return y;
}

export interface LoudnessResult {
  integrated_lufs: number | null;
  true_peak_dbtp: number | null;
  sample_peak_dbfs: number | null;
  loudness_range: number | null;
  clipping_detected: boolean;
  clip_sample_count: number;
  channels: number;
  sample_rate: number;
  analyzer_version: string;
}

const DB = (lin: number) => 20 * Math.log10(Math.max(lin, 1e-12));

/** 4x 선형 오버샘플 inter-sample peak 근사 → dBTP. (고차 FIR 대비 약간 과소평가 가능) */
function truePeakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length - 1; i++) {
      const a = ch[i], b = ch[i + 1];
      const aa = Math.abs(a);
      if (aa > peak) peak = aa;
      // 3개 보간점
      for (let k = 1; k < 4; k++) {
        const v = Math.abs(a + ((b - a) * k) / 4);
        if (v > peak) peak = v;
      }
    }
    const last = Math.abs(ch[ch.length - 1] || 0);
    if (last > peak) peak = last;
  }
  return DB(peak);
}

export function computeLoudness(channels: Float32Array[], fs: number): LoudnessResult {
  const nCh = channels.length;
  const G = [1.0, 1.0, 1.0, 1.41, 1.41]; // L,R,C,Ls,Rs

  // sample peak + clipping (raw)
  let samplePeak = 0;
  let clip = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > samplePeak) samplePeak = a;
      if (a >= 0.9995) clip++;
    }
  }
  const truePeak = truePeakDb(channels);

  // K-weighting
  const shelf = designHighShelf(fs);
  const hp = designHighPass(fs);
  const kw = channels.map((c) => applyBiquad(applyBiquad(c, shelf), hp));

  // 400ms blocks, 100ms hop
  const blockSize = Math.round(0.4 * fs);
  const hop = Math.round(0.1 * fs);
  const len = kw[0]?.length ?? 0;
  if (len < blockSize) {
    return {
      integrated_lufs: null, true_peak_dbtp: round1(truePeak), sample_peak_dbfs: round1(DB(samplePeak)),
      loudness_range: null, clipping_detected: clip > 8, clip_sample_count: clip, channels: nCh, sample_rate: fs,
      analyzer_version: 'ebur128-js-v1',
    };
  }

  const blocks: { l: number; z: number }[] = [];
  for (let start = 0; start + blockSize <= len; start += hop) {
    let z = 0;
    for (let c = 0; c < nCh; c++) {
      const ch = kw[c];
      let ms = 0;
      for (let i = start; i < start + blockSize; i++) ms += ch[i] * ch[i];
      ms /= blockSize;
      z += (G[c] ?? 1.0) * ms;
    }
    const l = -0.691 + 10 * Math.log10(z + 1e-12);
    blocks.push({ l, z });
  }

  // gating: absolute -70, then relative (-10 LU)
  const absKept = blocks.filter((b) => b.l >= -70);
  let integrated: number | null = null;
  if (absKept.length > 0) {
    const meanZAbs = absKept.reduce((s, b) => s + b.z, 0) / absKept.length;
    const relThresh = -0.691 + 10 * Math.log10(meanZAbs + 1e-12) - 10;
    const relKept = absKept.filter((b) => b.l >= relThresh);
    if (relKept.length > 0) {
      const meanZ = relKept.reduce((s, b) => s + b.z, 0) / relKept.length;
      integrated = -0.691 + 10 * Math.log10(meanZ + 1e-12);
    }
  }

  // LRA: short-term 3s/1s, gate -70 + relative -20, percentile 10~95 (EBU Tech 3342 근사)
  let lra: number | null = null;
  const stWin = Math.round(3 * fs);
  const stHop = Math.round(1 * fs);
  if (len >= stWin) {
    const st: number[] = [];
    for (let start = 0; start + stWin <= len; start += stHop) {
      let z = 0;
      for (let c = 0; c < nCh; c++) {
        const ch = kw[c];
        let ms = 0;
        for (let i = start; i < start + stWin; i++) ms += ch[i] * ch[i];
        z += (G[c] ?? 1.0) * (ms / stWin);
      }
      st.push(-0.691 + 10 * Math.log10(z + 1e-12));
    }
    const abs = st.filter((l) => l >= -70);
    if (abs.length > 1) {
      const meanZ = abs.reduce((s, l) => s + Math.pow(10, (l + 0.691) / 10), 0) / abs.length;
      const relT = -0.691 + 10 * Math.log10(meanZ) - 20;
      const kept = abs.filter((l) => l >= relT).sort((a, b) => a - b);
      if (kept.length > 1) {
        const pct = (p: number) => kept[Math.min(kept.length - 1, Math.max(0, Math.round((p / 100) * (kept.length - 1))))];
        lra = round1(pct(95) - pct(10));
      }
    }
  }

  return {
    integrated_lufs: integrated == null ? null : round1(integrated),
    true_peak_dbtp: round1(truePeak),
    sample_peak_dbfs: round1(DB(samplePeak)),
    loudness_range: lra,
    clipping_detected: clip > 8,
    clip_sample_count: clip,
    channels: nCh,
    sample_rate: fs,
    analyzer_version: 'ebur128-js-v1',
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
