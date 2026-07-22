// Phase BRAND-1 → BRAND-DEVICE-BINDING-1 — 브랜드 플레이어 세션/기기 Binding 저장.
// 보안 원칙:
//   • 매장 코드(평문) 는 절대 저장하지 않는다.
//   • Device Token 은 "서버 재검증 전제의 불투명 Reference" — brand 별 localStorage 에 영속 저장
//     (BRAND-DEVICE-BINDING-1: 브라우저 재실행 후 자동 연결). 저장값만으로 승인하지 않으며 앱 시작 시
//     verify_brand_device_binding 서버 검증을 반드시 통과해야 한다.
//   • Access/Refresh Token 등 Supabase Auth 토큰은 별도 저장하지 않는다(Supabase 공식 저장소 사용).
//   • 최근 접속 브랜드는 비민감 정보(id, name)만 저장.
//   • 레거시 sessionStorage 토큰은 최초 접근 시 localStorage 로 1회 마이그레이션.

const BINDING_PREFIX = 'srr.brand.binding.';  // localStorage (영속 · 불투명 device token)
const LEGACY_TOKEN_PREFIX = 'srr.brand.token.'; // sessionStorage (레거시)
const RECENT_KEY = 'srr.brand.recent';         // localStorage

export interface RecentBrand { id: string; name: string; ts: number; }

/** Device Binding 토큰 저장(영속). */
export function saveBrandToken(brandId: string, token: string): void {
  try { localStorage.setItem(BINDING_PREFIX + brandId, token); } catch { /* ignore */ }
  // 레거시 sessionStorage 잔존값 정리
  try { sessionStorage.removeItem(LEGACY_TOKEN_PREFIX + brandId); } catch { /* ignore */ }
}

/** Device Binding 토큰 조회(레거시 sessionStorage → localStorage 1회 마이그레이션 포함). */
export function getBrandToken(brandId: string): string | null {
  try {
    const persisted = localStorage.getItem(BINDING_PREFIX + brandId);
    if (persisted) return persisted;
    // 레거시 마이그레이션
    const legacy = sessionStorage.getItem(LEGACY_TOKEN_PREFIX + brandId);
    if (legacy) {
      try { localStorage.setItem(BINDING_PREFIX + brandId, legacy); } catch { /* ignore */ }
      try { sessionStorage.removeItem(LEGACY_TOKEN_PREFIX + brandId); } catch { /* ignore */ }
      return legacy;
    }
    return null;
  } catch { return null; }
}

/** 단일 brand binding 제거(연결 해제/검증 실패/만료 시). */
export function clearBrandToken(brandId: string): void {
  try { localStorage.removeItem(BINDING_PREFIX + brandId); } catch { /* ignore */ }
  try { sessionStorage.removeItem(LEGACY_TOKEN_PREFIX + brandId); } catch { /* ignore */ }
}

/** 모든 brand binding 제거(브랜드 로그아웃 시). */
export function clearAllBrandBindings(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(BINDING_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch { /* ignore */ }
  try {
    const skeys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(LEGACY_TOKEN_PREFIX)) skeys.push(k);
    }
    skeys.forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

export function pushRecentBrand(brand: { id: string; name: string }): void {
  try {
    const list = getRecentBrands().filter((b) => b.id !== brand.id);
    list.unshift({ id: brand.id, name: brand.name, ts: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  } catch { /* ignore */ }
}

export function getRecentBrands(): RecentBrand[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((b) => b && typeof b.id === 'string' && typeof b.name === 'string');
  } catch { return []; }
}
