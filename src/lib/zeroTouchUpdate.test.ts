// LEGACY-ANDROID-ZERO-TOUCH-UPDATE §2 · §3 · §7 · §10 · §12
//
// 24시간 매장이 사람 없이 새 빌드를 받되, **업데이트 때문에 음악이 멈추지는
// 않게** 하는 결정 규칙. §12 의 주입 시나리오 A~J 를 전부 여기서 돌린다.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decideUpdateActivation, deterministicStaggerMs, alreadyActivated, markActivated,
  activationMarkerKey, MAX_DEFER_MS, STAGGER_WINDOW_MS,
  noteAutoplaySignals, autoplayTrusted, autoplayTrustState, __resetAutoplayTrustForTest,
} from './zeroTouchUpdate';

/** 새 빌드가 대기 중이고 매장이 정상 재생 중인 기본 상태. */
const base = {
  updatePending: true,
  businessMode: true,
  audioActive: true,
  atTrackBoundary: false,
  crossfading: false,
  recovering: false,
  online: true,
  autoplayTrusted: true,
  deferredSince: 1_000_000,
  staggerMs: 0,
  now: 1_000_000,
};

describe('§3 트랙 경계를 최우선 활성화 창으로 쓴다', () => {
  it('A. 정상 재생 중(곡 중간)에는 적용하지 않는다', () => {
    expect(decideUpdateActivation(base)).toEqual({ kind: 'wait', blocker: 'mid_track' });
  });

  it('트랙 경계에서 적용한다 — 이게 핵심이다', () => {
    expect(decideUpdateActivation({ ...base, atTrackBoundary: true }))
      .toEqual({ kind: 'activate', reason: 'track_boundary' });
  });

  it('소리가 아예 없으면(영업 종료·이미 정지) 즉시 적용한다 — 리로드가 오히려 복구다', () => {
    expect(decideUpdateActivation({ ...base, audioActive: false }))
      .toEqual({ kind: 'activate', reason: 'audio_idle' });
  });

  it('적용할 업데이트가 없으면 아무것도 하지 않는다', () => {
    expect(decideUpdateActivation({ ...base, updatePending: false, atTrackBoundary: true }))
      .toEqual({ kind: 'wait', blocker: 'no_update' });
  });

  it('일반 사용자(매장 모드 아님)는 이 경로를 타지 않는다', () => {
    expect(decideUpdateActivation({ ...base, businessMode: false, atTrackBoundary: true }))
      .toEqual({ kind: 'wait', blocker: 'not_business' });
  });
});

describe('§12 B · C. 크로스페이드 / 복구 중에는 끼어들지 않는다', () => {
  it('B. 크로스페이드 임계 구간이면 경계여도 미룬다', () => {
    expect(decideUpdateActivation({ ...base, atTrackBoundary: true, crossfading: true }))
      .toEqual({ kind: 'wait', blocker: 'crossfading' });
  });

  it('C. 복구 사다리가 도는 중이면 미룬다 — 새로 만든 엘리먼트를 리로드가 부순다', () => {
    expect(decideUpdateActivation({ ...base, atTrackBoundary: true, recovering: true }))
      .toEqual({ kind: 'wait', blocker: 'recovering' });
  });

  it('복구가 크로스페이드보다 먼저 판정된다 (더 위험한 쪽)', () => {
    expect(decideUpdateActivation({
      ...base, atTrackBoundary: true, recovering: true, crossfading: true,
    })).toEqual({ kind: 'wait', blocker: 'recovering' });
  });
});

describe('§12 D. 오프라인 중에는 적용하지 않는다', () => {
  it('회선이 없으면 경계여도 미룬다 — 셸은 떠도 음원을 못 받는다', () => {
    expect(decideUpdateActivation({ ...base, atTrackBoundary: true, online: false }))
      .toEqual({ kind: 'wait', blocker: 'offline' });
  });

  it('상한을 넘겨도 오프라인이면 적용하지 않는다 (offline_hold 와 같은 이유)', () => {
    expect(decideUpdateActivation({
      ...base, online: false, now: base.deferredSince + MAX_DEFER_MS + 1,
    })).toEqual({ kind: 'wait', blocker: 'offline' });
  });
});

describe('§5 자동재생 신뢰가 없으면 자동으로 리로드하지 않는다', () => {
  it('제스처 없이 소리를 못 시작한 문서는 경계에서도 미룬다', () => {
    expect(decideUpdateActivation({ ...base, atTrackBoundary: true, autoplayTrusted: false }))
      .toEqual({ kind: 'wait', blocker: 'autoplay_not_trusted' });
  });

  it('**상한을 넘겨도** 자동 리로드하지 않는다 — 무인 매장을 조용하게 만드는 것보다 옛 빌드가 낫다', () => {
    expect(decideUpdateActivation({
      ...base, autoplayTrusted: false, now: base.deferredSince + MAX_DEFER_MS + 1,
    })).toEqual({ kind: 'wait', blocker: 'autoplay_not_trusted' });
  });

  it('신뢰가 있으면 경계에서 적용한다', () => {
    expect(decideUpdateActivation({ ...base, atTrackBoundary: true, autoplayTrusted: true }))
      .toEqual({ kind: 'activate', reason: 'track_boundary' });
  });
});

describe('§2 무한정 미루지 않는다 — 단 안전 조건은 상한보다 강하다', () => {
  it('상한을 넘기면 곡 중간이어도 적용한다', () => {
    expect(decideUpdateActivation({ ...base, now: base.deferredSince + MAX_DEFER_MS }))
      .toEqual({ kind: 'activate', reason: 'max_defer' });
  });

  it('상한 직전까지는 미룬다', () => {
    expect(decideUpdateActivation({ ...base, now: base.deferredSince + MAX_DEFER_MS - 1 }))
      .toEqual({ kind: 'wait', blocker: 'mid_track' });
  });

  it('상한이 2시간이다 — 숙대 실측 2시간에 트랙 경계가 45회였다', () => {
    expect(MAX_DEFER_MS).toBe(2 * 60 * 60 * 1000);
    // 기존 12시간보다 짧다. 안정성 수정이 반나절을 기다리지 않는다.
    expect(MAX_DEFER_MS).toBeLessThan(12 * 60 * 60 * 1000);
  });

  it('아직 미룬 적이 없으면(deferredSince=null) 상한이 발동하지 않는다', () => {
    expect(decideUpdateActivation({ ...base, deferredSince: null }))
      .toEqual({ kind: 'wait', blocker: 'mid_track' });
  });
});

describe('§10 전 매장이 동시에 origin 을 때리지 않는다', () => {
  it('stagger 시간 전에는 안전 창이어도 기다린다', () => {
    const d = decideUpdateActivation({
      ...base, atTrackBoundary: true, staggerMs: 60_000, now: base.deferredSince + 10_000,
    });
    expect(d).toEqual({ kind: 'wait', blocker: 'stagger', retryInMs: 50_000 });
  });

  it('stagger 가 지나면 적용한다', () => {
    expect(decideUpdateActivation({
      ...base, atTrackBoundary: true, staggerMs: 60_000, now: base.deferredSince + 60_000,
    })).toEqual({ kind: 'activate', reason: 'track_boundary' });
  });

  it('상한을 넘기면 stagger 를 무시한다 — 뒷문은 막지 않는다', () => {
    expect(decideUpdateActivation({
      ...base, staggerMs: 9_999_999, now: base.deferredSince + MAX_DEFER_MS,
    })).toEqual({ kind: 'activate', reason: 'max_defer' });
  });

  it('같은 매장은 항상 같은 지연이 나온다 (결정적)', () => {
    const a = deterministicStaggerMs('1311d900-c451-4b9b-8ced-27f164bdc337');
    const b = deterministicStaggerMs('1311d900-c451-4b9b-8ced-27f164bdc337');
    expect(a).toBe(b);
  });

  it('다른 매장은 다른 지연으로 흩어진다', () => {
    const sukdae = deterministicStaggerMs('1311d900-c451-4b9b-8ced-27f164bdc337');
    const hwajeong = deterministicStaggerMs('3caef236-d025-4141-8c96-3eb5067a53e0');
    expect(sukdae).not.toBe(hwajeong);
  });

  it('항상 창 안에 들어온다', () => {
    for (let i = 0; i < 500; i++) {
      const ms = deterministicStaggerMs(`store-${i}`);
      expect(ms).toBeGreaterThanOrEqual(0);
      expect(ms).toBeLessThan(STAGGER_WINDOW_MS);
    }
  });

  it('1000개 매장이 창 전체에 고르게 퍼진다 (한 구간에 쏠리지 않는다)', () => {
    const buckets = new Array(10).fill(0);
    for (let i = 0; i < 1000; i++) {
      const ms = deterministicStaggerMs(`store-${i}`);
      buckets[Math.floor((ms / STAGGER_WINDOW_MS) * 10)] += 1;
    }
    // 완전 균등을 요구하지 않는다 — 한 구간이 절반을 먹지 않으면 충분하다.
    for (const b of buckets) expect(b).toBeLessThan(500);
    expect(Math.min(...buckets)).toBeGreaterThan(0);
  });

  it('키가 없으면 흩뿌리지 않는다', () => {
    expect(deterministicStaggerMs('')).toBe(0);
  });
});

describe('§7 · §12 I · J. 같은 빌드로 두 번 활성화하지 않는다', () => {
  function memStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
      clear: () => m.clear(),
      key: (n: number) => [...m.keys()][n] ?? null,
      get length() { return m.size; },
    } as Storage;
  }

  it('J. 같은 빌드 이벤트가 반복돼도 표식이 한 번만 세워진다', () => {
    const s = memStorage();
    expect(alreadyActivated('build-1', s)).toBe(false);
    markActivated('build-1', s);
    // 같은 업데이트 이벤트가 10번 더 와도
    for (let i = 0; i < 10; i++) markActivated('build-1', s);
    expect(alreadyActivated('build-1', s)).toBe(true);
    expect(s.length).toBe(1);      // 키가 늘어나지 않는다
  });

  it('빌드가 다르면 각각 한 번씩 활성화할 수 있다', () => {
    const s = memStorage();
    markActivated('build-1', s);
    expect(alreadyActivated('build-1', s)).toBe(true);
    expect(alreadyActivated('build-2', s)).toBe(false);
  });

  it('I. 저장소를 못 읽으면 업데이트를 영영 막지 않는다 (표식 부재 = 미활성으로 본다)', () => {
    const broken = {
      getItem: () => { throw new Error('SecurityError'); },
      setItem: () => { throw new Error('SecurityError'); },
    } as unknown as Storage;
    expect(alreadyActivated('build-1', broken)).toBe(false);
    expect(() => markActivated('build-1', broken)).not.toThrow();
  });

  it('표식 키에 빌드 id 가 들어간다', () => {
    expect(activationMarkerKey('abc123')).toContain('abc123');
  });
});

describe('§12 E · F · G · H. 업데이트 수명주기 전체', () => {
  it('E. SW 가 waiting 상태여도 재생 중이면 적용하지 않는다', () => {
    // waiting 은 updatePending 으로 들어온다. 나머지 조건이 안전 창을 결정한다.
    expect(decideUpdateActivation(base)).toEqual({ kind: 'wait', blocker: 'mid_track' });
  });

  it('F. controllerchange 가 여러 번 와도 결정은 상태만 보고 내린다 (멱등)', () => {
    const d1 = decideUpdateActivation({ ...base, atTrackBoundary: true });
    const d2 = decideUpdateActivation({ ...base, atTrackBoundary: true });
    expect(d1).toEqual(d2);
  });

  it('G. 리로드했는데 자동재생이 막혔다면 다음 문서는 신뢰 없음으로 시작한다', () => {
    // 새 문서에서 autoplayTrusted=false → 또 리로드하지 않는다(리로드 루프 차단).
    expect(decideUpdateActivation({ ...base, autoplayTrusted: false, audioActive: false }))
      .toEqual({ kind: 'wait', blocker: 'autoplay_not_trusted' });
  });

  it('H. 리로드 후 소리가 돌아왔으면 그 문서는 더 이상 업데이트 대상이 아니다', () => {
    expect(decideUpdateActivation({ ...base, updatePending: false }))
      .toEqual({ kind: 'wait', blocker: 'no_update' });
  });
});

describe('§13 기존 안정성 규칙을 뒤집지 않는다', () => {
  it('오프라인 보류가 상한보다 강하다', () => {
    const d = decideUpdateActivation({
      ...base, online: false, atTrackBoundary: true,
      now: base.deferredSince + MAX_DEFER_MS * 10,
    });
    expect(d.kind).toBe('wait');
  });

  it('복구 중 보류가 상한보다 강하다', () => {
    const d = decideUpdateActivation({
      ...base, recovering: true, now: base.deferredSince + MAX_DEFER_MS * 10,
    });
    expect(d).toEqual({ kind: 'wait', blocker: 'recovering' });
  });

  it('어떤 입력에도 예외를 던지지 않는다 (순수 결정 함수)', () => {
    const flags = [true, false];
    for (const a of flags) for (const b of flags) for (const c of flags) for (const d of flags) {
      expect(() => decideUpdateActivation({
        ...base, audioActive: a, atTrackBoundary: b, crossfading: c, recovering: d,
      })).not.toThrow();
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* 배선 계약 — main.tsx 가 이 결정을 실제로 쓰는지 소스로 고정한다             */
/* ────────────────────────────────────────────────────────────────────────── */

describe('main.tsx 배선', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf-8');

  it('결정 함수를 실제로 부른다', () => {
    expect(src).toContain('decideUpdateActivation({');
    expect(src).toContain("decision.kind === 'activate'");
  });

  it('30초 폴링이 아니라 audioActive 변화를 구독한다 (확률 → 사건)', () => {
    expect(src).toContain('usePlaybackHealthStore.subscribe(');
    expect(src).toContain('st.audioActive !== prev.audioActive');
  });

  it('폴링은 안전망으로 남는다 — 구독이 안 돌아도 상한에는 닿는다', () => {
    expect(src).toContain("requestReload('deferred-recheck')");
  });

  it('자동재생 신뢰를 이 문서의 실제 이력으로 계산한다', () => {
    expect(src).toContain('autoplayTrusted: autoplayTrusted()');
  });

  it('24 — 신뢰 관측이 업데이트 감지보다 먼저 켜진다 (첫 경계를 잃지 않는다)', () => {
    // 부팅 즉시 현재 상태를 한 번 읽고, 그 뒤로 계속 듣는다.
    expect(src).toContain('noteAutoplaySignals(usePlaybackHealthStore.getState());');
    expect(src).toContain('usePlaybackHealthStore.subscribe(noteAutoplaySignals);');
    // 그 관측이 업데이트 감지 이후에야 걸리는 지연 구독 안에 남아 있으면 안 된다.
    const lazy = src.slice(src.indexOf('if (audioSub === null)'));
    expect(lazy).not.toContain('noteAutoplaySignals');
    // 부팅 배선이 requestReload 정의보다 앞에 있어야 한다(감지 전에 켜진다).
    expect(src.indexOf('usePlaybackHealthStore.subscribe(noteAutoplaySignals);'))
      .toBeLessThan(src.indexOf('function requestReload('));
  });

  it('빌드당 1회 표식을 세운다 (리로드 루프 차단, 이중 가드)', () => {
    expect(src).toContain('if (alreadyActivated(BUILD_ID)) return;');
    expect(src).toContain('markActivated(BUILD_ID);');
    expect(src).toContain('window.sessionStorage.getItem(SW_RELOAD_KEY)');
  });

  it('매장별 stagger 를 적용한다', () => {
    expect(src).toContain('deterministicStaggerMs(');
  });

  it('업데이트 수명주기를 서버에 남긴다 — 이게 없어서 6번 배포를 놓친 걸 몰랐다', () => {
    for (const e of ['update_pending', 'update_activated', 'update_blocked']) {
      expect(src).toContain(`'${e}'`);
    }
  });

  it('24 — 그 기록이 리로드를 견딘다 (keepalive beacon)', () => {
    // 일반 fetch 는 문서가 사라질 때 같이 취소된다. 2026-09-14 숙대점이 배포 두 건을
    // 자동으로 받았는데 update_* 가 한 줄도 안 남은 것이 그 증거다.
    for (const e of ['update_pending', 'update_activated', 'update_blocked']) {
      const at = src.indexOf(`'${e}'`);
      expect(src.slice(Math.max(0, at - 60), at)).toContain('beaconPlaybackDiagnostic(');
    }
    const diag = readFileSync(resolve(process.cwd(), 'src/lib/playbackDiagnostics.ts'), 'utf-8');
    expect(diag).toContain('keepalive: true');
  });

  it('24 — controllerchange 를 그 자리에서 남긴다 (누가 리로드했는지 가리는 표식)', () => {
    expect(src).toContain("beaconPlaybackDiagnostic('sw_controllerchange'");
    // 판단보다 **먼저** 남겨야 한다 — 판단 도중 문서가 사라질 수 있다.
    const marker = src.indexOf("beaconPlaybackDiagnostic('sw_controllerchange'");
    const call = src.indexOf("requestReload('controllerchange')");
    expect(marker).toBeLessThan(call);
  });

  it('blocker 로그가 유계다 (같은 사유를 매 tick 남기지 않는다)', () => {
    expect(src).toContain('lastBlockerLogged');
  });

  it('일반 사용자는 기존대로 즉시 적용된다 (매장 전용 경로다)', () => {
    expect(src).toContain('if (!businessMode) { applyReload(reason); return; }');
  });
});


/* ────────────────────────────────────────────────────────────────────────── */
/* 24 §1 — 자동재생 신뢰의 누적 관측                                            */
/*                                                                            */
/* 회귀 대상: 업데이트가 감지된 순간 **이미 재생 중**이던 문서가 첫 트랙 경계를   */
/* autoplay_not_trusted 로 버리던 결함. 원인은 관측을 감지 이후에야 시작해       */
/* 그 이전의 사실(지금 소리가 나고 있다)을 못 본 것이었다.                       */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§1 자동재생 신뢰 — 감지 시점에 이미 재생 중', () => {
  beforeEach(() => { __resetAutoplayTrustForTest(); });

  it('관측을 켜기 전에는 아무 근거가 없다 (이게 버려지던 원인이다)', () => {
    expect(autoplayTrusted()).toBe(false);
    const boundary = { ...base, audioActive: false, atTrackBoundary: true, autoplayTrusted: autoplayTrusted() };
    expect(decideUpdateActivation(boundary)).toEqual({ kind: 'wait', blocker: 'autoplay_not_trusted' });
  });

  it('부팅 시 현재 상태를 한 번 읽으면 첫 경계에서 바로 적용된다', () => {
    // 업데이트 감지 시점의 사실: 제스처 없이 이미 소리가 나고 있다.
    noteAutoplaySignals({ audioActive: true, autoplayBlocked: false });
    expect(autoplayTrusted()).toBe(true);

    // 그 문서의 첫 트랙 경계.
    const boundary = { ...base, audioActive: false, atTrackBoundary: true, autoplayTrusted: autoplayTrusted() };
    expect(decideUpdateActivation(boundary)).toEqual({ kind: 'activate', reason: 'track_boundary' });
  });

  it('전이를 못 봐도 신뢰가 유지된다 — 한 번 참이면 되돌리지 않는다', () => {
    noteAutoplaySignals({ audioActive: true, autoplayBlocked: false });
    // 트랙 경계에서 잠깐 false 로 떨어지는 것은 신뢰를 깨지 않는다.
    noteAutoplaySignals({ audioActive: false, autoplayBlocked: false });
    expect(autoplayTrusted()).toBe(true);
  });

  it('막힌 적이 있으면 지금 소리가 나도 신뢰하지 않는다 (보수성 유지)', () => {
    noteAutoplaySignals({ audioActive: false, autoplayBlocked: true });   // 부팅 때 막힘
    noteAutoplaySignals({ audioActive: true, autoplayBlocked: false });   // 사람이 눌러 살아남
    expect(autoplayTrusted()).toBe(false);

    const boundary = { ...base, audioActive: false, atTrackBoundary: true, autoplayTrusted: autoplayTrusted() };
    expect(decideUpdateActivation(boundary)).toEqual({ kind: 'wait', blocker: 'autoplay_not_trusted' });
  });

  it('상한을 넘겨도 미신뢰면 활성화하지 않는다', () => {
    noteAutoplaySignals({ audioActive: false, autoplayBlocked: true });
    const expired = {
      ...base, autoplayTrusted: autoplayTrusted(),
      deferredSince: 0, now: MAX_DEFER_MS + 1,
    };
    expect(decideUpdateActivation(expired)).toEqual({ kind: 'wait', blocker: 'autoplay_not_trusted' });
  });
});

describe('§2 자동재생 상태 모델 (보고용 — 판정에 쓰지 않는다)', () => {
  beforeEach(() => { __resetAutoplayTrustForTest(); });

  it('아무 것도 관측되지 않았으면 UNKNOWN', () => {
    expect(autoplayTrustState({ audioActive: false, autoplayBlocked: false }))
      .toBe('AUTOPLAY_UNKNOWN');
  });

  it('지금 막혀 있으면 BLOCKED', () => {
    expect(autoplayTrustState({ audioActive: false, autoplayBlocked: true }))
      .toBe('AUTOPLAY_BLOCKED');
  });

  it('막혔다가 사람이 눌러 살아난 문서는 RECOVERED_BY_GESTURE — TRUSTED 가 아니다', () => {
    noteAutoplaySignals({ audioActive: false, autoplayBlocked: true });
    noteAutoplaySignals({ audioActive: true, autoplayBlocked: false });
    expect(autoplayTrustState({ audioActive: true, autoplayBlocked: false }))
      .toBe('AUTOPLAY_RECOVERED_BY_GESTURE');
    // 승격하지 않는다 — 근거가 없다.
    expect(autoplayTrusted()).toBe(false);
  });

  it('한 번도 막히지 않고 소리가 났으면 TRUSTED_FOR_RELOAD', () => {
    noteAutoplaySignals({ audioActive: true, autoplayBlocked: false });
    expect(autoplayTrustState({ audioActive: true, autoplayBlocked: false }))
      .toBe('AUTOPLAY_TRUSTED_FOR_RELOAD');
    expect(autoplayTrusted()).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */
/* 24 §4 — sessionStorage 가 리로드를 넘지 못해도 리로드 루프가 없다             */
/*                                                                            */
/* Samsung Internet 30 설치형 PWA 에서 reload 뒤 sessionStorage 표식이 사라진    */
/* 정황이 있다(24 §3). 표식이 전부 사라져도 루프가 성립하지 않아야 한다.          */
/* ────────────────────────────────────────────────────────────────────────── */

describe('§4 표식이 사라져도 reload <= 1 per build', () => {
  /** 저장소가 리로드마다 통째로 비워지는 기기. */
  function amnesiacStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => { m.set(k, v); },
      removeItem: (k: string) => { m.delete(k); },
      clear: () => { m.clear(); },
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  it('같은 문서 안에서는 표식이 두 번째 활성화를 막는다', () => {
    const s = amnesiacStorage();
    expect(alreadyActivated('BUILD_A', s)).toBe(false);
    markActivated('BUILD_A', s);
    expect(alreadyActivated('BUILD_A', s)).toBe(true);
  });

  it('리로드로 표식이 사라져도 루프가 돌지 않는다 — 새 문서의 BUILD_ID 가 다르다', () => {
    // 문서 1: 옛 빌드가 새 빌드를 감지하고 활성화한다.
    let s = amnesiacStorage();
    markActivated('BUILD_OLD', s);

    // 리로드 — 저장소가 비워졌다.
    s = amnesiacStorage();
    expect(alreadyActivated('BUILD_NEW', s)).toBe(false);   // 표식이 없다

    // 그런데 새 문서는 이미 최신이라 적용할 업데이트가 없다.
    const noUpdate = { ...base, updatePending: false, autoplayTrusted: true };
    expect(decideUpdateActivation(noUpdate)).toEqual({ kind: 'wait', blocker: 'no_update' });
  });

  it('저장소가 던져도 업데이트를 영영 막지 않는다', () => {
    const hostile = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    } as unknown as Storage;
    expect(alreadyActivated('BUILD_X', hostile)).toBe(false);
    expect(() => markActivated('BUILD_X', hostile)).not.toThrow();
  });
});
