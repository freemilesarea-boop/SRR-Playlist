// 매장 안내방송/긴급방송의 떠 있는 알림 띠가 탭을 먹지 않는지 본다.
//
// 앱에서 "가끔 엉뚱한 게 눌린다" 의 원인이었다. 안내방송 중에 뜨는 보라색 알약이
// `fixed bottom-4 ... z-[120]` 로 화면 하단 정중앙에 떠 있었는데, 하단탭은
// `fixed bottom-0 z-30` 이다. z 가 120 대 30 이니 알약이 탭 위를 덮었고,
// 가운데 탭을 누르면 알약이 대신 먹었다. 방송 중에만 생기니 "가끔" 이었다.
//
// 이 띠들은 전부 읽기만 하는 상태 표시다 — 누를 것이 없으므로 탭을 통과시켜야 한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/components/store/AnnouncementOverlay.tsx',
  'src/components/store/EmergencyBroadcastOverlay.tsx',
];

describe('매장 오버레이는 탭을 가로막지 않는다', () => {
  for (const file of FILES) {
    it(`${file} 의 떠 있는 층은 전부 pointer-events-none`, () => {
      const src = readFileSync(file, 'utf8');
      // className 문자열 안에서 'fixed' 를 쓰는 층을 전부 찾는다.
      const layers = src.match(/className="[^"]*\bfixed\b[^"]*"/g) ?? [];
      expect(layers.length, '떠 있는 층이 하나도 없다면 이 테스트가 무의미하다').toBeGreaterThan(0);
      const offenders = layers.filter((c) => !c.includes('pointer-events-none'));
      expect(offenders, '하단탭(z-30) 위를 덮으면 그 자리의 탭이 안 눌린다').toEqual([]);
    });
  }
});
