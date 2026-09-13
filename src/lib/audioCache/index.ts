/**
 * audioCache — 오프라인 오디오 캐시 공개 API.
 *
 * 목적: 매장 회선이 끊겨도 이미 받아둔 곡은 계속 재생된다.
 * 매장은 같은 로테이션을 하루 종일 돌기 때문에, 한 바퀴 돌고 나면 사실상 전곡이 로컬에 있다.
 *
 * 설계에서 가장 중요한 제약 — **재생 경로(hot path)는 동기여야 한다.**
 *   Player 의 src 세팅은 effect 안에서 동기로 일어난다. 여기서 await 를 걸면
 *   트랙 전환과 경합이 생겨 24시간 무인 재생의 안정성을 해친다.
 *   그래서 선반입(prefetch)이 미리 object URL 까지 만들어 동기 맵에 등록해두고,
 *   재생 시점에는 `playbackSrcFor()` 로 **동기 조회만** 한다.
 *   맵에 없으면 원본 네트워크 URL 을 그대로 쓴다(= 캐시 도입 전과 완전히 동일한 동작).
 */
import {
  DEFAULT_PREFETCH_AHEAD,
  effectiveCacheLimit,
  isCacheableSize,
  needsRoomFor,
  pickEvictions,
  pickPrefetchTargets,
  type AudioCacheEntry,
} from './audioCachePolicy';
import {
  cachedUrlSet,
  cacheStoreReady,
  clearAll,
  deleteAudio,
  getAudioBlob,
  listEntries,
  putAudio,
  storageQuota,
  touchAudio,
} from './audioCacheStore';

export * from './audioCachePolicy';

/** audio_url → object URL (재생에 바로 쓸 수 있게 만들어둔 것) */
const objectUrlByAudioUrl = new Map<string, string>();
/** object URL → audio_url (Player 가드가 blob src 의 주인을 찾을 때) */
const audioUrlByObjectUrl = new Map<string, string>();

/** 동시에 살려두는 object URL 수. 현재 곡 + 다음 곡 + 여유. */
const MAX_LIVE_OBJECT_URLS = 4;
/** 최근 사용 순서(뒤가 최신) — object URL 회수 대상 선정용. */
const liveOrder: string[] = [];

let inFlight = new Set<string>();
let cachedUrls: Set<string> | null = null;

/* ------------------------------------------------------------------ *
 * 재생 경로 (동기)
 * ------------------------------------------------------------------ */

/**
 * 이 트랙을 재생할 때 실제로 audio.src 에 넣을 값.
 * 캐시가 준비돼 있으면 object URL, 아니면 원본 URL 그대로.
 */
export function playbackSrcFor(audioUrl: string | null | undefined): string {
  if (!audioUrl) return '';
  const objUrl = objectUrlByAudioUrl.get(audioUrl);
  if (!objUrl) return audioUrl;
  markLive(objUrl);
  touchThrottled(audioUrl);
  return objUrl;
}

/** LRU 갱신용 IDB 쓰기 빈도 제한 — 24시간 재생 중 같은 곡으로 쓰기 폭주를 막는다. */
const TOUCH_INTERVAL_MS = 30_000;
const lastTouchAt = new Map<string, number>();

function touchThrottled(audioUrl: string) {
  const now = Date.now();
  const prev = lastTouchAt.get(audioUrl) ?? 0;
  if (now - prev < TOUCH_INTERVAL_MS) return;
  lastTouchAt.set(audioUrl, now);
  // 실패해도 재생에는 영향 없다.
  void touchAudio(audioUrl);
}

/** blob: URL 이 어느 트랙의 것인지 — Player 의 src 매칭 가드가 쓴다. */
export function blobOwner(blobUrl: string): string | null {
  return audioUrlByObjectUrl.get(blobUrl) ?? null;
}

/** 이 트랙이 지금 오프라인으로 재생 가능한지(= object URL 이 준비됨). */
export function isPlayableOffline(audioUrl: string | null | undefined): boolean {
  return !!audioUrl && objectUrlByAudioUrl.has(audioUrl);
}

function markLive(objUrl: string) {
  const i = liveOrder.indexOf(objUrl);
  if (i >= 0) liveOrder.splice(i, 1);
  liveOrder.push(objUrl);
}

/** object URL 수 상한 유지 — 넘치면 가장 오래된 것부터 revoke. */
function trimLiveObjectUrls(keep: ReadonlySet<string>) {
  while (liveOrder.length > MAX_LIVE_OBJECT_URLS) {
    const oldest = liveOrder.find((u) => !keep.has(u));
    if (!oldest) return; // 전부 보호 대상 — 그대로 둔다
    releaseObjectUrl(oldest);
  }
}

function releaseObjectUrl(objUrl: string) {
  const audioUrl = audioUrlByObjectUrl.get(objUrl);
  audioUrlByObjectUrl.delete(objUrl);
  if (audioUrl) objectUrlByAudioUrl.delete(audioUrl);
  const i = liveOrder.indexOf(objUrl);
  if (i >= 0) liveOrder.splice(i, 1);
  try {
    URL.revokeObjectURL(objUrl);
  } catch {
    /* noop */
  }
}

/* ------------------------------------------------------------------ *
 * 선반입 (비동기 — 재생 경로 밖)
 * ------------------------------------------------------------------ */

/** 저장된 블롭을 object URL 로 만들어 동기 맵에 등록. 이미 있으면 그대로. */
async function materialize(audioUrl: string): Promise<boolean> {
  if (objectUrlByAudioUrl.has(audioUrl)) return true;
  const blob = await getAudioBlob(audioUrl);
  if (!blob) return false;
  // 경합: await 사이에 다른 호출이 먼저 등록했을 수 있다.
  const existing = objectUrlByAudioUrl.get(audioUrl);
  if (existing) return true;
  const objUrl = URL.createObjectURL(blob);
  objectUrlByAudioUrl.set(audioUrl, objUrl);
  audioUrlByObjectUrl.set(objUrl, audioUrl);
  markLive(objUrl);
  return true;
}

/** 네트워크에서 받아 IndexedDB 에 저장. 이미 있으면 받지 않는다. */
async function download(audioUrl: string, signal?: AbortSignal): Promise<boolean> {
  if (inFlight.has(audioUrl)) return false;
  inFlight.add(audioUrl);
  try {
    // Range 헤더 없이 전체를 받는다 — 206 부분응답을 저장하면 재생이 깨진다.
    const res = await fetch(audioUrl, { signal, credentials: 'omit', mode: 'cors' });
    if (!res.ok || res.status === 206) return false;
    const blob = await res.blob();
    if (!isCacheableSize(blob.size)) return false;

    await makeRoomFor(blob.size);
    await putAudio({
      url: audioUrl,
      blob,
      contentType: res.headers.get('content-type') ?? blob.type ?? 'audio/mpeg',
    });
    cachedUrls?.add(audioUrl);
    return true;
  } catch {
    // 오프라인/CORS/용량 초과 — 캐시는 부가 기능이므로 조용히 실패하고 네트워크 재생을 유지한다.
    return false;
  } finally {
    inFlight.delete(audioUrl);
  }
}

/** 새 항목이 들어갈 자리 확보 — LRU 로 정리. */
async function makeRoomFor(bytes: number): Promise<void> {
  const entries = await listEntries();
  const total = entries.reduce((s, e) => s + e.bytes, 0);
  const limit = effectiveCacheLimit(await storageQuota());
  if (!needsRoomFor(bytes, total, limit)) return;
  // 지금 재생에 걸려 있는 곡은 지우지 않는다.
  const protectedUrls = new Set(objectUrlByAudioUrl.keys());
  const victims = pickEvictions(entries, Math.max(0, limit - bytes), protectedUrls);
  if (victims.length > 0) await deleteAudio(victims);
}

/**
 * 큐에서 앞으로 쓸 곡들을 받아두고, 재생 직전에 쓸 수 있게 object URL 까지 만들어둔다.
 *
 * @returns 이번 호출로 새로 확보된 곡 수
 */
export async function prefetchQueue(opts: {
  urls: (string | null | undefined)[];
  index: number;
  ahead?: number;
  signal?: AbortSignal;
}): Promise<number> {
  const { urls, index, ahead = DEFAULT_PREFETCH_AHEAD, signal } = opts;
  if (!(await cacheStoreReady())) return 0;

  if (!cachedUrls) cachedUrls = await cachedUrlSet();

  // 1) 아직 안 받은 것 내려받기
  const targets = pickPrefetchTargets({ urls, index, cached: cachedUrls, ahead });
  let gained = 0;
  for (const url of targets) {
    if (signal?.aborted) break;
    if (await download(url, signal)) gained++;
  }

  // 2) 곧 쓸 곡은 object URL 까지 준비 — 재생 시점에 동기 조회가 되도록.
  const soon = pickPrefetchTargets({
    urls,
    index,
    cached: new Set<string>(), // 캐시 여부와 무관하게 "다음에 쓸 순서"만 뽑는다
    ahead: MAX_LIVE_OBJECT_URLS,
  });
  for (const url of soon) {
    if (signal?.aborted) break;
    await materialize(url);
  }
  trimLiveObjectUrls(new Set(soon.map((u) => objectUrlByAudioUrl.get(u) ?? '')));

  return gained;
}

/* ------------------------------------------------------------------ *
 * 상태 / 관리
 * ------------------------------------------------------------------ */

export interface AudioCacheStats {
  /** 저장된 곡 수 */
  count: number;
  /** 총 바이트 */
  bytes: number;
  /** 적용 중인 상한 */
  limitBytes: number;
  /** 저장소 사용 가능 여부 */
  available: boolean;
}

export async function audioCacheStats(): Promise<AudioCacheStats> {
  const available = await cacheStoreReady();
  if (!available) return { count: 0, bytes: 0, limitBytes: 0, available: false };
  const entries: AudioCacheEntry[] = await listEntries();
  return {
    count: entries.length,
    bytes: entries.reduce((s, e) => s + e.bytes, 0),
    limitBytes: effectiveCacheLimit(await storageQuota()),
    available: true,
  };
}

/** 저장된 곡 전체 삭제 + 살아있는 object URL 회수. */
export async function clearAudioCache(): Promise<void> {
  for (const objUrl of [...audioUrlByObjectUrl.keys()]) releaseObjectUrl(objUrl);
  cachedUrls = null;
  inFlight = new Set();
  lastTouchAt.clear();
  await clearAll();
}

/**
 * 캐시본으로 재생하다 실패했을 때 그 곡의 캐시를 폐기한다.
 *
 * 무인 매장에서 손상된 캐시가 남으면 그 곡이 돌아올 때마다 계속 실패한다.
 * 폐기하면 다음 차례에는 네트워크로 다시 받으므로 스스로 복구된다.
 *
 * @returns 실제로 캐시를 버렸으면 true (= 이 실패가 캐시본 때문이었음)
 */
export async function dropCachedAudio(audioUrl: string | null | undefined): Promise<boolean> {
  if (!audioUrl) return false;
  const objUrl = objectUrlByAudioUrl.get(audioUrl);
  if (objUrl) releaseObjectUrl(objUrl);
  const had = cachedUrls?.has(audioUrl) ?? true;
  cachedUrls?.delete(audioUrl);
  lastTouchAt.delete(audioUrl);
  try {
    await deleteAudio([audioUrl]);
  } catch {
    /* noop */
  }
  return had || !!objUrl;
}

/** 테스트/진단용 — 현재 살아있는 object URL 수. */
export function liveObjectUrlCount(): number {
  return liveOrder.length;
}
