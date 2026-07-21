import { describe, it, expect } from 'vitest';
import {
  isAllowedAuthOrigin,
  getAuthRedirectOrigin,
  getOAuthCallbackUrl,
  getPasswordResetUrl,
  sanitizeAuthReturnPath,
  CANONICAL_AUTH_ORIGIN,
} from './authRedirect';

const loc = (origin: string) => ({ origin } as Pick<Location, 'origin'>);

describe('isAllowedAuthOrigin', () => {
  it('allows production apex + www', () => {
    expect(isAllowedAuthOrigin('https://deudda.com')).toBe(true);
    expect(isAllowedAuthOrigin('https://www.deudda.com')).toBe(true);
  });
  it('allows vercel preview + production hosts', () => {
    expect(isAllowedAuthOrigin('https://srr-playlist.vercel.app')).toBe(true);
    expect(isAllowedAuthOrigin('https://srr-playlist-git-feat-x.vercel.app')).toBe(true);
  });
  it('allows localhost/127.0.0.1 (http or https)', () => {
    expect(isAllowedAuthOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedAuthOrigin('http://127.0.0.1:3000')).toBe(true);
    expect(isAllowedAuthOrigin('https://localhost')).toBe(true);
  });
  it('rejects unknown / non-https / malformed / empty', () => {
    expect(isAllowedAuthOrigin('https://evil.com')).toBe(false);
    expect(isAllowedAuthOrigin('https://deudda.com.evil.com')).toBe(false);
    expect(isAllowedAuthOrigin('http://www.deudda.com')).toBe(false); // prod must be https
    expect(isAllowedAuthOrigin('https://notvercel.app')).toBe(false);
    expect(isAllowedAuthOrigin('ftp://deudda.com')).toBe(false);
    expect(isAllowedAuthOrigin('not a url')).toBe(false);
    expect(isAllowedAuthOrigin('')).toBe(false);
    expect(isAllowedAuthOrigin(null)).toBe(false);
  });
});

describe('getAuthRedirectOrigin (fail-closed)', () => {
  it('keeps the current origin when allowed (same-origin PKCE preserved)', () => {
    expect(getAuthRedirectOrigin(loc('https://www.deudda.com'))).toBe('https://www.deudda.com');
    expect(getAuthRedirectOrigin(loc('https://deudda.com'))).toBe('https://deudda.com');
    expect(getAuthRedirectOrigin(loc('https://x-git-y.vercel.app'))).toBe('https://x-git-y.vercel.app');
    expect(getAuthRedirectOrigin(loc('http://localhost:5173'))).toBe('http://localhost:5173');
  });
  it('falls back to canonical for disallowed origins', () => {
    expect(getAuthRedirectOrigin(loc('https://evil.com'))).toBe(CANONICAL_AUTH_ORIGIN);
    expect(getAuthRedirectOrigin(loc(''))).toBe(CANONICAL_AUTH_ORIGIN);
  });
});

describe('callback URL builders', () => {
  it('appends /auth/callback and /auth/reset to the resolved origin', () => {
    expect(getOAuthCallbackUrl(loc('https://www.deudda.com'))).toBe('https://www.deudda.com/auth/callback');
    expect(getPasswordResetUrl(loc('https://www.deudda.com'))).toBe('https://www.deudda.com/auth/reset');
    expect(getOAuthCallbackUrl(loc('https://evil.com'))).toBe(`${CANONICAL_AUTH_ORIGIN}/auth/callback`);
  });
});

describe('sanitizeAuthReturnPath (open-redirect guard)', () => {
  it('allows internal absolute paths (with query/hash)', () => {
    expect(sanitizeAuthReturnPath('/')).toBe('/');
    expect(sanitizeAuthReturnPath('/business')).toBe('/business');
    expect(sanitizeAuthReturnPath('/playlist/123?x=1#h')).toBe('/playlist/123?x=1#h');
  });
  it('blocks protocol-relative and backslash tricks', () => {
    expect(sanitizeAuthReturnPath('//evil.com')).toBe('/');
    expect(sanitizeAuthReturnPath('/\\evil.com')).toBe('/');
  });
  it('blocks absolute URLs and relative paths', () => {
    expect(sanitizeAuthReturnPath('https://evil.com')).toBe('/');
    expect(sanitizeAuthReturnPath('http://evil.com')).toBe('/');
    expect(sanitizeAuthReturnPath('business')).toBe('/');
  });
  it('blocks control-character obfuscation', () => {
    expect(sanitizeAuthReturnPath('/foo\nbar')).toBe('/');
    expect(sanitizeAuthReturnPath('/\tfoo')).toBe('/');
  });
  it('empty/null → fallback (custom fallback respected)', () => {
    expect(sanitizeAuthReturnPath(null)).toBe('/');
    expect(sanitizeAuthReturnPath('')).toBe('/');
    expect(sanitizeAuthReturnPath('//evil', '')).toBe('');
  });
});
