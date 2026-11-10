/**
 * outputSlot — 분리 송출(멀티 플레이어)에서 "이 창이 몇 번 플레이어인가".
 * Migration: supabase/migrations/0536_multi_output.sql
 *
 * 분리 송출은 플레이어마다 브라우저 창을 따로 띄우고, 창마다 출력 장치(setSinkId)를
 * 다르게 고르는 방식이다. 창은 각자 독립된 앱이지만 localStorage 는 같은 origin 이라
 * 공유된다 — 출력 장치·재생 목록·볼륨·브랜드 연결이 마지막에 쓴 창 값으로 덮인다.
 * 그래서 슬롯 창에서는 이런 키에 슬롯 번호를 붙인다(slotScopedKey).
 *
 * 슬롯 번호는 창 주소의 `?slot=N` 으로 들어오고, 그 창의 sessionStorage 에 고정된다.
 * sessionStorage 는 창 단위라 새로고침·화면 이동 후에도 같은 창은 같은 번호를 유지하고,
 * 다른 창과는 섞이지 않는다. 슬롯이 없는 창(평소 사용)은 키가 그대로라 기존 동작과 같다.
 */

export type OutputSlot = 1 | 2 | 3;

export const OUTPUT_SLOTS: readonly OutputSlot[] = [1, 2, 3];

const SESSION_KEY = 'srr.output.slot';

export function parseOutputSlot(raw: unknown): OutputSlot | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return n === 1 || n === 2 || n === 3 ? n : null;
}

let cached: OutputSlot | null | undefined;

/** 이 창의 슬롯 번호. 분리 송출 창이 아니면 null. */
export function getOutputSlot(): OutputSlot | null {
  if (cached !== undefined) return cached;
  let slot: OutputSlot | null;
  try {
    const fromUrl = parseOutputSlot(new URLSearchParams(window.location.search).get('slot'));
    if (fromUrl) {
      slot = fromUrl;
      try { sessionStorage.setItem(SESSION_KEY, String(fromUrl)); } catch { /* 무시 */ }
    } else {
      slot = parseOutputSlot(sessionStorage.getItem(SESSION_KEY));
    }
  } catch {
    slot = null;
  }
  cached = slot;
  return slot;
}

/** 슬롯 창이면 키에 슬롯 번호를 붙인다. 슬롯이 없으면 원래 키 그대로. */
export function slotScopedKey(base: string, slot: OutputSlot | null = getOutputSlot()): string {
  return slot ? `${base}::slot${slot}` : base;
}

/** 슬롯 창 주소 — 이미 쿼리가 있으면 이어 붙인다. */
export function withOutputSlot(path: string, slot: OutputSlot): string {
  return `${path}${path.includes('?') ? '&' : '?'}slot=${slot}`;
}

// ── 열린 슬롯 창 확인 ────────────────────────────────────────────────
// 같은 이름 창이 이미 있을 때 window.open 을 다시 부르면 그 창을 새 주소로 "다시 불러온다"
// — 재생 중인 다른 공간 음악이 끊긴다. 그래서 열기 전에 같은 번호 창이 살아 있는지
// BroadcastChannel 로 물어보고, 있으면 열지 않는다.
const PRESENCE_CHANNEL = 'deudda-output-slot-presence';
type PresenceMsg = { t: 'ping'; slot: OutputSlot; id: string } | { t: 'pong'; slot: OutputSlot; id: string };

/** 슬롯 창에서 한 번 부른다 — 다른 창의 "N번 열려 있나?" 질문에 답한다. 해제 함수 반환. */
export function listenOutputSlotPresence(slot: OutputSlot): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const ch = new BroadcastChannel(PRESENCE_CHANNEL);
  ch.onmessage = (e: MessageEvent<PresenceMsg>) => {
    const m = e.data;
    if (m?.t === 'ping' && m.slot === slot) ch.postMessage({ t: 'pong', slot, id: m.id } satisfies PresenceMsg);
  };
  return () => ch.close();
}

/** 같은 번호 슬롯 창이 열려 있는지(기다림 최대 timeoutMs). 확인 불가 브라우저는 false. */
export function isOutputSlotOpen(slot: OutputSlot, timeoutMs = 250): Promise<boolean> {
  if (typeof BroadcastChannel === 'undefined') return Promise.resolve(false);
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(PRESENCE_CHANNEL);
    const id = Math.random().toString(36).slice(2);
    const done = (v: boolean) => { window.clearTimeout(t); ch.close(); resolve(v); };
    const t = window.setTimeout(() => done(false), timeoutMs);
    ch.onmessage = (e: MessageEvent<PresenceMsg>) => {
      if (e.data?.t === 'pong' && e.data.slot === slot && e.data.id === id) done(true);
    };
    ch.postMessage({ t: 'ping', slot, id } satisfies PresenceMsg);
  });
}

export type OpenSlotResult = 'opened' | 'already-open' | 'blocked';

/**
 * 슬롯 창을 **별도 창**으로 연다. 같은 번호 창이 이미 있으면 그 창으로 이동한다(창 이름 고정).
 *
 * 창 크기(features)를 주지 않으면 크롬은 같은 창의 새 "탭" 으로 연다 — 탭은 한 번에
 * 하나만 보여서 공간별로 나란히 띄울 수 없고, 뒤로 간 탭은 숨김 상태가 되며, 플레이어
 * 탭이 설정 화면을 가려 다음 플레이어를 켤 수도 없었다. 그래서 크기를 지정해 팝업 창으로 연다.
 * 새 창은 이 창의 sessionStorage 를 복사해 가지만 슬롯 번호는 주소의 ?slot= 이 우선한다.
 */
export async function openOutputSlotWindow(path: string, slot: OutputSlot): Promise<OpenSlotResult> {
  // 이미 열린 창을 다시 불러와 음악을 끊지 않는다. (크롬은 클릭 후 수 초간 팝업을 허용하므로
  // 짧게 기다린 뒤 열어도 차단되지 않는다.)
  if (await isOutputSlotOpen(slot)) return 'already-open';
  const w = Math.min(1100, Math.max(720, Math.round(window.screen.availWidth * 0.6)));
  const h = Math.min(800, Math.max(560, Math.round(window.screen.availHeight * 0.75)));
  // 창이 겹쳐 쌓이지 않게 번호마다 조금씩 비켜 연다.
  const left = Math.round((window.screen.availWidth - w) / 2) + (slot - 2) * 40;
  const top = Math.round((window.screen.availHeight - h) / 2) + (slot - 2) * 40;
  const win = window.open(
    withOutputSlot(path, slot),
    `deudda-output-${slot}`,
    `popup=yes,width=${w},height=${h},left=${Math.max(0, left)},top=${Math.max(0, top)}`,
  );
  if (!win) return 'blocked';
  try { win.opener = null; } catch { /* 무시 */ }
  win.focus();
  return 'opened';
}

export function __resetOutputSlotForTest(): void {
  cached = undefined;
}
