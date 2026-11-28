/**
 * nativeHaptics.ts — 누를 때 짧게 울린다.
 *
 * 앱 같다는 느낌의 절반은 촉감에서 온다. 웹은 눌러도 아무 반응이 없고, 그 차이를
 * 사람은 "반응이 없다" 가 아니라 "웹 같다" 로 인식한다.
 *
 * 컴포넌트마다 손대지 않고 document 에 한 번만 위임해서 붙인다. 조작부가 수십 개
 * 컴포넌트에 흩어져 있어 일일이 붙이는 건 유지가 안 된다.
 *
 * 울리지 않는 경우:
 *   - 웹/PWA (플러그인 자체가 없다)
 *   - data-no-haptic 이 붙은 것 (스크롤되는 목록 안의 항목 등, 호출부가 끌 수 있게)
 *   - 입력란 — 글자를 칠 때마다 울리면 고문이다
 *   - 연속 입력 — 아래 THROTTLE_MS 참고
 */
import { isNativeApp } from '@/lib/native';

/**
 * 이보다 촘촘한 연타는 한 번만 울린다.
 * 안 막으면 리스트를 빠르게 훑을 때 진동이 밀려서 기기가 웅웅거린다.
 */
export const THROTTLE_MS = 60;

/** 이 요소를 눌렀을 때 울려야 하는가. (DOM 없이 테스트할 수 있게 분리) */
export function shouldVibrateFor(el: {
  tagName?: string;
  closestNoHaptic?: boolean;
  isFormField?: boolean;
}): boolean {
  if (el.closestNoHaptic) return false;
  if (el.isFormField) return false;
  return true;
}

/** 마지막 진동 시각으로부터 충분히 지났는가. */
export function passesThrottle(now: number, last: number): boolean {
  return now - last >= THROTTLE_MS;
}

let installed = false;
let lastAt = -Infinity;

async function vibrate(): Promise<void> {
  try {
    const mod = await import('@capacitor/haptics');
    // Capacitor 플러그인 객체는 Proxy 라 thenable 로 오인된다 — 절대 await 로 꺼내지 말 것.
    // (푸시에서 "Haptics.then() is not implemented" 로 한 번 크게 당했다.)
    await mod.Haptics.impact({ style: mod.ImpactStyle.Light });
  } catch {
    /* 기기가 진동을 못 하거나 플러그인이 없으면 조용히 넘어간다 */
  }
}

/** 앱에서 조작부를 누를 때 짧게 울리도록 문서에 한 번 붙인다. 웹에서는 no-op. */
export function installTapHaptics(): void {
  if (!isNativeApp() || installed) return;
  if (typeof document === 'undefined') return;
  installed = true;

  // pointerdown 이다. click 은 손을 뗀 뒤에 오는데, 촉감은 누르는 순간에 와야 눌린 느낌이 난다.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const hit = target.closest('button, a[href], [role="button"], input[type="checkbox"], input[type="radio"]');
      if (!hit) return;

      const ok = shouldVibrateFor({
        closestNoHaptic: Boolean(target.closest('[data-no-haptic]')),
        isFormField:
          hit instanceof HTMLInputElement &&
          hit.type !== 'checkbox' &&
          hit.type !== 'radio',
      });
      if (!ok) return;

      const now = Date.now();
      if (!passesThrottle(now, lastAt)) return;
      lastAt = now;
      void vibrate();
    },
    { passive: true, capture: true },
  );
}
