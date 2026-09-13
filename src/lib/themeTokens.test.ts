/**
 * Tailwind 색 토큰이 실제로 존재하는지 고정한다.
 *
 * 없는 토큰을 쓰면 Tailwind 는 조용히 아무 것도 만들지 않는다. 에러도 경고도 없고
 * 타입 검사도 못 잡는다 — 화면에서 배경이 안 칠해져 있을 뿐이다.
 * bg-deep 이 그랬다: 484곳에서 쓰는데 정의가 없어 .bg-bg-deep 규칙이 0개였고,
 * 입력칸·코드칩·스켈레톤 배경과 매장 플레이어 그라데이션 시작색이 전부 비어 있었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

function repoFile(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

const config = repoFile('tailwind.config.js');

/** src 전체에서 쓰인 bg-* 계열 색 이름을 모은다. */
function usedBgTokens(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.test.ts')) {
        const src = readFileSync(p, 'utf8');
        // bg-bg-deep / from-bg-deep / via-bg-soft / to-bg-card …
        for (const m of src.matchAll(/(?:bg|from|via|to)-bg-([a-z]+)/g)) found.add(m[1]);
      }
    }
  };
  walk(resolve(process.cwd(), 'src'));
  return found;
}

describe('bg 색 토큰', () => {
  it('코드에서 쓰는 bg-* 이름이 전부 tailwind.config 에 있다', () => {
    const used = [...usedBgTokens()].sort();
    const missing = used.filter((name) => !new RegExp(`\\b${name}:\\s*'rgb\\(`).test(config));
    expect({ 쓰는것: used, 정의없음: missing }).toEqual({ 쓰는것: used, 정의없음: [] });
  });

  it('deep 은 테마 변수가 없어도 bg-soft 로 떨어진다', () => {
    // 테마 블록이 10개가 넘어서 --color-bg-deep 을 전부 새로 적는 대신 fallback 을 쓴다.
    expect(config).toContain('var(--color-bg-deep, var(--color-bg-soft))');
  });
});

describe('매장 플레이어 배경', () => {
  it('테마 토큰이 아니라 고정 다크 — 라이트 테마에서 흰 글자가 사라지면 안 된다', () => {
    const page = repoFile('src/pages/StorePlayerPage.tsx');
    expect(page).toContain('text-white');
    expect(page).not.toContain('from-bg-deep');
    expect(page).toMatch(/from-\[#[0-9a-f]{6}\]/i);
  });
});
