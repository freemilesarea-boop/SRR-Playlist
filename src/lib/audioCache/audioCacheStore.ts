/**
 * audioCacheStore.ts — 오디오 캐시의 저장소(IndexedDB) 래퍼.
 *
 * IndexedDB 를 고른 이유:
 *   • 웹 · PWA · iOS WKWebView · Android WebView 에서 모두 동일하게 동작한다
 *     (네이티브 전용 플러그인 없이 하나의 구현으로 앱과 웹을 함께 커버).
 *   • 앱/오리진 샌드박스 안에 머문다 — 사용자가 파일로 꺼내갈 수 없다.
 *   • Cache API 와 달리 바이트 크기·최근 사용 시각을 같이 들고 있어 LRU 정리가 쉽다.
 *
 * 블롭은 재생 직전 object URL 로 바꿔 쓴다(Range 시킹은 object URL 에서 정상 동작).
 */
import type { AudioCacheEntry } from './audioCachePolicy';

const DB_NAME = 'deudda-audio-cache';
const DB_VERSION = 1;
const STORE = 'audio';
const IDX_LAST_USED = 'lastUsedAt';

interface AudioCacheRecord extends AudioCacheEntry {
  blob: Blob;
  contentType: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openDb(): Promise<IDBDatabase> {
  if (!indexedDbAvailable()) return Promise.reject(new Error('IndexedDB unavailable'));
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'url' });
        os.createIndex(IDX_LAST_USED, IDX_LAST_USED);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // 다른 탭이 상위 버전으로 열면 이 연결을 닫아 blocked 를 피한다.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  // 실패한 promise 를 캐시하지 않는다 — 다음 호출에서 다시 시도.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('tx aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
  });
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('request failed'));
  });
}

/** 저장소 사용 가능 여부(사파리 프라이빗 등에서 실패할 수 있음). */
export async function cacheStoreReady(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/** 블롭 저장. 같은 url 이면 덮어쓴다. */
export async function putAudio(rec: {
  url: string;
  blob: Blob;
  contentType: string;
  now?: number;
}): Promise<void> {
  const db = await openDb();
  const now = rec.now ?? Date.now();
  const record: AudioCacheRecord = {
    url: rec.url,
    blob: rec.blob,
    bytes: rec.blob.size,
    contentType: rec.contentType,
    cachedAt: now,
    lastUsedAt: now,
  };
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).put(record);
  await txDone(tx);
}

/** 블롭 조회. 없으면 null. */
export async function getAudioBlob(url: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const rec = await reqDone(tx.objectStore(STORE).get(url) as IDBRequest<AudioCacheRecord | undefined>);
    return rec?.blob ?? null;
  } catch {
    return null;
  }
}

/** LRU 갱신 — 재생에 쓰였음을 기록. 실패해도 재생에는 영향 없으므로 조용히 무시. */
export async function touchAudio(url: string, now = Date.now()): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    const rec = await reqDone(os.get(url) as IDBRequest<AudioCacheRecord | undefined>);
    if (rec) {
      rec.lastUsedAt = now;
      os.put(rec);
    }
    await txDone(tx);
  } catch {
    /* noop */
  }
}

export async function deleteAudio(urls: readonly string[]): Promise<void> {
  if (urls.length === 0) return;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const os = tx.objectStore(STORE);
  for (const u of urls) os.delete(u);
  await txDone(tx);
}

/** 블롭을 뺀 메타 목록 — 용량 계산/정리용(블롭을 메모리로 끌어오지 않는다). */
export async function listEntries(): Promise<AudioCacheEntry[]> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const os = tx.objectStore(STORE);
    const out: AudioCacheEntry[] = [];
    await new Promise<void>((resolve, reject) => {
      const req = os.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          resolve();
          return;
        }
        const v = cursor.value as AudioCacheRecord;
        out.push({ url: v.url, bytes: v.bytes, lastUsedAt: v.lastUsedAt, cachedAt: v.cachedAt });
        cursor.continue();
      };
      req.onerror = () => reject(req.error ?? new Error('cursor failed'));
    });
    return out;
  } catch {
    return [];
  }
}

/** 캐시된 URL 집합 — 선반입 대상 계산에 쓴다. */
export async function cachedUrlSet(): Promise<Set<string>> {
  const entries = await listEntries();
  return new Set(entries.map((e) => e.url));
}

export async function clearAll(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await txDone(tx);
  } catch {
    /* noop */
  }
}

/** 브라우저가 알려주는 저장 quota(바이트). 모르면 null. */
export async function storageQuota(): Promise<number | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { quota } = await navigator.storage.estimate();
    return typeof quota === 'number' ? quota : null;
  } catch {
    return null;
  }
}
