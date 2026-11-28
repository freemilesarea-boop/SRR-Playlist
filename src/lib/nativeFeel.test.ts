/**
 * "앱 같은 느낌" 을 만드는 규칙들이 살아 있는지 고정한다.
 *
 * 이것들은 화면에 눈에 띄는 요소가 아니라서, 리팩터링 중에 조용히 사라져도 아무도 모른다.
 * 그런데 하나만 빠져도 즉시 "웹뷰" 로 읽힌다 — 길게 눌렀더니 글자가 선택되거나,
 * 라이트 모드인데 상태바만 검거나, 화면이 툭 바뀌거나.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function repoFile(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

const css = repoFile('src/index.css');

describe('길게 누르기 — 본문 글자가 선택되면 안 된다', () => {
  it('앱 전체에서 선택과 길게누르기 말풍선을 끈다', () => {
    expect(css).toContain('-webkit-touch-callout: none');
    expect(css).toMatch(/\.native-shell\s*\{[^}]*user-select:\s*none/s);
  });

  it('입력란은 예외 — 글자를 못 고치면 앱을 못 쓴다', () => {
    expect(css).toContain('.native-shell input');
    expect(css).toContain('.native-shell textarea');
  });

  it('복사해야 하는 값(코드·ID)은 예외로 열어둔다', () => {
    // 매장 코드처럼 복사해서 옮겨야 하는 값이 있다. 전부 막으면 그걸 못 쓴다.
    expect(css).toContain('.native-shell code');
    expect(css).toContain('.native-shell .app-selectable');
  });
});

describe('상태바 — 테마를 따라가야 한다', () => {
  const native = repoFile('src/lib/native.ts');

  it('다크로 고정하지 않는다', () => {
    // 예전에는 Style.Dark + #0a0a0a 하드코딩이었다. 라이트 모드에서 위쪽 한 줄만 검게 남았다.
    expect(native).not.toContain("setBackgroundColor({ color: '#0a0a0a' })");
    expect(native).toContain('syncNativeStatusBar');
  });

  it('테마가 바뀌면 다시 맞춘다', () => {
    expect(native).toContain('useThemeStore.subscribe');
  });
});

describe('촉감 — 누를 때 울려야 한다', () => {
  it('부팅 시 한 번 붙인다', () => {
    expect(repoFile('src/lib/native.ts')).toContain('installTapHaptics');
  });

  it('플러그인이 의존성에 있다', () => {
    const pkg = JSON.parse(repoFile('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@capacitor/haptics']).toBeTruthy();
  });
});

describe('태블릿 2단 — 넓은 화면을 쓰고 스크롤을 줄인다', () => {
  // 태블릿 구간은 짧은 변 기준이다(가로·세로를 함께 본다). width 만 보면 폰 가로가 섞인다.
  const TABLET_AT = '@media (min-width: 700px) and (min-height: 600px)';
  const tablet = css.slice(css.indexOf(TABLET_AT));
  const beforeTablet = css.slice(0, css.indexOf(TABLET_AT));

  it('폰을 눕힌 화면은 태블릿이 아니다 — 높이 조건이 있어야 한다', () => {
    // 아이폰 16 Pro Max 가로는 956px 다. width 조건만 있으면 여기로 들어온다.
    expect(css).toContain(TABLET_AT);
    expect(css).not.toMatch(/@media \(min-width: 1024px\)\s*\{[^}]*app-store-grid/s);
  });

  it('매장 대시보드 2단은 태블릿에서만 — 폰에서 2단이 되면 아무것도 안 보인다', () => {
    expect(tablet).toContain('.native-shell .app-store-grid');
    expect(beforeTablet).not.toContain('.native-shell .app-store-grid');
  });

  it('래퍼는 평소 contents — 폰·웹에서는 없는 것처럼 동작해야 한다', () => {
    // contents 가 빠지면 래퍼가 실제 박스가 되어 웹 레이아웃까지 바뀐다.
    expect(repoFile('src/pages/BusinessPage.tsx')).toContain('app-store-grid contents');
    expect(repoFile('src/pages/BusinessPage.tsx')).toContain('app-store-main');
    expect(repoFile('src/pages/BusinessPage.tsx')).toContain('app-store-side');
  });

  it('루트가 flex+gap 이어야 한다 — space-y 는 contents 래퍼를 넘지 못한다', () => {
    // space-y 로 두면 래퍼가 contents 일 때 섹션 사이 간격이 통째로 사라진다.
    const biz = repoFile('src/pages/BusinessPage.tsx');
    expect(biz).toContain('flex flex-col gap-5');
    expect(biz).not.toContain('<div className="space-y-5 px-4 pb-8 pt-6 sm:px-6 lg:space-y-6">');
  });

  it('설정 화면 다단도 태블릿에서만', () => {
    expect(tablet).toContain('.native-shell .app-settings-cols');
    expect(beforeTablet).not.toContain('.native-shell .app-settings-cols');
    expect(repoFile('src/pages/ProfilePage.tsx')).toContain('app-settings-cols');
  });

  it('다단에서 space-y 의 위쪽 여백을 지운다 — 안 지우면 두 단이 어긋난다', () => {
    expect(tablet).toMatch(/\.app-settings-cols > \* \+ \*\s*\{[^}]*margin-top:\s*0/s);
  });
});

describe('화면 전환 — 방향이 있어야 한다', () => {
  it('앞으로/뒤로 각각의 애니메이션이 있다', () => {
    expect(css).toContain('@keyframes app-route-push');
    expect(css).toContain('@keyframes app-route-pop');
  });

  it('애니메이션 줄이기를 켠 사용자에게는 적용하지 않는다', () => {
    const block = css.slice(css.indexOf('.native-shell .app-route-push') - 400);
    expect(block).toContain('prefers-reduced-motion: no-preference');
  });

  it('fill-mode 는 backwards — both 면 transform 이 남아 z-index 가 갇힌다', () => {
    // 실제로 당했다: both 로 두니 애니메이션이 끝나도 transform(matrix) 이 남아
    // 래퍼가 stacking context 가 됐고, 매장 플레이어(z-[90]) 가 하단탭(z-30) 아래로 깔렸다.
    // 전체화면이어야 할 화면 위로 탭바와 미니 플레이어가 떠 있었다.
    expect(css).toMatch(/app-route-push [^;]*backwards/);
    expect(css).toMatch(/app-route-pop [^;]*backwards/);
    expect(css).not.toMatch(/app-route-(push|pop) [^;]*\bboth\b/);
  });

  it('전환이 끝나면 클래스를 뗀다 — transform 흔적을 남기지 않는다', () => {
    expect(repoFile('src/components/native/RouteTransition.tsx')).toContain('animationend');
  });

  it('AppShell 이 Outlet 을 감싼다 — 여기 빠지면 전환이 통째로 죽는다', () => {
    const shell = repoFile('src/components/AppShell.tsx');
    expect(shell).toContain('RouteTransition');
    expect(shell).toMatch(/<RouteTransition>\s*<Outlet\s*\/>/s);
  });
});
