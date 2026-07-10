// Phase WEB-OPT-2 — 부팅 복구 순수 로직 단위 테스트.
// (RootErrorBoundary 의 DOM 렌더 테스트는 현재 레포에 jsdom/@testing-library 미설치로 실행하지 않음 →
//  설치 없이 검증 가능한 복구 판정 로직만 여기서 커버. 최종 보고에 DOM 테스트 NOT RUN 명시.)
import { describe, it, expect } from 'vitest';
import {
  isChunkLoadError, decideChunkAction, shouldRunOnce, shouldReloadForUpdatedSw,
  nextRecoveryAttempt, isAppCacheName, buildBootDiag, sanitizePath, isDiagSafe,
  MAX_BOOT_RECOVERY_ATTEMPTS,
} from './bootRecovery';

describe('isChunkLoadError (알려진 패턴만, 광범위 매칭 금지)', () => {
  it('대표 chunk 오류 메시지 감지', () => {
    expect(isChunkLoadError(new Error('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading chunk 123 failed'))).toBe(true);
    expect(isChunkLoadError(new Error('Loading CSS chunk foo failed'))).toBe(true);
    expect(isChunkLoadError('error loading dynamically imported module')).toBe(true);
  });
  it("name==='ChunkLoadError' 감지", () => {
    const e = new Error('boom'); e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });
  it('일반 런타임 오류는 chunk 오류로 오판하지 않음', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
    expect(isChunkLoadError(new Error('fetch failed'))).toBe(false); // 광범위 /fetch/ 매칭 안 함
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('')).toBe(false);
  });
});

describe('decideChunkAction (offline / 1회 제한)', () => {
  it('online + 미시도 → reload', () => {
    expect(decideChunkAction({ alreadyReloadedThisBuild: false, online: true })).toBe('reload');
  });
  it('offline → 무조건 rethrow(불필요 reload 금지)', () => {
    expect(decideChunkAction({ alreadyReloadedThisBuild: false, online: false })).toBe('rethrow');
  });
  it('이미 이 build 에서 reload 함 → rethrow(무한 reload 방지)', () => {
    expect(decideChunkAction({ alreadyReloadedThisBuild: true, online: true })).toBe('rethrow');
  });
});

describe('shouldRunOnce (build 스코프 1회 가드)', () => {
  it("미실행(null) → true, 이미 '1' → false", () => {
    expect(shouldRunOnce(null)).toBe(true);
    expect(shouldRunOnce('1')).toBe(false);
  });
});

describe('shouldReloadForUpdatedSw (첫방문 + 중복 reload 방지)', () => {
  it('기존 controller 존재 + 미reload → reload(정상 업데이트)', () => {
    expect(shouldReloadForUpdatedSw({ hadInitialController: true, alreadyReloaded: false })).toBe(true);
  });
  it('최초 방문(controller 없음) → reload 안 함(clientsClaim 첫방문 reload 방지)', () => {
    expect(shouldReloadForUpdatedSw({ hadInitialController: false, alreadyReloaded: false })).toBe(false);
  });
  it('이미 reload 함 → 재reload 안 함(controllerchange+SW_ACTIVATED 중복 방지)', () => {
    expect(shouldReloadForUpdatedSw({ hadInitialController: true, alreadyReloaded: true })).toBe(false);
  });
});

describe('nextRecoveryAttempt (bounded 복구)', () => {
  it('첫 시도는 허용, 한도 초과는 불허', () => {
    expect(nextRecoveryAttempt(0)).toEqual({ attempt: 1, allowed: true });
    expect(nextRecoveryAttempt(1)).toEqual({ attempt: 2, allowed: false }); // MAX=1
  });
  it('MAX 파라미터 반영', () => {
    expect(nextRecoveryAttempt(1, 2)).toEqual({ attempt: 2, allowed: true });
    expect(nextRecoveryAttempt(2, 2)).toEqual({ attempt: 3, allowed: false });
  });
  it('비정상 prev(NaN/음수) → 0 취급', () => {
    expect(nextRecoveryAttempt(NaN)).toEqual({ attempt: 1, allowed: true });
    expect(nextRecoveryAttempt(-5)).toEqual({ attempt: 1, allowed: true });
  });
  it('기본 한도 상수 확인', () => { expect(MAX_BOOT_RECOVERY_ATTEMPTS).toBe(1); });
});

describe('isAppCacheName (앱 캐시만 삭제 대상)', () => {
  it('workbox/precache 계열만 true', () => {
    expect(isAppCacheName('workbox-precache-v2-https://x/')).toBe(true);
    expect(isAppCacheName('srr-audio')).toBe(true);
    expect(isAppCacheName('deudda-x')).toBe(true);
    expect(isAppCacheName('some-precache')).toBe(true);
  });
  it('무관 캐시는 false(무차별 삭제 방지)', () => {
    expect(isAppCacheName('third-party-images')).toBe(false);
    expect(isAppCacheName('google-fonts')).toBe(false);
  });
});

describe('sanitizePath / buildBootDiag / isDiagSafe (PII 안전)', () => {
  it('query/hash 제거하여 pathname 만', () => {
    expect(sanitizePath('/auth/callback#access_token=abc&refresh_token=def')).toBe('/auth/callback');
    expect(sanitizePath('/x?token=secret')).toBe('/x');
    expect(sanitizePath('')).toBe('/');
    expect(sanitizePath(null)).toBe('/');
    expect(sanitizePath('/business/player')).toBe('/business/player');
  });
  it('buildBootDiag 는 pathname 만 담고 토큰/이메일 키 없음', () => {
    const d = buildBootDiag({ path: '/auth/callback#access_token=xyz', online: true, hasController: false, attempt: 1, reason: 'watchdog' });
    expect(d.path).toBe('/auth/callback');
    expect(d.build).toBeDefined();
    expect(d.online).toBe(true);
    expect(d.hasController).toBe(false);
    expect(d.attempt).toBe(1);
    expect(isDiagSafe(d as unknown as Record<string, unknown>)).toBe(true);
  });
  it('isDiagSafe 는 민감 키/값을 거부', () => {
    expect(isDiagSafe({ path: '/x', build: 'b' })).toBe(true);
    expect(isDiagSafe({ access_token: 'x' })).toBe(false);
    expect(isDiagSafe({ email: 'a@b.com' })).toBe(false);
    expect(isDiagSafe({ note: 'Bearer abc123' })).toBe(false);
    expect(isDiagSafe({ path: '/cb#access_token=leak' })).toBe(false);
  });
});
