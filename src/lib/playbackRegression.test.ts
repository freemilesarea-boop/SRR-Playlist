/**
 * 이번 회귀를 다시 만들지 않기 위한 못.
 *
 * 실기기에서 첫 곡은 소리가 났는데 진행바가 멈췄고, 두 번째 플레이리스트부터
 * 재생되지 않았다. 원인은 두 가지를 한꺼번에 바꾼 것이었다:
 *
 *   1. preload="auto" — 다음 곡 프리로드는 src 만 설정하고 이 속성에 기대어
 *      "메타데이터만" 받게 돼 있다(Player.tsx 의 preload 주석). auto 로 바꾸면
 *      다음 곡 전체를 받기 시작해 재생 중인 스트림의 대역폭을 가져간다.
 *   2. load() 직후 즉시 play() — 같은 엘리먼트에 immediate 와 canplay 두 경로가
 *      겹쳐 들어가고, 둘 다 ensureSinkReady 를 await 한 뒤 play() 를 부른다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const player = readFileSync(
  fileURLToPath(new URL('../components/player/Player.tsx', import.meta.url)), 'utf8');
const capConfig = readFileSync(
  fileURLToPath(new URL('../../capacitor.config.ts', import.meta.url)), 'utf8');

describe('오디오 엘리먼트 preload', () => {
  it('두 엘리먼트 모두 metadata 다', () => {
    // JSX 속성만 — 주석 안의 preload="metadata" 언급은 세지 않는다.
    const found = [...player.matchAll(/^\s+preload="(\w+)"$/gm)].map((m) => m[1]);
    expect(found).toHaveLength(2);
    expect(found).toEqual(['metadata', 'metadata']);
  });

  it('다음 곡 프리로드는 여전히 src 만 설정한다', () => {
    // load() 를 부르기 시작하면 preload 속성과 무관하게 전체를 받는다.
    const block = player.slice(player.indexOf('[audio:preload:start]'));
    const upTo = block.slice(0, block.indexOf('nextAudio.src = nextUrl;') + 40);
    expect(upTo).not.toContain('nextAudio.load()');
  });
});

describe('play 호출 경로', () => {
  it('load() 직후 즉시 play 하지 않는다', () => {
    expect(player).not.toContain("attemptPlay(audio, 'immediate')");
  });

  it('재생 진입점은 canplay 하나다', () => {
    const labels = [...player.matchAll(/attemptPlay\([^,]+,\s*'([a-z-]+)'\)/g)].map((m) => m[1]);
    // canplay(자동 재생) · resume(복귀) 두 가지만. 새 경로가 늘면 경합을 다시 본다.
    expect(new Set(labels)).toEqual(new Set(['canplay', 'resume']));
  });
});

describe('기기에서 로그를 건질 수 있다', () => {
  it('릴리스 빌드에서도 콘솔이 logcat 으로 간다', () => {
    // 기본값(debug)이면 릴리스 APK 에서 adb logcat 에 아무것도 안 잡힌다.
    expect(capConfig).toContain("loggingBehavior: 'production'");
  });

  it('콘솔이 막혀도 앱 안에서 볼 수 있다', () => {
    const diag = readFileSync(
      fileURLToPath(new URL('./playbackDiag.ts', import.meta.url)), 'utf8');
    expect(diag).toContain('export function readDiagLog');
    expect(diag).toContain('export function diagLogText');
  });

  it('빌드가 console.warn 을 지우지 않는다', () => {
    const vite = readFileSync(
      fileURLToPath(new URL('../../vite.config.ts', import.meta.url)), 'utf8');
    const pure = vite.slice(vite.indexOf('pure:'), vite.indexOf('pure:') + 200);
    expect(pure).not.toContain('console.warn');
    expect(pure).not.toContain('console.error');
  });
});
