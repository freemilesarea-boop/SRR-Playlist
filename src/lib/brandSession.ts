// Phase BRAND-1 — 브랜드 플레이어 세션 저장.
// 보안 원칙:
//   • 브랜드 코드(평문) 는 절대 저장하지 않는다.
//   • 세션 토큰(bearer) 은 sessionStorage 에만 저장 (탭 닫으면 소멸 — 24h 키오스크는 탭 유지).
//   • 최근 접속 브랜드는 비민감 정보(id, name)만 localStorage 에 저장.

const TOKEN_PREFIX = 'srr.brand.token.'; // sessionStorage
const RECENT_KEY = 'srr.brand.recent';    // localStorage

export interface RecentBrand { id: string; name: string; ts: number; }

export function saveBrandToken(brandId: string, token: string): void {
  try { sessionStorage.setItem(TOKEN_PREFIX + brandId, token); } catch { /* ignore */ }
}

export function getBrandToken(brandId: string): string | null {
  try { return sessionStorage.getItem(TOKEN_PREFIX + brandId); } catch { return null; }
}

export function clearBrandToken(brandId: string): void {
  try { sessionStorage.removeItem(TOKEN_PREFIX + brandId); } catch { /* ignore */ }
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
