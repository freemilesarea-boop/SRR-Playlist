// @vitest-environment jsdom
// 17 — liveness 스냅샷의 계약을 고정한다.
//
// 이 모듈이 지켜야 하는 것은 두 가지다:
//   1. 클라이언트가 보낸 자유 텍스트를 그대로 통과시키지 않는다.
//   2. "모른다" 를 "정상" 으로 바꾸지 않는다 — null 은 null 로 남는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  noteAudioProgress, lastAudioProgressAt,
  setRealtimeStatus, realtimeStatus, normalizeRealtimeStatus,
  normalizeVisibility, readVisibilityState, readOnline,
  readLivenessSnapshot, LIVENESS_PAYLOAD_KEYS, isAudiblyProgressing,
  __resetClientLivenessForTest,
} from './clientLiveness';

beforeEach(() => { __resetClientLivenessForTest(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('실제 오디오 진행 시각', () => {
  it('한 번도 진행한 적 없으면 null 이다 — 0 이나 now() 로 채우지 않는다', () => {
    expect(lastAudioProgressAt()).toBeNull();
  });

  it('기록한 시각을 그대로 돌려준다', () => {
    noteAudioProgress(1_700_000_000_000);
    expect(lastAudioProgressAt()).toBe(1_700_000_000_000);
  });

  it('나중 호출이 앞선 값을 덮는다 (마지막 진행이 곧 최신이다)', () => {
    noteAudioProgress(1000);
    noteAudioProgress(2000);
    expect(lastAudioProgressAt()).toBe(2000);
  });
});

describe('Realtime 상태 화이트리스트', () => {
  it('알려진 상태만 통과한다', () => {
    for (const s of ['SUBSCRIBED', 'TIMED_OUT', 'CLOSED', 'CHANNEL_ERROR']) {
      expect(normalizeRealtimeStatus(s)).toBe(s);
    }
  });

  it('소문자도 정규화한다 (supabase-js 표기 흔들림 대비)', () => {
    expect(normalizeRealtimeStatus('subscribed')).toBe('SUBSCRIBED');
  });

  it('모르는 문자열·비문자열은 버린다', () => {
    for (const bad of ['JOINED', '', '  ', null, undefined, 42, {}]) {
      expect(normalizeRealtimeStatus(bad)).toBeNull();
    }
  });

  it('버려진 값이 이미 기록된 상태를 지우지 않는다', () => {
    setRealtimeStatus('SUBSCRIBED');
    setRealtimeStatus('WHO_KNOWS');
    expect(realtimeStatus()).toBe('SUBSCRIBED');
  });
});

describe('visibilityState 화이트리스트', () => {
  it('스펙에 있는 값만 통과한다', () => {
    for (const s of ['visible', 'hidden', 'prerender', 'unloaded']) {
      expect(normalizeVisibility(s)).toBe(s);
    }
  });

  it('대문자/모르는 값은 버린다 — 케이스를 임의로 고치지 않는다', () => {
    expect(normalizeVisibility('VISIBLE')).toBeNull();
    expect(normalizeVisibility('frozen')).toBeNull();
  });

  it('document 를 읽어 정규화한다', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    expect(readVisibilityState()).toBe('hidden');
  });
});

describe('online', () => {
  it('navigator.onLine 을 그대로 읽는다', () => {
    const orig = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      expect(readOnline()).toBe(false);
    } finally {
      delete (navigator as unknown as Record<string, unknown>).onLine;
      if (orig) Object.defineProperty(Navigator.prototype, 'onLine', orig);
    }
  });
});

describe('heartbeat 스냅샷', () => {
  it('진행 시각을 ISO 로 바꿔 보낸다', () => {
    noteAudioProgress(Date.parse('2026-09-14T09:29:07.000Z'));
    const snap = readLivenessSnapshot({ playerInstanceId: 'pi-1', wakeLockActive: true });
    expect(snap.lastAudioProgressAt).toBe('2026-09-14T09:29:07.000Z');
  });

  it('진행한 적 없으면 null 을 보낸다 — 지금 시각으로 채우면 죽은 플레이어가 싱싱해 보인다', () => {
    const snap = readLivenessSnapshot({ playerInstanceId: null, wakeLockActive: null });
    expect(snap.lastAudioProgressAt).toBeNull();
    expect(snap.playerInstanceId).toBeNull();
    expect(snap.wakeLockActive).toBeNull();
  });

  it('페이로드 키가 늘어나면 이 테스트가 먼저 깨진다 (payload 폭증 방지)', () => {
    const snap = readLivenessSnapshot({ playerInstanceId: 'pi-1', wakeLockActive: false });
    expect(Object.keys(snap).sort()).toEqual([...LIVENESS_PAYLOAD_KEYS].sort());
    // 18 에서 기기 자원 5개가 늘어 11개다. 더 늘리려면 여기부터 고쳐야 한다 —
    // 그게 이 테스트의 목적이다(무심코 늘어나는 것을 막는다).
    expect(LIVENESS_PAYLOAD_KEYS).toHaveLength(11);
  });

  it('PII 가 될 만한 값을 담지 않는다', () => {
    const snap = readLivenessSnapshot({ playerInstanceId: 'pi-1', wakeLockActive: true });
    const blob = JSON.stringify(snap);
    for (const bad of ['@', 'userAgent', 'email', 'phone', 'http']) {
      expect(blob).not.toContain(bad);
    }
  });
});

// ── §13 네이티브 워치독이 먹어야 하는 신호 ──────────────────────────────────
//
// 지금 네이티브 쉘 브랜치는 `audioActive` 를 lastAudibleAt 으로 넘긴다. 그 값은
// Player.tsx:2438 에서 `playing` 이벤트 + `!el.paused` 로 세워진다 — currentTime
// 이 멈춘 플레이어도 계속 "들린다" 가 된다. 워치독이 존재하는 이유가 바로 그
// 상태인데, 거기서 눈이 먼다. 이 describe 는 대체 신호의 계약을 고정한다.
describe('isAudiblyProgressing — 네이티브 워치독 급전 신호', () => {
  it('한 번도 진행한 적 없으면 false — paused=false 라도 들린다고 하지 않는다', () => {
    expect(isAudiblyProgressing(1_000_000)).toBe(false);
  });

  it('방금 진행했으면 true', () => {
    noteAudioProgress(1_000_000);
    expect(isAudiblyProgressing(1_000_000)).toBe(true);
  });

  it('곡 전환/크로스페이드 수준의 공백(수 초)에는 반응하지 않는다', () => {
    noteAudioProgress(1_000_000);
    expect(isAudiblyProgressing(1_000_000 + 5_000)).toBe(true);
  });

  it('창 밖으로 나가면 false — currentTime 이 얼어붙은 상태를 잡는다', () => {
    noteAudioProgress(1_000_000);
    expect(isAudiblyProgressing(1_000_000 + 90_001)).toBe(false);
  });

  it('경계값은 포함한다 (90s 정확히는 아직 살아있다)', () => {
    noteAudioProgress(1_000_000);
    expect(isAudiblyProgressing(1_000_000 + 90_000)).toBe(true);
  });

  it('창 크기를 바꿔 부를 수 있다', () => {
    noteAudioProgress(1_000_000);
    expect(isAudiblyProgressing(1_000_000 + 20_000, 10_000)).toBe(false);
  });

  it('기기 시계가 역행해도 살아있다고 본다 — 시계 때문에 매장을 재시작하지 않는다', () => {
    noteAudioProgress(2_000_000);
    expect(isAudiblyProgressing(1_000_000)).toBe(true);
  });
});
