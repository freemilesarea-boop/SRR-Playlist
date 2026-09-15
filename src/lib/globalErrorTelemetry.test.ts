// Phase 27 §9 — 플레이어 **바깥**에서 잡는 전역 예외 기록.
//
// 왜 이게 필요한지는 2026-09-15 숙대점이 답했다. 플레이어 계층이 14:06:16 에
// 멈췄는데 왜 멈췄는지 끝내 알 수 없었다 — 유일한 클라이언트 진단기가
// 플레이어와 함께 죽기 때문이다(그날 12:17 사고엔 3번 flush, 14:05 전후 0번).
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  redact, boundedMessage, errorClass, stackFingerprint, gateReport,
  MAX_MESSAGE_CHARS, MAX_STACK_FRAMES, MAX_FRAME_CHARS,
  DEDUPE_WINDOW_MS, MAX_REPORTS_PER_DOCUMENT,
  __resetGlobalErrorTelemetryForTest,
} from './globalErrorTelemetry';

const R = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

beforeEach(() => __resetGlobalErrorTelemetryForTest());

describe('§9 보고자는 플레이어 밖에 산다', () => {
  it('main.tsx 가 전역 핸들러를 건다 — 컴포넌트가 아니라', () => {
    const main = R('src/main.tsx');
    expect(main).toContain('installGlobalErrorTelemetry()');
  });

  it('Player.tsx 나 BrandPlayerPage 안에서 설치하지 않는다', () => {
    expect(R('src/components/player/Player.tsx')).not.toContain('installGlobalErrorTelemetry');
    expect(R('src/pages/BrandPlayerPage.tsx')).not.toContain('installGlobalErrorTelemetry');
  });

  it('window.error 와 unhandledrejection 둘 다 잡는다', () => {
    const src = R('src/lib/globalErrorTelemetry.ts');
    expect(src).toContain("window.addEventListener('error'");
    expect(src).toContain("window.addEventListener('unhandledrejection'");
  });

  it('리로드를 견디는 경로로 보낸다 (예외 뒤에 이탈이 따라올 수 있다)', () => {
    expect(R('src/lib/globalErrorTelemetry.ts')).toContain('beaconPlaybackDiagnostic');
  });
});

describe('§9 개인정보·무제한 저장 금지', () => {
  it('JWT 로 보이는 값을 지운다', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk';
    expect(redact(`failed with ${jwt}`)).not.toContain(jwt);
  });

  it('토큰 쿼리 파라미터를 지운다', () => {
    const out = redact('GET /rest/v1/x?access_token=supersecretvalue123&y=1');
    expect(out).not.toContain('supersecretvalue123');
  });

  it('긴 무작위 문자열은 앞부분만 남긴다', () => {
    const out = redact('key=abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).toContain('***');
    expect(out).not.toContain('abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('메시지 길이에 상한이 있다', () => {
    const msg = boundedMessage(new Error('x'.repeat(5_000)));
    expect(msg.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  });

  it('스택은 몇 프레임만 남기고 줄번호를 지운다 (배포를 넘어 같은 지문)', () => {
    const err = new Error('boom');
    err.stack = ['Error: boom',
      ...Array.from({ length: 40 }, (_, i) => `    at fn${i} (https://x/assets/a.js:${i}:${i})`),
    ].join('\n');
    const frames = stackFingerprint(err);
    expect(frames.length).toBe(MAX_STACK_FRAMES);
    expect(frames[0]).not.toMatch(/:\d+:\d+/);
    frames.forEach((f) => expect(f.length).toBeLessThanOrEqual(MAX_FRAME_CHARS));
  });

  it('스택이 없으면 빈 배열 — 지어내지 않는다', () => {
    expect(stackFingerprint('just a string')).toEqual([]);
  });

  it('보고 본문에 사용자 입력·트랙 제목을 싣지 않는다', () => {
    const src = R('src/lib/globalErrorTelemetry.ts');
    expect(src).not.toMatch(/title|nickname|email|queue\[/);
    // 라우트는 경로만 — 쿼리/해시 금지
    expect(src).toContain('location.pathname');
    expect(src).not.toContain('location.search');
  });
});

describe('§12-C·J 폭주 방지', () => {
  it('같은 지문은 창 안에서 한 번만', () => {
    expect(gateReport('k', 0).allowed).toBe(true);
    expect(gateReport('k', DEDUPE_WINDOW_MS - 1)).toEqual({ allowed: false, reason: 'duplicate' });
  });

  it('창이 지나면 다시 보낸다', () => {
    gateReport('k', 0);
    expect(gateReport('k', DEDUPE_WINDOW_MS).allowed).toBe(true);
  });

  it('문서 한 수명당 총량 상한이 있다 (24시간 도는 무인 매장)', () => {
    for (let i = 0; i < MAX_REPORTS_PER_DOCUMENT; i++) {
      expect(gateReport(`k${i}`, 0).allowed).toBe(true);
    }
    expect(gateReport('kN', 0)).toEqual({ allowed: false, reason: 'document_limit' });
  });

  it('서로 다른 예외는 서로를 막지 않는다', () => {
    expect(gateReport('a', 0).allowed).toBe(true);
    expect(gateReport('b', 0).allowed).toBe(true);
  });
});

describe('§12-A~C 예외 종류를 구분한다', () => {
  it('Error 하위 클래스 이름을 남긴다', () => {
    expect(errorClass(new TypeError('x'))).toBe('TypeError');
  });

  it('문자열 throw 도 잃지 않는다', () => {
    expect(errorClass('boom')).toBe('String');
    expect(boundedMessage('boom')).toBe('boom');
  });

  it('Promise rejection 의 비-Error reason 도 기록 가능하다', () => {
    expect(errorClass({ message: 'nope' })).toBe('object');
    expect(boundedMessage({ message: 'nope' })).toBe('nope');
  });

  it('null reject 에도 죽지 않는다', () => {
    expect(errorClass(null)).toBe('null');
    expect(() => boundedMessage(null)).not.toThrow();
  });
});

describe('§10 ErrorBoundary 감사 결과를 고정한다', () => {
  it('라우트 전체를 감싸는 ErrorBoundary 는 **없다** — 이 사실을 알고 있어야 한다', () => {
    const app = R('src/App.tsx');
    // Suspense 는 하나뿐이고, 라우트용 ErrorBoundary 는 없다.
    // 따라서 렌더 중 예외는 루트 전체를 내린다 — AppShell 도 같이 죽는다.
    // 2026-09-15 에는 AppShell 이 살아 있었으므로 **렌더 예외가 아니었다.**
    expect(app).toContain('<Suspense fallback={<RouteFallback />}>');
    expect(app).not.toMatch(/<RouteErrorBoundary|<AppErrorBoundary/);
  });

  it('전역 핸들러는 그 경우에도 기록을 남긴다 (window.error 는 렌더 예외도 받는다)', () => {
    expect(R('src/lib/globalErrorTelemetry.ts')).toContain("'error_boundary'");
  });
});
