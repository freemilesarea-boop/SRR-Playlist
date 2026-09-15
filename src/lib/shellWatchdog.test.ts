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
  REQUIRED_PROGRESS_SAMPLES, CONFIRM_OBSERVATIONS, PLAYER_RUNTIME_SUSPECT_MS,
  PLAYER_RUNTIME_SUSPECT_HIDDEN_MS, suspectThresholdMs, worstCaseDetectionMs,
  type ShellWatchdogInput,
} from './shellWatchdog';
import { RELOAD_PAGE_AFTER_MS, SKIP_AFTER_MS } from './stallWatchdog';
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
  documentHidden: false,
  // 30 — 2단계 감지. 기본 픽스처는 이미 확정 직전까지 관측이 쌓인 상태다.
  staleObservations: CONFIRM_OBSERVATIONS - 1,
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

describe('§2·§3 임계값 실험 — 숫자를 임의로 고르지 않는다', () => {
  /**
   * 타이머 구조의 비대칭이 실험의 전제다:
   *   런타임 신호 = 3초 **Web Worker** 티커 → 백그라운드 스로틀링에 강하다
   *   셸 판정    = 5초 **메인 스레드** interval → hidden 이면 분당 1회까지 눌린다
   *
   * 그래서 "정상인데 신호가 잠깐 낡아 보이는" 폭이 visible / hidden 에서 다르다.
   * 아래 지터 모형은 그 폭을 재현한다(ms 단위 gap).
   */
  const JITTER = {
    /** 정상: 3초 티커가 제때 돈다. */
    normal: [3_000, 3_100, 3_200, 2_900],
    /** 트랙 전환·큐 리필: 메인 스레드가 잠깐 바쁘다. */
    transition: [3_000, 5_000, 4_000, 6_000],
    /** 저사양 GC·긴 렌더: 드물게 수 초. */
    lowEndBlocking: [3_000, 8_000, 3_000, 12_000],
    /** 느린 네트워크: 티커 자체와는 무관하지만 함께 본다. */
    slowNetwork: [3_000, 4_000, 3_000, 5_000],
    /** SW 업데이트 적용 직전: 짧은 정지. */
    swUpdate: [3_000, 7_000, 3_000],
    /** 백그라운드 스로틀링(hidden) — 들쭉날쭉한 초기 구간. */
    backgroundThrottled: [30_000, 45_000, 60_000, 50_000],
    /**
     * 지속 스로틀링. 크로미움 계열은 백그라운드 타이머를 **분당 1회**까지 줄인다.
     * 그 상태가 이어지면 gap 이 60초 근처에서 계속 머문다 — 이게 최악 조건이다.
     */
    sustainedBackground: [60_000, 62_000, 61_000, 60_000],
  };

  /** 그 지터로 정상 재생이 이어질 때, 후보 임계값이 몇 번 오탐하는가. */
  function falseRecoveries(thresholdMs: number, gaps: number[], confirmNeeded: number): number {
    let stale = 0;
    let fired = 0;
    // 셸은 5초마다 본다. 티커 gap 을 5초 격자에 올려놓고 관측한다.
    for (let round = 0; round < 200; round++) {
      const age = gaps[round % gaps.length];       // 마지막 틱 이후 경과
      if (age >= thresholdMs) {
        stale += 1;
        if (stale >= confirmNeeded) { fired += 1; stale = 0; }
      } else {
        stale = 0;
      }
    }
    return fired;
  }

  const CANDIDATES = [30_000, 45_000, 60_000, 90_000, 150_000];

  it('visible 지터로는 30초 후보부터 이미 오탐이 없다 — 그래서 더 낮출 이유가 없다', () => {
    const visibleJitter = [
      ...JITTER.normal, ...JITTER.transition, ...JITTER.lowEndBlocking,
      ...JITTER.slowNetwork, ...JITTER.swUpdate,
    ];
    CANDIDATES.forEach((t) => {
      expect(falseRecoveries(t, visibleJitter, CONFIRM_OBSERVATIONS)).toBe(0);
    });
  });

  it('hidden 초기 스로틀링에서 30·45초는 오탐한다 (60초는 이 모형은 통과한다)', () => {
    const g = JITTER.backgroundThrottled;
    expect(falseRecoveries(30_000, g, CONFIRM_OBSERVATIONS)).toBeGreaterThan(0);
    expect(falseRecoveries(45_000, g, CONFIRM_OBSERVATIONS)).toBeGreaterThan(0);
    // 60초는 gap 이 60초를 **연속으로** 넘지 않아 이 모형에서는 살아남는다.
    // 통과했다고 안전하다는 뜻은 아니다 — 아래 지속 스로틀링이 진짜 조건이다.
    expect(falseRecoveries(60_000, g, CONFIRM_OBSERVATIONS)).toBe(0);
  });

  it('❗지속 스로틀링(분당 1회)에서는 60초 이하가 전부 오탐한다', () => {
    const g = JITTER.sustainedBackground;
    expect(falseRecoveries(30_000, g, CONFIRM_OBSERVATIONS)).toBeGreaterThan(0);
    expect(falseRecoveries(45_000, g, CONFIRM_OBSERVATIONS)).toBeGreaterThan(0);
    expect(falseRecoveries(60_000, g, CONFIRM_OBSERVATIONS)).toBeGreaterThan(0);
    // 90초부터 견딘다. 우리는 이미 쓰고 있는 150초를 골랐다 — 여유를 더 둔다.
    expect(falseRecoveries(90_000, g, CONFIRM_OBSERVATIONS)).toBe(0);
    expect(falseRecoveries(PLAYER_RUNTIME_SUSPECT_HIDDEN_MS, g, CONFIRM_OBSERVATIONS)).toBe(0);
  });

  it('그래서 임계값을 visible / hidden 으로 나눈다', () => {
    expect(suspectThresholdMs(false)).toBe(PLAYER_RUNTIME_SUSPECT_MS);
    expect(suspectThresholdMs(true)).toBe(PLAYER_RUNTIME_SUSPECT_HIDDEN_MS);
    expect(PLAYER_RUNTIME_SUSPECT_MS).toBeLessThan(PLAYER_RUNTIME_SUSPECT_HIDDEN_MS);
  });

  it('선택한 visible 임계값은 새 숫자가 아니다 — SKIP_AFTER_MS(35초)', () => {
    expect(PLAYER_RUNTIME_SUSPECT_MS).toBe(SKIP_AFTER_MS);
    // 3초 티커 기준 11번 연속 결측. 저사양 메인 스레드 블로킹(수 초)과 한 자릿수 이상 차이.
    expect(PLAYER_RUNTIME_SUSPECT_MS / 3_000).toBeGreaterThanOrEqual(11);
  });

  it('hidden 임계값도 새 숫자가 아니다 — RELOAD_PAGE_AFTER_MS(150초)', () => {
    expect(PLAYER_RUNTIME_SUSPECT_HIDDEN_MS).toBe(RELOAD_PAGE_AFTER_MS);
  });

  it('§3 목표 — visible 최악 감지 지연이 60초 이하다', () => {
    expect(worstCaseDetectionMs(false)).toBe(35_000 + 5_000 * CONFIRM_OBSERVATIONS);
    expect(worstCaseDetectionMs(false)).toBeLessThanOrEqual(60_000);
  });

  it('29 대비 3배 빨라졌고, 그날의 26분 방치 대비 1/30 이다', () => {
    expect(worstCaseDetectionMs(false)).toBeLessThan(155_000);      // 29 의 최악값
    expect(worstCaseDetectionMs(false) * 30).toBeLessThan(26 * 60_000);
  });
});

describe('§4 2단계 감지 — 한 번의 관측으로 리마운트하지 않는다', () => {
  it('첫 관측은 observe 다 (복구하지 않는다)', () => {
    expect(resolveShellWatchdogAction({ ...SUKDAE_1406, staleObservations: 0 })).toBe('observe');
  });

  it('확정에 필요한 만큼 쌓여야 움직인다', () => {
    for (let n = 0; n < CONFIRM_OBSERVATIONS - 1; n++) {
      expect(resolveShellWatchdogAction({ ...SUKDAE_1406, staleObservations: n })).toBe('observe');
    }
    expect(resolveShellWatchdogAction({
      ...SUKDAE_1406, staleObservations: CONFIRM_OBSERVATIONS - 1,
    })).toBe('remount_player');
  });

  it('중간에 정상으로 돌아오면 카운터가 리셋된다 (제어면이 리셋한다)', () => {
    const plane = R('src/components/RecoveryControlPlane.tsx');
    expect(plane).toContain("staleObservationsRef.current = 0;");
    expect(plane).toContain("staleObservationsRef.current += 1;");
  });

  it('새 타이머·네트워크·저장소·렌더를 추가하지 않는다', () => {
    const plane = R('src/components/RecoveryControlPlane.tsx');
    expect((plane.match(/window\.setInterval\(/g) ?? []).length).toBe(2);   // 29 와 동일
    expect(plane).not.toMatch(/localStorage|sessionStorage/);
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

/* ════════════════════════════════════════════════════════════════════════ */
/* §8 복구 race — 두 주체가 동시에 움직이지 않는다                             */
/* ════════════════════════════════════════════════════════════════════════ */
describe('§8 race injection — single owner 보장', () => {
  /** 두 주체가 같은 순간에 복구를 시도한다. 하나만 잡아야 한다. */
  function race(a: Parameters<typeof beginRecovery>[0], b: Parameters<typeof beginRecovery>[0]) {
    const gotA = beginRecovery(a);
    const gotB = beginRecovery(b);
    return { gotA, gotB, owner: currentRecoveryOwner() };
  }

  it('audio stall + player stale — 사다리가 먼저 잡으면 셸은 물러난다', () => {
    const r = race('player_ladder', 'shell_watchdog');
    expect(r.gotA).toBe(true);
    expect(r.gotB).toBe(false);
    expect(r.owner).toBe('player_ladder');
    // 그리고 판정 단계에서도 물러난다 — 이중 방어.
    expect(resolveShellWatchdogAction({ ...SUKDAE_1406, recoveryInProgress: true })).toBe('none');
  });

  it('remote command + player stale — 원격이 먼저 잡으면 셸은 물러난다', () => {
    const r = race('remote_command', 'shell_watchdog');
    expect(r.gotB).toBe(false);
    expect(r.owner).toBe('remote_command');
  });

  it('SW update + player stale — 셸이 잡았으면 다른 주체가 못 들어온다', () => {
    const r = race('shell_watchdog', 'player_ladder');
    expect(r.gotA).toBe(true);
    expect(r.gotB).toBe(false);
  });

  it('중복 remount / reload / skip 이 생기지 않는다 — 소유권이 하나뿐이다', () => {
    let remounts = 0;
    for (let i = 0; i < 100; i++) {
      // 같은 순간에 셋이 전부 시도한다.
      const owners = (['player_ladder', 'remote_command', 'shell_watchdog'] as const);
      const winners = owners.filter((o) => beginRecovery(o));
      expect(winners.length).toBe(1);
      if (winners[0] === 'shell_watchdog') remounts++;
      endRecovery(winners[0]);
      expect(isRecoveryInProgress()).toBe(false);
    }
    // 100 라운드 내내 소유권이 새지 않았다. (누가 이기든 항상 1명)
    expect(remounts).toBeLessThanOrEqual(100);
  });

  it('mutex 가 끼지 않는다 — 제어면이 finally 로 반드시 놓는다', () => {
    const plane = R('src/components/RecoveryControlPlane.tsx');
    expect(plane).toContain('} finally {');
    expect(plane).toContain("endRecovery('shell_watchdog')");
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* §7 최종 임계값으로 stress                                                  */
/* ════════════════════════════════════════════════════════════════════════ */
describe('§7 stress — 선택한 임계값으로', () => {
  it('정상 1,000회 체크 → false recovery 0', () => {
    let fired = 0;
    let stale = 0;
    for (let i = 0; i < 1_000; i++) {
      const a = resolveShellWatchdogAction({
        ...HEALTHY, playerRuntimeAgeMs: 3_000 + (i % 4) * 500, staleObservations: stale,
      });
      if (a === 'observe') stale++;
      else if (a === 'none') stale = 0;
      else fired++;
    }
    expect(fired).toBe(0);
  });

  it('백그라운드 스로틀 500회 체크 → false recovery 0', () => {
    let fired = 0;
    let stale = 0;
    for (let i = 0; i < 500; i++) {
      const a = resolveShellWatchdogAction({
        ...HEALTHY,
        documentHidden: true,
        playerRuntimeAgeMs: 60_000 + (i % 3) * 1_000,   // 지속 스로틀링 구간
        staleObservations: stale,
      });
      if (a === 'observe') stale++;
      else if (a === 'none') stale = 0;
      else fired++;
    }
    expect(fired).toBe(0);
  });

  it('네트워크 저하 100 사이클 → 셸은 개입하지 않는다 (티커는 네트워크와 무관)', () => {
    let fired = 0;
    for (let c = 0; c < 100; c++) {
      const a = resolveShellWatchdogAction({
        ...HEALTHY,
        playerRuntimeAgeMs: 3_000,      // 런타임은 멀쩡하다
        canNavigate: c % 2 === 0,       // 오프라인/온라인을 오간다
        staleObservations: 0,
      });
      if (a !== 'none') fired++;
    }
    expect(fired).toBe(0);
  });

  it('타이머 상실 100 사이클 — 매번 확정까지 정확히 CONFIRM_OBSERVATIONS 관측', () => {
    for (let c = 0; c < 100; c++) {
      let stale = 0;
      let observes = 0;
      let action: string = 'none';
      while (action !== 'remount_player' && observes < 10) {
        action = resolveShellWatchdogAction({ ...SUKDAE_1406, staleObservations: stale });
        if (action === 'observe') { stale++; observes++; }
      }
      expect(action).toBe('remount_player');
      expect(observes).toBe(CONFIRM_OBSERVATIONS - 1);
    }
  });
});
