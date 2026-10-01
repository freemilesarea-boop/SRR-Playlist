/**
 * Phase 28 — LEGACY ANDROID FIRST.
 *
 * 기준 실기기는 숙대점이다: Android 10 · Samsung Internet · 설치형 PWA ·
 * 무인 매장 24시간 연속 재생. 최신 태블릿이 아니라 **이 기기**가 성능 baseline 이다.
 *
 * 이 파일이 지키는 것은 하나다 — 오래 돌수록 나빠지지 않을 것.
 * 트랙이 5,000번 바뀌어도 타이머·구독·object URL·사다리 상태가 선형으로 늘지 않아야 한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { advanceProgressAnchor, countsAsPlayback, type ProgressAnchor } from './mediaProgress';
import {
  resolveStallAction, FRUITLESS_SKIP_LIMIT, SKIP_AFTER_MS, NUDGE_AFTER_MS,
  type StallInput,
} from './stallWatchdog';
import { gateReport, MAX_REPORTS_PER_DOCUMENT, __resetGlobalErrorTelemetryForTest } from './globalErrorTelemetry';

const R = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');

/* ════════════════════════════════════════════════════════════════════════ */
/* PART 1 · 2 — Object URL / Audio element 수명                              */
/* ════════════════════════════════════════════════════════════════════════ */
describe('PART 1 — object URL 은 유계다', () => {
  const cache = R('src/lib/audioCache/index.ts');

  it('동시에 살아 있는 object URL 에 상한이 있다', () => {
    const m = cache.match(/const MAX_LIVE_OBJECT_URLS = (\d+);/);
    expect(m).not.toBeNull();
    const cap = Number(m![1]);
    expect(cap).toBeGreaterThan(0);
    // 저사양 기기에서 디코드된 오디오를 몇 개나 물고 있을지의 상한이다.
    // 크로스페이드가 매장에서 꺼져 있으므로 한 자릿수면 충분하다.
    expect(cap).toBeLessThanOrEqual(8);
  });

  it('상한을 넘으면 가장 오래된 것부터 revoke 한다 (LRU)', () => {
    expect(cache).toContain('function trimLiveObjectUrls');
    expect(cache).toContain('URL.revokeObjectURL');
    expect(cache).toContain('liveOrder.splice');
  });

  it('재생 경로의 createObjectURL 은 audioCache 한 곳뿐이다', () => {
    // 플레이어가 직접 만들면 revoke 주인이 사라진다.
    expect(R('src/components/player/Player.tsx')).not.toContain('createObjectURL');
    expect(R('src/pages/BrandPlayerPage.tsx')).not.toContain('createObjectURL');
  });

  it('워커 blob URL 도 stop 에서 revoke 된다', () => {
    const t = R('src/lib/backgroundTicker.ts');
    expect(t).toContain('URL.createObjectURL');
    expect(t).toContain('URL.revokeObjectURL(url)');
    expect(t).toContain('worker.terminate()');
  });
});

describe('PART 2 — 매장 모드에서는 crossfade 가 아예 돌지 않는다', () => {
  const player = R('src/components/player/Player.tsx');

  it('businessMode 면 startCrossfade 가 첫 줄에서 반환한다', () => {
    const i = player.indexOf('const startCrossfade = useCallback(async () => {');
    expect(i).toBeGreaterThan(-1);
    // 첫 가드가 businessMode 여야 한다 — 뒤에 있으면 그 사이 코드가 매장에서도 돈다.
    const head = player.slice(i, i + 400);
    expect(head).toMatch(/if \(businessMode\) return;/);
  });

  it('따라서 숙대의 트랙 전환 경로는 onEnded 하나다 (crossfade lock 무관)', () => {
    expect(player).toContain('function onEnded(');
    expect(player).toContain("next({ cause: 'audio_ended' })");
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* PART 3 — 장기 실행 타이머 inventory                                        */
/* ════════════════════════════════════════════════════════════════════════ */
describe('PART 3 — 모든 장기 타이머는 주인과 해제가 짝을 이룬다', () => {
  /**
   * OWNER / CREATE / CLEANUP 을 소스에서 직접 검증한다.
   * 0개가 되는 것(정지)도, 2개 이상이 되는 것(중복)도 둘 다 금지다.
   */
  const TIMERS = [
    { owner: 'src/hooks/useBrandPlayerHeartbeat.ts', create: 'window.setInterval', clear: 'window.clearInterval' },
    { owner: 'src/components/RecoveryControlPlane.tsx', create: 'window.setInterval', clear: 'window.clearInterval' },
    { owner: 'src/components/store/AnnouncementOverlay.tsx', create: 'setInterval', clear: 'clearInterval' },
    { owner: 'src/components/store/EmergencyBroadcastOverlay.tsx', create: 'setInterval', clear: 'clearInterval' },
  ];

  TIMERS.forEach(({ owner, create, clear }) => {
    it(`${owner.split('/').pop()} — 만든 만큼 해제한다`, () => {
      const src = R(owner);
      expect(src).toContain(create);
      expect(src).toContain(clear);
    });
  });

  it('stall watchdog 은 워커 ticker 를 쓰고 stop() 을 가진다', () => {
    const t = R('src/lib/backgroundTicker.ts');
    expect(t).toContain('export function startBackgroundTicker');
    expect(t).toContain('stop: ()');
    expect(R('src/components/player/Player.tsx')).toContain('startBackgroundTicker');
  });

  it('제어면은 단일 소유권으로 중복 구독을 막는다', () => {
    const plane = R('src/components/RecoveryControlPlane.tsx');
    expect(plane).toContain('acquireCommandReceiver');
    expect(plane).toContain('releaseCommandReceiver');
  });

  it('플레이어 페이지 훅은 더 이상 Realtime 을 구독하지 않는다 (27 구조 유지)', () => {
    expect(R('src/hooks/useBrandPlayerHeartbeat.ts')).not.toContain('subscribeStoreRecoveryCommands');
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* PART 4 · 6 — 트랙 경계와 RPC 격리                                          */
/* ════════════════════════════════════════════════════════════════════════ */
describe('PART 4·6 — 한 RPC 실패가 다음 곡을 막지 않는다', () => {
  const player = R('src/components/player/Player.tsx');

  it('❗이어추천 RPC 가 거부돼도 next() 는 호출된다', () => {
    // 예전에는 .then() 하나뿐이라 rejection 이 next() 를 통째로 삼켰다.
    const i = player.indexOf('void maybeAutoplayRecommendations()');
    expect(i).toBeGreaterThan(-1);
    const block = player.slice(i, i + 500);
    expect(block).toContain('.then(advance,');           // rejection 핸들러가 있다
    expect(block).toContain('advance(false)');           // 그 안에서도 큐를 진행한다
  });

  it('텔레메트리 RPC 는 전부 fire-and-forget 이다 (await 하지 않는다)', () => {
    const i = player.indexOf('function onEnded(');
    const block = player.slice(i, player.indexOf('function onError(', i));
    for (const rpc of ['recordPlayEvent', 'trackStream', 'safeRecordStreamV2',
                       'logPlaybackEventV2', 'clearContinueListening']) {
      expect(block).toContain(`void ${rpc}(`);           // void — 체인을 막지 않는다
      expect(block).not.toContain(`await ${rpc}(`);
    }
  });

  it('무한 재시도가 없다 — 캐시 다운로드는 in-flight 가드로 1회만', () => {
    const cache = R('src/lib/audioCache/index.ts');
    expect(cache).toContain('if (inFlight.has(audioUrl)) return false;');
  });

  it('캐시 저장소가 던져도 재생 경로로 전파되지 않는다', () => {
    expect(R('src/lib/audioCache/index.ts')).toContain('캐시는 부가 기능이고 재생은 아니다');
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* PART 17 — 장시간 가속 stress                                               */
/* ════════════════════════════════════════════════════════════════════════ */
describe('PART 17 — 5,000 트랙 전환에도 상태가 유계다', () => {
  const TRANSITIONS = 5_000;

  /** 무인 매장 정상 상태. 캐스트를 쓰지 않는다 — 필드가 늘면 여기서 먼저 깨져야 한다. */
  const BASE: StallInput = {
    businessMode: true, playing: true, paused: false, ended: false,
    crossfading: false, suppressed: false, autoplayBlocked: false,
    subscriptionBlocked: false, stalledMs: 0, online: true,
  };

  it('진행 기준점은 트랙마다 새 객체를 쌓지 않는다', () => {
    let anchor: ProgressAnchor = { trackId: null, ct: 0 };
    let progressCount = 0;
    for (let i = 0; i < TRANSITIONS; i++) {
      const id = `track-${i}`;
      // 트랙 시작 — 전환은 진행으로 세지 않는다
      let v = advanceProgressAnchor(anchor, id, 0);
      anchor = v.anchor;
      expect(v.kind).toBe('track_change');
      // 정상 재생 3초씩 40회 = 120초
      for (let t = 3; t <= 120; t += 3) {
        v = advanceProgressAnchor(anchor, id, t);
        anchor = v.anchor;
        if (countsAsPlayback(v)) progressCount++;
      }
    }
    // 기준점은 항상 **하나**다. 키가 늘지 않는다.
    expect(Object.keys(anchor)).toEqual(['trackId', 'ct']);
    expect(anchor.trackId).toBe(`track-${TRANSITIONS - 1}`);
    // 진행 판정은 트랙당 40회로 일정하다 — 누적 배수가 되지 않는다.
    expect(progressCount).toBe(TRANSITIONS * 40);
  });

  it('정상 재생이 이어지는 동안 사다리는 한 칸도 올라가지 않는다', () => {
    const actions = new Set<string>();
    for (let i = 0; i < TRANSITIONS; i++) {
      actions.add(resolveStallAction({ ...BASE, stalledMs: 0 }));
    }
    expect([...actions]).toEqual(['none']);
  });

  it('얼어붙은 상태가 반복돼도 헛skip 은 상한에서 멈춘다', () => {
    let fruitless = 0;
    let hardResets = 0;
    for (let i = 0; i < TRANSITIONS; i++) {
      const a = resolveStallAction({
        ...BASE,
        stalledMs: SKIP_AFTER_MS,
        fruitlessSkips: fruitless,
        hardResetDone: hardResets > 0,
      });
      if (a === 'skip') fruitless++;
      if (a === 'hard_reset') { hardResets++; fruitless = 0; }
      // 상한을 넘겨 자라지 않는다
      expect(fruitless).toBeLessThanOrEqual(FRUITLESS_SKIP_LIMIT);
    }
    expect(hardResets).toBeGreaterThan(0);
  });

  it('사다리 임계값은 저사양 기기에서도 사람보다 먼저 움직인다', () => {
    // 8초면 점주가 이상을 느끼기 전이다.
    expect(NUDGE_AFTER_MS).toBeLessThanOrEqual(10_000);
    expect(SKIP_AFTER_MS).toBeLessThan(60_000);
  });

  it('전역 예외 기록은 문서 수명당 상한을 넘지 않는다 (24시간 연속 실행)', () => {
    __resetGlobalErrorTelemetryForTest();
    let allowed = 0;
    for (let i = 0; i < TRANSITIONS; i++) {
      if (gateReport(`err-${i}`, i * 1_000).allowed) allowed++;
    }
    expect(allowed).toBe(MAX_REPORTS_PER_DOCUMENT);
  });
});

/* ════════════════════════════════════════════════════════════════════════ */
/* PART 19 — LEGACY ANDROID FIRST guardrail                                  */
/* ════════════════════════════════════════════════════════════════════════ */
describe('PART 19 — 지원 기준을 조용히 올리지 않는다', () => {
  it('브라우저/기기 종류로 매장 재생기를 가르지 않는다', () => {
    const mi = R('src/lib/monitoredInstall.ts');
    expect(mi).toContain('관찰 metadata 일 뿐 — 판정에 쓰지 않는다');
    // 주석이 줄바꿈으로 갈려 있어 정규식으로 본다.
    expect(mi).toMatch(/화정점의 정상 매장[\s*]*재생기는 데스크톱이다/);
  });

  it('자동재생 성공을 가정하지 않는다', () => {
    // Samsung Internet/PWA 에서 리로드 뒤 자동재생이 막힐 수 있다.
    const zt = R('src/lib/zeroTouchUpdate.ts');
    expect(zt).toContain('AUTOPLAY_BLOCKED');
    expect(zt).toContain('AUTOPLAY_UNKNOWN');
  });

  it('업데이트는 무기한 미루지 않는다', () => {
    expect(R('src/lib/zeroTouchUpdate.ts')).toMatch(/MAX|시간|12h|deadline/i);
  });
});
