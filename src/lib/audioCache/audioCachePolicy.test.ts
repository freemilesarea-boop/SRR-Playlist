// 오프라인 오디오 캐시 — 판단 로직 단위 테스트.
// 매장 무인 재생 중에 도는 코드라 "무엇을 받고 무엇을 버리는지"를 못 박아둔다.
import { describe, it, expect } from 'vitest';
import {
  audioSourceMatch,
  effectiveCacheLimit,
  formatCacheSize,
  isCacheableAudioUrl,
  isCacheableSize,
  needsRoomFor,
  pickEvictions,
  pickPrefetchTargets,
  DEFAULT_CACHE_LIMIT_BYTES,
  MAX_TRACK_BYTES,
  type AudioCacheEntry,
} from './audioCachePolicy';

const MB = 1024 * 1024;

describe('isCacheableAudioUrl', () => {
  it('원격 http(s) 음원만 캐시 대상', () => {
    expect(isCacheableAudioUrl('https://x.supabase.co/audio/a.mp3')).toBe(true);
    expect(isCacheableAudioUrl('http://x/a.mp3')).toBe(true);
  });
  it('이미 로컬이거나 음원이 아닌 것은 제외', () => {
    expect(isCacheableAudioUrl('blob:https://x/abc')).toBe(false);
    expect(isCacheableAudioUrl('data:audio/mp3;base64,AAA')).toBe(false);
    expect(isCacheableAudioUrl('/local/a.mp3')).toBe(false);
    expect(isCacheableAudioUrl('')).toBe(false);
    expect(isCacheableAudioUrl(null)).toBe(false);
    expect(isCacheableAudioUrl(undefined)).toBe(false);
  });
});

describe('isCacheableSize', () => {
  it('0/음수/비정상 크기는 거른다', () => {
    expect(isCacheableSize(0)).toBe(false);
    expect(isCacheableSize(-1)).toBe(false);
    expect(isCacheableSize(Number.NaN)).toBe(false);
  });
  it('상한을 넘는 파일은 캐시하지 않는다 (캐시 전체를 먹는 것 방지)', () => {
    expect(isCacheableSize(MAX_TRACK_BYTES)).toBe(true);
    expect(isCacheableSize(MAX_TRACK_BYTES + 1)).toBe(false);
  });
  it('보통 크기의 mp3 는 통과', () => {
    expect(isCacheableSize(5 * MB)).toBe(true);
  });
});

describe('effectiveCacheLimit', () => {
  it('quota 를 모르면 기본 상한', () => {
    expect(effectiveCacheLimit(null)).toBe(DEFAULT_CACHE_LIMIT_BYTES);
    expect(effectiveCacheLimit(undefined)).toBe(DEFAULT_CACHE_LIMIT_BYTES);
    expect(effectiveCacheLimit(0)).toBe(DEFAULT_CACHE_LIMIT_BYTES);
  });
  it('quota 의 절반을 넘지 않는다 (다른 앱 데이터를 밀어내지 않도록)', () => {
    expect(effectiveCacheLimit(400 * MB)).toBe(200 * MB);
  });
  it('quota 가 넉넉하면 기본 상한에서 멈춘다', () => {
    expect(effectiveCacheLimit(100 * 1024 * MB)).toBe(DEFAULT_CACHE_LIMIT_BYTES);
  });
});

describe('pickPrefetchTargets', () => {
  const urls = ['https://a/1.mp3', 'https://a/2.mp3', 'https://a/3.mp3', 'https://a/4.mp3'];

  it('현재 곡부터 순서대로 ahead 개', () => {
    expect(pickPrefetchTargets({ urls, index: 0, cached: new Set(), ahead: 2 }))
      .toEqual(['https://a/1.mp3', 'https://a/2.mp3']);
  });

  it('이미 캐시된 곡은 건너뛴다', () => {
    const cached = new Set(['https://a/1.mp3', 'https://a/2.mp3']);
    expect(pickPrefetchTargets({ urls, index: 0, cached, ahead: 2 }))
      .toEqual(['https://a/3.mp3', 'https://a/4.mp3']);
  });

  it('큐 끝에서 앞으로 되감는다 — 매장은 같은 로테이션을 반복한다', () => {
    expect(pickPrefetchTargets({ urls, index: 3, cached: new Set(), ahead: 3 }))
      .toEqual(['https://a/4.mp3', 'https://a/1.mp3', 'https://a/2.mp3']);
  });

  it('wrap=false 면 큐 끝에서 멈춘다', () => {
    expect(pickPrefetchTargets({ urls, index: 3, cached: new Set(), ahead: 3, wrap: false }))
      .toEqual(['https://a/4.mp3']);
  });

  it('캐시 불가 URL(빈 음원 placeholder 등)은 제외', () => {
    const mixed = ['', null, 'https://a/2.mp3', undefined];
    expect(pickPrefetchTargets({ urls: mixed, index: 0, cached: new Set(), ahead: 5 }))
      .toEqual(['https://a/2.mp3']);
  });

  it('같은 곡이 큐에 두 번 있어도 한 번만', () => {
    const dup = ['https://a/1.mp3', 'https://a/1.mp3', 'https://a/2.mp3'];
    expect(pickPrefetchTargets({ urls: dup, index: 0, cached: new Set(), ahead: 5 }))
      .toEqual(['https://a/1.mp3', 'https://a/2.mp3']);
  });

  it('빈 큐 / ahead 0 이면 아무것도 안 받는다', () => {
    expect(pickPrefetchTargets({ urls: [], index: 0, cached: new Set() })).toEqual([]);
    expect(pickPrefetchTargets({ urls, index: 0, cached: new Set(), ahead: 0 })).toEqual([]);
  });
});

describe('pickEvictions', () => {
  const e = (url: string, bytes: number, lastUsedAt: number): AudioCacheEntry =>
    ({ url, bytes, lastUsedAt, cachedAt: 0 });

  it('상한 이내면 아무것도 버리지 않는다', () => {
    const entries = [e('a', 10, 1), e('b', 10, 2)];
    expect(pickEvictions(entries, 100)).toEqual([]);
  });

  it('오래 안 쓴 것부터 버린다 (LRU)', () => {
    const entries = [e('new', 50, 300), e('old', 50, 100), e('mid', 50, 200)];
    expect(pickEvictions(entries, 100)).toEqual(['old']);
  });

  it('상한 아래로 내려갈 때까지 계속 버린다', () => {
    const entries = [e('a', 50, 1), e('b', 50, 2), e('c', 50, 3)];
    expect(pickEvictions(entries, 50)).toEqual(['a', 'b']);
  });

  it('재생 중인 곡은 절대 버리지 않는다', () => {
    const entries = [e('playing', 50, 1), e('other', 50, 2)];
    // 'playing' 이 가장 오래됐지만 보호 대상 → 'other' 가 나간다
    expect(pickEvictions(entries, 50, new Set(['playing']))).toEqual(['other']);
  });

  it('보호 항목만으로 상한을 넘으면 버릴 것이 없다', () => {
    const entries = [e('p1', 100, 1), e('p2', 100, 2)];
    expect(pickEvictions(entries, 50, new Set(['p1', 'p2']))).toEqual([]);
  });
});

describe('needsRoomFor', () => {
  it('넣으면 상한을 넘는 경우에만 true', () => {
    expect(needsRoomFor(10, 80, 100)).toBe(false);
    expect(needsRoomFor(30, 80, 100)).toBe(true);
  });
});

describe('formatCacheSize', () => {
  it('MB / GB 표기', () => {
    expect(formatCacheSize(0)).toBe('0 MB');
    expect(formatCacheSize(5 * MB)).toBe('5 MB');
    expect(formatCacheSize(1536 * MB)).toBe('1.5 GB');
  });
  it('1MB 미만은 뭉뚱그린다', () => {
    expect(formatCacheSize(1024)).toBe('1 MB 미만');
  });
});

describe('audioSourceMatch', () => {
  const origin = 'https://app.example';
  const url = 'https://cdn.example/audio/track-1.mp3';

  it('같은 경로면 match (기존 동작 유지)', () => {
    expect(audioSourceMatch(url, url, { origin })).toBe('match');
  });

  it('다른 트랙이면 mismatch — preload 중인 다음 곡의 이벤트를 무시해야 한다', () => {
    expect(audioSourceMatch(url, 'https://cdn.example/audio/track-2.mp3', { origin })).toBe('mismatch');
  });

  it('호스트가 달라도 경로가 같으면 match (CDN 전환 대비 — 기존 비교와 동일)', () => {
    expect(audioSourceMatch(url, 'https://other.example/audio/track-1.mp3', { origin })).toBe('match');
  });

  it('캐시 적중(blob:)은 주인 트랙과 대조해 판정한다', () => {
    const blobOwner = (b: string) => (b === 'blob:https://app.example/abc' ? url : null);
    expect(audioSourceMatch(url, 'blob:https://app.example/abc', { origin, blobOwner })).toBe('match');
    expect(audioSourceMatch('https://cdn.example/audio/other.mp3', 'blob:https://app.example/abc', { origin, blobOwner }))
      .toBe('mismatch');
  });

  it('주인을 모르는 blob(회수된 URL 등)은 unknown → 호출부가 activeRef 로 폴백', () => {
    expect(audioSourceMatch(url, 'blob:https://app.example/zzz', { origin, blobOwner: () => null })).toBe('unknown');
    expect(audioSourceMatch(url, 'blob:https://app.example/zzz', { origin })).toBe('unknown');
  });

  it('값이 없으면 unknown', () => {
    expect(audioSourceMatch(null, url, { origin })).toBe('unknown');
    expect(audioSourceMatch(url, '', { origin })).toBe('unknown');
    expect(audioSourceMatch(undefined, undefined, { origin })).toBe('unknown');
  });

  it('파싱 불가 URL 은 unknown (기존 catch 폴백과 동일한 의미)', () => {
    expect(audioSourceMatch('::::', 'http://a/b', { origin: 'not a url' })).toBe('unknown');
  });
});
