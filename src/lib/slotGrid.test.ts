import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 시간대 카드가 카드 안에서 잘리던 회귀 방지.
 *
 * 매장 자동 스케줄의 오전·오후·저녁 카드는 `xl:grid-cols-3`(화면 폭 1280px)으로
 * 3칸이 됐다. 그런데 태블릿 2단 레이아웃에서 이 영역은 화면의 일부일 뿐이라,
 * 화면이 1280px 여도 카드 하나가 208px 밖에 안 됐다. 시작·종료 시간 입력 두 개가
 * 그 안에 못 들어가 종료 시간이 카드 밖으로 밀렸고, 카드가 overflow-hidden 이라
 * 잘린 줄도 모르고 "시간이 하나뿐인 화면" 처럼 보였다.
 *
 * 화면 폭이 아니라 "그 영역의 실제 폭" 으로 칸 수를 정해야 한다.
 */
const src = readFileSync(resolve(process.cwd(), 'src/components/BusinessScheduler.tsx'), 'utf8');

describe('시간대 카드 그리드', () => {
  it('칸 수를 화면 폭이 아니라 영역 폭으로 정한다', () => {
    const grids = src.match(/grid-cols-\[repeat\(auto-fit,minmax\(min\(21rem,100%\),1fr\)\)\]/g) ?? [];
    // 평일/주말 별도 그룹과 단일 그룹, 두 곳 모두.
    expect(grids).toHaveLength(2);
  });

  it('화면 폭 기준(xl:grid-cols-3)으로 돌아가지 않는다', () => {
    expect(src).not.toContain('xl:grid-cols-3');
  });

  it('시간 입력이 칸보다 커도 밀려나지 않는다', () => {
    // grid 아이템의 기본 min-width 는 auto — min-content 밑으로 줄지 않아서 밖으로 밀린다.
    const timeInputs = src.match(/className="input min-w-0 py-1\.5 text-sm font-mono"/g) ?? [];
    expect(timeInputs).toHaveLength(2);
  });
});

describe('매장 2단 레이아웃 비율', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');

  it('왼쪽 칸이 시간대 카드 두 장을 담을 수 있어야 한다', () => {
    // 1.5:1 일 때 왼쪽이 719px 이었고 두 장에는 722px 이 필요했다 — 3px 차이로
    // 세 장이 전부 세로로 쌓이고 오른쪽 40% 가 비었다.
    expect(css).toMatch(/\.app-store-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 2fr\) minmax\(0, 1fr\)/s);
  });
});
