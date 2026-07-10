// WEB-OBS-1 — Sampling: session-stable decisions + errors-never-sampled tests.
import { describe, it, expect } from 'vitest';
import { hash32, sessionUniform, decideSampling } from './sampling';

describe('hash32 / sessionUniform', () => {
  it('is deterministic', () => {
    expect(hash32('abc')).toBe(hash32('abc'));
    expect(sessionUniform('s1', 'api')).toBe(sessionUniform('s1', 'api'));
  });
  it('produces a value in [0,1)', () => {
    for (const s of ['a', 'b', 'session-xyz', 'zzz']) {
      const u = sessionUniform(s, 'api');
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
  it('varies across sessions/types', () => {
    expect(sessionUniform('s1', 'api')).not.toBe(sessionUniform('s2', 'api'));
    expect(sessionUniform('s1', 'api')).not.toBe(sessionUniform('s1', 'memory'));
  });
});

describe('decideSampling', () => {
  it('always keeps errors at rate 1 (never sampled)', () => {
    for (const s of ['s1', 's2', 's3']) {
      const d = decideSampling(s, 'error', 0.001);
      expect(d.keep).toBe(true);
      expect(d.rate).toBe(1);
    }
  });
  it('always keeps route + vital (rate 1) regardless of base', () => {
    expect(decideSampling('s1', 'route', 0.01).keep).toBe(true);
    expect(decideSampling('s1', 'vital', 0.01).keep).toBe(true);
  });
  it('is stable for a session+type across repeated calls', () => {
    const a = decideSampling('stable-session', 'api', 0.5);
    const b = decideSampling('stable-session', 'api', 0.5);
    expect(a.keep).toBe(b.keep);
    expect(a.rate).toBe(b.rate);
  });
  it('records the sample rate on sampled streams', () => {
    expect(decideSampling('s', 'api', 0.25).rate).toBe(0.25);
  });
  it('base 1 keeps everything; base ~0 drops sampleable streams', () => {
    expect(decideSampling('s', 'api', 1).keep).toBe(true);
    expect(decideSampling('s', 'api', 0).keep).toBe(false);
  });
  it('roughly honors the rate across many sessions', () => {
    let kept = 0;
    const N = 2000;
    for (let i = 0; i < N; i++) if (decideSampling(`sess-${i}`, 'longtask', 0.25).keep) kept++;
    const frac = kept / N;
    expect(frac).toBeGreaterThan(0.18);
    expect(frac).toBeLessThan(0.32);
  });
});
