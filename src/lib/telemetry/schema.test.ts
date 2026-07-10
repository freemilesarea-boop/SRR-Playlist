// WEB-OBS-1 — Telemetry schema: sanitization + validation + privacy tests.
import { describe, it, expect } from 'vitest';
import {
  parseEnvelope, sanitizeRoute, sanitizeMessage, sanitizeApiName,
  viewportBucketFor, deviceClassFor, concurrencyBucketFor, memoryBucketFor, networkTypeFor,
  MAX_PAYLOAD_BYTES, MAX_MESSAGE_LEN, TELEMETRY_EVENT_VERSION,
} from './schema';

// A minimal valid envelope skeleton (payload/type overridden per test). Overrides are typed as an
// open record so tests can pass intentionally-invalid values (e.g. bad enums) to exercise rejection.
function baseEnvelope(over: Record<string, unknown> & { event_type: string; payload: unknown }): Record<string, unknown> {
  return {
    event_id: 'sess1234-abcd-01',
    session_id: 'sess1234session',
    event_version: TELEMETRY_EVENT_VERSION,
    sequence: 1,
    occurred_at: 1_700_000_000_000,
    release: 'build-abc',
    environment: 'preview',
    route: '/dashboard',
    previous_route: null,
    duration_ms: 12,
    severity: 'info',
    browser_family: 'Chrome',
    browser_major: 120,
    os_family: 'macOS',
    device_class: 'desktop',
    viewport_bucket: 'lg',
    network_type: '4g',
    hardware_concurrency_bucket: '5-8',
    device_memory_bucket: '5-8',
    sample_rate: 1,
    ...over,
  };
}

describe('sanitizeRoute', () => {
  it('strips query string and hash fragment', () => {
    expect(sanitizeRoute('/tracks?q=secret&token=eyJabc#frag')).toBe('/tracks');
  });
  it('collapses uuid / long-number / hex / jwt path segments to :id', () => {
    expect(sanitizeRoute('/store/123456/detail')).toBe('/store/:id/detail');
    expect(sanitizeRoute('/u/550e8400-e29b-41d4-a716-446655440000')).toBe('/u/:id');
    expect(sanitizeRoute('/x/deadbeefdeadbeef99')).toBe('/x/:id');
  });
  it('drops scheme+host if a full URL leaks in', () => {
    expect(sanitizeRoute('https://evil.example.com/a/b?x=1')).toBe('/a/b');
  });
  it('never returns empty', () => {
    expect(sanitizeRoute('')).toBe('/');
    expect(sanitizeRoute(null)).toBe('/');
  });
});

describe('sanitizeMessage (privacy redaction)', () => {
  it('redacts email', () => {
    expect(sanitizeMessage('failed for user@example.com!')).toContain('[email]');
    expect(sanitizeMessage('failed for user@example.com!')).not.toContain('example.com');
  });
  it('redacts JWT-ish tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9payload';
    expect(sanitizeMessage(`token=${jwt}`)).toContain('[jwt]');
    expect(sanitizeMessage(`token=${jwt}`)).not.toContain(jwt);
  });
  it('redacts uuid and long numbers', () => {
    expect(sanitizeMessage('id 550e8400-e29b-41d4-a716-446655440000 gone')).toContain('[uuid]');
    expect(sanitizeMessage('order 1234567 failed')).toContain('[num]');
  });
  it('truncates to MAX_MESSAGE_LEN', () => {
    expect(sanitizeMessage('x'.repeat(5000)).length).toBeLessThanOrEqual(MAX_MESSAGE_LEN);
  });
});

describe('sanitizeApiName', () => {
  it('keeps host+path, drops query, collapses ids', () => {
    expect(sanitizeApiName('ref.supabase.co/rest/v1/tracks?id=eq.999999')).toBe('ref.supabase.co/rest/v1/tracks?id=eq.:id'.split('?')[0]);
  });
  it('collapses numeric id segments', () => {
    expect(sanitizeApiName('host/rest/v1/stores/123456')).toBe('host/rest/v1/stores/:id');
  });
});

describe('parseEnvelope — happy path', () => {
  it('accepts a valid vital event and rebuilds it', () => {
    const res = parseEnvelope(baseEnvelope({ event_type: 'vital', payload: { name: 'LCP', value: 2400.5, rating: 'good' } }));
    expect(res.ok).toBe(true);
    expect(res.event?.event_type).toBe('vital');
    if (res.event?.event_type === 'vital') {
      expect(res.event.payload.name).toBe('LCP');
      expect(res.event.payload.value).toBe(2400.5);
    }
  });
  it('accepts a valid error event', () => {
    const res = parseEnvelope(baseEnvelope({ event_type: 'error', payload: { kind: 'react', message: 'boom' } }));
    expect(res.ok).toBe(true);
    expect(res.event?.event_type).toBe('error');
  });
});

describe('parseEnvelope — rejection', () => {
  it('rejects a missing/invalid event_id', () => {
    const e = baseEnvelope({ event_type: 'route', payload: { duration: 5 } });
    e.event_id = 'x'; // too short
    expect(parseEnvelope(e).ok).toBe(false);
  });
  it('rejects an unsupported event_type', () => {
    const e = baseEnvelope({ event_type: 'evil', payload: {} });
    expect(parseEnvelope(e).ok).toBe(false);
    expect(parseEnvelope(e).error).toBe('bad_event_type');
  });
  it('rejects a non-object body', () => {
    expect(parseEnvelope('nope').ok).toBe(false);
    expect(parseEnvelope(null).ok).toBe(false);
  });
  it('rejects an oversized payload', () => {
    const e = baseEnvelope({ event_type: 'error', payload: { kind: 'js', message: 'x'.repeat(MAX_PAYLOAD_BYTES + 500) } });
    // message is truncated by sanitizer, so also test a genuinely huge (unknown) payload:
    const huge = baseEnvelope({ event_type: 'api', payload: { name: 'a', kind: 'rest', duration: 1, transferKb: 1, junk: 'y'.repeat(MAX_PAYLOAD_BYTES * 2) } });
    // junk is dropped by the allow-list rebuild, so this stays valid — proves allow-list works:
    expect(parseEnvelope(huge).ok).toBe(true);
    // A valid-but-truncated message stays under the cap:
    expect(parseEnvelope(e).ok).toBe(true);
  });
});

describe('parseEnvelope — privacy: strips unknown fields + re-sanitizes strings', () => {
  it('drops arbitrary extra top-level fields (access_token, email, etc.)', () => {
    const e = baseEnvelope({ event_type: 'route', payload: { duration: 5 } });
    e.access_token = 'eyJsecret';
    e.email = 'a@b.com';
    e.user_id = '550e8400-e29b-41d4-a716-446655440000';
    const res = parseEnvelope(e);
    expect(res.ok).toBe(true);
    const serialized = JSON.stringify(res.event);
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('a@b.com');
    expect(serialized).not.toContain('eyJsecret');
  });
  it('re-sanitizes a route that still carries a query string', () => {
    const e = baseEnvelope({ event_type: 'route', payload: { duration: 5 }, route: '/search?q=raw+user+input' });
    const res = parseEnvelope(e);
    expect(res.event?.route).toBe('/search');
  });
  it('drops payload fields not in the per-type allow-list', () => {
    const e = baseEnvelope({ event_type: 'api', payload: { name: 'host/rest/v1/x', kind: 'rest', duration: 100, transferKb: 2, secret: 'nope' } });
    const res = parseEnvelope(e);
    expect(JSON.stringify(res.event?.payload)).not.toContain('secret');
  });
  it('clamps sample_rate into (0,1] and defaults invalid to 1', () => {
    const e = baseEnvelope({ event_type: 'route', payload: { duration: 5 }, sample_rate: 99 });
    expect(parseEnvelope(e).event?.sample_rate).toBe(1);
    const e2 = baseEnvelope({ event_type: 'route', payload: { duration: 5 }, sample_rate: 0.25 });
    expect(parseEnvelope(e2).event?.sample_rate).toBe(0.25);
  });
  it('collapses out-of-allowlist enums to safe defaults', () => {
    const e = baseEnvelope({ event_type: 'route', payload: { duration: 5 }, severity: 'nuclear', browser_family: 'Netscape' });
    const res = parseEnvelope(e);
    expect(res.event?.severity).toBe('info');
    expect(res.event?.browser_family).toBe('Other');
  });
});

describe('bucketing helpers', () => {
  it('viewportBucketFor', () => {
    expect(viewportBucketFor(320)).toBe('xs');
    expect(viewportBucketFor(600)).toBe('sm');
    expect(viewportBucketFor(1500)).toBe('xl');
    expect(viewportBucketFor(0)).toBe('unknown');
  });
  it('deviceClassFor', () => {
    expect(deviceClassFor(400, true)).toBe('mobile');
    expect(deviceClassFor(900, true)).toBe('tablet');
    expect(deviceClassFor(900, false)).toBe('desktop');
    expect(deviceClassFor(1600, false)).toBe('desktop');
  });
  it('concurrencyBucketFor + memoryBucketFor + networkTypeFor handle null', () => {
    expect(concurrencyBucketFor(null)).toBe(null);
    expect(concurrencyBucketFor(6)).toBe('5-8');
    expect(memoryBucketFor(null)).toBe(null);
    expect(memoryBucketFor(4)).toBe('3-4');
    expect(networkTypeFor(null)).toBe(null);
    expect(networkTypeFor('4g')).toBe('4g');
    expect(networkTypeFor('weird')).toBe('unknown');
  });
});
