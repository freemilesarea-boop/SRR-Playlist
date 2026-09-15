// Phase 27 — 복구 제어면.
//
// 고정하는 사실(2026-09-15 14:06:16 KST 숙대점, Supabase edge 로그):
//   · 플레이어 계층 마지막 호출 14:06:16, 그 뒤 하트비트 0건.
//   · 같은 문서·같은 IP 의 셸 폴러가 **14:32:54 까지 5초마다 200 OK** (167건).
//   · 라우트 변경 0건(visitor_events 1건, 14:13:33). 리로드·session_start 0건.
//   · 14:23:35 발행한 복구 명령이 배달되지 않고 TTL(120초) 만료.
//
// 즉 명령을 받을 수 있는 살아 있는 실행 컨텍스트가 26분 38초 동안 있었는데
// 수신기가 죽은 쪽에 있었다. 이 파일은 그 구조가 되돌아오지 못하게 막는다.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  publishControlPlaneIdentity, readControlPlaneIdentity, clearControlPlaneIdentity,
  notePlayerLayerAlive, noteShellLayerAlive, readLayerHealth,
  resolveRecoveryRung, describeRung, shouldPollForCommands,
  acquireCommandReceiver, releaseCommandReceiver, currentCommandReceiver,
  PLAYER_LAYER_STALE_MS, SHELL_LAYER_STALE_MS, DEGRADED_POLL_INTERVAL_MS,
  __resetControlPlaneForTest,
} from './recoveryControlPlane';
import { SUSPECTED_DOWN_AFTER_S } from './playerDownDetection';

const R = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/** 실기기 사고의 시간 구조. 초 단위 실측값. */
const SUKDAE = {
  playerDeadForMs: (14 * 3600 + 32 * 60 + 54 - (14 * 3600 + 6 * 60 + 16)) * 1000, // 26분 38초
  commandIssuedAfterPlayerDeathMs: (17 * 60 + 19) * 1000,                          // 14:06:16 → 14:23:35
  shellPollIntervalMs: 5_000,
};

beforeEach(() => __resetControlPlaneForTest());

describe('§1 아키텍처 규칙 — 복구 시스템은 복구 대상과 같은 failure domain 에 없다', () => {
  const hook = R('src/hooks/useBrandPlayerHeartbeat.ts');
  const shell = R('src/components/AppShell.tsx');
  const plane = R('src/components/RecoveryControlPlane.tsx');

  it('플레이어 페이지 훅이 더 이상 Realtime 명령을 구독하지 않는다', () => {
    expect(hook).not.toContain('subscribeStoreRecoveryCommands');
  });

  it('구독은 제어면 컴포넌트가 한다', () => {
    expect(plane).toContain('subscribeStoreRecoveryCommands');
    expect(plane).toContain('handleRemoteCommand');
  });

  it('제어면은 AppShell 에 마운트된다 (플레이어 라우트가 아니라)', () => {
    expect(shell).toContain('<RecoveryControlPlane />');
  });

  it('제어면은 오디오·큐를 건드리지 않는다', () => {
    expect(plane).not.toMatch(/usePlayerStore|audioRef|\.play\(\)|\.pause\(\)/);
  });

  it('훅은 여전히 heartbeat fallback 을 갖는다 (명령 배달 경로를 하나로 줄이지 않았다)', () => {
    expect(hook).toContain('consumeHeartbeat');
    expect(hook).toContain("'heartbeat'");
  });
});

describe('§2 신원은 플레이어가 죽어도 남는다', () => {
  it('부분 갱신은 알고 있는 값을 지우지 않는다', () => {
    publishControlPlaneIdentity({ storeUserId: 'u1', sessionId: 's1', brandId: 'b1' });
    publishControlPlaneIdentity({ sessionId: 's2' });
    expect(readControlPlaneIdentity()).toEqual({ storeUserId: 'u1', sessionId: 's2', brandId: 'b1' });
  });

  it('플레이어 계층이 멈춰도 신원은 유효하다 — 그날 target 은 끝까지 옳았다', () => {
    publishControlPlaneIdentity({ storeUserId: 'u1', sessionId: '823034d7', brandId: 'b1' });
    // 플레이어는 더 이상 아무것도 하지 않는다. 신원을 지우는 경로가 없어야 한다.
    expect(readControlPlaneIdentity().sessionId).toBe('823034d7');
  });

  it('명시적 종료에서만 지워진다', () => {
    publishControlPlaneIdentity({ storeUserId: 'u1' });
    clearControlPlaneIdentity();
    expect(readControlPlaneIdentity().storeUserId).toBeNull();
  });
});

describe('§5 복구 사다리', () => {
  it('RUNG 1 — 플레이어가 살아 있으면 기존 경로', () => {
    expect(resolveRecoveryRung({ playerAgeMs: 30_000, shellAgeMs: 1_000 })).toBe('player_recovery');
  });

  it('RUNG 2 — 플레이어만 죽고 셸이 살아 있으면 subtree 복구 ★ 2026-09-15 이 칸이다', () => {
    expect(resolveRecoveryRung({
      playerAgeMs: SUKDAE.commandIssuedAfterPlayerDeathMs,   // 17분 19초
      shellAgeMs: SUKDAE.shellPollIntervalMs,                // 5초 전에 돌았다
    })).toBe('player_subtree_recovery');
  });

  it('RUNG 3 — 셸도 조용하면 웹으로 할 수 있는 것이 없다', () => {
    expect(resolveRecoveryRung({ playerAgeMs: 999_999, shellAgeMs: 999_999 }))
      .toBe('web_client_unreachable');
  });

  it('신호를 한 번도 못 받았으면 "모른다" 를 "살아 있다" 로 읽지 않는다', () => {
    expect(resolveRecoveryRung({ playerAgeMs: null, shellAgeMs: null })).toBe('web_client_unreachable');
    expect(resolveRecoveryRung({ playerAgeMs: null, shellAgeMs: 1_000 })).toBe('player_subtree_recovery');
  });

  it('RUNG 3 문구가 되는 척하지 않는다', () => {
    expect(describeRung('web_client_unreachable')).toBe('기기 응답 없음 — 웹 복구 불가');
  });
});

describe('§3·§5 임계값은 새로 만들지 않는다', () => {
  it('플레이어 stale = heartbeat 2회 결측 (60s x 2)', () => {
    const hook = R('src/hooks/useBrandPlayerHeartbeat.ts');
    expect(hook).toContain('const HEARTBEAT_INTERVAL_MS = 60_000;');
    expect(PLAYER_LAYER_STALE_MS).toBe(60_000 * 2);
  });

  it('클라이언트가 서버 SUSPECTED_DOWN 보다 **먼저** 알아챈다', () => {
    // 운영자가 버튼을 누르는 순간엔 이미 폴백이 켜져 있어야 한다.
    expect(PLAYER_LAYER_STALE_MS).toBeLessThan(SUSPECTED_DOWN_AFTER_S * 1_000);
  });

  it('셸 stale 은 셸 폴링 주기보다 충분히 크다 (멀쩡한 셸을 오분류하지 않는다)', () => {
    expect(SHELL_LAYER_STALE_MS).toBeGreaterThanOrEqual(SUKDAE.shellPollIntervalMs * 10);
  });
});

describe('§3 폴백 폴링은 필요할 때만 켠다', () => {
  it('정상일 때는 폴링하지 않는다 — 상시 5초 RPC 를 추가하지 않는다', () => {
    expect(shouldPollForCommands({ playerAgeMs: 10_000, shellAgeMs: 1_000 })).toBe(false);
  });

  it('플레이어가 멈춘 동안에만 켠다', () => {
    expect(shouldPollForCommands({ playerAgeMs: PLAYER_LAYER_STALE_MS, shellAgeMs: 1_000 })).toBe(true);
  });

  it('셸이 안 돌면 폴링할 주체도 없다', () => {
    expect(shouldPollForCommands({ playerAgeMs: 999_999, shellAgeMs: null })).toBe(false);
  });

  it('픽업 상한이 60초 heartbeat 가 아니라 5초다', () => {
    expect(DEGRADED_POLL_INTERVAL_MS).toBe(5_000);
    expect(DEGRADED_POLL_INTERVAL_MS).toBeLessThan(60_000);
  });

  it('❗이 폴링이 없으면 그날 명령은 TTL(120초) 안에 픽업되지 못했다', () => {
    // 폴링 없이 남는 경로는 60초 heartbeat 뿐인데, 그 heartbeat 가 죽은 것이
    // 바로 이 장애다. 즉 픽업 확률 0.
    const ttlMs = 120_000;
    expect(DEGRADED_POLL_INTERVAL_MS).toBeLessThan(ttlMs);
  });
});

describe('§2 중복 구독 금지', () => {
  it('두 번째 소유자는 구독을 얻지 못한다', () => {
    expect(acquireCommandReceiver('a')).toBe(true);
    expect(acquireCommandReceiver('b')).toBe(false);
    expect(currentCommandReceiver()).toBe('a');
  });

  it('같은 소유자의 재획득은 허용된다 (StrictMode 이중 실행)', () => {
    expect(acquireCommandReceiver('a')).toBe(true);
    expect(acquireCommandReceiver('a')).toBe(true);
  });

  it('해제 뒤에는 다음 소유자가 얻는다', () => {
    acquireCommandReceiver('a');
    releaseCommandReceiver('a');
    expect(acquireCommandReceiver('b')).toBe(true);
  });

  it('남의 소유권을 해제하지 못한다', () => {
    acquireCommandReceiver('a');
    releaseCommandReceiver('b');
    expect(currentCommandReceiver()).toBe('a');
  });
});

describe('계층 생존 표시', () => {
  it('시간은 뒤로 가지 않는다 (늦게 도착한 표시가 최신을 지우지 않는다)', () => {
    notePlayerLayerAlive(1_000);
    notePlayerLayerAlive(500);
    expect(readLayerHealth(1_000).playerAgeMs).toBe(0);
  });

  it('한 번도 못 받았으면 null — 0 이 아니다', () => {
    expect(readLayerHealth(1_000)).toEqual({ playerAgeMs: null, shellAgeMs: null });
  });

  it('그날의 두 계층을 그대로 재현한다', () => {
    const death = 1_000_000;
    notePlayerLayerAlive(death);                       // 14:06:16
    noteShellLayerAlive(death + SUKDAE.playerDeadForMs); // 14:32:54 까지 계속 돌았다
    const now = death + SUKDAE.playerDeadForMs;
    const h = readLayerHealth(now);
    expect(h.playerAgeMs).toBe(SUKDAE.playerDeadForMs);
    expect(h.shellAgeMs).toBe(0);
    expect(resolveRecoveryRung(h)).toBe('player_subtree_recovery');
    expect(shouldPollForCommands(h)).toBe(true);
  });
});
