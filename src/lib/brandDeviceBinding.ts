// Phase BRAND-DEVICE-BINDING-1 — 브랜드 매장 기기 Binding 순수 로직.
//   · Access State 결정(단일 지점) — 페이지마다 조건문 중복 방지.
//   · Device Label 파생(coarse, 비-fingerprinting).
// 저장/서버검증은 각각 brandSession.ts / brandPlayerApi.ts 가 담당(부수효과 분리).

export type BrandPlayerAccessState =
  | 'AUTH_LOADING'         // 인증 세션 복원 중
  | 'SIGNED_OUT'           // 세션 없음 → 로그인
  | 'BINDING_CHECKING'     // 서버 binding 재검증 중
  | 'STORE_CODE_REQUIRED'  // binding 없음/무효 → 매장 코드 입력
  | 'AUTHORIZED'           // 자동 진입 허용
  | 'REVOKED'              // binding 폐기됨
  | 'EXPIRED'              // binding 만료됨
  | 'ERROR';               // 일시 오류(재시도, 무한로딩 금지)

/** 서버 verify_brand_device_binding 결과 요약(민감정보 없음). */
export interface BindingVerifyResult {
  ok: boolean;
  reason?: string; // not_authenticated | no_binding | invalid_binding | not_owner | revoked | expired | store_inactive
  brandName?: string | null;
  deviceLabel?: string | null;
  expiresAt?: string | null;
}

export interface AccessInputs {
  authReady: boolean;
  hasSession: boolean;
  /** 로컬에 저장된 binding 토큰 존재 여부. */
  hasStoredBinding: boolean;
  /** 서버 재검증을 시도했는지. */
  verifyAttempted: boolean;
  verify?: BindingVerifyResult | null;
  /** 재검증 중 네트워크/전송 오류 발생. */
  networkError?: boolean;
}

/**
 * 단일 Access State 결정. Loading flicker 방지를 위해 인증/검증 진행 중에는 절대
 * STORE_CODE_REQUIRED 로 떨어지지 않는다.
 */
export function resolveBrandAccessState(i: AccessInputs): BrandPlayerAccessState {
  if (!i.authReady) return 'AUTH_LOADING';
  if (!i.hasSession) return 'SIGNED_OUT';
  if (!i.hasStoredBinding) return 'STORE_CODE_REQUIRED';
  if (!i.verifyAttempted) return 'BINDING_CHECKING';
  if (i.networkError) return 'ERROR';
  const v = i.verify;
  if (!v) return 'BINDING_CHECKING';
  if (v.ok) return 'AUTHORIZED';
  switch (v.reason) {
    case 'revoked': return 'REVOKED';
    case 'expired': return 'EXPIRED';
    case 'not_authenticated': return 'SIGNED_OUT';
    // not_owner / invalid_binding / no_binding / store_inactive → 코드 재입력
    default: return 'STORE_CODE_REQUIRED';
  }
}

/** 저장된 binding 을 로컬에서 제거해야 하는 상태인지(무효 토큰 정리). */
export function shouldClearStoredBinding(state: BrandPlayerAccessState): boolean {
  return state === 'STORE_CODE_REQUIRED' || state === 'REVOKED' || state === 'EXPIRED';
}

/** 사용자 안내 메시지(내부 오류 상세 비노출). */
export function accessStateMessage(state: BrandPlayerAccessState): string {
  switch (state) {
    case 'AUTH_LOADING': return '로그인 정보를 확인하고 있습니다.';
    case 'BINDING_CHECKING': return '매장 플레이어를 준비하고 있습니다.';
    case 'STORE_CODE_REQUIRED': return '최초 한 번만 매장 코드를 입력해 주세요. 이 브라우저에서는 다음부터 자동으로 연결됩니다.';
    case 'EXPIRED': return '매장 연결이 만료되었습니다. 매장 코드를 다시 입력해 주세요.';
    case 'REVOKED': return '이 기기의 매장 연결이 해제되었습니다.';
    case 'ERROR': return '매장 연결을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    default: return '';
  }
}

/**
 * Device Label 파생 — coarse "Browser · OS" (개인정보/과도한 fingerprinting 금지).
 * 실패 시 '브라우저 기기'.
 */
export function deviceLabelFromUA(ua: string | null | undefined): string {
  const s = (ua ?? '').toLowerCase();
  if (!s) return '브라우저 기기';
  let browser = '브라우저';
  if (s.includes('edg/')) browser = 'Edge';
  else if (s.includes('opr/') || s.includes('opera')) browser = 'Opera';
  else if (s.includes('samsungbrowser')) browser = 'Samsung Internet';
  else if (s.includes('firefox')) browser = 'Firefox';
  else if (s.includes('chrome') || s.includes('crios')) browser = 'Chrome';
  else if (s.includes('safari')) browser = 'Safari';

  let os = '';
  if (s.includes('ipad')) os = 'iPad';
  else if (s.includes('iphone')) os = 'iPhone';
  else if (s.includes('android')) os = 'Android';
  else if (s.includes('windows')) os = 'Windows';
  else if (s.includes('mac os') || s.includes('macintosh')) os = 'macOS';
  else if (s.includes('cros')) os = 'ChromeOS';
  else if (s.includes('linux')) os = 'Linux';

  return os ? `${browser} · ${os}` : browser;
}
