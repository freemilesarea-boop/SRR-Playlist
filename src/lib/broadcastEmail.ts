/**
 * 회원 대량 메일 발송 — 프론트엔드 순수 헬퍼.
 *
 * 발송 로직은 엣지 함수(dispatch-broadcast-emails)가 수행하지만,
 * 제목 [광고] 표기 규칙 등은 미리보기(compose)에서도 동일하게 보여야 하므로
 * 여기 순수 함수로 두고 단위 테스트로 잠근다.
 */

export type EmailKind = 'notice' | 'ad';
export type RecipientMode = 'all' | 'filter' | 'selected';
export type CampaignStatus =
  | 'draft' | 'scheduled' | 'sending' | 'sent' | 'partial' | 'failed' | 'cancelled';

export const EMAIL_KIND_LABEL: Record<EmailKind, string> = {
  notice: '공지성',
  ad: '광고성',
};

export const RECIPIENT_MODE_LABEL: Record<RecipientMode, string> = {
  all: '전체 회원',
  filter: '검색·필터',
  selected: '개별 선택',
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: '작성 중',
  scheduled: '예약됨',
  sending: '발송 중',
  sent: '발송 완료',
  partial: '일부 실패',
  failed: '발송 실패',
  cancelled: '취소됨',
};

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, StatusTone> = {
  draft: 'neutral',
  scheduled: 'info',
  sending: 'info',
  sent: 'success',
  partial: 'warning',
  failed: 'danger',
  cancelled: 'neutral',
};

const AD_PREFIX_RE = /^\s*\[광고\]/;

/** 광고성이면 제목 앞에 [광고] 표기(이미 있으면 중복하지 않음). 엣지 함수 로직과 동일. */
export function buildBroadcastSubject(subject: string, kind: EmailKind): string {
  const s = (subject ?? '').trim();
  if (kind === 'ad' && !AD_PREFIX_RE.test(s)) return `[광고] ${s}`;
  return s;
}

export function isMarketing(kind: EmailKind): boolean {
  return kind === 'ad';
}

export interface ComposeDraft {
  subject: string;
  bodyHtml: string;
  kind: EmailKind;
  mode: RecipientMode;
  selectedCount: number;
  scheduledAt: string | null; // ISO or null (즉시)
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** 발송 전 최소 검증 — 제목/본문/수신자모드/예약시각. (수신자 수 0 검증은 서버가 함) */
export function validateBroadcastDraft(draft: ComposeDraft, now: number = Date.now()): ValidationResult {
  const errors: string[] = [];
  if (!draft.subject || draft.subject.trim().length === 0) errors.push('제목을 입력해주세요.');
  if (draft.subject && draft.subject.trim().length > 200) errors.push('제목은 200자 이내여야 합니다.');
  if (!draft.bodyHtml || draft.bodyHtml.trim().length === 0) errors.push('본문을 입력해주세요.');
  if (draft.mode === 'selected' && draft.selectedCount <= 0) errors.push('수신자를 1명 이상 선택해주세요.');
  if (draft.scheduledAt) {
    const t = Date.parse(draft.scheduledAt);
    if (Number.isNaN(t)) errors.push('예약 시각이 올바르지 않습니다.');
    else if (t <= now) errors.push('예약 시각은 현재 이후여야 합니다.');
  }
  return { ok: errors.length === 0, errors };
}

/** 발송 확인 문구 — 실수 방지용 요약. */
export function summarizeSend(
  draft: Pick<ComposeDraft, 'kind' | 'mode' | 'scheduledAt'>,
  recipientCount: number,
): string {
  const when = draft.scheduledAt
    ? `${new Date(draft.scheduledAt).toLocaleString('ko-KR')} 예약`
    : '지금';
  return `${EMAIL_KIND_LABEL[draft.kind]} 메일을 ${RECIPIENT_MODE_LABEL[draft.mode]} 기준 ${recipientCount.toLocaleString('ko-KR')}명에게 ${when} 발송합니다.`;
}
