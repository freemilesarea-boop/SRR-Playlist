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

/** 슬롯 창을 연다. 같은 번호 창이 이미 있으면 그 창으로 이동한다(창 이름 고정). */
export function openOutputSlotWindow(path: string, slot: OutputSlot): void {
  // noopener — 새 창이 이 창의 sessionStorage 를 복사해 가지 않게 한다.
  window.open(withOutputSlot(path, slot), `deudda-output-${slot}`, 'noopener');
}

export function __resetOutputSlotForTest(): void {
  cached = undefined;
}
