/**
 * identityVerification.ts
 *
 * 본인확인 어댑터.
 *   - 주민등록번호 원문/뒷자리 절대 수집하지 않음.
 *   - 외부 본인확인기관(NICE / KCB / 토스 / 카카오) 의 결과로 받은
 *     CI/DI 또는 verification_id 만 저장.
 *   - MVP: mock provider 만 동작. 운영 키 연결은 추후.
 *
 * 운영 연동 시 필요한 환경변수 (예시):
 *   NICE_PRODUCT_ID, NICE_CLIENT_ID, NICE_CLIENT_SECRET
 *   또는 TOSS_API_KEY, KAKAO_REST_API_KEY 등.
 *   ⚠️ 이 키들은 클라이언트에 절대 노출 X — Supabase Edge Function 또는
 *   Vercel serverless API 에서만 호출.
 */

export type IdentityProvider = 'mock' | 'nice' | 'kcb' | 'toss' | 'kakao';

export interface IdentityVerificationResult {
  ok: boolean;
  provider: IdentityProvider;
  /** 외부 인증기관이 발급한 연계정보 (CI). 민감 정보 — Supabase 본인 행에만 저장. */
  ci: string | null;
  /** 중복가입확인정보 (DI) — 동일 서비스 내에서만 유효. */
  di: string | null;
  verified_at: string;
  /** 외부 인증기관이 돌려준 표시용 이름 — 화면에만 사용, 별도 저장 X */
  display_name?: string;
}

/** mock 인증: 1초 지연 후 성공. 개발 환경에서만 노출 권장. */
export async function mockIdentityVerification(
  options: { name?: string } = {},
): Promise<IdentityVerificationResult> {
  await new Promise((r) => setTimeout(r, 1000));
  const now = new Date().toISOString();
  // mock 토큰 — 운영 결과 형식과 구별되도록 prefix
  const ci = `mock_ci_${crypto.randomUUID()}`;
  const di = `mock_di_${crypto.randomUUID()}`;
  return {
    ok: true,
    provider: 'mock',
    ci,
    di,
    verified_at: now,
    display_name: options.name,
  };
}

/**
 * 본인확인 시작. MVP 에서는 mock 만 호출.
 * 운영에서는 Edge Function 으로 POST → 인증창 redirect URL 반환.
 */
export async function startIdentityVerification(
  provider: IdentityProvider = 'mock',
): Promise<{ url?: string; mock?: boolean }> {
  if (provider === 'mock' || import.meta.env.DEV) {
    return { mock: true };
  }
  // 운영 연동 자리 — 현재는 안내 후 mock 진행
  // throw new Error('정식 본인인증은 NICE/KCB/토스/카카오 연동 예정입니다.');
  return { mock: true };
}

/**
 * 인증 완료 콜백. 외부 redirect 후 받은 토큰을 Edge Function 에 보내
 * CI/DI 를 받는 부분. MVP 에서는 mock 그대로 통과.
 */
export async function completeIdentityVerification(
  _token: string,
  provider: IdentityProvider = 'mock',
): Promise<IdentityVerificationResult> {
  if (provider === 'mock' || import.meta.env.DEV) {
    return mockIdentityVerification();
  }
  // 운영 연동 자리
  return mockIdentityVerification();
}

/**
 * 클라이언트 측 빠른 통합 헬퍼.
 * MVP: "본인인증 하기" 버튼이 호출. 1초 후 결과 반환.
 */
export async function verifyIdentityNow(
  options: { name?: string; provider?: IdentityProvider } = {},
): Promise<IdentityVerificationResult> {
  return mockIdentityVerification({ name: options.name });
}
