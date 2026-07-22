import { describe, it, expect } from 'vitest';
import { formatPlaybackTime, isDurationPending, playbackProgress, progressToSeconds } from './playbackTime';

describe('formatPlaybackTime', () => {
  it('formats normal values', () => {
    expect(formatPlaybackTime(0)).toBe('0:00');
    expect(formatPlaybackTime(9)).toBe('0:09');
    expect(formatPlaybackTime(59)).toBe('0:59');
    expect(formatPlaybackTime(60)).toBe('1:00');
    expect(formatPlaybackTime(65)).toBe('1:05');
    expect(formatPlaybackTime(3599)).toBe('59:59');
  });
  it('formats hour+ values as h:mm:ss', () => {
    expect(formatPlaybackTime(3600)).toBe('1:00:00');
    expect(formatPlaybackTime(3661)).toBe('1:01:01');
    expect(formatPlaybackTime(7325)).toBe('2:02:05');
  });
  it('guards NaN / Infinity / negative', () => {
    expect(formatPlaybackTime(NaN)).toBe('0:00');
    expect(formatPlaybackTime(Infinity)).toBe('0:00');
    expect(formatPlaybackTime(-5)).toBe('0:00');
  });
});

describe('isDurationPending', () => {
  it('true for 0/NaN/Infinity/negative', () => {
    expect(isDurationPending(0)).toBe(true);
    expect(isDurationPending(NaN)).toBe(true);
    expect(isDurationPending(Infinity)).toBe(true);
    expect(isDurationPending(-1)).toBe(true);
  });
  it('false for positive finite', () => {
    expect(isDurationPending(180)).toBe(false);
  });
});

describe('playbackProgress', () => {
  it('normal ratio', () => {
    expect(playbackProgress(90, 180)).toBeCloseTo(0.5);
    expect(playbackProgress(0, 180)).toBe(0);
    expect(playbackProgress(180, 180)).toBe(1);
  });
  it('clamps overflow and guards divide-by-zero', () => {
    expect(playbackProgress(200, 180)).toBe(1);
    expect(playbackProgress(50, 0)).toBe(0);
    expect(playbackProgress(50, NaN)).toBe(0);
    expect(playbackProgress(NaN, 180)).toBe(0);
    expect(playbackProgress(-5, 180)).toBe(0);
  });
});

describe('progressToSeconds', () => {
  it('maps ratio to seconds within range', () => {
    expect(progressToSeconds(0.5, 180)).toBe(90);
    expect(progressToSeconds(0, 180)).toBe(0);
    expect(progressToSeconds(1, 180)).toBe(180);
  });
  it('clamps and guards', () => {
    expect(progressToSeconds(2, 180)).toBe(180);
    expect(progressToSeconds(-1, 180)).toBe(0);
    expect(progressToSeconds(0.5, 0)).toBe(0);
    expect(progressToSeconds(NaN, 180)).toBe(0);
  });
});
