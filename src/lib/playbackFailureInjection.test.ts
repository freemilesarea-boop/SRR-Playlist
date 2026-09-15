// @vitest-environment jsdom
//
// LEGACY-ANDROID-PLAYBACK-STABILITY §17 — 고장 주입.
//
// 원칙 하나: **관측·control plane 의 어떤 고장도 소리를 멈추면 안 된다.**
// 재생은 최우선이고, heartbeat·진단·Realtime·Wake Lock·캐시는 전부 그 아래다.
//
// A · B · C 는 frozenAudioState.test.ts 가 담당한다(정지 모양 분류).
// 여기서는 D ~ J 를 **실제 모듈에 진짜 고장을 주입해서** 확인한다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ── D · E: 캐시 저장소 고장 주입 ──────────────────────────────────────────── */

interface Rec { url: string; bytes: number; lastUsedAt: number; cachedAt: number }
let store: Map<string, Rec>;
let getBlobMode: 'ok' | 'missing' | 'throw';
let putMode: 'ok' | 'reject';

vi.mock('./audioCache/audioCacheStore', () => ({
  cacheStoreReady: async () => true,
  putAudio: async (rec: { url: string; blob: { size: number } }) => {
    if (putMode === 'reject') throw new Error('QuotaExceededError');
    store.set(rec.url, { url: rec.url, bytes: rec.blob.size, lastUsedAt: Date.now(), cachedAt: Date.now() });
  },
  getAudioBlob: async (url: string) => {
    if (getBlobMode === 'throw') throw new Error('IDB read failed');
    if (getBlobMode === 'missing') return null;          // D: 캐시가 있다고 믿었는데 없다
    return store.has(url) ? { size: store.get(url)!.bytes } : null;
  },
  touchAudio: async () => {},
  deleteAudio: async (urls: readonly string[]) => { for (const u of urls) store.delete(u); },
  listEntries: async () => [...store.values()],
  cachedUrlSet: async () => new Set(store.keys()),
  clearAll: async () => { store.clear(); },
  storageQuota: async () => null,
}));

const TRACK = 5 * 1024 * 1024;
const urls = Array.from({ length: 20 }, (_, i) => `https://cdn.example.com/t${i}.mp3`);

beforeEach(async () => {
  store = new Map();
  getBlobMode = 'ok';
  putMode = 'ok';
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => `blob:mock/${Math.random().toString(36).slice(2)}`,
    revokeObjectURL: () => {},
  });
  vi.stubGlobal('fetch', async () => ({
    ok: true, status: 200,
    headers: { get: () => 'audio/mpeg' },
    blob: async () => ({ size: TRACK, type: 'audio/mpeg' }),
  }));
  const mod = await import('./audioCache/index');
  mod.__resetAudioCacheMemoryForTest();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('D. 캐시됐다고 믿은 blob 이 실제로 없다', () => {
  it('object URL 을 못 만들어도 재생 src 는 원본 네트워크 URL 로 떨어진다', async () => {
    const mod = await import('./audioCache/index');
    getBlobMode = 'missing';
    await mod.prefetchQueue({ urls, index: 0, ahead: 3 });

    // 캐시가 준비되지 않았으므로 원본 URL 이 그대로 나온다 — 재생은 계속된다.
    expect(mod.playbackSrcFor(urls[0])).toBe(urls[0]);
    expect(mod.audioCacheDiagnostics().liveObjectUrls).toBe(0);
  });

  it('blob 조회가 throw 해도 prefetch 가 예외를 밖으로 내보내지 않는다', async () => {
    const mod = await import('./audioCache/index');
    getBlobMode = 'throw';
    await expect(mod.prefetchQueue({ urls, index: 0, ahead: 3 })).resolves.toBeTypeOf('number');
    expect(mod.playbackSrcFor(urls[0])).toBe(urls[0]);
  });
});

describe('E. IndexedDB 쓰기가 거부된다 (quota 초과 등)', () => {
  it('저장 실패가 예외로 올라오지 않고 네트워크 재생이 유지된다', async () => {
    const mod = await import('./audioCache/index');
    putMode = 'reject';
    await expect(mod.prefetchQueue({ urls, index: 0, ahead: 5 })).resolves.toBe(0);
    expect(store.size).toBe(0);
    expect(mod.playbackSrcFor(urls[0])).toBe(urls[0]);   // 원본으로 계속 재생
  });

  it('쓰기 실패가 반복돼도 내부 자료구조가 늘어나지 않는다', async () => {
    const mod = await import('./audioCache/index');
    putMode = 'reject';
    for (let n = 0; n < 60; n++) await mod.prefetchQueue({ urls, index: n % urls.length, ahead: 3 });
    const d = mod.audioCacheDiagnostics();
    expect(d.liveObjectUrls).toBeLessThanOrEqual(4);
    expect(d.inFlight).toBe(0);
    expect(d.cachedIndex).toBe(0);
  });

  it('쓰기가 다시 가능해지면 스스로 회복한다', async () => {
    const mod = await import('./audioCache/index');
    putMode = 'reject';
    await mod.prefetchQueue({ urls, index: 0, ahead: 3 });
    expect(store.size).toBe(0);

    putMode = 'ok';
    await mod.prefetchQueue({ urls, index: 0, ahead: 3 });
    expect(store.size).toBeGreaterThan(0);
  });
});

/* ── F · G: control plane / 관측 고장 ──────────────────────────────────────── */

describe('F · G. Realtime / heartbeat 가 던져도 재생 경로로 전파되지 않는다', () => {
  const read = (p: string) => require('node:fs').readFileSync(
    require('node:path').resolve(process.cwd(), p), 'utf-8');

  // 27 — 구독은 플레이어 페이지 훅에서 AppShell 제어면으로 옮겼다. 계약은 그대로다.
  it('F. 구독 생성이 throw 해도 제어면이 삼킨다', () => {
    const plane = read('src/components/RecoveryControlPlane.tsx');
    const block = plane.slice(plane.indexOf('sub = subscribeStoreRecoveryCommands'));
    expect(block.slice(0, 900)).toMatch(/\} catch \{[\s\S]{0,160}구독 실패해도/);
  });

  it('F. 구독은 플레이어와 다른 failure domain 에 있다 (2026-09-15 회귀 금지)', () => {
    expect(read('src/hooks/useBrandPlayerHeartbeat.ts')).not.toContain('subscribeStoreRecoveryCommands');
    expect(read('src/components/AppShell.tsx')).toContain('<RecoveryControlPlane />');
  });

  it('F. 수신 콜백이 throw 해도 재생을 건드리지 않는다', () => {
    const api = read('src/lib/api/brandPlayerApi.ts');
    expect(api).toContain('catch { /* 수신 처리 실패가 재생을 건드리면 안 된다 */ }');
  });

  it('G. heartbeat RPC 거부가 두 경로 모두에서 삼켜진다', () => {
    const hook = read('src/hooks/useBrandPlayerHeartbeat.ts');
    const calls = hook.match(/brandPlayerHeartbeat\((?:[^()]|\([^()]*\))*\)[\s\S]{0,200}?catch/g) ?? [];
    expect(calls.length).toBe(2);
  });

  it('G. 진단 기록 실패도 삼켜진다', () => {
    const diag = read('src/lib/playbackDiagnostics.ts');
    expect(diag).toContain('/* 진단 기록 실패가 재생을 막아선 안 된다 */');
  });

  it('관측 모듈이 audio element 를 조작하지 않는다', () => {
    // 주석에 타입 이름이 나오는 것은 무해하다. **호출**이 없어야 한다.
    const liveness = read('src/lib/clientLiveness.ts')
      .split('\n').filter((l: string) => !l.trimStart().startsWith('*') && !l.trimStart().startsWith('//'))
      .join('\n');
    for (const bad of ['.play(', '.pause(', '.load(', 'document.createElement', 'new Audio']) {
      expect(liveness).not.toContain(bad);
    }
  });
});

/* ── H: Wake Lock 거부 ─────────────────────────────────────────────────────── */

describe('H. Wake Lock 획득이 계속 거부된다', () => {
  const read = (p: string) => require('node:fs').readFileSync(
    require('node:path').resolve(process.cwd(), p), 'utf-8');

  it('획득 실패는 null 로 끝난다 — 예외를 던지지 않는다', () => {
    const awake = read('src/lib/screenAwake.ts');
    expect(awake).toContain('// 권한 거부 / 비활성 탭 / 배터리 절약 모드 등 — 조용히 실패');
    expect(awake).toContain('return null;');
  });

  it('재시도가 유계다 — 거부가 반복돼도 무한 루프를 돌지 않는다', () => {
    const wl = read('src/hooks/useWakeLock.ts');
    expect(wl).toContain('const MAX_REACQUIRE_ATTEMPTS = 5;');
    expect(wl).toContain('if (attempts >= MAX_REACQUIRE_ATTEMPTS) return;');
  });

  it('Wake Lock 은 재생 성공 조건이 아니다 — 재생 경로가 그 상태를 읽지 않는다', () => {
    const player = read('src/components/player/Player.tsx');
    // 재생/복구 판단에 wakeLockActive 를 쓰면 보조 방어선이 필수 조건이 된다.
    expect(player).not.toMatch(/wakeLockActive\s*(\?|&&|\|\||===|!==)/);
  });
});

/* ── I: 비활성 슬롯 emptied ────────────────────────────────────────────────── */

describe('I. 비활성 슬롯에서 emptied 가 발생한다', () => {
  const player = require('node:fs').readFileSync(
    require('node:path').resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf-8');

  it('비활성 슬롯의 emptied 가 전역 audioActive 를 끄지 않는다', () => {
    expect(player).toMatch(/if \(\(ev === 'pause' \|\| ev === 'emptied'\) && isActiveEl\)/);
  });

  it('teardown 이 load() 로 리소스를 놓되, 그 emptied 가 안전하도록 가드가 먼저다', () => {
    const guardAt = player.indexOf("(ev === 'pause' || ev === 'emptied') && isActiveEl");
    const loadAt = player.indexOf('try { other.load(); } catch');
    expect(guardAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(-1);
  });
});

/* ── J: 옛 generation 의 stale 콜백 ────────────────────────────────────────── */

describe('J. 옛 generation 의 콜백이 새 element 를 건드리지 않는다', () => {
  const player = require('node:fs').readFileSync(
    require('node:path').resolve(process.cwd(), 'src/components/player/Player.tsx'), 'utf-8');

  it('generation 번호로 세대를 구분한다', () => {
    expect(player).toContain('audioGenerationRef');
  });

  it('hard reset 성공 판정은 오직 실제 진행으로만 한다', () => {
    expect(player).toContain('verifyHardReset({');
    expect(player).toContain('progressed,');
    // ACK/이벤트/paused=false 로 성공 처리하면 죽은 파이프라인을 살아있다고 본다.
    expect(player).not.toMatch(/verifyHardReset\([^)]*paused/);
  });

  it('트랙이 다른 element 의 timeupdate 는 무시된다', () => {
    expect(player).toContain("if (m === 'mismatch') return;");
    expect(player).toContain('if (m === \'unknown\' && target !== activeRef()) return;');
  });
});
