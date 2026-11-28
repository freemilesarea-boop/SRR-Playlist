import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { syncThemeColorMeta } from '@/lib/timeTheme';

/**
 * 아이폰·아이패드는 지금 PWA 로만 돈다. 네이티브 StatusBar 플러그인이 없으니
 * 브라우저 크롬 색을 정하는 건 theme-color 메타 태그 하나뿐이다.
 */

type FakeMeta = { name: string; content: string };

const g = globalThis as {
  document?: unknown;
  getComputedStyle?: unknown;
};
const hadDoc = 'document' in g;
const hadCS = 'getComputedStyle' in g;

function install(bgTriplet: string, withExistingMeta: boolean) {
  const existing: FakeMeta | null = withExistingMeta
    ? { name: 'theme-color', content: '#0a0a0a' }
    : null;
  const appended: FakeMeta[] = [];
  const root = {};
  g.document = {
    documentElement: root,
    head: { appendChild: (m: FakeMeta) => appended.push(m) },
    createElement: () => ({ name: '', content: '' }) as FakeMeta,
    querySelector: (sel: string) => (sel.includes('theme-color') ? existing : null),
  };
  g.getComputedStyle = () => ({ getPropertyValue: () => bgTriplet });
  return { existing, appended };
}

afterEach(() => {
  if (!hadDoc) delete g.document;
  if (!hadCS) delete g.getComputedStyle;
});

describe('syncThemeColorMeta', () => {
  it('있는 메타 태그의 색을 지금 배경색으로 바꾼다', () => {
    const { existing } = install('250 250 250', true);
    syncThemeColorMeta();
    expect(existing?.content).toBe('#fafafa');
  });

  it('메타 태그가 없으면 만들어 붙인다', () => {
    const { appended } = install('10 10 10', false);
    syncThemeColorMeta();
    expect(appended).toHaveLength(1);
    expect(appended[0].name).toBe('theme-color');
    expect(appended[0].content).toBe('#0a0a0a');
  });

  it('색을 못 읽으면 건드리지 않는다', () => {
    const { existing } = install('', true);
    syncThemeColorMeta();
    expect(existing?.content).toBe('#0a0a0a');
  });

  it('document 가 없어도 던지지 않는다', () => {
    if (hadDoc) delete g.document;
    expect(() => syncThemeColorMeta()).not.toThrow();
  });
});

describe('테마 적용 경로', () => {
  it('applyThemeAttributes 가 메타 갱신까지 같이 한다', () => {
    // 여기서 부르지 않으면 테마 토글은 되는데 상태바만 옛 색으로 남는다.
    const src = readFileSync(resolve(process.cwd(), 'src/lib/timeTheme.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function applyThemeAttributes'));
    expect(body.slice(0, body.indexOf('\n}'))).toContain('syncThemeColorMeta()');
  });

  it('index.html 에 viewport-fit=cover 가 있다', () => {
    // 이게 없으면 iOS 에서 env(safe-area-inset-*) 이 전부 0 이 된다 — pb-safe 가 통째로 무의미해진다.
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('apple-mobile-web-app-capable');
  });
});
