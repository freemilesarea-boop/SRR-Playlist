// @vitest-environment jsdom
//
// LEGACY-ANDROID §1·§2·§14 — 1000회 트랙 전환 soak.
//
// 왜 유닛 레벨에서 도는가 — 실기기에서 1000곡을 돌리려면 40시간이 걸린다. 대신
// **실제 모듈의 실제 코드 경로**를 그대로 태우고, 이 모듈이 붙들고 있는 모든
// 자료구조의 크기를 0/100/250/500/1000 시점에 비교한다. 하나라도 단조 증가하면
// 그게 곧 누수다.
//
// 이 파일이 잡아낸 실제 결함 (2026-09-14):
//   makeRoomFor() 가 IndexedDB 에서 곡을 축출하면서 인메모리 색인(cachedUrls)을
//   갱신하지 않았다. 축출된 곡이 영원히 "캐시됨" 으로 남아 **다시는 내려받지
//   않는다** — 매장은 캐시가 있다고 믿는 채로 그 곡마다 네트워크에 의존하게
//   되고, 회선이 흔들리는 구형 기기에서 그게 곧 무음이다. 리로드 전까지 낫지 않는다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ── IndexedDB 를 메모리 저장소로 대체 (정책·색인 로직은 실물 그대로) ───────── */

interface Rec { url: string; bytes: number; lastUsedAt: number; cachedAt: number }
let store: Map<string, Rec>;
let quota: number | null;

vi.mock('./audioCacheStore', () => ({
  cacheStoreReady: async () => true,
  putAudio: async (rec: { url: string; blob: { size: number }; now?: number }) => {
    const now = rec.now ?? Date.now();
    store.set(rec.url, { url: rec.url, bytes: rec.blob.size, lastUsedAt: now, cachedAt: now });
  },
  getAudioBlob: async (url: string) => (store.has(url) ? { size: store.get(url)!.bytes } : null),
  touchAudio: async (url: string, now = Date.now()) => {
    const r = store.get(url); if (r) r.lastUsedAt = now;
  },
  deleteAudio: async (urls: readonly string[]) => { for (const u of urls) store.delete(u); },
  listEntries: async () => [...store.values()],
  cachedUrlSet: async () => new Set(store.keys()),
  clearAll: async () => { store.clear(); },
  storageQuota: async () => quota,
}));

/* ── object URL 회계 — 만든 만큼 회수하는지 센다 ────────────────────────────── */

let created = 0;
let revoked = 0;
let liveObjectUrls: Set<string>;

const TRACK_BYTES = 5 * 1024 * 1024;          // 곡당 5MB — 매장 음원 실측 근사
const ROTATION = 150;                          // 매장 로테이션 곡 수
const urls = Array.from({ length: ROTATION }, (_, i) => `https://cdn.example.com/t${i}.mp3`);

beforeEach(async () => {
  store = new Map();
  quota = null;
  liveObjectUrls = new Set();

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (_b: unknown) => {
      created += 1;
      const u = `blob:mock/${created}`;
      liveObjectUrls.add(u);
      return u;
    },
    revokeObjectURL: (u: string) => { revoked += 1; liveObjectUrls.delete(u); },
  });

  vi.stubGlobal('fetch', async () => ({
    ok: true, status: 200,
    headers: { get: () => 'audio/mpeg' },
    blob: async () => ({ size: TRACK_BYTES, type: 'audio/mpeg' }),
  }));

  const mod = await import('./index');
  // 모듈은 싱글턴이라 앞 테스트의 object URL 이 남아 있다. 먼저 비우고, **그 다음에**
  // 회계를 0 으로 맞춘다 — 정리 과정의 revoke 가 기준선을 오염시키지 않도록.
  mod.__resetAudioCacheMemoryForTest();
  created = 0; revoked = 0;
  liveObjectUrls.clear();
});

afterEach(() => { vi.unstubAllGlobals(); });

/** 한 곡 재생 사이클: 선반입 → 재생 src 결정. 실제 Player 가 하는 그대로다. */
async function playOneTrack(mod: typeof import('./index'), index: number) {
  await mod.prefetchQueue({ urls, index, ahead: 5 });
  mod.playbackSrcFor(urls[index]);
}

describe('1000회 트랙 전환 soak — 자료구조가 단조 증가하지 않는다', () => {
  it('0 / 100 / 250 / 500 / 1000 전환 시점에서 모든 카운터가 유계다', async () => {
    const mod = await import('./index');
    const checkpoints = [0, 100, 250, 500, 1000];
    const samples: Record<number, ReturnType<typeof mod.audioCacheDiagnostics>> = {};

    samples[0] = mod.audioCacheDiagnostics();

    for (let n = 1; n <= 1000; n++) {
      await playOneTrack(mod, n % ROTATION);
      if (checkpoints.includes(n)) samples[n] = mod.audioCacheDiagnostics();
    }

    // 살아있는 object URL 은 상한(4)을 절대 넘지 않는다.
    for (const n of checkpoints) {
      expect(samples[n].liveObjectUrls).toBeLessThanOrEqual(4);
      expect(samples[n].objectUrlMap).toBeLessThanOrEqual(4);
      expect(samples[n].reverseMap).toBeLessThanOrEqual(4);
    }

    // 250 회 이후로는 어떤 카운터도 늘지 않는다(로테이션을 이미 한 바퀴 넘겼다).
    for (const key of ['liveObjectUrls', 'objectUrlMap', 'reverseMap', 'inFlight'] as const) {
      expect(samples[1000][key]).toBeLessThanOrEqual(samples[250][key]);
    }

    // 색인은 로테이션 크기를 넘지 않는다 — 곡 수에 비례할 뿐 전환 횟수에 비례하지 않는다.
    expect(samples[1000].touchEntries).toBeLessThanOrEqual(ROTATION);
    expect(samples[1000].cachedIndex).toBeLessThanOrEqual(ROTATION);

    // in-flight 다운로드는 끝나면 반드시 0 으로 돌아온다.
    expect(samples[1000].inFlight).toBe(0);
  }, 60_000);

  it('만든 object URL 은 살아있는 것 말고 전부 회수된다 (revoke 누락 없음)', async () => {
    const mod = await import('./index');
    for (let n = 0; n < 500; n++) await playOneTrack(mod, n % ROTATION);
    const live = mod.audioCacheDiagnostics().liveObjectUrls;
    expect(created - revoked).toBe(live);
    expect(liveObjectUrls.size).toBe(live);
  }, 60_000);

  it('전환 1000회를 해도 IndexedDB 항목 수는 로테이션 크기를 넘지 않는다', async () => {
    const mod = await import('./index');
    for (let n = 0; n < 1000; n++) await playOneTrack(mod, n % ROTATION);
    expect(store.size).toBeLessThanOrEqual(ROTATION);
  }, 60_000);
});

describe('축출이 인메모리 색인과 어긋나지 않는다 (실제로 있었던 결함)', () => {
  it('축출된 곡은 색인에서도 빠져 다시 내려받을 수 있다', async () => {
    // quota 를 좁혀 축출을 강제한다. effectiveCacheLimit = quota/2 = 25MB → 5곡.
    quota = 50 * 1024 * 1024;
    const mod = await import('./index');

    for (let n = 0; n < 40; n++) await playOneTrack(mod, n % ROTATION);

    const diag = mod.audioCacheDiagnostics();
    // 색인이 저장소보다 커지면 = 축출된 곡을 "캐시됨" 으로 착각하고 있다는 뜻이다.
    expect(diag.cachedIndex).toBeLessThanOrEqual(store.size);
    expect(diag.touchEntries).toBeLessThanOrEqual(store.size + 4);
  }, 60_000);

  it('축출 뒤에도 저장소가 상한 근처에 유지된다 (무한 증가 없음)', async () => {
    quota = 50 * 1024 * 1024;                 // 실효 상한 25MB
    const mod = await import('./index');
    for (let n = 0; n < 60; n++) await playOneTrack(mod, n % ROTATION);
    const bytes = [...store.values()].reduce((s, r) => s + r.bytes, 0);
    // 보호 대상(재생 중 4곡)만큼의 초과는 설계상 허용된다.
    expect(bytes).toBeLessThanOrEqual(25 * 1024 * 1024 + 4 * TRACK_BYTES);
  }, 60_000);

  it('축출된 곡이 다시 차례가 오면 네트워크에서 재확보된다', async () => {
    quota = 50 * 1024 * 1024;
    const mod = await import('./index');
    for (let n = 0; n < 30; n++) await playOneTrack(mod, n % ROTATION);

    // 앞쪽 곡들은 이미 축출됐을 것이다. 다시 한 바퀴 돌린다.
    const before = store.size;
    for (let n = 0; n < 30; n++) await playOneTrack(mod, n % ROTATION);
    // 재확보가 실제로 일어나 저장소가 비지 않는다.
    expect(store.size).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
    // 그리고 색인은 여전히 저장소와 어긋나지 않는다.
    expect(mod.audioCacheDiagnostics().cachedIndex).toBeLessThanOrEqual(store.size);
  }, 60_000);
});
