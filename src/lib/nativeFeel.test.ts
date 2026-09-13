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

describe('화면 전환 — 방향이 있어야 한다', () => {
  it('앞으로/뒤로 각각의 애니메이션이 있다', () => {
    expect(css).toContain('@keyframes app-route-push');
    expect(css).toContain('@keyframes app-route-pop');
  });

  it('애니메이션 줄이기를 켠 사용자에게는 적용하지 않는다', () => {
    const block = css.slice(css.indexOf('.native-shell .app-route-push') - 400);
    expect(block).toContain('prefers-reduced-motion: no-preference');
  });

  it('AppShell 이 Outlet 을 감싼다 — 여기 빠지면 전환이 통째로 죽는다', () => {
    const shell = repoFile('src/components/AppShell.tsx');
    expect(shell).toContain('RouteTransition');
    expect(shell).toMatch(/<RouteTransition>\s*<Outlet\s*\/>/s);
  });
});
