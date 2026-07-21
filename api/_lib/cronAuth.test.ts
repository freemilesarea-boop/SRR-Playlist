import { describe, it, expect } from 'vitest';
import { verifyCronAuth, timingSafeEqualStr, cronAuthErrorResponse } from './cronAuth';

function reqWith(headers: Record<string, string>): Request {
  return new Request('https://example.com/api/cron/x', { headers });
}

describe('verifyCronAuth — fail-closed', () => {
  it('503 CONFIGURATION_ERROR when CRON_SECRET unset/blank', () => {
    expect(verifyCronAuth(reqWith({ authorization: 'Bearer x' }), {})).toEqual({ ok: false, status: 503, code: 'CONFIGURATION_ERROR' });
    expect(verifyCronAuth(reqWith({ authorization: 'Bearer x' }), { CRON_SECRET: '   ' })).toEqual({ ok: false, status: 503, code: 'CONFIGURATION_ERROR' });
  });

  it('401 UNAUTHORIZED when no auth header present', () => {
    expect(verifyCronAuth(reqWith({}), { CRON_SECRET: 'sekret' })).toEqual({ ok: false, status: 401, code: 'UNAUTHORIZED' });
  });

  it('403 FORBIDDEN when secret mismatches', () => {
    expect(verifyCronAuth(reqWith({ authorization: 'Bearer wrong' }), { CRON_SECRET: 'sekret' })).toEqual({ ok: false, status: 403, code: 'FORBIDDEN' });
    expect(verifyCronAuth(reqWith({ 'x-cron-secret': 'wrong' }), { CRON_SECRET: 'sekret' })).toEqual({ ok: false, status: 403, code: 'FORBIDDEN' });
  });

  it('ok via Authorization: Bearer and via x-cron-secret', () => {
    expect(verifyCronAuth(reqWith({ authorization: 'Bearer sekret' }), { CRON_SECRET: 'sekret' })).toEqual({ ok: true });
    expect(verifyCronAuth(reqWith({ 'x-cron-secret': 'sekret' }), { CRON_SECRET: 'sekret' })).toEqual({ ok: true });
  });

  it('does not accept empty provided secret as match even if secret set', () => {
    expect(verifyCronAuth(reqWith({ authorization: 'Bearer ' }), { CRON_SECRET: 'sekret' })).toEqual({ ok: false, status: 401, code: 'UNAUTHORIZED' });
  });
});

describe('timingSafeEqualStr', () => {
  it('equal / unequal / length-mismatch', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });
});

describe('cronAuthErrorResponse', () => {
  it('returns the given status and JSON code, without leaking the secret', async () => {
    const res = cronAuthErrorResponse({ ok: false, status: 403, code: 'FORBIDDEN' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toEqual({ error: 'FORBIDDEN' });
  });
});
