// Phase ENT-WORKSPACE — 본사(HQ) 운영 준비 상태 순수 계산.
// admin_get_enterprise_detail 결과(EnterpriseDetail)만으로 브랜드/사업자/정산/초대·온보딩/
// 지역/매장 6개 운영 도메인의 준비 상태를 산출한다. RPC/DB/권한과 무관한 표시 전용 로직.
import type { EnterpriseDetail } from '@/lib/api/enterpriseDetailApi';

export type ReadinessStatus = 'ready' | 'partial' | 'attention' | 'missing';

export type ReadinessDomain =
  | 'brand' | 'business' | 'settlement' | 'invite' | 'region' | 'store';

/**
 * 준비 카드에서 실행할 '실제 지원 액션'의 종류(순수 서술자).
 * React 계층이 이 종류를 기존 Dialog/Mutation/Tab 이동으로 매핑한다.
 * 새 백엔드 기능을 만들지 않으며, 지원 액션이 없으면 안전한 탭 이동으로 대체한다.
 * - 'invite'     → 초대·코드 관리(InviteCodesModal): brand/hq/store 코드
 * - 'settlement' → 정산·사업자 검토(SettlementReviewModal): 승인/반려/지급설정
 * - 'regions'    → 지역 관리 화면(enterprise-regions 탭) 이동
 * - 'tab:stores' → 매장 상세 탭 이동
 * - 'tab:billing'→ 계약·정산 상세 탭 이동
 */
export type ReadinessActionKind =
  | 'invite' | 'settlement' | 'regions' | 'tab:stores' | 'tab:billing';

export interface ReadinessItem {
  domain: ReadinessDomain;
  /** 한국어 도메인 라벨. */
  label: string;
  status: ReadinessStatus;
  /** 핵심 수치/한 줄 요약 (예: "활성 12 / 15"). */
  headline: string;
  /** 다음 액션 또는 상태 설명. */
  detail: string;
  /** 이 도메인에서 실행할 실제 지원 액션의 종류. */
  actionKind: ReadinessActionKind;
}

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 브랜드 코드/레지스트리 연결 상태. */
export function brandReadiness(d: EnterpriseDetail): ReadinessItem {
  const code = d.invite.brand_code;
  const linked = nonEmpty(d.enterprise.brand_registry_id);
  if (nonEmpty(code) && linked) {
    return { domain: 'brand', label: '브랜드', status: 'ready', headline: code!, detail: '브랜드 코드 발급 · 레지스트리 연결됨', actionKind: 'invite' };
  }
  if (nonEmpty(code)) {
    return { domain: 'brand', label: '브랜드', status: 'partial', headline: code!, detail: '브랜드 코드는 있으나 레지스트리 미연결', actionKind: 'invite' };
  }
  return { domain: 'brand', label: '브랜드', status: 'missing', headline: '미발급', detail: '브랜드 코드가 발급되지 않음', actionKind: 'invite' };
}

/** 사업자(회사) 정보 등록 상태. */
export function businessReadiness(d: EnterpriseDetail): ReadinessItem {
  const bp = d.business_profile;
  if (!bp) {
    return { domain: 'business', label: '사업자', status: 'missing', headline: '미등록', detail: '사업자 프로필이 등록되지 않음', actionKind: 'settlement' };
  }
  const core = [bp.company_name, bp.business_number, bp.representative_name];
  const filled = core.filter(nonEmpty).length;
  if (filled === core.length) {
    return { domain: 'business', label: '사업자', status: 'ready', headline: bp.company_name ?? '등록 완료', detail: '상호·사업자번호·대표자 등록 완료', actionKind: 'settlement' };
  }
  if (filled > 0) {
    return { domain: 'business', label: '사업자', status: 'partial', headline: `필수 ${filled}/${core.length}`, detail: '사업자 필수 정보 일부 누락', actionKind: 'settlement' };
  }
  return { domain: 'business', label: '사업자', status: 'missing', headline: '미등록', detail: '사업자 필수 정보 없음', actionKind: 'settlement' };
}

/** 정산 준비 — 계약 단가/수수료/방식 + 최근 정산 상태. 상세는 계약·정산 탭. */
export function settlementReadiness(d: EnterpriseDetail): ReadinessItem {
  const c = d.contract;
  if (!c) {
    return { domain: 'settlement', label: '정산', status: 'missing', headline: '계약 없음', detail: '등록된 계약이 없어 정산 불가', actionKind: 'settlement' };
  }
  const hasTerms = c.monthly_store_price != null && c.commission_rate != null && nonEmpty(c.settlement_method);
  if (!hasTerms) {
    return { domain: 'settlement', label: '정산', status: 'partial', headline: '조건 미설정', detail: '계약 단가·수수료·정산방식 미완성', actionKind: 'settlement' };
  }
  const latest = d.settlements[0];
  if (latest && (latest.status === 'held' || latest.below_minimum === true)) {
    const reason = latest.status === 'held' ? '보류' : '최소지급 미달';
    return { domain: 'settlement', label: '정산', status: 'attention', headline: `주의 · ${reason}`, detail: `최근 정산(${latest.settlement_month ?? '—'}) 확인 필요`, actionKind: 'settlement' };
  }
  return { domain: 'settlement', label: '정산', status: 'ready', headline: '조건 완료', detail: `단가·수수료·방식 설정됨 (정산 ${d.settlements.length}건)`, actionKind: 'settlement' };
}

/** 초대코드 발급 + 온보딩 활성화 상태. */
export function inviteReadiness(d: EnterpriseDetail): ReadinessItem {
  const hq = nonEmpty(d.invite.hq_invite_code);
  const store = nonEmpty(d.invite.store_invite_code);
  const onboarding = d.enterprise.onboarding_enabled === true;
  const count = (hq ? 1 : 0) + (store ? 1 : 0);
  if (count === 0) {
    return { domain: 'invite', label: '초대·온보딩', status: 'missing', headline: '코드 없음', detail: '본사·매장 초대코드 미발급', actionKind: 'invite' };
  }
  if (count === 2 && onboarding) {
    return { domain: 'invite', label: '초대·온보딩', status: 'ready', headline: '발급 완료', detail: '본사·매장 코드 발급 · 온보딩 ON', actionKind: 'invite' };
  }
  if (!onboarding) {
    return { domain: 'invite', label: '초대·온보딩', status: 'attention', headline: '온보딩 OFF', detail: `코드 ${count}/2 · 초대 가입 비활성화`, actionKind: 'invite' };
  }
  return { domain: 'invite', label: '초대·온보딩', status: 'partial', headline: `코드 ${count}/2`, detail: '초대코드 일부만 발급됨', actionKind: 'invite' };
}

/** 지역 등록 상태. */
export function regionReadiness(d: EnterpriseDetail): ReadinessItem {
  const n = d.regions.length;
  if (n === 0) {
    return { domain: 'region', label: '지역', status: 'missing', headline: '미등록', detail: '등록된 지역이 없음', actionKind: 'regions' };
  }
  return { domain: 'region', label: '지역', status: 'ready', headline: `${n}개 지역`, detail: '지역 등록됨', actionKind: 'regions' };
}

/** 매장 연결 + 온라인 건전성. 상세는 매장 탭. */
export function storeReadiness(d: EnterpriseDetail): ReadinessItem {
  const s = d.store_summary;
  if (!s || s.total === 0) {
    return { domain: 'store', label: '매장', status: 'missing', headline: '연결 없음', detail: '연결된 매장이 없음', actionKind: 'tab:stores' };
  }
  if (s.offline_or_error > 0) {
    return { domain: 'store', label: '매장', status: 'attention', headline: `오프라인/오류 ${s.offline_or_error}`, detail: `활성 ${s.active} / ${s.total} · 점검 필요`, actionKind: 'tab:stores' };
  }
  return { domain: 'store', label: '매장', status: 'ready', headline: `활성 ${s.active} / ${s.total}`, detail: `재생중 ${s.playing} · 오프라인/오류 0`, actionKind: 'tab:stores' };
}

/** 6개 운영 도메인 준비 상태 (표시 순서 고정). */
export function computeEnterpriseReadiness(d: EnterpriseDetail): ReadinessItem[] {
  return [
    brandReadiness(d),
    businessReadiness(d),
    settlementReadiness(d),
    inviteReadiness(d),
    regionReadiness(d),
    storeReadiness(d),
  ];
}

/** 미완료(주의/부분/누락) 도메인 수 — 헤더 요약용. */
export function countIncomplete(items: ReadinessItem[]): number {
  return items.filter((i) => i.status !== 'ready').length;
}

// ── 지금 처리할 작업 (Required / Recommended) ─────────────────────────

export type EnterpriseRequiredPriority = 'required' | 'recommended';

export interface EnterpriseRequiredAction {
  /** 도메인 기반 고유 id (중복 방지). */
  id: string;
  title: string;
  description: string;
  priority: EnterpriseRequiredPriority;
  /** 현재 구현된 actionKind 재사용 — React 계층이 실제 지원 액션으로 매핑. */
  actionKind: ReadinessActionKind;
}

/** 운영에 필수인 도메인(정산·계약 진행 전 반드시 필요). 나머지는 recommended. */
const REQUIRED_DOMAINS: ReadonlySet<ReadinessDomain> = new Set(['business', 'settlement', 'invite', 'region']);

/** 미완료 도메인별 '지금 처리할 작업' 문구(운영자 관점, DB 필드명 아님). */
function requiredCopy(item: ReadinessItem): { title: string; description: string } {
  const s = item.status;
  switch (item.domain) {
    case 'brand':
      return s === 'partial'
        ? { title: '브랜드 레지스트리 미연결', description: '브랜드 코드는 있으나 레지스트리에 연결되지 않았습니다.' }
        : { title: '브랜드 코드 미발급', description: '브랜드 코드가 아직 발급되지 않았습니다.' };
    case 'business':
      return { title: '사업자 정보 확인 필요', description: '계약·정산 진행 전에 사업자 정보를 검토하세요.' };
    case 'settlement':
      if (s === 'attention') return { title: '정산 확인 필요', description: item.detail };
      return s === 'partial'
        ? { title: '정산 조건 미완성', description: '계약 단가·수수료·정산방식이 완성되지 않았습니다.' }
        : { title: '계약·정산 미설정', description: '등록된 계약이 없어 정산을 진행할 수 없습니다.' };
    case 'invite':
      if (s === 'attention') return { title: '초대 온보딩 비활성화', description: '초대 가입이 꺼져 있어 신규 연결이 불가합니다.' };
      return s === 'partial'
        ? { title: '초대코드 일부만 발급', description: '본사·매장 초대코드 중 일부만 발급되었습니다.' }
        : { title: 'HQ·매장 초대코드 없음', description: '본사 연결을 위한 초대코드가 없습니다.' };
    case 'region':
      return { title: '지역 미연결', description: '본사의 운영 지역을 지정하세요.' };
    case 'store':
      return s === 'attention'
        ? { title: '매장 오프라인/오류', description: item.detail }
        : { title: '연결된 매장 없음', description: '아직 연결된 매장이 없습니다.' };
  }
}

/**
 * '지금 처리할 작업' 목록 — 완료(ready) 항목 제외, required 우선.
 * 도메인당 최대 1개(중복 없음). 액션은 기존 actionKind 재사용.
 * 모두 완료면 빈 배열(호출부에서 완료 메시지 표시).
 */
export function getEnterpriseRequiredActions(d: EnterpriseDetail): EnterpriseRequiredAction[] {
  const rank: Record<EnterpriseRequiredPriority, number> = { required: 0, recommended: 1 };
  return computeEnterpriseReadiness(d)
    .filter((it) => it.status !== 'ready')
    .map((it): EnterpriseRequiredAction => {
      const copy = requiredCopy(it);
      return {
        id: it.domain,
        title: copy.title,
        description: copy.description,
        priority: REQUIRED_DOMAINS.has(it.domain) ? 'required' : 'recommended',
        actionKind: it.actionKind,
      };
    })
    // required 먼저, 그 외 원래(도메인 고정) 순서 유지 — Array.prototype.sort 안정 정렬.
    .sort((a, b) => rank[a.priority] - rank[b.priority]);
}

/** 목록을 limit개까지만 노출하고 나머지 개수를 반환(지역 '3개 + N개 더' 등). */
export function splitForDisplay<T>(items: readonly T[], limit: number): { shown: T[]; hiddenCount: number } {
  if (limit < 0) return { shown: [...items], hiddenCount: 0 };
  return { shown: items.slice(0, limit), hiddenCount: Math.max(0, items.length - limit) };
}
