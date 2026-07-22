// Phase BRAND-PLAYER-UX-4 → UX-FIX-1 — 브랜드 플레이어 시각 콘텐츠 표시 우선순위 (단일 Selector).
//
// 우선순위(UX-FIX-1 에서 자켓을 로고보다 앞으로 조정):
//   1) 유효한 브랜드 사이니지 미디어(이미지/영상)가 하나라도 있으면 → BRAND_MEDIA
//   2) 미디어 없음 + 현재곡 자켓 존재(로드 실패 아님) → TRACK_ARTWORK
//   3) 미디어·자켓 없음(또는 자켓 로드 실패) + 브랜드/서비스 로고 존재 → BRAND_LOGO
//   4) 그 외 → DEFAULT_FALLBACK (안전한 기본 화면, 안내 문구 없음)
//
// 근거: 사용자 확인 증상 — 현재곡 자켓이 있어도 중앙에 로고가 고정 표시되던 문제.
//   자켓이 유효하면 현재곡 자켓을 중앙 메인 이미지로 우선 표시하고, 자켓이 없거나 로드
//   실패한 경우에만 로고로 폴백한다. 사이니지 미디어(BRAND_MEDIA)는 별도의 의도된
//   기능이므로 최상위 우선순위를 유지한다.
//
// 여러 컴포넌트에서 조건문을 중복하지 않도록 표시 모드 결정을 이 파일 하나로 통합한다.
import { mediaTypeForMime } from '@/lib/brandMediaType';

export type BrandPlayerDisplayMode =
  | 'BRAND_MEDIA'
  | 'BRAND_LOGO'
  | 'TRACK_ARTWORK'
  | 'DEFAULT_FALLBACK';

/** 미디어 유효성 판정에 필요한 최소 형태 (BrandMediaAsset / SignageItem 호환). */
export interface SignageValidatable {
  id: string;
  image_url: string;
  asset_type?: 'image' | 'video';
  mime_type?: string | null;
}

/**
 * 실제 재생 가능한 Asset 인지 판정. 배열 길이만으로 빈 상태를 결정하지 않기 위한 기준.
 * 무효로 간주: URL 비어있음 / 지원하지 않는 형식.
 * (삭제·비활성·표시기간 아님 Asset 은 서버 RPC 가 이미 제외하고 반환한다.
 *  로딩 반복 실패 Asset 은 런타임 broken 집합으로 별도 제외한다 — usableMediaCount 참조.)
 */
export function isValidSignageItem(it: SignageValidatable | null | undefined): boolean {
  if (!it) return false;
  const url = (it.image_url ?? '').trim();
  if (!url) return false;
  if (it.asset_type === 'image' || it.asset_type === 'video') return true;
  if (it.mime_type) return mediaTypeForMime(it.mime_type) !== null;
  // asset_type/mime 둘 다 없음 → 레거시 이미지로 간주(유효).
  return true;
}

/** 유효 미디어만 남긴다(순서 보존). */
export function filterValidSignageItems<T extends SignageValidatable>(items: T[] | null | undefined): T[] {
  if (!items || items.length === 0) return [];
  return items.filter(isValidSignageItem);
}

export interface DisplayModeInput {
  /** 유효 + 런타임 broken 제외 후 실제 표시 가능한 미디어 수. */
  usableMediaCount: number;
  logoUrl: string | null | undefined;
  artworkUrl: string | null | undefined;
  /** 현재곡 자켓 이미지 로드가 실패했는지. */
  artworkFailed: boolean;
}

/** 표시 모드 결정 — 우선순위 1→4 (자켓이 로고보다 우선). */
export function resolveBrandDisplayMode(input: DisplayModeInput): BrandPlayerDisplayMode {
  if (input.usableMediaCount > 0) return 'BRAND_MEDIA';
  if (hasNonEmpty(input.artworkUrl) && !input.artworkFailed) return 'TRACK_ARTWORK';
  if (hasNonEmpty(input.logoUrl)) return 'BRAND_LOGO';
  return 'DEFAULT_FALLBACK';
}

function hasNonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}
