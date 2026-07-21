/**
 * errorMessages.ts — 사용자 친화 에러 메시지 유틸 (X6.38)
 *
 * 운영 DB 의 raise exception 메시지 200+ 개 분석 + Supabase/PostgreSQL
 * 에러 코드 매핑 + 네트워크/HTTP 상태 기반 친화화.
 *
 * 사용법:
 *   try { ... }
 *   catch (e) {
 *     toast.error(friendlyError(e, '저장 실패'));
 *     captureError(e);  // raw 는 Sentry 로 별도
 *   }
 *
 * 정책:
 *   - 메시지가 한국어 ([가-힣]) 면 그대로 노출 (이미 친화적이라 가정)
 *   - 영어/코드형이면 정규식 매칭 → 한국어 친화 메시지
 *   - 매칭 실패 시 fallback (없으면 일반 fallback)
 *   - raw 메시지는 Sentry 에 별도 보고 — 사용자 노출 X
 */

/** PostgreSQL SQLSTATE 코드 → 친화 메시지 */
const PG_CODE_MAP: Record<string, string> = {
  '42501': '권한이 없습니다.',
  '23505': '이미 등록된 값이라 추가할 수 없습니다.',
  '23503': '연결된 데이터가 남아 있어 처리할 수 없습니다.',
  '23502': '필수 입력값이 비어 있습니다.',
  '22023': '입력값이 올바르지 않습니다.',
  '23514': '값이 허용 범위를 벗어났습니다.',
  '42P01': '대상 테이블이 없습니다. 운영자에게 문의해주세요.',
  '40001': '동시 처리 충돌 — 잠시 후 다시 시도해주세요.',
  '53300': '서버가 일시적으로 바쁩니다. 잠시 후 다시 시도해주세요.',
  'PGRST301': '로그인이 필요합니다.',
  'PGRST302': '권한이 없습니다.',
  'PGRST116': '대상을 찾을 수 없습니다.',
  // PLATFORM-HOTFIX-1 — 정의되지 않은 함수(RPC) 호출: 내부 함수명/SQL 을 노출하지 않고
  // 안전한 안내로 대체. (PGRST202: PostgREST schema cache 에 함수 없음 / 42883: undefined_function)
  'PGRST202': '요청하신 기능을 현재 사용할 수 없습니다. 잠시 후 다시 시도하거나 운영자에게 문의해주세요.',
  '42883': '요청하신 기능을 현재 사용할 수 없습니다. 잠시 후 다시 시도하거나 운영자에게 문의해주세요.',
};

/**
 * 메시지 패턴 매칭 룰 (선순위 우선). 운영 DB raise exception 메시지 +
 * Supabase JS / PostgREST 표준 메시지 패턴 기반.
 */
const PATTERN_RULES: Array<{ re: RegExp; msg: string }> = [
  // 네트워크 / 일시 장애
  { re: /Failed to fetch|NetworkError|network ?error/i, msg: '네트워크 연결을 확인해주세요.' },
  { re: /timeout|timed out|ETIMEDOUT/i, msg: '요청이 시간을 초과했습니다. 잠시 후 다시 시도해주세요.' },
  { re: /rate ?limit|too many requests|\b429\b/i, msg: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
  { re: /service unavailable|\b50[23]\b/i, msg: '서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.' },

  // 로그인 / 권한 / 인증
  { re: /\bnot authenticated\b|JWT (expired|invalid)|invalid (refresh )?token|^login required$/i,
    msg: '로그인이 만료되었거나 필요합니다. 다시 로그인해주세요.' },
  { re: /\b(super_?admin|content_admin|sales_admin|curator_admin) only\b|admin or service_role only|service_role (or admin )?only|admin only|forbidden|unauthorized/i,
    msg: '이 작업에 대한 권한이 없습니다. 운영자에게 문의해주세요.' },

  // 결제 / 구독
  { re: /already_paid|already_applied|already_decided|already_processed/i,
    msg: '이미 처리된 항목이라 다시 처리할 수 없습니다.' },
  { re: /active_subscription_exists/i, msg: '이미 활성 구독이 있습니다.' },
  { re: /invalid_plan_type|^invalid plan_type/i, msg: '플랜 정보가 올바르지 않습니다.' },
  { re: /artist not eligible|artist payment not completed|not paid \(tier=/i,
    msg: '결제/계약 상태를 먼저 완료해주세요.' },
  { re: /subscription create failed|subscription not found/i,
    msg: '구독 처리에 실패했습니다. 잠시 후 다시 시도하거나 운영팀에 문의해주세요.' },
  { re: /amount mismatch/i, msg: '결제 금액이 일치하지 않습니다. 다시 시도해주세요.' },
  { re: /provider.*not.*enabled|unsupported provider|validation_failed/i,
    msg: '소셜 로그인 설정이 완료되지 않았습니다. 잠시 후 다시 시도해주세요.' },
  { re: /disallowed_useragent|보안 브라우저/i,
    msg: '앱 내 브라우저 또는 설치 앱에서는 Google 로그인이 제한될 수 있습니다. Chrome 또는 Safari에서 다시 시도해주세요.' },

  // 정산 / 환불
  { re: /cannot carryover .*paid/i, msg: '이미 지급된 정산은 이월할 수 없습니다.' },
  { re: /settlement already carried over/i, msg: '이미 이월 처리된 정산입니다.' },
  { re: /cannot mark merged settlement/i, msg: '다음 달로 흡수된 정산은 지급 처리할 수 없습니다.' },
  { re: /paid settlement (cannot be deleted|is immutable)/i,
    msg: '지급 완료된 정산은 수정할 수 없습니다.' },
  { re: /carryover_amount must be > 0/i, msg: '이월 금액은 0보다 커야 합니다.' },
  { re: /PII 미완료 정산/i, msg: '본인 인증/정산 계좌 정보가 완료되지 않은 정산입니다. PII override 가 필요합니다.' },
  { re: /payout account not found|verified payout account required/i,
    msg: '검증된 지급 계좌 정보가 필요합니다.' },

  // 음원
  { re: /track not found|track_not_found/i, msg: '음원 정보를 찾을 수 없습니다.' },
  { re: /not an artist upload/i, msg: '아티스트가 업로드한 음원만 처리 가능합니다.' },
  { re: /artist cannot (modify|set release_status)/i,
    msg: '현재 상태에서는 음원 정보를 수정할 수 없습니다.' },
  { re: /released track (is )?immutable|released track core metadata is immutable/i,
    msg: '이미 발매된 음원은 변경할 수 없습니다.' },
  { re: /release_date.*today \+ 3 days|release_date must be at least/i,
    msg: '발매일은 오늘 + 3일 이상으로 설정해주세요.' },
  { re: /cannot approve: (album cover|audio|title|album|genre)/i,
    msg: '필수 메타데이터/파일이 누락되어 승인할 수 없습니다.' },
  { re: /duplicate audio.*sha256/i, msg: '이미 등록된 음원과 동일한 파일입니다.' },
  { re: /monthly_upload_quota_exceeded/i, msg: '월간 업로드 한도를 초과했습니다.' },
  { re: /음원 .* super_admin\/content_admin/i, msg: '음원 관리 권한이 필요합니다.' },

  // 본인인증 / PII
  { re: /(account_number|account_holder|bank_name|legal_name|address|phone)_?required/i,
    msg: '정산 계좌 정보를 모두 입력해주세요.' },
  { re: /account_number_format_invalid|rrn_format_invalid/i,
    msg: '입력 형식이 올바르지 않습니다. 다시 확인해주세요.' },
  { re: /id_document_required/i, msg: '신분증/사업자등록증 사본이 필요합니다.' },
  { re: /tax_consent_required/i, msg: '원천징수 동의가 필요합니다.' },
  { re: /pii_encryption_key_not_configured/i,
    msg: '시스템 설정 오류 — 운영팀에 문의해주세요.' },

  // PLATFORM-HOTFIX-1 — 정의되지 않은 함수(RPC). 함수명/스키마 노출 없이 안전 안내.
  { re: /could not find the function|PGRST202|schema cache|undefined function|function .* does not exist/i,
    msg: '요청하신 기능을 현재 사용할 수 없습니다. 잠시 후 다시 시도하거나 운영자에게 문의해주세요.' },

  // 일반 not_found / required / immutable
  { re: /_not_found$|^not found$|^not_found$/i, msg: '대상을 찾을 수 없습니다.' },
  { re: /_required$|^.+ required$|^reason_required$/i, msg: '필수 입력값이 비어있습니다.' },
  { re: /is immutable|cannot delete|cannot change|append-only/i,
    msg: '이미 확정된 항목이라 변경할 수 없습니다.' },
  { re: /^invalid|^bad |invalid_action|invalid_status|invalid_severity/i,
    msg: '입력값이 올바르지 않습니다.' },

  // 사용자 / 가입
  { re: /user not found|user_not_found|target user not found/i,
    msg: '사용자를 찾을 수 없습니다.' },
  { re: /이미 가입된 이메일/i, msg: '이미 가입된 이메일입니다. 로그인해주세요.' },
  { re: /유효하지 않은 영업코드/i, msg: '유효하지 않은 영업인 코드입니다.' },
  { re: /유효한 초대코드가 필요/i, msg: '유효한 아티스트 초대 코드가 필요합니다.' },

  // 운영 가드 (한국어 메시지는 그대로 통과시키므로 여기엔 영어/혼합만)
  { re: /admin 계정은 (처리|탈퇴 처리)할 수 없습니다/i, msg: '관리자 계정은 이 작업을 수행할 수 없습니다.' },
];

/** 한국어 포함 여부 — 한국어면 raw 그대로 노출 정책 */
function looksKorean(s: string): boolean {
  return /[가-힣]/.test(s);
}

function matchPattern(s: string): string | null {
  for (const rule of PATTERN_RULES) {
    if (rule.re.test(s)) return rule.msg;
  }
  return null;
}

interface MaybePgError {
  code?: string;
  status?: number;
  message?: string;
  details?: string;
  hint?: string;
}

/**
 * unknown 에러 → 사용자 친화 메시지.
 * @param err     catch 절의 에러 — Error / PostgrestError / string / unknown 모두 허용
 * @param fallback 매칭 실패 + 한국어 아닌 경우 사용. 없으면 일반 fallback.
 */
export function friendlyError(err: unknown, fallback?: string): string {
  const defaultFallback = '오류가 발생했습니다. 잠시 후 다시 시도해주세요.';

  if (err == null) return fallback ?? defaultFallback;
  if (typeof err === 'string') {
    return matchPattern(err) ?? (looksKorean(err) ? err : (fallback ?? err));
  }

  // Error / Object / PostgrestError 처리
  if (typeof err === 'object') {
    const e = err as MaybePgError;

    // network 우선
    const msg = (e.message ?? '') as string;
    if (msg) {
      const networkMatch = matchPattern(msg);
      // PG code 가 있으면 코드 매핑 우선 (단 raise_exception 의 한국어 메시지는 유지)
      if (e.code && PG_CODE_MAP[e.code]) {
        // P0001 raise_exception 본문이 친화적이면 그대로
        if (e.code === 'P0001' && msg && looksKorean(msg)) return msg;
        return networkMatch ?? PG_CODE_MAP[e.code];
      }
      // HTTP status 매핑
      if (e.status === 401) return '로그인이 만료되었거나 필요합니다. 다시 로그인해주세요.';
      if (e.status === 403) return '이 작업에 대한 권한이 없습니다.';
      if (e.status === 404) return '대상을 찾을 수 없습니다.';
      if (e.status === 409) return '이미 존재하는 값입니다.';
      if (e.status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.';
      if (e.status && e.status >= 500) return '서버가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해주세요.';

      if (networkMatch) return networkMatch;
      if (looksKorean(msg)) return msg;
    }
  }

  if (err instanceof Error) {
    const matched = matchPattern(err.message);
    if (matched) return matched;
    if (looksKorean(err.message)) return err.message;
  }

  return fallback ?? defaultFallback;
}
