// ANDROID-NATIVE §13/§14 — 워치독이 먹는 신호의 계약을 소스 수준에서 고정한다.
//
// 왜 이 파일이 있나 — 2026-09-14 감사에서 실제 결함을 찾았다.
//
//   StorePlaybackService.noteWebHeartbeat(audible) → audible 이면 lastAudibleAt 갱신
//   JS 는 sendNativeHeartbeat(usePlaybackHealthStore.getState().audioActive) 를 불렀고
//   audioActive 는 Player 에서 audio element 의 `playing` 이벤트 + `!el.paused` 로 선다.
//
// 즉 **currentTime 이 얼어붙은 채 paused=false 인 플레이어**도 30초마다 계속
// "들린다" 로 보고됐다. 워치독은 5분 무음일 때만 개입하는데, 그 5분이 영원히
// 오지 않는다 — 워치독이 존재하는 이유인 바로 그 정지 상태에서 눈이 먼다.
//
// 여기서 고정하는 것:
//   1. 네이티브 heartbeat 의 audible 은 실제 currentTime 진행 기준이다.
//   2. audioActive / paused 기반으로 되돌아가지 않는다.
//   3. 정상 background(다른 앱 foreground + 재생 정상)를 장애로 판정하지 않는다.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  noteAudioProgress, isAudiblyProgressing, __resetClientLivenessForTest,
} from './clientLiveness';

const hookSrc = readFileSync(
  resolve(process.cwd(), 'src/hooks/useBrandPlayerHeartbeat.ts'), 'utf-8');
const svcSrc = readFileSync(
  resolve(process.cwd(), 'android/app/src/main/java/com/deudda/app/StorePlaybackService.java'), 'utf-8');
const playerSrc = readFileSync(
  resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf-8');

beforeEach(() => { __resetClientLivenessForTest(); });

describe('§13 — audible 은 실제 currentTime 진행 기준이다', () => {
  it('네이티브 heartbeat 에 isAudiblyProgressing() 을 넘긴다', () => {
    expect(hookSrc).toContain('sendNativeHeartbeat(isAudiblyProgressing())');
  });

  it('audioActive 를 네이티브 heartbeat 로 넘기지 않는다 (회귀 금지)', () => {
    expect(hookSrc).not.toContain('sendNativeHeartbeat(usePlaybackHealthStore.getState().audioActive)');
    expect(hookSrc).not.toMatch(/sendNativeHeartbeat\([^)]*audioActive/);
    expect(hookSrc).not.toMatch(/sendNativeHeartbeat\([^)]*paused/);
  });

  it('진행 시각은 currentTime 이 실제로 늘어난 분기에서만 기록된다', () => {
    // lastProgressRef 갱신 = |t - lastCt| >= 0.01 또는 트랙 변경. 그 자리에만 있어야 한다.
    const at = playerSrc.indexOf('noteAudioProgress()');
    const branch = playerSrc.lastIndexOf('Math.abs(t - lastProgress.ct) >= 0.01', at);
    expect(at).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    expect(at - branch).toBeLessThan(600);   // 같은 분기 안이다
  });

  it('Player 안에서 noteAudioProgress 는 한 번만 불린다 (다른 경로로 새지 않는다)', () => {
    expect(playerSrc.match(/noteAudioProgress\(\)/g) ?? []).toHaveLength(1);
  });
});

describe('§13 — 얼어붙은 플레이어를 살아있다고 보고하지 않는다', () => {
  it('진행이 멈추면 창을 넘긴 순간 false 로 떨어진다', () => {
    noteAudioProgress(1_000_000);
    expect(isAudiblyProgressing(1_000_000 + 89_000)).toBe(true);
    expect(isAudiblyProgressing(1_000_000 + 91_000)).toBe(false);
  });

  it('한 번도 진행한 적 없으면 false — 재생을 시작하지 않은 기기를 되살리지 않는다', () => {
    expect(isAudiblyProgressing(1_000_000)).toBe(false);
  });

  it('네이티브 beat 주기(30초)보다 창이 넉넉하다 — 한 번 걸렀다고 죽었다고 하지 않는다', () => {
    noteAudioProgress(1_000_000);
    expect(isAudiblyProgressing(1_000_000 + 30_000)).toBe(true);
    expect(isAudiblyProgressing(1_000_000 + 60_000)).toBe(true);
  });
});

describe('§14 — 정상 background 를 장애로 오판하지 않는다', () => {
  it('소리가 나는 동안에는 foreground 여부와 무관하게 개입하지 않는다', () => {
    // shouldRelaunch() 의 첫 가드가 audibleSilent 이고, 여기서 바로 return false 한다.
    const fn = svcSrc.slice(svcSrc.indexOf('private boolean shouldRelaunch()'));
    const body = fn.slice(0, fn.indexOf('private void startWatchdog'));
    expect(body).toContain('if (audibleSilent < 0 || audibleSilent < AUDIBLE_DEAD_MS)');
    expect(body.indexOf('return false;')).toBeLessThan(body.indexOf('if (!activityAlive)'));
  });

  it('foreground 여부를 되살리기 조건으로 쓰지 않는다', () => {
    const fn = svcSrc.slice(svcSrc.indexOf('private boolean shouldRelaunch()'));
    const body = fn.slice(0, fn.indexOf('private void startWatchdog'));
    expect(body).not.toContain('activityForeground');
  });

  it('세 신호를 조합한다 — 소리 / JS 생존 / Activity 생존', () => {
    const fn = svcSrc.slice(svcSrc.indexOf('private boolean shouldRelaunch()'));
    const body = fn.slice(0, fn.indexOf('private void startWatchdog'));
    expect(body).toContain('audibleSilentForMs()');
    expect(body).toContain('webHeartbeatSilentForMs()');
    expect(body).toContain('activityAlive');
  });

  it('JS 가 살아서 하트비트를 보내는 중이면 네이티브가 끼어들지 않는다 (웹 복구 사다리의 몫)', () => {
    const fn = svcSrc.slice(svcSrc.indexOf('private boolean shouldRelaunch()'));
    const body = fn.slice(0, fn.indexOf('private void startWatchdog'));
    expect(body).toContain('webSilent >= 0 && webSilent >= WEB_HEARTBEAT_DEAD_MS');
  });

  it('하트비트를 한 번도 못 받았으면 판단하지 않는다', () => {
    expect(svcSrc).toContain('if (lastWebHeartbeatAt == 0L)');
    expect(svcSrc).toContain('if (lastAudibleAt == 0L)');
  });
});
