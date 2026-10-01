import { describe, it, expect } from 'vitest';
import {
  resolveStoreGate,
  isStorePlaybackBlocked,
  resolveBusinessToggleAction,
  isStorePlayerSurface,
  resolveStoreAutoStart,
  shouldResumeStorePlayerOnLaunch,
  type StoreGateInput,
} from './storePlaybackGate';

function input(over: Partial<StoreGateInput> = {}): StoreGateInput {
  return { membership: 'free', businessMode: true, onStorePlayerSurface: true, ...over };
}

describe('resolveStoreGate', () => {
  it('유료/체험(premium)은 매장이든 개인이든 재생 가능', () => {
    expect(resolveStoreGate(input({ membership: 'premium' }))).toBe('allow');
    expect(resolveStoreGate(input({ membership: 'premium', businessMode: false }))).toBe('allow');
  });

  it('매장 플레이어 화면 + 매장 모드 + 무료 등급 → 미리듣기 없이 전체화면 차단', () => {
    expect(resolveStoreGate(input())).toBe('subscription_required');
  });

  it('일반 사용자 + 무료 등급 → 기존 25초 미리듣기 유지 (결제 유도 흐름 불변)', () => {
    expect(resolveStoreGate(input({ businessMode: false }))).toBe('preview');
  });

  it('매장 모드가 켜져 있어도 일반 페이지면 25초 미리듣기 (2026-10-01 회원 신고 회귀)', () => {
    // businessMode 는 localStorage 에 남는 끈적한 플래그다. 점주가 홈·차트·플레이리스트를
    // 둘러보는 동안에도 true 라서, 예전에는 거기서도 전체화면 차단 판정이 나왔다.
    // 그 페이지들에는 설명 화면이 없어 사용자는 이유도 모른 채 25초조차 듣지 못했다.
    expect(resolveStoreGate(input({ onStorePlayerSurface: false }))).toBe('preview');
  });

  it('비로그인은 로그인 요구', () => {
    expect(resolveStoreGate(input({ membership: 'anonymous' }))).toBe('login_required');
    expect(resolveStoreGate(input({ membership: 'anonymous', businessMode: false }))).toBe('login_required');
  });
});

describe('isStorePlaybackBlocked', () => {
  it('매장 무료 등급에서만 true', () => {
    expect(isStorePlaybackBlocked(input())).toBe(true);
    expect(isStorePlaybackBlocked(input({ businessMode: false }))).toBe(false);
    expect(isStorePlaybackBlocked(input({ membership: 'premium' }))).toBe(false);
    expect(isStorePlaybackBlocked(input({ membership: 'anonymous' }))).toBe(false);
  });

  it('데모 계정은 membership 이 premium 으로 해석되므로 걸리지 않는다 (시연용 무제한 — 의도됨)', () => {
    expect(isStorePlaybackBlocked(input({ membership: 'premium' }))).toBe(false);
  });
});

// 0511/0512 — reloadApp 사유 분류. 자동재생 차단이 배포 때문인지 탭 정리 때문인지
// 구분하려면 이 분류가 맞아야 한다(숙대점 조사에서 구분 불가였던 지점).
describe('classifyReloadReason', () => {
  it('서비스워커 갱신 → sw_update', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('sw build abc123 (updatefound)')).toBe('sw_update');
    expect(classifyReloadReason('sw-cache-reset')).toBe('sw_update');
  });
  it('청크 로드 실패 → chunk_error', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('chunk-load-failed (build x, attempt 1)')).toBe('chunk_error');
  });
  it('자가 복구 → self_heal', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('route-fallback-stuck')).toBe('self_heal');
  });
  it('분류 불가 → unknown', async () => {
    const { classifyReloadReason } = await import('./playbackGuard');
    expect(classifyReloadReason('something else')).toBe('unknown');
  });
});

describe('resolveBusinessToggleAction', () => {
  it('매장 모드가 켜져 있으면 재생이 멎어 있어도 끌 수 있다 (2026-10-01 데드락 회귀)', () => {
    // 무료 등급은 subscription_required 로 재생이 막혀 playing 이 영원히 false 다.
    // 예전 로직(isPlaying 기준)은 여기서 start 로 가 매장 모드를 다시 켰고,
    // 사용자는 재생도 못 하고 끄지도 못하는 상태에 갇혔다.
    expect(resolveBusinessToggleAction({ businessMode: true, hasSchedules: true })).toBe('stop');
    expect(resolveBusinessToggleAction({ businessMode: true, hasSchedules: false })).toBe('stop');
  });

  it('꺼져 있고 스케줄이 있으면 시작', () => {
    expect(resolveBusinessToggleAction({ businessMode: false, hasSchedules: true })).toBe('start');
  });

  it('꺼져 있고 스케줄이 없으면 스케줄 설정을 먼저 안내', () => {
    expect(resolveBusinessToggleAction({ businessMode: false, hasSchedules: false })).toBe('need_schedule');
  });
});

describe('isStorePlayerSurface', () => {
  it('매장/브랜드 플레이어 경로만 true', () => {
    expect(isStorePlayerSurface('/business/player')).toBe(true);
    expect(isStorePlayerSurface('/brand/player/682c08e1-55b7-4324-8572-39afabfe6519')).toBe(true);
  });

  it('일반 페이지는 false — 매장 설정 페이지(/business)도 플레이어 화면이 아니다', () => {
    expect(isStorePlayerSurface('/')).toBe(false);
    expect(isStorePlayerSurface('/charts')).toBe(false);
    expect(isStorePlayerSurface('/business')).toBe(false);
    expect(isStorePlayerSurface('/playlist/abc')).toBe(false);
  });
});

describe('resolveStoreAutoStart', () => {
  const base = {
    membership: 'premium' as const,
    schedulesLoading: false,
    hasSchedules: true,
    hasQueue: false,
    playing: false,
    alreadyTried: false,
  };

  it('큐가 없고 스케줄이 있으면 스케줄로 시작', () => {
    expect(resolveStoreAutoStart(base)).toBe('start_schedule');
  });

  it('복원된 큐가 있으면 그 큐를 이어서 재생', () => {
    expect(resolveStoreAutoStart({ ...base, hasQueue: true })).toBe('resume_queue');
  });

  it('이미 재생 중이면 건드리지 않는다', () => {
    expect(resolveStoreAutoStart({ ...base, playing: true })).toBe('none');
  });

  it('화면 진입당 1회만 — 사람이 멈춘 것을 다시 켜지 않는다', () => {
    expect(resolveStoreAutoStart({ ...base, alreadyTried: true })).toBe('none');
  });

  it('무료 등급은 자동 시작하지 않는다 (매장 화면에서 어차피 막힌다)', () => {
    expect(resolveStoreAutoStart({ ...base, membership: 'free' })).toBe('none');
    expect(resolveStoreAutoStart({ ...base, membership: 'anonymous' })).toBe('none');
  });

  it('스케줄 로딩 중에는 판단을 미룬다 — 없다고 단정하지 않는다', () => {
    expect(resolveStoreAutoStart({ ...base, schedulesLoading: true })).toBe('none');
  });

  it('스케줄이 하나도 없으면 시작할 것이 없다', () => {
    expect(resolveStoreAutoStart({ ...base, hasSchedules: false })).toBe('none');
  });
});

describe('shouldResumeStorePlayerOnLaunch', () => {
  const base = {
    pathname: '/',
    businessMode: true,
    membership: 'premium' as const,
    standalone: true,
    alreadyResumed: false,
  };

  it('설치형 앱을 매장 모드로 켜면 매장 플레이어로 복귀', () => {
    expect(shouldResumeStorePlayerOnLaunch(base)).toBe(true);
  });

  it('브라우저 탭으로 접속한 사람은 끌고 가지 않는다', () => {
    expect(shouldResumeStorePlayerOnLaunch({ ...base, standalone: false })).toBe(false);
  });

  it('start_url 이 아닌 진입은 존중한다', () => {
    expect(shouldResumeStorePlayerOnLaunch({ ...base, pathname: '/charts' })).toBe(false);
    expect(shouldResumeStorePlayerOnLaunch({ ...base, pathname: '/playlist/abc' })).toBe(false);
  });

  it('매장 모드가 아니면 복귀하지 않는다', () => {
    expect(shouldResumeStorePlayerOnLaunch({ ...base, businessMode: false })).toBe(false);
  });

  it('무료 등급은 보내지 않는다 — 전체화면 차단 화면만 보게 된다', () => {
    expect(shouldResumeStorePlayerOnLaunch({ ...base, membership: 'free' })).toBe(false);
  });

  it('앱 실행당 1회만 — 홈으로 나온 사람을 다시 끌고 가지 않는다', () => {
    expect(shouldResumeStorePlayerOnLaunch({ ...base, alreadyResumed: true })).toBe(false);
  });
});
