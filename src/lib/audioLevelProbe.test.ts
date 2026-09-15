import { describe, it, expect } from 'vitest';
import {
  classifyLoudness,
  snapshotPlayerVolume,
  diagnoseLevel,
  formatLevelReport,
  STREAMING_REFERENCE_LUFS,
  type ProbeResult,
} from './audioLevelProbe';

function probeAt(lufs: number | null): ProbeResult {
  return {
    url: 'blob:test',
    bytes: 1024,
    loudness: {
      integrated_lufs: lufs,
      true_peak_dbtp: -1.2,
      sample_peak_dbfs: -1.4,
      loudness_range: 6,
      clipping_detected: false,
      clip_sample_count: 0,
      channels: 2,
      sample_rate: 44100,
      analyzer_version: 'ebur128-js-v1',
    },
    vsReferenceDb: lufs === null ? null : Math.round((lufs - STREAMING_REFERENCE_LUFS) * 10) / 10,
    verdict: classifyLoudness(lufs),
  };
}

/** audio.volume 을 흉내내는 최소 스텁 — 이 모듈은 두 속성만 본다. */
function audioStub(volume: number, muted = false): HTMLAudioElement {
  return { volume, muted } as HTMLAudioElement;
}

describe('classifyLoudness', () => {
  it.each([
    [null, 'silent'],
    [-30, 'too-quiet'],
    [-18, 'quiet'],
    [-11.7, 'normal'],
    [-5, 'loud'],
  ] as const)('%s LUFS → %s', (lufs, verdict) => {
    expect(classifyLoudness(lufs)).toBe(verdict);
  });

  it('QC 통과 밴드(-14~-9)의 양 끝은 normal', () => {
    expect(classifyLoudness(-14)).toBe('normal');
    expect(classifyLoudness(-9)).toBe('normal');
  });
});

describe('snapshotPlayerVolume', () => {
  it('활성/비활성 엘리먼트를 activeIdx 로 갈라본다', () => {
    const a = audioStub(1.0);
    const b = audioStub(0);
    expect(snapshotPlayerVolume(1, 0, a, b).activeElementVolume).toBe(1.0);
    expect(snapshotPlayerVolume(1, 1, a, b).activeElementVolume).toBe(0);
  });

  it('저장값과 엘리먼트 값이 같으면 mismatch 가 아니다', () => {
    expect(snapshotPlayerVolume(1, 0, audioStub(1.0), audioStub(0)).mismatch).toBe(false);
  });

  it('엘리먼트가 저장값보다 낮으면 mismatch — 이게 플레이어 버그의 신호다', () => {
    expect(snapshotPlayerVolume(1, 0, audioStub(0.15), audioStub(0)).mismatch).toBe(true);
  });

  it('부동소수 오차(0.01 이내)는 mismatch 로 보지 않는다', () => {
    expect(snapshotPlayerVolume(0.7, 0, audioStub(0.699), audioStub(0)).mismatch).toBe(false);
  });

  it('엘리먼트가 아직 없으면 null 로 두고 mismatch 라고 하지 않는다', () => {
    const s = snapshotPlayerVolume(1, 0, null, null);
    expect(s.activeElementVolume).toBeNull();
    expect(s.mismatch).toBe(false);
  });
});

describe('diagnoseLevel — 원인 지목', () => {
  const okVol = snapshotPlayerVolume(1, 0, audioStub(1.0), audioStub(0));

  it('음원이 정상이고 볼륨도 1 이면 앱 밖(기기/OS)을 가리킨다', () => {
    expect(diagnoseLevel(probeAt(-11.7), okVol).cause).toBe('device-or-ok');
  });

  it('엘리먼트 볼륨이 깎여 있으면 플레이어를 지목한다', () => {
    const bad = snapshotPlayerVolume(1, 0, audioStub(0.15), audioStub(0));
    expect(diagnoseLevel(probeAt(-11.7), bad).cause).toBe('player');
  });

  it('음소거도 플레이어 문제로 잡는다', () => {
    const muted = snapshotPlayerVolume(1, 0, audioStub(1.0, true), audioStub(0));
    expect(diagnoseLevel(probeAt(-11.7), muted).cause).toBe('player');
  });

  it('음원이 -30 이면 음원을 지목한다', () => {
    expect(diagnoseLevel(probeAt(-30), okVol).cause).toBe('source');
  });

  it('플레이어 문제가 음원 문제보다 먼저다 — 둘 다여도 볼륨부터 고쳐야 한다', () => {
    const bad = snapshotPlayerVolume(1, 0, audioStub(0.15), audioStub(0));
    expect(diagnoseLevel(probeAt(-30), bad).cause).toBe('player');
  });
});

describe('formatLevelReport', () => {
  const okVol = snapshotPlayerVolume(1, 0, audioStub(1.0), audioStub(0));

  it('logcat 한 줄에 원인·음원·볼륨이 다 들어간다', () => {
    const line = formatLevelReport(probeAt(-11.7), okVol);
    expect(line).toContain('[레벨진단:device-or-ok]');
    expect(line).toContain('-11.7 LUFS');
    expect(line).toContain('슬라이더=100');
    expect(line).toContain('audio.volume=1');
  });

  it('줄바꿈이 없다 — logcat 에서 한 줄로 읽혀야 한다', () => {
    expect(formatLevelReport(probeAt(-30), okVol)).not.toContain('\n');
  });

  it('기준 대비 차이를 부호와 함께 적는다', () => {
    expect(formatLevelReport(probeAt(-30), okVol)).toContain('-16dB');
    expect(formatLevelReport(probeAt(-11), okVol)).toContain('+3dB');
  });

  it('무음도 숫자 없이 표현한다 — NaN 이 찍히면 안 된다', () => {
    const line = formatLevelReport(probeAt(null), okVol);
    expect(line).toContain('무음');
    expect(line).not.toContain('NaN');
  });
});
