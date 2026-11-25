/**
 * imageUrl.ts — 화면에 보이는 크기에 맞는 이미지를 요청한다.
 *
 * 지금까지는 아티스트가 올린 커버 **원본**이 그대로 나갔다. 저장소 URL 은
 * `/storage/v1/object/public/...` 인데 이건 가공 없는 원본이고, 업로드 쪽에도
 * 리사이즈가 없다. 홈 한 화면에 그런 이미지가 수십 장 깔리면 WebView 는
 * 매번 전체 해상도를 디코딩한다 — 커버가 늦게 뜨고, 절반만 그려진 채로
 * 한참 있고, 스크롤이 끊기는 이유가 이것이다.
 *
 * Supabase 저장소는 같은 파일을 리사이즈해서 주는 엔드포인트가 따로 있다:
 *   /storage/v1/object/public/<bucket>/<path>
 *   /storage/v1/render/image/public/<bucket>/<path>?width=&height=&resize=cover
 *
 * ⚠️ 이미지 변환은 Supabase 유료 플랜 기능이다. 지원되지 않는 프로젝트에서
 * 변환 URL 을 먼저 요청하면 **커버 한 장마다 왕복이 두 번** 생긴다 —
 * 변환 실패를 기다렸다가 그제서야 원본을 받는다. 빈 사각형이 더 오래 보인다.
 *
 * 그래서 "실패하면 되돌린다" 가 아니라 **지원 여부를 먼저 한 번 알아보고,
 * 모르거나 안 되면 처음부터 원본을 쓴다.** 판정은 앱 실행당 한 번이고
 * localStorage 에 남아 다음 실행에서는 즉시 안다.
 */

/** 저장소 공개 객체 URL 인가 — 변환 대상인지 판별. */
const PUBLIC_OBJECT = '/storage/v1/object/public/';

/* ------------------------------------------------------------------ *
 * 변환 지원 여부 — 한 번만 알아본다
 * ------------------------------------------------------------------ */

const SUPPORT_KEY = 'deudda.imgTransform';
type Support = 'yes' | 'no' | 'unknown';

let support: Support = 'unknown';
try {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(SUPPORT_KEY) : null;
  if (saved === 'yes' || saved === 'no') support = saved;
} catch { /* 저장소가 막힌 WebView */ }

export function transformSupport(): Support {
  return support;
}

/** 테스트/재판정용. */
export function setTransformSupport(next: Support): void {
  support = next;
  try {
    if (next === 'unknown') localStorage.removeItem(SUPPORT_KEY);
    else localStorage.setItem(SUPPORT_KEY, next);
  } catch { /* 무시 */ }
}

/**
 * 변환 엔드포인트가 사는지 아주 작은 이미지 하나로 확인한다.
 *
 * 화면에 쓰지 않는 16px 요청이라 비용이 거의 없고, 결과가 나올 때까지는
 * 원본을 쓰므로 **이 판정이 어떤 커버의 표시도 지연시키지 않는다.**
 */
export function probeTransformSupport(sampleUrl: string | null | undefined): void {
  if (support !== 'unknown') return;
  if (!sampleUrl || typeof Image === 'undefined') return;
  const probe = thumbnailSource(sampleUrl, 16, /* force */ true);
  if (!probe || probe.src === probe.fallback) return;
  const img = new Image();
  img.onload = () => setTransformSupport('yes');
  img.onerror = () => setTransformSupport('no');
  img.src = probe.src;
}

export interface ThumbSource {
  /** 실제로 먼저 요청할 URL (가능하면 리사이즈본). */
  src: string;
  /** 리사이즈본이 실패했을 때 되돌아갈 원본. 같으면 되돌릴 곳이 없다는 뜻. */
  fallback: string;
}

/**
 * 표시 폭(px)에 맞춘 이미지 주소.
 *
 * @param url     원본 주소
 * @param width   화면에서 차지하는 폭. 기기 픽셀비는 호출 측이 이미 곱해서 준다.
 */
export function thumbnailSource(
  url: string | null | undefined,
  width: number,
  force = false,
): ThumbSource | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_OBJECT);
  // 저장소 URL 이 아니면 손대지 않는다(외부 이미지, data:, blob: 등).
  if (i < 0) return { src: url, fallback: url };
  // 지원이 확인되기 전에는 원본을 쓴다 — 실패를 기다리는 왕복을 만들지 않는다.
  if (!force && support !== 'yes') return { src: url, fallback: url };

  const w = Math.max(64, Math.round(width));
  const rendered =
    `${url.slice(0, i)}/storage/v1/render/image/public/${url.slice(i + PUBLIC_OBJECT.length)}` +
    `?width=${w}&height=${w}&resize=cover&quality=72`;
  return { src: rendered, fallback: url };
}

/**
 * AutoCover 의 size 별 표시 폭(px).
 *
 * 실제 레이아웃 폭보다 약간 크게 잡는다 — 카드 폭이 기기마다 다르고,
 * 모자라면 흐려 보이는 쪽이 과하게 받는 쪽보다 눈에 띈다.
 */
export const COVER_WIDTH: Record<string, number> = {
  sm: 128,   // 리스트 썸네일 · 미니플레이어
  md: 320,   // 홈 카드
  lg: 640,   // 상세 헤더
  xl: 1024,  // 전체화면 플레이어
};

/** 기기 픽셀비를 반영한 요청 폭. 과하게 커지지 않도록 2배에서 끊는다. */
export function scaledWidth(base: number, dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1): number {
  const r = Math.min(2, Math.max(1, Number.isFinite(dpr) ? dpr : 1));
  return Math.round(base * r);
}
