/** 결제 관련 공통 포맷 유틸. */

/** ₩ 포맷 (한국 원). */
export function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

/** 전화번호 숫자만 추출. */
export function normalizePhone(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}
