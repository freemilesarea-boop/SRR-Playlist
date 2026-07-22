import { describe, it, expect } from 'vitest';
import {
  resolveBrandAccessState,
  shouldClearStoredBinding,
  deviceLabelFromUA,
  accessStateMessage,
} from './brandDeviceBinding';

describe('resolveBrandAccessState', () => {
  const base = { authReady: true, hasSession: true, hasStoredBinding: true, verifyAttempted: true };
  it('AUTH_LOADING before auth ready', () => {
    expect(resolveBrandAccessState({ ...base, authReady: false })).toBe('AUTH_LOADING');
  });
  it('SIGNED_OUT when no session', () => {
    expect(resolveBrandAccessState({ ...base, hasSession: false })).toBe('SIGNED_OUT');
  });
  it('STORE_CODE_REQUIRED when no stored binding', () => {
    expect(resolveBrandAccessState({ ...base, hasStoredBinding: false })).toBe('STORE_CODE_REQUIRED');
  });
  it('BINDING_CHECKING before verify attempted (no flicker to code screen)', () => {
    expect(resolveBrandAccessState({ ...base, verifyAttempted: false })).toBe('BINDING_CHECKING');
  });
  it('BINDING_CHECKING when verify pending', () => {
    expect(resolveBrandAccessState({ ...base, verify: null })).toBe('BINDING_CHECKING');
  });
  it('ERROR on network error (not infinite loading)', () => {
    expect(resolveBrandAccessState({ ...base, networkError: true })).toBe('ERROR');
  });
  it('AUTHORIZED when verify ok', () => {
    expect(resolveBrandAccessState({ ...base, verify: { ok: true } })).toBe('AUTHORIZED');
  });
  it('REVOKED / EXPIRED map from reason', () => {
    expect(resolveBrandAccessState({ ...base, verify: { ok: false, reason: 'revoked' } })).toBe('REVOKED');
    expect(resolveBrandAccessState({ ...base, verify: { ok: false, reason: 'expired' } })).toBe('EXPIRED');
  });
  it('not_owner / invalid / store_inactive → STORE_CODE_REQUIRED', () => {
    for (const reason of ['not_owner', 'invalid_binding', 'no_binding', 'store_inactive', 'anything']) {
      expect(resolveBrandAccessState({ ...base, verify: { ok: false, reason } })).toBe('STORE_CODE_REQUIRED');
    }
  });
  it('not_authenticated → SIGNED_OUT', () => {
    expect(resolveBrandAccessState({ ...base, verify: { ok: false, reason: 'not_authenticated' } })).toBe('SIGNED_OUT');
  });
});

describe('shouldClearStoredBinding', () => {
  it('clears on invalid/revoked/expired', () => {
    expect(shouldClearStoredBinding('STORE_CODE_REQUIRED')).toBe(true);
    expect(shouldClearStoredBinding('REVOKED')).toBe(true);
    expect(shouldClearStoredBinding('EXPIRED')).toBe(true);
  });
  it('keeps on authorized/checking/loading/error', () => {
    for (const s of ['AUTHORIZED', 'BINDING_CHECKING', 'AUTH_LOADING', 'ERROR', 'SIGNED_OUT'] as const) {
      expect(shouldClearStoredBinding(s)).toBe(false);
    }
  });
});

describe('deviceLabelFromUA', () => {
  it('parses common browser · os', () => {
    expect(deviceLabelFromUA('Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537')).toBe('Chrome · macOS');
    expect(deviceLabelFromUA('Mozilla/5.0 (Windows NT 10.0) Edg/120')).toBe('Edge · Windows');
    expect(deviceLabelFromUA('Mozilla/5.0 (iPad; CPU OS 17) Safari/605')).toBe('Safari · iPad');
    expect(deviceLabelFromUA('Mozilla/5.0 (iPhone; CPU iPhone OS 17) CriOS/120')).toBe('Chrome · iPhone');
    expect(deviceLabelFromUA('Mozilla/5.0 (X11; Linux) Firefox/121')).toBe('Firefox · Linux');
    expect(deviceLabelFromUA('Mozilla/5.0 (Macintosh) Version/17 Safari/605')).toBe('Safari · macOS');
  });
  it('falls back safely', () => {
    expect(deviceLabelFromUA('')).toBe('브라우저 기기');
    expect(deviceLabelFromUA(null)).toBe('브라우저 기기');
    expect(deviceLabelFromUA('weird-agent')).toBe('브라우저');
  });
});

describe('accessStateMessage', () => {
  it('gives safe messages without internal detail', () => {
    expect(accessStateMessage('REVOKED')).toContain('연결이 해제');
    expect(accessStateMessage('EXPIRED')).toContain('만료');
    expect(accessStateMessage('ERROR')).toContain('다시 시도');
    expect(accessStateMessage('AUTHORIZED')).toBe('');
  });
});
