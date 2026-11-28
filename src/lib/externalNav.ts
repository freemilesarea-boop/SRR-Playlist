/**
 * externalNav.ts — 앱 밖(결제창 등)으로 나가는 이동을 한 곳에서 처리한다.
 *
 * 웹에서는 그냥 주소를 바꾸면 된다. 앱(Capacitor WebView)에서는 그러면 안 된다:
 *
 *   1) WebView 가 PayApp 사이트로 통째로 넘어가 버린다. 결제가 끝나면 PayApp 은
 *      웹 주소(/payment/success)로 되돌리는데, 그건 우리 앱이 아니라 웹사이트다 —
 *      사용자는 앱 안에 갇힌 채 웹 화면을 보게 되고, 앱으로 돌아올 방법이 없다.
 *   2) 국내 결제는 카드사 앱을 intent:// · 커스텀 스킴으로 띄운다. WebView 는
 *      이 스킴을 모르면 그냥 실패하고 흰 화면이 된다. 시스템 브라우저(커스텀탭)는
 *      OS 가 처리하므로 카드사 앱이 정상적으로 열린다.
 *
 * 그래서 앱에서는 시스템 브라우저로 띄우고, 사용자가 그 창을 닫고 돌아오면
 * onReturn 으로 알려준다(권한/플랜을 다시 읽어 화면을 갱신하라는 신호).
 *
 * 권한 부여는 여기서도, 프론트 어디서도 하지 않는다 — PayApp 웹훅에서만.
 * onReturn 은 "서버에 다시 물어봐라" 는 신호일 뿐이다.
 */
import { isNativeApp } from '@/lib/native';

export interface OpenExternalOptions {
  /** 앱에서 시스템 브라우저가 닫혀 앱으로 돌아왔을 때 (웹에서는 호출되지 않는다). */
  onReturn?: () => void;
}

/**
 * 결제창 등 외부 URL 열기.
 * 웹: 현재 탭 이동(기존 동작 그대로). 앱: 시스템 브라우저.
 */
export async function openExternalUrl(url: string, opts: OpenExternalOptions = {}): Promise<void> {
  if (!isNativeApp()) {
    window.location.href = url;
    return;
  }

  const { Browser } = await import('@capacitor/browser');
  let handle: { remove: () => Promise<void> } | null = null;
  if (opts.onReturn) {
    // 한 번만 듣고 뗀다 — 결제 한 건에 리스너 하나.
    handle = await Browser.addListener('browserFinished', () => {
      void handle?.remove();
      opts.onReturn?.();
    });
  }
  try {
    await Browser.open({ url });
  } catch (e) {
    // 브라우저를 못 열었으면 리스너가 영원히 남는다 — 떼고 에러를 그대로 올린다.
    await handle?.remove();
    throw e;
  }
}
