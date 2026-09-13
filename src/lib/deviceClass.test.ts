import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { isTabletSize, currentDeviceIsTablet, TABLET_MIN_SIDE } from '@/lib/deviceClass';

// 실제로 팔리는 기기 크기. 이 표가 바뀌면 판정 기준도 다시 봐야 한다.
const PHONES: Array<[string, number, number]> = [
  ['iPhone SE', 375, 667],
  ['iPhone 13 mini', 375, 812],
  ['iPhone 15', 393, 852],
  ['iPhone 16 Pro Max', 440, 956],
  ['Galaxy S24', 360, 780],
  ['Galaxy S24 Ultra', 412, 915],
  ['Pixel 8 Pro', 448, 998],
];

const TABLETS: Array<[string, number, number]> = [
  ['iPad mini', 744, 1133],
  ['iPad 10.9', 820, 1180],
  ['iPad Pro 11', 834, 1194],
  ['iPad Pro 13', 1024, 1366],
  ['Galaxy Tab S9', 753, 1205],
  ['매장 태블릿(가로)', 1280, 800],
];

describe('isTabletSize', () => {
  it.each(PHONES)('%s 는 폰이다', (_name, w, h) => {
    expect(isTabletSize(w, h)).toBe(false);
    // 눕혀도 폰이다 — 짧은 변으로 보기 때문.
    expect(isTabletSize(h, w)).toBe(false);
  });

  it.each(TABLETS)('%s 는 태블릿이다', (_name, w, h) => {
    expect(isTabletSize(w, h)).toBe(true);
    expect(isTabletSize(h, w)).toBe(true);
  });

  it('경계값은 600 포함이다', () => {
    expect(isTabletSize(TABLET_MIN_SIDE, 1000)).toBe(true);
    expect(isTabletSize(TABLET_MIN_SIDE - 1, 1000)).toBe(false);
  });

  it('값이 없으면 폰으로 본다', () => {
    // 폰 레이아웃이 태블릿보다 안전하다 — 태블릿에서 폰 화면은 좀 허전할 뿐이지만
    // 폰에서 태블릿 화면은 잘린다.
    expect(isTabletSize(NaN, 800)).toBe(false);
    expect(isTabletSize(800, Infinity)).toBe(false);
  });
});

describe('currentDeviceIsTablet', () => {
  // jsdom 을 쓰지 않는 테스트 환경이라 window 를 직접 세운다.
  const g = globalThis as { window?: unknown };
  const had = 'window' in g;
  const prev = g.window;
  const setViewport = (innerWidth: number, innerHeight: number) => {
    g.window = { innerWidth, innerHeight };
  };
  afterEach(() => {
    if (had) g.window = prev;
    else delete g.window;
  });

  it('창 크기를 그대로 읽는다', () => {
    setViewport(1280, 800);
    expect(currentDeviceIsTablet()).toBe(true);

    setViewport(412, 915);
    expect(currentDeviceIsTablet()).toBe(false);
  });

  it('window 가 없으면(SSR·빌드 시점) 폰으로 본다', () => {
    if (had) delete g.window;
    expect(currentDeviceIsTablet()).toBe(false);
  });
});

describe('화면 높이 단위', () => {
  // 모바일 브라우저에서 100vh 는 주소창을 뺀 높이가 아니다. 그래서 로그인 화면이
  // 항상 조금 잘리고 하단 버튼이 주소창 밑으로 숨었다. dvh 는 그걸 고친다.
  it('vh 계열 높이 클래스가 남아있지 않다', () => {
    const out = execSync(
      // 앞에 글자가 붙은 건 클래스가 아니다(@capacitor/splash-screen 같은 패키지명).
      "grep -rn -E '(^|[^a-zA-Z-])(min-h-screen|max-h-screen|h-screen)|100vh' src" +
        ' --include=*.tsx --include=*.ts --include=*.css | grep -v deviceClass.test || true',
      { encoding: 'utf8' },
    ).trim();
    expect(out).toBe('');
  });
});
