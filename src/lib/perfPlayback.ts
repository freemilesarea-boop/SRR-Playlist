/**
 * perfPlayback.ts — "눌렀는데 왜 소리가 안 나는가" 의 구간별 소요시간.
 *
 * 체감 지연이 수십 초인데 어디서 쓰이는지 모르면 최적화는 추측이 된다.
 * 탭 한 번을 하나의 사건으로 묶어 각 전이 시각을 재고, 소리가 실제로
 * 나기 시작하면(첫 timeupdate) 한 줄로 내보낸다.
 *
 * 재생 경로는 건드리지 않는다. mark() 는 Map 에 숫자 하나를 넣는 게 전부다.
 *
 * 콘솔 출력은 **기본 OFF** 다. 지연 측정은 쫓을 때만 필요한데, 플레이리스트를
 * 누를 때마다 한 줄씩 찍으면 출시 빌드의 logcat 이 지저분해진다.
 * 다만 **기록은 항상 남긴다** — 앱 안의 진단 화면(더보기 → 사업자 정보 7회 탭)에서
 * 언제든 꺼내볼 수 있어야 재빌드 없이 현장 문제를 본다.
 *
 * 콘솔로도 보려면 (아무거나):
 *   • URL `?perfDiag=1`
 *   • localStorage `deudda.perfDiag` = `'1'`
 *   • 빌드 시 `VITE_PERF_DIAG=1`
 *   • `?audioDebug=1` 세션이면 자동으로 켜진다
 *
 * 실패 기록([PLAYBACK_DIAG])은 이 게이트와 무관하게 항상 콘솔로 나간다 —
 * 실패는 드물고, 그게 보여야 할 유일한 것이다.
 */
import { isAudioDebugEnabled } from './audioDebug';

export const PERF_LOG_STORAGE_KEY = 'deudda.perfDiag';
export const PERF_LOG_QUERY_KEY = 'perfDiag';

/** 순수 판정 — window 없이 테스트에서 그대로 부를 수 있게 분리. */
export function resolvePerfLogEnabled(input: {
  search?: string;
  storage?: Pick<Storage, 'getItem'> | null;
  buildFlag?: string | undefined;
  audioDebug?: boolean;
} = {}): boolean {
  const truthy = (v: string | null | undefined) => v === '1' || v === 'true';
  if (input.audioDebug) return true;
  if (truthy(input.buildFlag)) return true;
  try {
    if (truthy(new URLSearchParams(input.search ?? '').get(PERF_LOG_QUERY_KEY))) return true;
  } catch { /* 이상한 search 문자열 */ }
  try {
    if (truthy(input.storage?.getItem(PERF_LOG_STORAGE_KEY))) return true;
  } catch { /* 저장소가 막힌 WebView */ }
  return false;
}

function isPerfLogEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  let storage: Pick<Storage, 'getItem'> | null;
  try { storage = window.localStorage; } catch { storage = null; }
  return resolvePerfLogEnabled({
    search: window.location?.search ?? '',
    storage,
    buildFlag: import.meta.env?.VITE_PERF_DIAG as string | undefined,
    audioDebug: isAudioDebugEnabled(),
  });
}

export type PerfMark =
  | 'tap'            // T0  사용자가 플레이리스트를 눌렀다
  | 'setQueue'       // T1  큐 생성 완료
  | 'currentTrack'   // T2  첫 트랙 확정
  | 'srcResolve'     // T3  재생 주소 조회 시작
  | 'srcResolved'    // T4  조회 완료 (캐시본인지 네트워크인지 결정)
  | 'srcSet'         // T5  audio.src 대입
  | 'load'           // T6  load() 호출
  | 'loadedmetadata' // T7
  | 'canplay'        // T8
  | 'playCall'       // T9  play() 호출
  | 'playing'        // T10 playing 이벤트
  | 'firstProgress'; // T11 첫 timeupdate — 사용자가 실제로 소리를 듣는 시점

interface Session {
  id: number;
  label: string;
  marks: Map<PerfMark, number>;
  done: boolean;
}

let current: Session | null = null;
let nextId = 1;

/** 콘솔이 기기에서 안 보일 수 있으므로 앱 안에서도 꺼내볼 수 있게 쌓아둔다. */
const PERF_MAX = 100;
const perfLines: string[] = [];
function keepPerfLine(line: string): void {
  perfLines.push(line);
  if (perfLines.length > PERF_MAX) perfLines.shift();
}
export function readPerfLog(): readonly string[] {
  return perfLines;
}
export function clearPerfLog(): void {
  perfLines.length = 0;
}

const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

/** 새 사건 시작. 플레이리스트 탭 등 사용자 행동에서 부른다. */
export function perfStart(label: string): void {
  current = { id: nextId++, label, marks: new Map([['tap', now()]]), done: false };
}

export function perfMark(mark: PerfMark, extra?: Record<string, unknown>): void {
  const s = current;
  if (!s || s.done) return;
  // 같은 사건에서 한 전이는 한 번만 — 재시도가 첫 측정을 덮지 않도록.
  if (!s.marks.has(mark)) s.marks.set(mark, now());
  if (extra) meta(extra);
  // 소리가 나기 시작했으면 사건을 닫는다.
  if (mark === 'firstProgress') perfFlush();
}

const extras = new Map<string, unknown>();
export function meta(kv: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(kv)) extras.set(k, v);
}

/** 구간 계산 — 두 지점이 다 있어야 숫자가 나온다. */
function span(s: Session, a: PerfMark, b: PerfMark): string {
  const ta = s.marks.get(a);
  const tb = s.marks.get(b);
  if (ta === undefined || tb === undefined) return '—';
  return `${Math.round(tb - ta)}ms`;
}

export function formatPerf(s: Session): string {
  const seen = [...s.marks.keys()];
  const missing = (['setQueue', 'srcSet', 'canplay', 'playCall', 'playing', 'firstProgress'] as PerfMark[])
    .filter((m) => !s.marks.has(m));
  return [
    '[PERF_PLAYBACK]',
    `#${s.id}`,
    `what=${s.label}`,
    `tap→queue=${span(s, 'tap', 'setQueue')}`,
    `tap→src=${span(s, 'tap', 'srcSet')}`,
    `src해석=${span(s, 'srcResolve', 'srcResolved')}`,
    `src→canplay=${span(s, 'srcSet', 'canplay')}`,
    `tap→play호출=${span(s, 'tap', 'playCall')}`,
    `tap→실제재생=${span(s, 'tap', 'playing')}`,
    `tap→첫진행=${span(s, 'tap', 'firstProgress')}`,
    `메타=${span(s, 'load', 'loadedmetadata')}`,
    ...[...extras.entries()].map(([k, v]) => `${k}=${String(v)}`),
    missing.length ? `도달못함=${missing.join(',')}` : 'ok',
    `단계=${seen.join('>')}`,
  ].join(' · ');
}

/** 한 줄로 내보내고 사건을 닫는다. 미완성이어도(타임아웃 등) 찍을 수 있다. */
export function perfFlush(): void {
  const s = current;
  if (!s || s.done) return;
  s.done = true;
  try {
    const line = formatPerf(s);
    keepPerfLine(line);                       // 진단 화면에는 항상 쌓는다
    if (isPerfLogEnabled()) console.warn(line); // 콘솔은 켠 세션만
  } catch { /* 로그가 재생을 막지 않는다 */ }
  extras.clear();
}

/** 테스트/진단용 — 지금 사건의 스냅샷. */
export function readPerfSession(): { id: number; label: string; marks: [PerfMark, number][] } | null {
  if (!current) return null;
  return { id: current.id, label: current.label, marks: [...current.marks.entries()] };
}

export function resetPerf(): void {
  current = null;
  extras.clear();
}
