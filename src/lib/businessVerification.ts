/**
 * businessVerification.ts
 *
 * 사업자등록번호 검증 어댑터.
 *   - 형식 검증 (체크섬 포함, 한국 표준 KS X 1003 알고리즘)
 *   - MVP: mock verification
 *   - 운영: 국세청 사업자등록정보 진위확인/상태조회 API
 *     ⚠️ API 키는 클라이언트에 절대 노출 X. Supabase Edge Function 또는
 *     Vercel serverless API 경유.
 *     env: NTS_BUSINESS_API_KEY
 */

export interface BusinessVerificationPayload {
  business_number: string;
  representative_name: string;
  business_open_date: string; // YYYY-MM-DD
  business_name?: string;
}

export interface BusinessVerificationResult {
  ok: boolean;
  business_verified: boolean;
  verification_status: 'pending' | 'verified' | 'rejected' | 'manual_review';
  business_state?: string;     // 국세청: 계속사업자 / 휴업자 / 폐업자 / 등록되지 않은 사업자 등
  tax_type?: string;            // 일반과세자 / 간이과세자 / 면세사업자
  verified_at?: string;
  message?: string;
}

/**
 * 사업자등록번호 형식 검증.
 * 한국 사업자번호 10자리. 마지막 자리가 체크섬.
 * 알고리즘 (KS X 1003):
 *   각 자리 가중치 [1,3,7,1,3,7,1,3,5]
 *   곱한 후 합 + (9번째 자리 * 5) / 10 의 몫
 *   합의 한자리 더한 후 10 에서 뺀 값 mod 10 == 10번째 자리
 */
export function validateBusinessNumberFormat(input: string): {
  ok: boolean;
  normalized: string;
  error?: string;
} {
  const digits = (input ?? '').replace(/\D/g, '');
  if (digits.length !== 10) {
    return { ok: false, normalized: digits, error: '사업자번호는 10자리 숫자여야 합니다' };
  }
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(digits[i]) * weights[i];
  }
  sum += Math.floor((Number(digits[8]) * 5) / 10);
  const check = (10 - (sum % 10)) % 10;
  if (check !== Number(digits[9])) {
    return { ok: false, normalized: digits, error: '사업자번호 체크섬이 맞지 않습니다' };
  }
  return { ok: true, normalized: digits };
}

/** 사업자번호 표시용 포맷팅 (XXX-XX-XXXXX) */
export function formatBusinessNumber(input: string): string {
  const d = (input ?? '').replace(/\D/g, '');
  if (d.length !== 10) return input;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** 사업자번호 마스킹 (관리자 회원관리 등에서 사용) */
export function maskBusinessNumber(input: string | null | undefined): string {
  if (!input) return '—';
  const d = input.replace(/\D/g, '');
  if (d.length !== 10) return input;
  return `${d.slice(0, 3)}-**-***${d.slice(8)}`;
}

/**
 * MVP mock 검증 — 형식만 통과하면 verified 처리.
 * 운영에서는 verifyBusinessNumber 를 Edge Function 으로 옮기고 그 결과 사용.
 */
async function mockVerifyBusinessNumber(
  payload: BusinessVerificationPayload,
): Promise<BusinessVerificationResult> {
  await new Promise((r) => setTimeout(r, 1000));
  const fmt = validateBusinessNumberFormat(payload.business_number);
  if (!fmt.ok) {
    return {
      ok: false,
      business_verified: false,
      verification_status: 'rejected',
      message: fmt.error,
    };
  }
  if (!payload.representative_name || !payload.business_open_date) {
    return {
      ok: false,
      business_verified: false,
      verification_status: 'manual_review',
      message: '대표자명과 개업일자가 필요합니다',
    };
  }
  return {
    ok: true,
    business_verified: true,
    verification_status: 'verified',
    business_state: '계속사업자',
    tax_type: '일반과세자',
    verified_at: new Date().toISOString(),
    message: '확인되었습니다 (MVP mock — 정식 검증은 국세청 API 연동 예정).',
  };
}

/**
 * 사업자번호 검증.
 * MVP: mock.
 * 운영: fetch('/api/business/verify', { POST, body }) — Vercel serverless 함수가
 * 국세청 API 호출 (env NTS_BUSINESS_API_KEY 사용).
 */
export async function verifyBusinessNumber(
  payload: BusinessVerificationPayload,
): Promise<BusinessVerificationResult> {
  // 운영 연동 자리 — 추후:
  //   const r = await fetch('/api/business/verify', { method: 'POST', body: JSON.stringify(payload) });
  //   return r.json();
  return mockVerifyBusinessNumber(payload);
}
