/**
 * Phase 29 — Failure Matrix **I (Player timer loss)** 를 닫는다.
 *
 * 28 까지 I 는 `self-heal ✗` 였다. 플레이어 내부 워치독이 플레이어와 같은 실행
 * 도메인에 있어 스스로를 감시할 수 없었기 때문이다. 2026-09-15 14:06:16 숙대점이
 * 그 모양이었고 — 브랜드 heartbeat(60초)와 스트림 heartbeat(10초)가 동시에 멎고
 * 같은 문서의 셸 폴러는 26분 38초 동안 5초마다 200 OK — 20분 넘게 방치됐다.
 *
 * 이 파일은 그 시나리오를 결정론적으로 재현하고, 셸이 스스로 되살리는지 본다.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  resolveShellWatchdogAction, describeShellWatchdogAction, isShellRecoveryVerified,
  PLAYER_RUNTIME_STALE_MS, SHELL_RECOVERY_BUDGET, SHELL_RECOVERY_COOLDOWN_MS,
  REQUIRED_PROGRESS_SAMPLES, type ShellWatchdogInput,
} from './shellWatchdog';
import { RELOAD_PAGE_AFTER_MS } from './stallWatchdog';
import {
  notePlayerRuntimeAlive, readPlayerRuntimeAge, noteShellLayerAlive, readLayerHealth,
  beginRecovery, endRecovery, isRecoveryInProgress, currentRecoveryOwner,
  __resetControlPlaneForTest,
} from './recoveryControlPlane';

const R = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/** 무인 매장이 정상 재생 중이고 셸도 방금 돌았다. */
const HEALTHY: ShellWatchdogInput = {
  playerRuntimeAgeMs: 3_000,     // 3초 티커가 방금 돌았다
  shellAgeMs: 5_000,
  playing: true, hasQueue: true, suppressed: false, autoplayBlocked: false,
  recoveryInProgress: false,
  recoveriesUsed: 0, msSinceLastRecovery: null, remountTried: false, canNavigate: true,
};

/** 2026-09-15 14:06 의 모양 — 플레이어 실행만 사라지고 셸은 살아 있다. */
const SUKDAE_1406: ShellWatchdogInput = {
  ...HEALTHY,
  playerRuntimeAgeMs: 26 * 60_000 + 38_000,   // 26분 38초
  shellAgeMs: 5_000,                          // 셸은 5초 전에 돌았다
};

beforeEach(() => __resetControlPlaneForTest());

describe('§1 감시자는 감시 대상과 같은 failure domain 에 없다', () => {
  it('런타임 신호는 플레이어의 3초 티커가 찍는다', () => {
    const player = R('src/components/player/Player.tsx');
    const i = player.indexOf('const tick = () => {');
    // 티커 본문의 **첫 동작**이어야 한다 — early return 뒤에 있으면
    // "오디오가 잠깐 없는 상태" 가 "실행이 죽은 상태" 로 오인된다.
    expect(player.slice(i, i + 1400)).toContain('notePlayerRuntimeAlive();');
    expect(player).toContain('startBackgroundTicker(tick, 3_000)');
  });

  it('판정자는 셸에 있고 새 타이머를 만들지 않는다', () => {
    const plane = R('src/components/RecoveryControlPlane.tsx');
    expect(plane).toContain('resolveShellWatchdogAction');
    // 5초 틱은 **하나뿐**이다. 워치독은 거기 얹힌다.
    expect((plane.match(/window\.setInterval\(/g) ?? []).length).toBe(2); // 셸 틱 + 저하 폴링
    expect(plane).toContain('runWatchdogRef.current()');
  });

  it('셸은 currentTime 을 폴링하지 않는다 (저사양 CPU 예산)', () => {
    // 주석에는 "currentTime 을 폴링하지 않는다" 가 적혀 있다 — 실행 코드만 본다.
    const plane = R('src/components/RecoveryControlPlane.tsx')
      .split('\n')
      .filter((l) => {
        const t = l.trimStart();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(plane).not.toContain('currentTime');
    expect(plane).not.toContain('audioRef');
  });
});

describe('§10 Failure I — 결정론적 재현', () => {
  it('❗플레이어 실행이 멎고 셸이 살아 있으면 셸이 되살린다', () => {
    expect(resolveShellWatchdogAction(SUKDAE_1406)).toBe('remount_player');
  });

  it('리마운트로도 안 살아나면 페이지 재시작으로 올라간다', () => {
    expect(resolveShellWatchdogAction({
      ...SUKDAE_1406, remountTried: true, recoveriesUsed: 1,
      msSinceLastRecovery: SHELL_RECOVERY_COOLDOWN_MS,
    })).toBe('reload_page');
  });

  it('오프라인이면 페이지 재시작을 하지 않는다 (캐시 재생을 날린다)', () => {
    expect(resolveShellWatchdogAction({
      ...SUKDAE_1406, remountTried: true, recoveriesUsed: 1,
      msSinceLastRecovery: SHELL_RECOVERY_COOLDOWN_MS, canNavigate: false,
    })).toBe('none');
  });

  it('예산을 다 쓰면 되는 척하지 않는다', () => {
    const a = resolveShellWatchdogAction({
      ...SUKDAE_1406, recoveriesUsed: SHELL_RECOVERY_BUDGET,
      msSinceLastRecovery: SHELL_RECOVERY_COOLDOWN_MS, remountTried: true,
    });
    expect(a).toBe('exhausted');
    expect(describeShellWatchdogAction(a)).toContain('운영자 확인 필요');
  });

  it('쿨다운 중에는 연타하지 않는다', () => {
    expect(resolveShellWatchdogAction({
      ...SUKDAE_1406, recoveriesUsed: 1, msSinceLastRecovery: SHELL_RECOVERY_COOLDOWN_MS - 1,
    })).toBe('none');
  });

  it('§17 리마운트를 페이지 재시작보다 먼저 쓴다 (자동재생 정책을 다시 만나지 않으려고)', () => {
    const first = resolveShellWatchdogAction(SUKDAE_1406);
    expect(first).toBe('remount_player');
    expect(first).not.toBe('reload_page');
  });
});

describe('§9 오탐 방지 — 이 상태들에서는 절대 개입하지 않는다', () => {
  const stale = { ...SUKDAE_1406 };
  const cases: Array<[string, Partial<ShellWatchdogInput>]> = [
    ['의도적 일시정지', { playing: false }],
    ['영업 종료', { suppressed: true }],
    ['틀 곡이 없음', { hasQueue: false }],
    ['자동재생 차단 — 제스처 대기', { autoplayBlocked: true }],
    ['다른 복구가 이미 진행 중', { recoveryInProgress: true }],
    ['셸 자신이 안 돌고 있음', { shellAgeMs: null }],
    ['런타임 신호를 한 번도 못 받음(모른다)', { playerRuntimeAgeMs: null }],
  ];
  cases.forEach(([name, patch]) => {
    it(name, () => {
      expect(resolveShellWatchdogAction({ ...stale, ...patch })).toBe('none');
    });
  });

  it('정상 재생 중에는 아무 일도 없다', () => {
    expect(resolveShellWatchdogAction(HEALTHY)).toBe('none');
  });

  it('플레이어가 자기 사다리를 돌리는 동안에는 끼어들지 않는다', () => {
    // 사다리는 이 티커 위에서 돈다 — 티커가 살아 있으면 사다리도 살아 있다.
    expect(resolveShellWatchdogAction({
      ...HEALTHY, playerRuntimeAgeMs: PLAYER_RUNTIME_STALE_MS - 1,
    })).toBe('none');
  });
});

describe('§5 감지 예산 — 새 숫자를 만들지 않는다', () => {
  it('임계값은 플레이어가 자기 사다리를 끝까지 쓰는 시간과 같다', () => {
    expect(PLAYER_RUNTIME_STALE_MS).toBe(RELOAD_PAGE_AFTER_MS);
  });

  it('3초 티커 기준으로 50번 연속 결측이다 — 지터로는 닿지 않는다', () => {
    expect(PLAYER_RUNTIME_STALE_MS / 3_000).toBeGreaterThanOrEqual(50);
  });

  it('숙대 사고의 26분 방치보다 훨씬 빨리 잡는다', () => {
    const worstCaseDetectionMs = PLAYER_RUNTIME_STALE_MS + 5_000; // 임계 + 셸 틱
    expect(worstCaseDetectionMs).toBeLessThan(200_000);            // < 3분 20초
    expect(worstCaseDetectionMs).toBeLessThan(26 * 60_000);        // 그날의 1/10 미만
  });
});

describe('§8 성공 계약 — remount 했다는 것은 성공이 아니다', () => {
  it('진행 표본이 2개 있어야 성공이다', () => {
    expect(isShellRecoveryVerified({ playerRuntimeAgeMs: 3_000, progressSamples: 1 })).toBe(false);
    expect(isShellRecoveryVerified({ playerRuntimeAgeMs: 3_000, progressSamples: 2 })).toBe(true);
    expect(REQUIRED_PROGRESS_SAMPLES).toBe(2);
  });

  it('런타임 신호만 돌아온 것은 성공이 아니다', () => {
    expect(isShellRecoveryVerified({ playerRuntimeAgeMs: 3_000, progressSamples: 0 })).toBe(false);
  });

  it('신호가 여전히 낡았으면 진행 표본이 있어도 성공이 아니다', () => {
    expect(isShellRecoveryVerified({
      playerRuntimeAgeMs: PLAYER_RUNTIME_STALE_MS, progressSamples: 5,
    })).toBe(false);
  });
});

describe('§16 복구 조정자 — 셋이 동시에 고치지 않는다', () => {
  it('먼저 잡은 쪽만 복구한다', () => {
    expect(beginRecovery('player_ladder')).toBe(true);
    expect(beginRecovery('shell_watchdog')).toBe(false);
    expect(currentRecoveryOwner()).toBe('player_ladder');
  });

  it('같은 주체의 재진입은 허용된다', () => {
    expect(beginRecovery('shell_watchdog')).toBe(true);
    expect(beginRecovery('shell_watchdog')).toBe(true);
  });

  it('자기가 잡은 것만 놓는다', () => {
    beginRecovery('remote_command');
    endRecovery('shell_watchdog');
    expect(currentRecoveryOwner()).toBe('remote_command');
    endRecovery('remote_command');
    expect(isRecoveryInProgress()).toBe(false);
  });

  it('셸 워치독은 남이 잡고 있으면 판정 단계에서 물러난다', () => {
    expect(resolveShellWatchdogAction({ ...SUKDAE_1406, recoveryInProgress: true })).toBe('none');
  });
});

describe('§13 stress — 1,000 워치독 체크 · 100 복구 사이클', () => {
  it('정상 플레이어에서 1,000회 체크 → false recovery 0', () => {
    let acted = 0;
    for (let i = 0; i < 1_000; i++) {
      if (resolveShellWatchdogAction({ ...HEALTHY, shellAgeMs: 5_000 }) !== 'none') acted++;
    }
    expect(acted).toBe(0);
  });

  it('타이머 상실을 100회 반복해도 상태가 선형 증가하지 않는다', () => {
    for (let cycle = 0; cycle < 100; cycle++) {
      __resetControlPlaneForTest();
      const t0 = 1_000_000 + cycle * 10_000_000;

      // 정상: 런타임이 돌고 셸도 돈다
      notePlayerRuntimeAlive(t0);
      noteShellLayerAlive(t0);
      expect(readPlayerRuntimeAge(t0)).toBe(0);

      // 타이머 상실: 런타임만 멎고 셸은 계속 돈다
      const dead = t0 + PLAYER_RUNTIME_STALE_MS + 1_000;
      noteShellLayerAlive(dead);
      const health = readLayerHealth(dead);
      expect(health.shellAgeMs).toBe(0);

      const action = resolveShellWatchdogAction({
        ...HEALTHY,
        playerRuntimeAgeMs: readPlayerRuntimeAge(dead),
        shellAgeMs: health.shellAgeMs,
      });
      expect(action).toBe('remount_player');

      // 복구 후: 새 세대가 런타임 신호를 다시 찍는다
      const recovered = dead + 3_000;
      notePlayerRuntimeAlive(recovered);
      expect(isShellRecoveryVerified({
        playerRuntimeAgeMs: readPlayerRuntimeAge(recovered),
        progressSamples: 2,
      })).toBe(true);

      // 소유권이 남지 않는다
      expect(isRecoveryInProgress()).toBe(false);
    }
  });
});

describe('§12 저사양 예산 — 무엇을 추가했는가', () => {
  const plane = R('src/components/RecoveryControlPlane.tsx');
  const player = R('src/components/player/Player.tsx');

  it('네트워크 요청 추가 0 — 워치독은 서버를 부르지 않는다', () => {
    const i = plane.indexOf('function runShellWatchdog');
    const body = plane.slice(i, plane.indexOf('const runWatchdogRef', i));
    expect(body).not.toMatch(/fetch\(|supabase\.|rpc\(/);
  });

  it('저장소 쓰기 추가 0', () => {
    const i = player.indexOf('const tick = () => {');
    expect(player.slice(i, i + 1400)).not.toMatch(/localStorage|sessionStorage/);
  });

  it('렌더 추가 0 — 런타임 신호는 모듈 변수 대입 하나다', () => {
    const rc = R('src/lib/recoveryControlPlane.ts');
    const i = rc.indexOf('export function notePlayerRuntimeAlive');
    const body = rc.slice(i, i + 220);
    expect(body).not.toMatch(/useState|setState|dispatch|set\(/);
  });

  it('타이머 추가 0 — 기존 5초 틱에 얹었다', () => {
    expect(plane).toContain('원래 있던 5초 틱 하나에 얹는다');
  });
});
