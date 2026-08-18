/**
 * 수강신청 상품 — 프론트 순수 헬퍼 (단위 테스트 대상).
 */
export type CourseOrderStatus = 'requested' | 'waiting' | 'paid' | 'canceled' | 'failed';

export const COURSE_ORDER_STATUS_LABEL: Record<CourseOrderStatus, string> = {
  requested: '결제 대기',
  waiting: '입금 대기',
  paid: '결제 완료',
  canceled: '취소됨',
  failed: '결제 실패',
};

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';
export const COURSE_ORDER_STATUS_TONE: Record<CourseOrderStatus, StatusTone> = {
  requested: 'neutral',
  waiting: 'info',
  paid: 'success',
  canceled: 'neutral',
  failed: 'danger',
};

/** ₩ 포맷 (한국 원). */
export function formatKRW(n: number): string {
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

/** 전화번호 숫자만 추출. */
export function normalizePhone(s: string): string {
  return (s ?? '').replace(/\D/g, '');
}

export interface CourseProductForm {
  name: string;
  description: string;
  category: string;
  price: number | string;
  capacity: number | string; // '' = 무제한
  sortOrder: number | string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 관리자 상품 폼 검증. */
export function validateCourseProductForm(form: CourseProductForm): ValidationResult {
  const errors: string[] = [];
  if (!form.name || form.name.trim().length === 0) errors.push('상품명을 입력해주세요.');
  if (form.name && form.name.trim().length > 120) errors.push('상품명은 120자 이내여야 합니다.');
  const price = Number(form.price);
  if (!Number.isFinite(price) || price <= 0) errors.push('가격은 0보다 큰 숫자여야 합니다.');
  if (!Number.isInteger(price)) errors.push('가격은 정수(원)여야 합니다.');
  if (form.capacity !== '' && form.capacity != null) {
    const cap = Number(form.capacity);
    if (!Number.isInteger(cap) || cap <= 0) errors.push('정원은 비우거나 0보다 큰 정수여야 합니다.');
  }
  if (form.sortOrder !== '' && form.sortOrder != null && !Number.isInteger(Number(form.sortOrder))) {
    errors.push('정렬 순서는 정수여야 합니다.');
  }
  return { ok: errors.length === 0, errors };
}

/** 폼 → RPC 파라미터(숫자 정규화). */
export function courseFormToParams(form: CourseProductForm) {
  return {
    name: form.name.trim(),
    description: form.description ?? '',
    category: form.category?.trim() || null,
    price: Number(form.price),
    capacity: form.capacity === '' || form.capacity == null ? null : Number(form.capacity),
    sort_order: form.sortOrder === '' || form.sortOrder == null ? 0 : Number(form.sortOrder),
  };
}

/** 정원 대비 잔여 좌석 문구. remaining=null 이면 무제한. */
export function seatLabel(remaining: number | null, sold: number): string {
  if (remaining == null) return `${sold.toLocaleString('ko-KR')}명 신청`;
  if (remaining <= 0) return '마감';
  return `잔여 ${remaining.toLocaleString('ko-KR')}석`;
}
