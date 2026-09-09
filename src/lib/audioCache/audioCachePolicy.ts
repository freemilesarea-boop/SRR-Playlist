/**
 * audioCachePolicy.ts — 오프라인 오디오 캐시의 "판단" 부분 (순수 함수만).
 *
 * 저장(IndexedDB)·네트워크는 audioCacheStore.ts / audioCache.ts 가 맡고,
 * 여기서는 부수효과 없는 결정만 한다: 무엇을 받을지, 무엇을 버릴지, 얼마나 쓸지.
 * 매장 무인 재생 중에 도는 로직이라 테스트로 못 박아둔다.
 *
 * 배경: 웹 SW 는 오디오를 캐시하지 않는다(의도적 — Range 206 요청을 가로채면
 * 시킹이 깨진다). 그래서 SW 대신 "파일 전체를 IndexedDB 에 받아두고 재생 시
 * object URL 로 물리는" 방식을 쓴다. 이 방식은 웹·PWA·네이티브 쉘에서 동일하게 돈다.
 */

/** 캐시 1건의 메타(블롭 제외 — 목록/정리 계산용). */
export interface AudioCacheEntry {
  /** 원본 audio_url — 캐시 키 */
  url: string;
  bytes: number;
  /** 마지막으로 재생에 쓰인 시각(ms). LRU 기준. */
  lastUsedAt: number;
  cachedAt: number;
}

/** 기본 상한 1GB — 매장 로테이션 150곡(곡당 5MB 내외)을 담고도 여유가 있는 크기. */
export const DEFAULT_CACHE_LIMIT_BYTES = 1_024 * 1_024 * 1_024;

/** 한 곡이 이 크기를 넘으면 캐시하지 않는다(비정상 파일이 캐시를 통째로 먹는 것 방지). */
export const MAX_TRACK_BYTES = 60 * 1_024 * 1_024;

/** 기본 선반입 곡 수 — 현재 곡 이후 이만큼을 미리 받아둔다. */
export const DEFAULT_PREFETCH_AHEAD = 5;

/**
 * 기기 저장 여유를 감안한 실제 상한.
 * 브라우저 quota 의 절반을 넘지 않게 잡는다(다른 앱 데이터/DB 를 밀어내지 않도록).
 * quota 를 알 수 없으면(estimate 미지원) 기본 상한을 그대로 쓴다.
 */
export function effectiveCacheLimit(quotaBytes: number | null | undefined, base = DEFAULT_CACHE_LIMIT_BYTES): number {
  if (!quotaBytes || !Number.isFinite(quotaBytes) || quotaBytes <= 0) return base;
  return Math.max(0, Math.min(base, Math.floor(quotaBytes / 2)));
}

/**
 * 캐시 대상 URL 인지. Supabase Storage 등 http(s) 원격 파일만 받는다.
 * blob:/data: 는 이미 로컬이고, 빈 값/상대경로는 매장 음원이 아니다.
 */
export function isCacheableAudioUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  return /^https?:\/\//i.test(url);
}

/** 응답 크기가 캐시 가능한 범위인지. 0/음수/과대 파일은 거른다. */
export function isCacheableSize(bytes: number, maxBytes = MAX_TRACK_BYTES): boolean {
  return Number.isFinite(bytes) && bytes > 0 && bytes <= maxBytes;
}

/**
 * 다음에 미리 받아둘 URL 목록.
 *
 * 현재 인덱스 다음 곡부터 순서대로 훑고, repeat='all' 이면 큐 끝에서 앞으로 되감는다
 * (매장은 같은 로테이션을 하루 종일 도므로 되감기 구간이 곧 다음에 쓸 곡이다).
 * 이미 캐시된 것과 캐시 불가 URL 은 건너뛴다. 중복은 제거된다.
 */
export function pickPrefetchTargets(opts: {
  urls: (string | null | undefined)[];
  index: number;
  cached: ReadonlySet<string>;
  ahead?: number;
  wrap?: boolean;
}): string[] {
  const { urls, index, cached, ahead = DEFAULT_PREFETCH_AHEAD, wrap = true } = opts;
  const n = urls.length;
  if (n === 0 || ahead <= 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  // 현재 곡 자신도 후보에 넣는다 — 재생 중 캐시가 비어 있으면 다음 루프를 위해 받아둔다.
  const span = wrap ? n : Math.max(0, n - index);

  for (let step = 0; step < span && out.length < ahead; step++) {
    const i = wrap ? (index + step) % n : index + step;
    const url = urls[i];
    if (!isCacheableAudioUrl(url)) continue;
    if (cached.has(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * 상한을 넘긴 만큼 버릴 항목 (LRU — 가장 오래 안 쓴 것부터).
 * protectedUrls(현재/다음 곡)는 재생 중이므로 절대 버리지 않는다.
 * 보호 항목만으로 이미 상한을 넘으면 버릴 게 없다 → 빈 배열(캐시가 잠시 상한을 넘음).
 */
export function pickEvictions(
  entries: readonly AudioCacheEntry[],
  limitBytes: number,
  protectedUrls: ReadonlySet<string> = new Set(),
): string[] {
  const total = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= limitBytes) return [];

  const evictable = entries
    .filter((e) => !protectedUrls.has(e.url))
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

  const out: string[] = [];
  let running = total;
  for (const e of evictable) {
    if (running <= limitBytes) break;
    out.push(e.url);
    running -= e.bytes;
  }
  return out;
}

/** 새 항목(bytes)을 넣기 전에 비워야 하는지 — 넣으면 상한을 넘는 경우. */
export function needsRoomFor(bytes: number, currentTotal: number, limitBytes: number): boolean {
  return currentTotal + bytes > limitBytes;
}

/** "312 MB" 같은 표시용 문자열. */
export function formatCacheSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return '1 MB 미만';
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * audio element 의 currentSrc 가 이 트랙의 것인지 — 3-상태.
 *
 * 캐시가 적중하면 src 는 object URL(blob:)이라 원본 audio_url 과 경로 비교가 불가능하다.
 * Player 의 timeupdate/loadedmetadata/durationchange 가드가 전부 이 비교에 걸려 있고
 * (틀리면 진행률·duration·자동재생이 통째로 죽는다) 한 곳에서 판정한다.
 *
 *   'match'    — 이 audio 가 해당 트랙을 물고 있다
 *   'mismatch' — 다른 트랙(예: preload 중인 다음 곡) → 이벤트 무시
 *   'unknown'  — 판정 불가(값 없음/URL 파싱 실패) → 호출부가 activeRef 비교로 폴백
 */
export type AudioSourceMatch = 'match' | 'mismatch' | 'unknown';

export function audioSourceMatch(
  audioUrl: string | null | undefined,
  currentSrc: string | null | undefined,
  opts: { origin: string; blobOwner?: (blobUrl: string) => string | null },
): AudioSourceMatch {
  if (!audioUrl || !currentSrc) return 'unknown';
  if (currentSrc.startsWith('blob:')) {
    const owner = opts.blobOwner?.(currentSrc);
    // 캐시가 비워졌거나 revoke 된 blob → 주인을 모른다. 폴백에 맡긴다.
    if (owner == null) return 'unknown';
    return owner === audioUrl ? 'match' : 'mismatch';
  }
  try {
    const a = new URL(audioUrl, opts.origin).pathname;
    const b = new URL(currentSrc, opts.origin).pathname;
    return a === b ? 'match' : 'mismatch';
  } catch {
    return 'unknown';
  }
}
