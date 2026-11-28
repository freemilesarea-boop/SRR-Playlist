import { describe, it, expect } from 'vitest';
import { computeLoudness } from './loudness';

const SR = 48000;

/** 진폭 amp 인 정현파. 게이트가 400ms 블록을 쓰므로 기본 5초로 넉넉히 준다. */
function sine(freq: number, amp: number, sec = 5, sr = SR): Float32Array {
  const n = Math.round(sr * sec);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

function silence(sec = 5, sr = SR): Float32Array {
  return new Float32Array(Math.round(sr * sec));
}

function concat(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

const lufs = (chs: Float32Array[], sr = SR): number => {
  const v = computeLoudness(chs, sr).integrated_lufs;
  if (v === null) throw new Error('무음으로 측정됨');
  return v;
};

/**
 * 997Hz 는 BS.1770 의 교정점이다. K-weighting 이 이 주파수에서 정확히 +0.691dB 이고
 * 공식의 -0.691dB 오프셋이 그걸 상쇄하므로, 남는 건 순수 에너지뿐이다.
 * 진폭 A 정현파의 평균제곱은 A²/2 → 단일 채널이면 10log10(A²/2) LUFS.
 *
 * 이 값이 어긋나면 업로드 QC 가 기록한 LUFS 전체가 어긋난다. 매장에서
 * "소리가 작다" 는 제보가 왔을 때 DB 숫자를 믿어도 되는지가 여기 달려 있다.
 */
const theoreticalMono = (amp: number) => 10 * Math.log10((amp * amp) / 2);

/** 목표 LUFS(스테레오 L=R)를 내는 정현파 진폭. 위 식을 거꾸로 푼 것. */
function stereoAmpFor(targetLufs: number): number {
  return Math.sqrt(2 * Math.pow(10, (targetLufs - 3.01) / 10));
}

describe('computeLoudness — 교정 (이게 틀리면 QC 숫자 전부가 틀린다)', () => {
  it.each([1.0, 0.5, 0.1, 0.0631])('997Hz 단일 채널 amp=%s 는 이론값과 0.5dB 안', (amp) => {
    expect(lufs([sine(997, amp)])).toBeCloseTo(theoreticalMono(amp), 0);
    expect(Math.abs(lufs([sine(997, amp)]) - theoreticalMono(amp))).toBeLessThan(0.5);
  });

  it('스테레오(L=R)는 모노보다 정확히 3.01dB 크다 — 규격이 채널 에너지를 합하기 때문', () => {
    const ch = sine(997, 0.5);
    expect(lufs([ch, ch]) - lufs([ch])).toBeCloseTo(3.01, 1);
  });

  it('진폭이 절반이면 정확히 6.02dB 내려간다', () => {
    expect(lufs([sine(997, 0.5)]) - lufs([sine(997, 0.25)])).toBeCloseTo(6.02, 1);
  });

  it('44.1kHz 에서도 같은 값이 나온다 — 필터를 샘플레이트마다 새로 설계하므로', () => {
    const at48 = lufs([sine(997, 0.5, 5, 48000)], 48000);
    const at441 = lufs([sine(997, 0.5, 5, 44100)], 44100);
    expect(at441).toBeCloseTo(at48, 0);
  });

  it('제보 수준(-30 LUFS)과 카탈로그 중앙값(-11.7)을 구분할 만큼 정확하다', () => {
    // 두 값의 차이는 18dB 가 넘는다 — 측정 오차(<0.5dB)로는 뒤집히지 않는다.
    // 즉 "파일은 -11.7 인데 -30 으로 들린다" 면 그건 측정의 문제가 아니다.
    for (const target of [-30, -11.7]) {
      expect(lufs([sine(997, stereoAmpFor(target)), sine(997, stereoAmpFor(target))])).toBeCloseTo(target, 0);
    }
  });
});

describe('computeLoudness — 게이트', () => {
  it('뒤에 붙은 긴 무음이 곡 값을 끌어내리지 않는다', () => {
    const tone = sine(997, 0.5, 3);
    expect(lufs([concat(tone, silence(20))])).toBeCloseTo(lufs([tone]), 0);
  });

  it('완전 무음은 null — 0 으로 뭉개지 않는다', () => {
    expect(computeLoudness([silence()], SR).integrated_lufs).toBeNull();
  });

  it('400ms 보다 짧으면 integrated 를 포기하되 피크는 남긴다', () => {
    const r = computeLoudness([sine(997, 0.5, 0.1)], SR);
    expect(r.integrated_lufs).toBeNull();
    expect(r.sample_peak_dbfs).toBeCloseTo(-6.02, 1);
  });
});

describe('computeLoudness — 피크와 클리핑', () => {
  it('샘플 피크를 dBFS 로 준다', () => {
    expect(computeLoudness([sine(997, 0.5)], SR).sample_peak_dbfs).toBeCloseTo(-6.02, 1);
  });

  it('true peak 는 샘플 피크 이상이다 — 샘플 사이 봉우리를 보므로', () => {
    const r = computeLoudness([sine(997, 0.5)], SR);
    expect(r.true_peak_dbtp!).toBeGreaterThanOrEqual(r.sample_peak_dbfs! - 0.01);
  });

  it('여유 있는 신호에는 클리핑을 표시하지 않는다', () => {
    expect(computeLoudness([sine(997, 0.5)], SR).clipping_detected).toBe(false);
  });

  it('0dBFS 를 넘겨 깎인 신호는 클리핑으로 잡는다', () => {
    const clipped = sine(997, 1.5).map((v) => Math.max(-1, Math.min(1, v))) as Float32Array;
    const r = computeLoudness([clipped], SR);
    expect(r.clipping_detected).toBe(true);
    expect(r.clip_sample_count).toBeGreaterThan(8);
  });

  it('메타데이터를 그대로 돌려준다', () => {
    const r = computeLoudness([sine(997, 0.5), sine(997, 0.5)], SR);
    expect(r.channels).toBe(2);
    expect(r.sample_rate).toBe(SR);
    expect(r.analyzer_version).toBe('ebur128-js-v1');
  });
});
