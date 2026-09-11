// 숙대점(2026-09-11) 회귀 방지 — 폰 브라우저로 매장 음악을 틀어두면 경고해야 한다.
// 실제 로그에서 뽑은 UA 를 그대로 쓴다. 오판 하나가 곧 "몰랐던 무음 20분" 이다.
import { describe, it, expect } from 'vitest';
import {
  assessPlaybackDeviceRisk, shouldWarnMobileBrowser,
  type PlaybackDeviceEnv,
} from './mobileBrowserPlaybackRisk';

/** 숙대점 폰 — 09-11 11:22 세션. 12:13 백그라운드 → 15:05 신호 중단. */
const SUKDAE_PHONE =
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
/** 숙대점 PC — 이 구간에서는 끊기지 않았다. */
const SUKDAE_PC =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/30.0 Chrome/143.0.0.0 Safari/537.36';

function env(over: Partial<PlaybackDeviceEnv> = {}): PlaybackDeviceEnv {
  return { native: false, userAgent: SUKDAE_PC, ...over };
}

describe('assessPlaybackDeviceRisk — 숙대점 실제 기기', () => {
  it('숙대점 폰(Android Chrome) → 경고 대상', () => {
    expect(assessPlaybackDeviceRisk(env({ userAgent: SUKDAE_PHONE }))).toBe('mobile_browser');
  });

  it('숙대점 PC(삼성브라우저/X11) → 경고하지 않는다', () => {
    expect(assessPlaybackDeviceRisk(env({ userAgent: SUKDAE_PC }))).toBe('desktop_browser');
  });

  it('같은 폰이라도 네이티브 앱이면 안전 — 포그라운드 서비스가 프로세스를 보호한다', () => {
    // Capacitor WebView 의 UA 에도 'Android' 가 들어 있다. native 를 먼저 보지 않으면
    // 앱을 모바일 브라우저로 오판해 "앱을 설치하세요" 를 앱 안에서 띄우게 된다.
    expect(assessPlaybackDeviceRisk(env({ native: true, userAgent: SUKDAE_PHONE }))).toBe('native_app');
  });
});

describe('assessPlaybackDeviceRisk — 기기 판별', () => {
  it('아이폰 사파리 → 경고 대상', () => {
    const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    expect(assessPlaybackDeviceRisk(env({ userAgent: ua }))).toBe('mobile_browser');
  });

  it('아이패드 사파리는 Macintosh 로 위장한다 — 터치로 잡는다', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(assessPlaybackDeviceRisk(env({ userAgent: ua, hasTouch: true }))).toBe('mobile_browser');
  });

  it('진짜 맥(터치 없음)은 경고하지 않는다', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
    expect(assessPlaybackDeviceRisk(env({ userAgent: ua, hasTouch: false }))).toBe('desktop_browser');
  });

  it('윈도우 크롬 → 경고하지 않는다', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
    expect(assessPlaybackDeviceRisk(env({ userAgent: ua }))).toBe('desktop_browser');
  });

  it('UA 를 못 읽어도 터지지 않는다 — 기록 실패가 재생을 막으면 안 된다', () => {
    expect(assessPlaybackDeviceRisk(env({ userAgent: '' }))).toBe('desktop_browser');
  });
});

describe('shouldWarnMobileBrowser', () => {
  it('폰 브라우저에서만 경고한다', () => {
    expect(shouldWarnMobileBrowser('mobile_browser')).toBe(true);
    expect(shouldWarnMobileBrowser('desktop_browser')).toBe(false);
    expect(shouldWarnMobileBrowser('native_app')).toBe(false);
  });
});
