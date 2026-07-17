/**
 * settlementReadability — Artist Settlement Admin Readability &
 * Secure Payout Identity Center 순수 로직 (Phase SETTLEMENT-UX-1).
 *
 * 절대 조건(전부 코드로 준수):
 *  - Settlement/Shadow/Payment/Version 계산 일절 없음 — 저장 값의 표시/분해/필터만.
 *  - 차이 이유는 저장 성분(gross/fee/tax/carryover delta)의 분해 "후보"(reasonIsCandidateOnly).
 *  - 주민번호/계좌번호 기본 마스킹(0300 SQL 정책과 동일 규칙) — 원문은 이 모듈에 들어오지 않음.
 *  - deterministic · pure · null 안전 · NaN/Infinity 방어.
 */
import { isFiniteNumber } from './aiMemory';

/* ── 상수 ─────────────────────────────────────────────────────────────── */
export const SETTLEMENT_STATUSES = ['pending', 'carried_over', 'payable', 'paid', 'held', 'disputed'] as const;
export const ACCOUNT_STATUSES = ['unregistered', 'verification_pending', 'verified', 'verification_failed'] as const;
export const ENTITY_TYPES = ['business', 'individual_other_income', 'none', 'unknown'] as const;
export const DELTA_REASON_CANDIDATES = ['no_difference', 'gross_or_eligible_difference', 'company_fee_policy_difference', 'agent_fee_difference', 'tax_difference', 'carryover_difference', 'mixed_difference', 'v1_only_missing_v2', 'v2_only_missing_v1', 'insufficient_data'] as const;
export const ACCESS_AUDIT_ACTIONS = ['list_view', 'detail_view', 'shadow_view', 'history_view', 'kpi_view', 'copy_masked_value', 'copy_revealed_value', 'export_download', 'search_query'] as const;

export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  pending: '지급대기', carried_over: '이월', payable: '지급가능', paid: '지급완료', held: '보류', disputed: '분쟁',
};
export const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  unregistered: '미등록', verification_pending: '검증대기', verified: '검증완료', verification_failed: '검증실패',
};
export const ENTITY_TYPE_LABELS: Record<string, string> = {
  business: '사업자(3.3%)', individual_other_income: '개인(기타소득 8.8%)', none: '원천징수 없음', unknown: '미확인',
};

/* 운영/개발자 모드 컬럼 분리 — 운영자는 이름 중심, 개발자는 UUID/버전 추가 */
export const OPERATION_MODE_COLUMNS = ['artist_name', 'real_name', 'nickname', 'email', 'settlement_month', 'status', 'final_payout_amount', 'bank_name', 'account_holder', 'masked_account_number', 'account_status'] as const;
export const DEVELOPER_MODE_EXTRA_COLUMNS = ['settlement_id', 'artist_user_id', 'payout_account_id', 'policy_id', 'v2_id', 'v2_run_id', 'v2_version'] as const;

/* ── 1) 마스킹(0300 SQL 정책과 동일 규칙 — 표시 방어용) ──────────────── */
export function maskResidentNumber(rrn: string | null): string | null {
  if (rrn == null || !rrn.trim()) return null;
  if (rrn.includes('-')) return `${rrn.split('-')[0]}-*******`;
  const digits = rrn.replace(/\D/g, '');
  if (digits.length >= 13) return `${digits.slice(0, 6)}-*******`;
  return '******';
}

export function maskAccountNumber(acct: string | null): string | null {
  if (acct == null || !acct.trim()) return null;
  if (acct.length <= 4) return '*'.repeat(acct.length);
  return '*'.repeat(Math.max(acct.length - 4, 4)) + acct.slice(-4);
}

export function maskEmail(email: string | null): string | null {
  if (email == null || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}${'*'.repeat(Math.max(local.length - head.length, 2))}@${domain}`;
}

/* ── 2) 금액/상태 표기 ───────────────────────────────────────────────── */
export function formatKrw(n: number | null): string {
  if (n == null || !isFiniteNumber(n)) return '—';
  return `${Math.round(n).toLocaleString('ko-KR')}원`;
}

export function translateSettlementStatus(status: string): string {
  return SETTLEMENT_STATUS_LABELS[status] ?? status;
}

export function classifyAccountStatus(i: { hasAccount: boolean; verificationStatus: string | null }): (typeof ACCOUNT_STATUSES)[number] {
  if (!i.hasAccount) return 'unregistered';
  if (i.verificationStatus === 'verified') return 'verified';
  if (i.verificationStatus === 'rejected') return 'verification_failed';
  return 'verification_pending';
}

/* ── 3) Shadow Delta 분해(저장 성분 재조합 — 계산 변경 아님·이유는 후보) ── */
export interface ShadowDeltaComponents { grossDelta: number | null; companyFeeDelta: number | null; agentFeeDelta: number | null; taxDelta: number | null; carryoverDelta: number | null }
export function classifyShadowDelta(i: { v1Net: number | null; v2Net: number | null; components: ShadowDeltaComponents | null; v1Missing?: boolean; v2Missing?: boolean }): { netDelta: number | null; primaryReasonCandidate: (typeof DELTA_REASON_CANDIDATES)[number]; componentBreakdown: { component: string; delta: number }[]; reasonIsCandidateOnly: true; shadowRecalculated: false } {
  const flags = { reasonIsCandidateOnly: true as const, shadowRecalculated: false as const };
  if (i.v2Missing) return { netDelta: null, primaryReasonCandidate: 'v1_only_missing_v2', componentBreakdown: [], ...flags };
  if (i.v1Missing) return { netDelta: null, primaryReasonCandidate: 'v2_only_missing_v1', componentBreakdown: [], ...flags };
  if (i.v1Net == null || !isFiniteNumber(i.v1Net) || i.v2Net == null || !isFiniteNumber(i.v2Net)) return { netDelta: null, primaryReasonCandidate: 'insufficient_data', componentBreakdown: [], ...flags };
  const netDelta = i.v2Net - i.v1Net;
  if (netDelta === 0) return { netDelta: 0, primaryReasonCandidate: 'no_difference', componentBreakdown: [], ...flags };
  if (i.components == null) return { netDelta, primaryReasonCandidate: 'insufficient_data', componentBreakdown: [], ...flags };
  const parts = [
    { component: 'gross_or_eligible_difference', delta: i.components.grossDelta },
    { component: 'company_fee_policy_difference', delta: i.components.companyFeeDelta },
    { component: 'agent_fee_difference', delta: i.components.agentFeeDelta },
    { component: 'tax_difference', delta: i.components.taxDelta },
    { component: 'carryover_difference', delta: i.components.carryoverDelta },
  ].filter((p): p is { component: string; delta: number } => p.delta != null && isFiniteNumber(p.delta) && p.delta !== 0);
  if (!parts.length) return { netDelta, primaryReasonCandidate: 'insufficient_data', componentBreakdown: [], ...flags };
  const sorted = [...parts].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = Math.abs(sorted[0].delta);
  const second = sorted.length > 1 ? Math.abs(sorted[1].delta) : 0;
  const primary = second > 0 && second >= top * 0.5
    ? 'mixed_difference' as const
    : sorted[0].component as (typeof DELTA_REASON_CANDIDATES)[number];
  return { netDelta, primaryReasonCandidate: primary, componentBreakdown: sorted, ...flags };
}

/* ── 4) 차이 설명 문장(숫자만이 아니라 "왜"를 표기 — 후보 문구) ──────── */
export function buildDeltaExplanation(i: { primaryReasonCandidate: string; netDelta: number | null; eligibleStreamDelta?: number | null }): string {
  if (i.netDelta == null || !isFiniteNumber(i.netDelta)) return '차이 판정 불가(insufficient_data)';
  const amount = `${i.netDelta > 0 ? '+' : ''}${Math.round(i.netDelta).toLocaleString('ko-KR')}원`;
  switch (i.primaryReasonCandidate) {
    case 'no_difference': return 'v1 = v2 (차이 없음)';
    case 'gross_or_eligible_difference': {
      const streams = i.eligibleStreamDelta != null && isFiniteNumber(i.eligibleStreamDelta) && i.eligibleStreamDelta !== 0
        ? `유효재생 ${i.eligibleStreamDelta > 0 ? '+' : ''}${i.eligibleStreamDelta}건 → ` : '';
      return `v2 Gross/유효재생 차이 후보: ${streams}Net ${amount}`;
    }
    case 'company_fee_policy_difference': return `회사 수수료 정책 차이 후보 → Net ${amount}`;
    case 'agent_fee_difference': return `에이전트 수수료 차이 후보 → Net ${amount}`;
    case 'tax_difference': return `원천징수(세금) 차이 후보 → Net ${amount}`;
    case 'carryover_difference': return `이월 금액 차이 후보 → Net ${amount}`;
    case 'mixed_difference': return `복합 요인 차이 후보(성분 분해 참조) → Net ${amount}`;
    case 'v1_only_missing_v2': return 'v2 Shadow 데이터 없음(비교 불가)';
    case 'v2_only_missing_v1': return 'v1 정산 데이터 없음(비교 불가)';
    default: return `차이 ${amount} — 이유 후보 판정 불가`;
  }
}

/* ── 5) 검색/필터(클라이언트 보조 — 서버 필터와 동일 규칙) ───────────── */
export interface ReadableSettlementRow { artist_name: string | null; real_name: string | null; nickname: string | null; email: string | null; status: string; bank_name: string | null; masked_account_number: string | null; entity_type: string; final_payout_amount: number | null }
export function filterSettlementRows<T extends ReadableSettlementRow>(rows: T[], f: { search?: string; status?: string | null; bank?: string | null; entityType?: string | null; minAmount?: number | null; maxAmount?: number | null }): T[] {
  const q = (f.search ?? '').trim().toLowerCase();
  const last4 = /^\d{4}$/.test(q) ? q : null;
  return rows.filter((r) => {
    if (f.status && r.status !== f.status) return false;
    if (f.bank && !(r.bank_name ?? '').toLowerCase().includes(f.bank.toLowerCase())) return false;
    if (f.entityType && r.entity_type !== f.entityType) return false;
    if (f.minAmount != null && (r.final_payout_amount ?? 0) < f.minAmount) return false;
    if (f.maxAmount != null && (r.final_payout_amount ?? 0) > f.maxAmount) return false;
    if (!q) return true;
    if (last4) return (r.masked_account_number ?? '').endsWith(last4);
    return [r.artist_name, r.real_name, r.nickname, r.email, r.bank_name].some((v) => (v ?? '').toLowerCase().includes(q));
  });
}

/* ── 6) KPI(저장 값 집계 — 재계산 없음) ──────────────────────────────── */
export function calculateSettlementKpis(rows: { status: string; final_payout_amount: number | null; account_status: string }[] | null): { payableTotal: number; paidTotal: number; heldCount: number; carriedOverCount: number; unregisteredAccountCount: number; verificationFailedCount: number; settlementValuesRecomputed: false } {
  const rs = rows ?? [];
  const sum = (pred: (r: (typeof rs)[number]) => boolean) => rs.filter(pred).reduce((a, r) => a + (isFiniteNumber(r.final_payout_amount) ? (r.final_payout_amount as number) : 0), 0);
  return {
    payableTotal: sum((r) => r.status === 'pending' || r.status === 'payable'),
    paidTotal: sum((r) => r.status === 'paid'),
    heldCount: rs.filter((r) => r.status === 'held').length,
    carriedOverCount: rs.filter((r) => r.status === 'carried_over').length,
    unregisteredAccountCount: rs.filter((r) => r.account_status === 'unregistered').length,
    verificationFailedCount: rs.filter((r) => r.account_status === 'verification_failed').length,
    settlementValuesRecomputed: false,
  };
}

/* ── 7) 지급 이력 요약 ───────────────────────────────────────────────── */
export function summarizePayoutHistory(rows: { settlement_month: string; final_payout: number | null; status: string }[] | null): { month: string; label: string; amountLabel: string; statusLabel: string }[] {
  return (rows ?? [])
    .slice()
    .sort((a, b) => b.settlement_month.localeCompare(a.settlement_month))
    .slice(0, 24)
    .map((r) => ({
      month: r.settlement_month,
      label: r.settlement_month.slice(0, 7),
      amountLabel: formatKrw(r.final_payout),
      statusLabel: translateSettlementStatus(r.status),
    }));
}

/* ── 지원 매트릭스(정직 명시) ────────────────────────────────────────── */
export const SETTLEMENT_READABILITY_SUPPORT: { key: string; status: string; note: string }[] = [
  { key: 'name_centric_list', status: 'supported', note: '아티스트명/회원명/닉네임/이메일 중심 — UUID 는 개발자 모드 전용' },
  { key: 'payout_info_integration', status: 'supported', note: '은행/예금주/마스킹 계좌/지급예정/공제/실지급/지급상태/지급일 통합' },
  { key: 'rrn_masked_by_default', status: 'supported', note: '930101-******* 형식(0300 정책) — 목록/상세 기본 마스킹' },
  { key: 'account_masked_by_default', status: 'supported', note: '끝 4자리만 노출(0300 정책)' },
  { key: 'pii_reveal_via_existing_rpc', status: 'supported', note: '원문 열람은 기존 admin_reveal_payout_pii(0300) 경유만 — 자동 Audit(payout_account_reveal_logs)' },
  { key: 'access_audit', status: 'supported', note: '조회/복사/다운로드/검색 Audit(settlement_admin_access_logs append-only)' },
  { key: 'shadow_readable_compare', status: 'supported', note: '이름 + v1/v2/차이 + 성분 분해 이유 후보(reason_is_candidate)' },
  { key: 'delta_reason_candidate', status: 'supported', note: 'gross/수수료/세금/이월 성분 분해 — 저장 값 재조합(계산 변경 없음)' },
  { key: 'search_filters', status: 'supported', note: '이름/이메일/은행/계좌 끝4자리/월/상태/유형/금액범위' },
  { key: 'kpi_cards', status: 'supported', note: '지급예정/지급완료/총지급/미등록/검증실패/Shadow match·diff' },
  { key: 'detail_page', status: 'supported', note: '기본정보/정산/Shadow/재생정보(v2 실측)/지급이력 12개월' },
  { key: 'operation_developer_mode', status: 'supported', note: '운영 모드 기본(이름 중심) · 개발자 모드에서 UUID/버전/내부 ID 추가 표시' },
  { key: 'contract_status_reference', status: 'supported', note: 'artist_contracts(0057) 최신 상태 참조' },
  { key: 'entity_type_proxy', status: 'supported', note: '사업자/개인 구분은 tax_withholding_type 기반 proxy(정직 표기)' },
  { key: 'v1_stream_detail', status: 'unsupported', note: 'v1 은 재생 상세 미저장 — 재생정보는 v2 shadow 실측만(없으면 미표시)' },
  { key: 'settlement_modification', status: 'unsupported', note: '정산 결과/데이터 수정 없음 — 조회 전용' },
  { key: 'payment_execution_change', status: 'unsupported', note: 'Payment Engine/지급 금액 변경 없음' },
  { key: 'shadow_recalculation', status: 'unsupported', note: 'Shadow 계산 변경/재계산 없음 — 저장 값 표시만' },
  { key: 'version_change', status: 'unsupported', note: 'Settlement Version 변경 없음' },
  { key: 'pii_plaintext_in_list', status: 'unsupported', note: '목록/상세 원문 미노출 — 마스킹 기본' },
];
