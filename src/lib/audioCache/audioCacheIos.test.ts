// @vitest-environment jsdom
//
// iPhone/iPad(WebKit)에서는 오프라인 캐시를 쓰지 않는다 (2026-11-26 이루밍 브랜드 플레이어).
// IndexedDB 블롭의 blob: URL 로 재생하면 SRC_NOT_SUPPORTED / META_TIMEOUT 으로 곡마다 실패했다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const store = new Map<string, { size: number }>();
const fetchMock = vi.fn();
vi.mock('./audioCacheStore', () => ({
  cacheStoreReady: async () => true,
  putAudio: async (rec: { url: string; blob: { size: number } }) => { store.set(rec.url, rec.blob); },
  getAudioBlob: async (url: string) => store.get(url) ?? null,
  touchAudio: async () => {},
  deleteAudio: async (urls: readonly string[]) => { for (const u of urls) store.delete(u); },
  listEntries: async () => [...store.entries()].map(([url, b]) => ({ url, bytes: b.size, lastUsedAt: 0, cachedAt: 0 })),
  cachedUrlSet: async () => new Set(store.keys()),
  clearAll: async () => { store.clear(); },
  storageQuota: async () => null,
}));

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
const IOS_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/158.0 Mobile/15E148 Safari/604.1';
const IPADOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; SM-X230) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0 Safari/537.36';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0 Safari/537.36';

function setUa(ua: string, touch = 0) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touch, configurable: true });
}

const mod = await import('./index');

beforeEach(() => {
  store.clear();
  fetchMock.mockReset().mockResolvedValue({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg' }),
    blob: async () => new Blob([new Uint8Array(1000)], { type: 'audio/mpeg' }),
  });
  vi.stubGlobal('fetch', fetchMock);
  let n = 0;
  Object.assign(URL, { createObjectURL: () => `blob:test/${++n}`, revokeObjectURL: () => {} });
  mod.__resetAudioCacheMemoryForTest();
});
afterEach(() => { vi.unstubAllGlobals(); setUa(MAC); });

describe('audioCacheSupportedOn', () => {
  it('iPhone·iOS Chrome·iPadOS(데스크톱 UA + 터치) 는 끈다, Android·PC 는 켠다', () => {
    expect(mod.audioCacheSupportedOn({ userAgent: IPHONE })).toBe(false);
    expect(mod.audioCacheSupportedOn({ userAgent: IOS_CHROME })).toBe(false);
    expect(mod.audioCacheSupportedOn({ userAgent: IPADOS, maxTouchPoints: 5 })).toBe(false);
    expect(mod.audioCacheSupportedOn({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(true);
    expect(mod.audioCacheSupportedOn({ userAgent: MAC, maxTouchPoints: 0 })).toBe(true);
  });
});

describe('iPhone 에서는', () => {
  it('선반입을 하지 않고 늘 원본 주소로 재생한다', async () => {
    setUa(IPHONE, 5);
    const urls = ['https://x.supabase.co/a.mp3', 'https://x.supabase.co/b.mp3'];
    expect(await mod.prefetchQueue({ urls, index: 0, ahead: 2 })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mod.playbackSrcFor(urls[0])).toBe(urls[0]);
    expect(await mod.prepareCachedFallback({ urls, index: 0 })).toBeNull();
    expect((await mod.audioCacheStats()).available).toBe(false);
  });

  it('예전에 받아둔 곡이 있으면 한 번 비운다', async () => {
    store.set('https://x.supabase.co/old.mp3', { size: 5_000_000 });
    setUa(IPHONE, 5);
    await mod.purgeAudioCacheIfUnsupported();
    expect(store.size).toBe(0);
  });
});

describe('Android 에서는 그대로', () => {
  it('선반입하고 캐시본(blob:)으로 재생한다', async () => {
    setUa(ANDROID, 5);
    const urls = ['https://x.supabase.co/a.mp3'];
    expect(await mod.prefetchQueue({ urls, index: 0, ahead: 1 })).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mod.playbackSrcFor(urls[0])).toMatch(/^blob:/);
  });
});
