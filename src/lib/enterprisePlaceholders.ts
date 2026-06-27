/**
 * enterprisePlaceholders — Phase 1-8
 *
 * Enterprise HQ form placeholder / 예시 상수.
 * 운영사 = (주)스튜디오 오감 기준.
 * 운영사 변경 시 이 파일만 수정.
 */

export const STUDIO_OGAM_LEGAL_NAME = '(주)스튜디오 오감';
export const STUDIO_OGAM_TAX_EMAIL = 'invoice@studioogam.com';
export const STUDIO_OGAM_ACCOUNTING_EMAIL = 'accounting@studioogam.com';

export const ENTERPRISE_PLACEHOLDERS = {
  // 사업자 정보
  companyName: `예: ${STUDIO_OGAM_LEGAL_NAME}`,
  businessNumber: '예: 123-45-67890',
  representativeName: '예: 이승현',
  businessAddress: '예: 서울특별시 성동구 ○○로 123',
  contactPhone: '예: 02-1234-5678',
  taxInvoiceEmail: STUDIO_OGAM_TAX_EMAIL,

  // 정산 담당자
  settlementContactName: '예: 이승현',
  settlementContactPhone: '예: 010-1234-5678',
  settlementContactEmail: STUDIO_OGAM_ACCOUNTING_EMAIL,

  // 정산 계좌
  bankName: '예: 신한은행',
  accountNumber: '예: 110-123-456789',
  accountHolder: `예: ${STUDIO_OGAM_LEGAL_NAME}`,

  // 메모
  notes: '관리자에게 전달할 내용을 입력하세요.',
} as const;

export const SETTLEMENT_STATUS_LABEL = {
  unregistered: '미등록',
  reviewing: '검토중',
  approved: '승인',
  rejected: '반려',
} as const;

export const SETTLEMENT_METHOD_LABEL = {
  monthly: '월 정산',
  weekly: '주 정산',
  manual: '수동 정산',
} as const;

export type SettlementStatus = keyof typeof SETTLEMENT_STATUS_LABEL;
export type SettlementMethod = keyof typeof SETTLEMENT_METHOD_LABEL;

// 파일 업로드 제한
export const ENTERPRISE_DOCUMENT_BUCKET = 'enterprise-documents';
export const ENTERPRISE_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024; // 20MB
export const ENTERPRISE_DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';
export const ENTERPRISE_DOCUMENT_SIGNED_URL_TTL = 600; // 10분
