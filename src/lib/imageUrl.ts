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
 * ⚠️ 이미지 변환은 Supabase 유료 플랜 기능이다. 플랜이 안 되면 이 URL 이
 * 실패하는데, 그때 커버가 사라지면 안 되므로 **호출 측이 원본으로 되돌아갈 수
 * 있도록** 원본 URL 을 같이 돌려준다(AutoCover 의 onError 가 그 일을 한다).
 */

/** 저장소 공개 객체 URL 인가 — 변환 대상인지 판별. */
const PUBLIC_OBJECT = '/storage/v1/object/public/';

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
export function thumbnailSource(url: string | null | undefined, width: number): ThumbSource | null {
  if (!url) return null;
  const i = url.indexOf(PUBLIC_OBJECT);
  // 저장소 URL 이 아니면 손대지 않는다(외부 이미지, data:, blob: 등).
  if (i < 0) return { src: url, fallback: url };

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
