/**
 * 하단 레이아웃 회귀 — 미니플레이어가 하단탭에 가리지 않도록.
 *
 * 원래는 미니플레이어 bottom 이 5.25rem / 5.5rem 으로 박혀 있었다. 그 값에는
 * env(safe-area-inset-bottom) 이 빠져 있어서, 제스처바가 있는 기기에서는 하단탭이
 * 그만큼 위로 올라와 미니플레이어를 덮었다(탭 z-30 > 플레이어 z-20).
 * inset 이 0 인 웹·에뮬레이터에서는 멀쩡해 보여서 더 늦게 발견됐다.
 *
 * 고치는 방법이 "다른 숫자를 박는 것" 으로 되돌아가지 않도록 못을 박는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

/** 주석 안의 예시 값("bottom: 1rem 을 되돌린다")까지 규칙으로 읽히지 않도록 걷어낸다. */
const stripComments = (c: string): string => c.replace(/\/\*[\s\S]*?\*\//g, '');

const css = stripComments(repo('src/index.css'));
const player = repo('src/components/player/Player.tsx');
const nav = repo('src/components/BottomNav.tsx');

describe('미니플레이어 위치', () => {
  it('하단탭 실측 높이(--app-nav-h)를 기준으로 계산한다', () => {
    expect(css).toMatch(/\.app-player\s*\{[^}]*--app-nav-h/);
  });

  it('bottom 을 rem 상수로 박지 않는다', () => {
    // Tailwind 임의값(bottom-[5.25rem] 등)이 다시 들어오면 기기별로 다시 겹친다.
    expect(player).not.toMatch(/bottom-\[\d/);
    expect(player).not.toMatch(/sm:bottom-\[\d/);
  });

  it('네이티브 오버라이드도 같은 변수를 쓴다', () => {
    const native = css.match(/\.native-shell \.app-player \{[^}]*\}/)?.[0] ?? '';
    expect(native).toContain('--app-nav-h');
    expect(native).not.toMatch(/bottom:\s*\d+(\.\d+)?rem/);
  });
});

describe('하단탭 실측', () => {
  it('BottomNav 가 자기 높이를 --app-nav-h 로 올린다', () => {
    expect(nav).toContain("useMeasuredCssVar('--app-nav-h')");
    // 측정 대상은 pb-safe 를 포함한 <nav> 자신이어야 한다(safe-area 가 높이에 들어간다).
    expect(nav).toMatch(/<nav\s+ref=\{navRef/);
  });

  it('미니플레이어도 자기 높이를 올린다 (콘텐츠 하단 여백 계산용)', () => {
    expect(player).toContain("useMeasuredCssVar('--app-player-h')");
  });
});

describe('콘텐츠 하단 여백', () => {
  it('두 바의 실측 높이를 더해서 잡는다', () => {
    const space = css.match(/\.native-shell \.app-footer-space \{[^}]*\}/)?.[0] ?? '';
    expect(space).toContain('--app-nav-h');
    expect(space).toContain('--app-player-h');
    expect(space).not.toMatch(/padding-bottom:\s*\d+(\.\d+)?rem\s*!important/);
  });
});

describe('앱 스크롤 비용', () => {
  it('네이티브에서는 유리 효과(backdrop-filter)를 끈다', () => {
    // 화면 하단에 blur 두 겹이 fixed 로 떠 있으면 WebView 스크롤이 프레임마다 재합성된다.
    expect(css).toMatch(/\.native-shell \.glass[\s\S]{0,200}backdrop-filter:\s*none/);
  });

  it('웹의 유리 효과는 그대로 둔다', () => {
    expect(css).toMatch(/\.glass\s*\{[\s\S]{0,120}backdrop-blur/);
  });
});
