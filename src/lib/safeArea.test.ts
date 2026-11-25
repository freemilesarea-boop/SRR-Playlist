import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/**
 * 안전영역 회귀 방지.
 *
 * `.pl-safe` 는 padding-left 를 그대로 덮어쓴다. 예전에는 이 클래스들이 @layer base
 * 에 있어서 `px-3 pl-safe` 로 쓰면 px-3 이 이겼다 — 아이폰 가로에서 노치에 물렸다.
 * utilities 로 올린 지금은 반대로 pl-safe 가 이겨서 px-3(12px 여백)이 사라진다.
 * 어느 쪽이든 고장이므로, 같은 방향에 두 개를 같이 쓰는 것 자체를 막는다.
 */

const SRC = resolve(process.cwd(), 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** className="..." 안의 클래스 목록. 변형(sm: 등) 접두사는 그대로 둔다. */
function classAttrs(src: string): string[] {
  return [...src.matchAll(/className="([^"]+)"/g)].map((m) => m[1]);
}

// [안전영역 클래스, 같은 방향을 건드리는 숫자 padding 접두사들]
const AXES: Array<[string, string[]]> = [
  ['pl-safe', ['pl-', 'px-', 'p-']],
  ['pr-safe', ['pr-', 'px-', 'p-']],
  ['pt-safe', ['pt-', 'py-', 'p-']],
  ['pb-safe', ['pb-', 'py-', 'p-']],
  ['px-safe', ['pl-', 'pr-', 'px-', 'p-']],
];

describe('안전영역 padding 충돌', () => {
  const files = walk(SRC);

  it('같은 방향에 숫자 padding 과 *-safe 를 함께 쓰지 않는다', () => {
    const bad: string[] = [];
    for (const f of files) {
      for (const attr of classAttrs(readFileSync(f, 'utf8'))) {
        const classes = attr.split(/\s+/).filter(Boolean);
        for (const [safe, prefixes] of AXES) {
          if (!classes.includes(safe)) continue;
          for (const c of classes) {
            const bare = c.includes(':') ? c.slice(c.lastIndexOf(':') + 1) : c;
            if (bare.endsWith('-safe') || bare.startsWith('p-[') ) continue;
            // 임의값(max(...))은 안전영역을 스스로 품고 있으므로 예외.
            if (/^p[xyltrb]?-\[/.test(bare)) continue;
            if (prefixes.some((p) => bare.startsWith(p) && /\d/.test(bare))) {
              bad.push(`${f.replace(SRC, 'src')}: "${safe}" + "${c}"`);
            }
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('안전영역 클래스는 utilities 레이어에 있다', () => {
    const css = readFileSync(resolve(SRC, 'index.css'), 'utf8');
    const util = css.slice(css.indexOf('@layer utilities {'));
    expect(util).toContain('.pb-safe');
    expect(util).toContain('.pt-safe');
    expect(util).toContain('.pl-safe');
    expect(util).toContain('.pr-safe');
  });

  it('하단탭과 전체화면 플레이어는 안전영역을 지킨다', () => {
    // 홈 인디케이터(아이폰) 위에 탭이 깔리면 탭이 안 눌린다.
    const nav = readFileSync(resolve(SRC, 'components/BottomNav.tsx'), 'utf8');
    expect(nav).toMatch(/app-bottom-nav[^"]*pb-safe/);
    for (const p of ['pages/StorePlayerPage.tsx', 'pages/BrandPlayerPage.tsx']) {
      const s = readFileSync(resolve(SRC, p), 'utf8');
      expect(s).toContain('pt-safe');
      expect(s).toContain('pb-safe');
    }
  });
});
