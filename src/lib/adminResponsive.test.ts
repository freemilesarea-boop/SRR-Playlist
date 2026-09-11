// 관리자 패널의 폰 대응 회귀 방지.
//
// 관리자 화면은 운영자용이라 데스크톱 기준으로 만들어져 있다. 다만 앱의 "더보기 →
// 관리자" 로 폰에서도 열리므로, 폰에서 아예 못 읽는 형태만 막는다:
//   • 통계 타일이 폰에서 4칸 이상 → 한 칸 75px 이하, 라벨이 잘린다
//   • 열이 많은 표에 가로 스크롤이 없으면 → 열이 눌려 글자가 세로로 쌓인다
//
// 표를 몇 칸으로 나눌지 같은 디자인 판단은 여기서 강제하지 않는다.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ADMIN_DIR = fileURLToPath(new URL('../components/admin', import.meta.url));

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** 접두사 없는(= 폰부터 적용되는) grid-cols-N */
const PHONE_GRID = /(?:^|\s)grid-cols-(?:[4-9]|1[0-2])(?=\s|$)/;

describe('관리자 패널 — 폰에서 읽을 수 있는가', () => {
  const files = tsxFiles(ADMIN_DIR);

  it('스캔 대상이 실제로 있다', () => {
    // 경로가 바뀌어 0개를 훑고 통과하는 일을 막는다.
    expect(files.length).toBeGreaterThan(50);
  });

  it('폰 기준 4칸 이상 격자가 없다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/className=["`]([^"`]*)["`]/g)) {
        if (PHONE_GRID.test(m[1])) offenders.push(`${f.split('/admin/')[1]}: ${m[1].slice(0, 50)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('열이 6개 이상인 표는 가로로 스크롤된다', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!line.includes('<table')) return;
        // 이 표의 thead 열 개수
        let cols = 0;
        for (let j = i; j < Math.min(lines.length, i + 40); j++) {
          cols += (lines[j].match(/<th[ >]/g) ?? []).length;
          if (lines[j].includes('</thead>')) break;
        }
        if (cols < 6) return;
        // 표 자신 또는 위쪽 열두 줄 안에 가로 스크롤 껍데기가 있어야 한다.
        // (조건부 렌더가 끼어 껍데기와 <table> 사이가 벌어지는 경우가 있다.)
        const scope = lines.slice(Math.max(0, i - 12), i + 1).join(' ');
        if (!/overflow-x-auto|overflow-x-scroll|overflow-auto/.test(scope)) {
          offenders.push(`${f.split('/admin/')[1]}:${i + 1} (열 ${cols}개)`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
