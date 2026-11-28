/**
 * 대형 플레이리스트가 음원 전송을 굶기지 않게.
 *
 * 실기기 증거: "자주 듣는 분위기" 레일의 플레이리스트만 재생이 안 됐는데,
 * 그것들이 전부 대형 큐레이션(805·448·302·177·117·93곡)이었다.
 * 트랙 행마다 **원본 커버를 raw <img> 로** 받고 있어서, 805곡이면 수백 장이
 * 한꺼번에 요청된다. 그 호스트가 음원과 같아서 오디오가 뒤로 밀렸다 —
 * 메타데이터가 61초 걸렸고(25초 타임아웃이 먼저 터져 '포맷 오류' 로 보였다),
 * 기다리면 결국 재생됐다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const playlistPage = read('../pages/PlaylistPage.tsx');
const css = read('../index.css').replace(/\/\*[\s\S]*?\*\//g, '');

describe('트랙 목록 커버', () => {
  it('행마다 원본을 그대로 받지 않는다', () => {
    // 목록 본문(트랙 map 이후)에 가공 없는 <img> 가 있으면 다시 수백 장이 나간다.
    const list = playlistPage.slice(playlistPage.indexOf('tracks.map('));
    expect(list).not.toMatch(/<img\s+src=\{t\.cover_url\}/);
  });

  it('표시 크기에 맞춰 받는 컴포넌트를 쓴다', () => {
    const list = playlistPage.slice(playlistPage.indexOf('tracks.map('));
    expect(list).toContain('<AutoCover');
    expect(list).toContain('size="sm"');   // 40px 칸이다
  });
});

describe('가로 드래그', () => {
  it('문서가 좌우로 밀리지 않는다', () => {
    const html = css.match(/\bhtml\s*\{[^}]*\}/)?.[0] ?? '';
    expect(html).toContain('overscroll-behavior-x: none');
    expect(html).toContain('overflow-x: hidden');
  });

  it('body 에도 같이 건다', () => {
    const body = css.match(/\n\s*body\s*\{[^}]*\}/)?.[0] ?? '';
    expect(body).toContain('overscroll-behavior-x: none');
    expect(body).toContain('overflow-x: hidden');
  });

  it('세로 당겨서 새로고침 차단은 그대로 둔다', () => {
    expect(css).toContain('overscroll-behavior-y: none');
  });
});
