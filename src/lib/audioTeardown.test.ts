// LEGACY-ANDROID §11 — 비활성 audio element 의 리소스 해제.
//
// 무엇을 고쳤나
//
//   트랙 전환 때 비활성(프리로드) 슬롯을 이렇게 정리했다:
//       other.pause(); other.removeAttribute('src');
//
//   HTML 스펙상 src 제거만으로는 media element load algorithm 이 돌지 않는다.
//   element 는 직전 리소스(디코딩 버퍼 포함, 매장 음원 평균 4.58MB)를 **다음
//   preload 가 새 src 를 넣을 때까지** 그대로 붙들고 있다. 누수는 아니지만
//   Android 10 저메모리 기기에서는 그 한 곡분이 아깝다.
//
// 왜 지금까지 못 고쳤나
//
//   load() 는 emptied 를 발생시킨다. 그런데 이벤트 핸들러가 슬롯을 구분하지 않고
//       if (ev === 'pause' || ev === 'emptied') setAudioActive(false)
//   를 했다. 비활성 슬롯을 정리하는 것만으로 **활성이 멀쩡히 재생 중인데**
//   audioActive 가 false 로 떨어진다.
//
//   audioActive 가 좌우하는 것:
//     · swUpdateGate — 재생 중 배포 리로드 유예 (false 면 재생 중에 리로드한다)
//     · useBrandPlayerHeartbeat 의 resolveReportedTrackId — 서버에 보고하는 곡
//     · 0524 heartbeat liveness 스냅샷
//
//   그래서 순서를 지켰다: 먼저 false 전이를 활성 슬롯으로 한정하고, 그 다음에
//   load() 를 넣었다. 이 파일이 그 두 계약을 함께 고정한다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf-8');

/** 이벤트 핸들러 본문만 잘라낸다 — 다른 곳의 setAudioActive 와 섞이지 않게. */
function eventHandlerBody(): string {
  const start = src.indexOf("const events = ['stalled', 'waiting', 'suspend', 'emptied', 'playing', 'pause'] as const;");
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf('audioMountRevision', start);
  return src.slice(start, end > start ? end : start + 6000);
}

/** 비활성 슬롯 teardown 블록만 잘라낸다. */
function inactiveTeardownBlock(): string {
  const start = src.indexOf('const other = nextRef();');
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n      }', start) + 8);
}

describe('audioActive 의 false 전이는 활성 슬롯에서만 온다', () => {
  const body = eventHandlerBody();

  it('pause / emptied 가 활성 슬롯 판정으로 가드된다', () => {
    expect(body).toMatch(
      /if \(\(ev === 'pause' \|\| ev === 'emptied'\) && isActiveEl\)/);
  });

  it('가드 없는 옛 형태가 남아 있지 않다 (회귀 금지)', () => {
    expect(body).not.toMatch(
      /if \(ev === 'pause' \|\| ev === 'emptied'\) usePlaybackHealthStore/);
  });

  it('활성 슬롯 판정을 healthStateRef 로 한다 — activeRef() 는 이 effect 에서 stale 이다', () => {
    expect(body).toContain('healthStateRef.current.activeIdx');
    // deps 가 [] 인 effect 안에서 렌더 스코프 activeIdx 를 닫으면 첫 렌더 값에 묶인다.
    expect(body).not.toMatch(/isActiveEl\s*=\s*[^;]*activeRef\(\)/);
  });

  it('playing 은 가드하지 않는다 — 크로스페이드 중엔 두 슬롯 다 소리가 난다', () => {
    expect(body).toMatch(/if \(ev === 'playing'\) usePlaybackHealthStore\.getState\(\)\.setAudioActive\(!el\.paused\)/);
  });

  it('슬롯 판정이 A/B 를 모두 다룬다', () => {
    expect(body).toContain("slot === 'A' && activeIdxNow === 0");
    expect(body).toContain("slot === 'B' && activeIdxNow === 1");
  });
});

describe('비활성 슬롯이 미디어 리소스를 실제로 놓는다', () => {
  const block = inactiveTeardownBlock();

  it('pause → removeAttribute(src) → load() 순서다', () => {
    const p = block.indexOf('other.pause()');
    const r = block.indexOf("other.removeAttribute('src')");
    const l = block.indexOf('other.load()');
    expect(p).toBeGreaterThan(-1);
    expect(r).toBeGreaterThan(p);
    expect(l).toBeGreaterThan(r);
  });

  it('load() 실패가 트랙 전환을 막지 않는다', () => {
    expect(block).toContain('try { other.load(); } catch');
  });

  it('활성 슬롯에는 load() 를 부르지 않는다 — 재생 중인 소리를 끊으면 안 된다', () => {
    // 이 블록은 nextRef()(비활성)만 다룬다. activeRef 가 섞이면 안 된다.
    expect(block).not.toContain('activeRef()');
  });

  it('INACTIVE_AUDIO pause 기록을 유지한다 (Flight Recorder 관측 보존)', () => {
    expect(block).toContain("recordPauseRequest('INACTIVE_AUDIO'");
  });
});

describe('audioActive 를 읽는 쪽 계약이 그대로다', () => {
  it('heartbeat 는 여전히 audioActive 로 "실제 소리가 난 곡" 을 고른다', () => {
    const hook = readFileSync(
      resolve(process.cwd(), 'src/hooks/useBrandPlayerHeartbeat.ts'), 'utf-8');
    expect(hook).toContain('const audioActive = usePlaybackHealthStore.getState().audioActive;');
    expect(hook).toContain('lastAudibleRef.current = storeTrackId;');
  });

  it('배포 리로드 게이트가 여전히 audioActive 를 본다', () => {
    const gate = readFileSync(resolve(process.cwd(), 'src/lib/swUpdateGate.ts'), 'utf-8');
    expect(gate.toLowerCase()).toContain('audioactive');
  });
});
