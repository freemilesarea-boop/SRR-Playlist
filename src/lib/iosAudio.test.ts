import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { nudgeVolume, VOLUME_STEP } from '@/lib/iosAudio';

describe('nudgeVolume', () => {
  it('한 칸 올리고 내린다', () => {
    expect(nudgeVolume(0.5, VOLUME_STEP)).toBe(0.6);
    expect(nudgeVolume(0.5, -VOLUME_STEP)).toBe(0.4);
  });

  it('0 과 1 밖으로 나가지 않는다', () => {
    expect(nudgeVolume(0.05, -VOLUME_STEP)).toBe(0);
    expect(nudgeVolume(0.95, VOLUME_STEP)).toBe(1);
    expect(nudgeVolume(0, -VOLUME_STEP)).toBe(0);
    expect(nudgeVolume(1, VOLUME_STEP)).toBe(1);
  });

  it('부동소수점 찌꺼기를 남기지 않는다', () => {
    // 0.7 - 0.1 은 그냥 빼면 0.5999999999999999 다. 그대로 두면 화면 퍼센트가
    // 60 과 59 를 오가고 슬라이더 위치도 어긋난다.
    expect(nudgeVolume(0.7, -VOLUME_STEP)).toBe(0.6);
    expect(nudgeVolume(0.3, VOLUME_STEP)).toBe(0.4);
    expect(Math.round(nudgeVolume(0.7, -VOLUME_STEP) * 100)).toBe(60);
  });

  it('열 번이면 0 에서 100 까지 간다', () => {
    let v = 0;
    for (let i = 0; i < 10; i += 1) v = nudgeVolume(v, VOLUME_STEP);
    expect(v).toBe(1);
  });
});

describe('매장 플레이어 볼륨 조작부', () => {
  // 전역 미니 플레이어에도 볼륨이 있지만 매장 플레이어(z-[90] 전체화면)에 가려서 닿지 않는다.
  // 이 화면 안에 따로 있어야 하고, 없어지면 매장에서 볼륨을 못 줄인다.
  const page = readFileSync(resolve(process.cwd(), 'src/pages/StorePlayerPage.tsx'), 'utf8');

  it('매장 플레이어 안에 볼륨 조작부가 있다', () => {
    expect(page).toContain('StoreVolumeControl');
    expect(page).toContain('app-volume-range');
  });

  it('음소거와 ± 버튼이 함께 있다', () => {
    expect(page).toContain('aria-label="볼륨 낮추기"');
    expect(page).toContain('aria-label="볼륨 높이기"');
    expect(page).toMatch(/aria-label=\{volume === 0 \? '음소거 해제' : '음소거'\}/);
  });

  it('iOS 에서는 슬라이더 대신 안내를 띄운다', () => {
    // WebKit 은 audio.volume 을 무시한다. 움직여도 소리가 그대로인 슬라이더는 고장으로 보인다.
    expect(page).toContain('isIOSVolumeLocked');
    expect(page).toContain('기기 볼륨 버튼');
  });

  it('손잡이를 손가락 크기로 키우는 규칙이 있다', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    expect(css).toContain('.app-volume-range::-webkit-slider-thumb');
    expect(css).toContain('.app-volume-range::-moz-range-thumb');
  });
});
