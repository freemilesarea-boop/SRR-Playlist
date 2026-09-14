// LEGACY-ANDROID-ZERO-TOUCH-UPDATE §2 · §3 · §7 · §10 · §12
//
// 24시간 매장이 사람 없이 새 빌드를 받되, **업데이트 때문에 음악이 멈추지는
// 않게** 하는 결정 규칙. §12 의 주입 시나리오 A~J 를 전부 여기서 돌린다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decideUpdateActivation, deterministicStaggerMs, alreadyActivated, markActivated,
  activationMarkerKey, MAX_DEFER_MS, STAGGER_WINDOW_MS,
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
    expect(src).toContain('autoplayEverBlocked');
    expect(src).toContain('audioEverActive');
    expect(src).toContain('return audioEverActive && !autoplayEverBlocked;');
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

  it('blocker 로그가 유계다 (같은 사유를 매 tick 남기지 않는다)', () => {
    expect(src).toContain('lastBlockerLogged');
  });

  it('일반 사용자는 기존대로 즉시 적용된다 (매장 전용 경로다)', () => {
    expect(src).toContain('if (!businessMode) { applyReload(reason); return; }');
  });
});
