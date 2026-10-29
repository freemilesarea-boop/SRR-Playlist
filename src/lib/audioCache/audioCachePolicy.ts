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

/**
 * 기본 상한 4GB — 실제 상한은 effectiveCacheLimit 이 브라우저 quota 의 절반으로 다시 깎는다.
 *
 * 1GB 였을 때 화정점(2026-10) 브랜드 로테이션은 303곡 ≈ 1.5GB 라 다 담기지 않았다.
 * 캐시가 꽉 찬 채로 LRU 축출과 재다운로드를 반복했고, 그만큼 곡이 네트워크에 의존했다.
 * 브랜드 일일 플레이리스트는 전날 곡을 모두 유지한 채 새 곡만 더하므로(303 → 363곡)
 * 하루치를 다 담으면 다음 날 교체 때도 대부분 로컬에서 나온다.
 */
export const DEFAULT_CACHE_LIMIT_BYTES = 4 * 1_024 * 1_024 * 1_024;

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
 * 현재 곡부터 **실제로 재생될 순서**대로 큐 인덱스를 돌려준다(현재 곡 포함, 첫 원소).
 *
 * order 는 playerStore.shuffleOrder 다. 브랜드/매장 플레이어는 셔플로 돌기 때문에
 * 큐 배열의 다음 칸(index+1)은 다음에 나올 곡이 **아니다**. 화정점 2026-10-28 에는
 * 큐 152번 곡을 네트워크로 받는 동안 선반입이 큐 순서상 이웃 곡(안 나올 곡)을 받고 있었다.
 *
 * order 가 큐와 맞지 않으면(길이 불일치·현재 곡 없음) 큐 순서로 폴백한다 —
 * playerStore.next() 가 같은 조건에서 선형 진행으로 폴백하는 것과 같다.
 */
export function playOrderFrom(opts: {
  length: number;
  index: number;
  order?: readonly number[] | null;
  wrap?: boolean;
}): number[] {
  const { length: n, index, order, wrap = true } = opts;
  if (n <= 0) return [];
  const pos = order && order.length === n ? order.indexOf(index) : -1;
  const out: number[] = [];
  if (order && pos !== -1) {
    const span = wrap ? n : n - pos;
    for (let step = 0; step < span; step++) out.push(order[(pos + step) % n]);
    return out;
  }
  const span = wrap ? n : Math.max(0, n - index);
  for (let step = 0; step < span; step++) out.push(wrap ? (index + step) % n : index + step);
  return out;
}

/**
 * 다음에 미리 받아둘 URL 목록.
 *
 * 현재 곡부터 재생 순서(order — 셔플이면 shuffleOrder)대로 훑고, repeat='all' 이면 끝에서
 * 앞으로 되감는다(매장은 같은 로테이션을 하루 종일 도므로 되감기 구간이 곧 다음에 쓸 곡이다).
 * 이미 캐시된 것과 캐시 불가 URL 은 건너뛴다. 중복은 제거된다.
 */
export function pickPrefetchTargets(opts: {
  urls: (string | null | undefined)[];
  index: number;
  cached: ReadonlySet<string>;
  ahead?: number;
  wrap?: boolean;
  /** 재생 순서(셔플 순서). 없거나 큐와 안 맞으면 큐 순서. */
  order?: readonly number[] | null;
}): string[] {
  const { urls, index, cached, ahead = DEFAULT_PREFETCH_AHEAD, wrap = true, order } = opts;
  const n = urls.length;
  if (n === 0 || ahead <= 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  // 현재 곡 자신도 후보에 넣는다 — 재생 중 캐시가 비어 있으면 다음 루프를 위해 받아둔다.
  for (const i of playOrderFrom({ length: n, index, order, wrap })) {
    if (out.length >= ahead) break;
    const url = urls[i];
    if (!isCacheableAudioUrl(url)) continue;
    if (cached.has(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/**
 * 지금 곡이 네트워크에서 안 받아질 때 대신 틀 곡 — 재생 순서상 다음 곡들 중
 * **이미 로컬에 있는** 첫 곡의 큐 인덱스. 없으면 null(호출측이 평소대로 next()).
 *
 * 순서가 조금 바뀌어도 무음보다 낫다(매장 BGM). 건너뛴 곡은 다음 바퀴에 나온다.
 * 현재 곡과 같은 URL 은 고르지 않는다 — 같은 파일이면 같은 이유로 막혀 있다.
 */
export function pickCachedFallbackIndex(opts: {
  urls: (string | null | undefined)[];
  index: number;
  isCached: (url: string) => boolean;
  order?: readonly number[] | null;
}): number | null {
  const { urls, index, isCached, order } = opts;
  const currentUrl = urls[index];
  const seq = playOrderFrom({ length: urls.length, index, order, wrap: true });
  for (const i of seq.slice(1)) {
    const url = urls[i];
    if (!isCacheableAudioUrl(url) || url === currentUrl) continue;
    if (isCached(url)) return i;
  }
  return null;
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
