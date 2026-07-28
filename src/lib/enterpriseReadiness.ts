// Phase ENT-WORKSPACE — 본사(HQ) 운영 준비 상태 순수 계산.
// admin_get_enterprise_detail 결과(EnterpriseDetail)만으로 브랜드/사업자/정산/초대·온보딩/
// 지역/매장 6개 운영 도메인의 준비 상태를 산출한다. RPC/DB/권한과 무관한 표시 전용 로직.
import type { EnterpriseDetail } from '@/lib/api/enterpriseDetailApi';

export type ReadinessStatus = 'ready' | 'partial' | 'attention' | 'missing';

export type ReadinessDomain =
  | 'brand' | 'business' | 'settlement' | 'invite' | 'region' | 'store';

/** 준비 카드에서 '이동' 시 열 상세 탭. null 이면 개요 화면 내 항목(같은 화면). */
export type ReadinessJumpTab = 'stores' | 'billing' | null;

export interface ReadinessItem {
  domain: ReadinessDomain;
  /** 한국어 도메인 라벨. */
  label: string;
  status: ReadinessStatus;
  /** 핵심 수치/한 줄 요약 (예: "활성 12 / 15"). */
  headline: string;
  /** 다음 액션 또는 상태 설명. */
  detail: string;
  /** 이동 대상 상세 탭. null 이면 개요 내 카드로 스크롤. */
  jumpTab: ReadinessJumpTab;
}

function nonEmpty(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** 브랜드 코드/레지스트리 연결 상태. */
export function brandReadiness(d: EnterpriseDetail): ReadinessItem {
  const code = d.invite.brand_code;
  const linked = nonEmpty(d.enterprise.brand_registry_id);
  if (nonEmpty(code) && linked) {
    return { domain: 'brand', label: '브랜드', status: 'ready', headline: code!, detail: '브랜드 코드 발급 · 레지스트리 연결됨', jumpTab: null };
  }
  if (nonEmpty(code)) {
    return { domain: 'brand', label: '브랜드', status: 'partial', headline: code!, detail: '브랜드 코드는 있으나 레지스트리 미연결', jumpTab: null };
  }
  return { domain: 'brand', label: '브랜드', status: 'missing', headline: '미발급', detail: '브랜드 코드가 발급되지 않음', jumpTab: null };
}

/** 사업자(회사) 정보 등록 상태. */
export function businessReadiness(d: EnterpriseDetail): ReadinessItem {
  const bp = d.business_profile;
  if (!bp) {
    return { domain: 'business', label: '사업자', status: 'missing', headline: '미등록', detail: '사업자 프로필이 등록되지 않음', jumpTab: null };
  }
  const core = [bp.company_name, bp.business_number, bp.representative_name];
  const filled = core.filter(nonEmpty).length;
  if (filled === core.length) {
    return { domain: 'business', label: '사업자', status: 'ready', headline: bp.company_name ?? '등록 완료', detail: '상호·사업자번호·대표자 등록 완료', jumpTab: null };
  }
  if (filled > 0) {
    return { domain: 'business', label: '사업자', status: 'partial', headline: `필수 ${filled}/${core.length}`, detail: '사업자 필수 정보 일부 누락', jumpTab: null };
  }
  return { domain: 'business', label: '사업자', status: 'missing', headline: '미등록', detail: '사업자 필수 정보 없음', jumpTab: null };
}

/** 정산 준비 — 계약 단가/수수료/방식 + 최근 정산 상태. 상세는 계약·정산 탭. */
export function settlementReadiness(d: EnterpriseDetail): ReadinessItem {
  const c = d.contract;
  if (!c) {
    return { domain: 'settlement', label: '정산', status: 'missing', headline: '계약 없음', detail: '등록된 계약이 없어 정산 불가', jumpTab: 'billing' };
  }
  const hasTerms = c.monthly_store_price != null && c.commission_rate != null && nonEmpty(c.settlement_method);
  if (!hasTerms) {
    return { domain: 'settlement', label: '정산', status: 'partial', headline: '조건 미설정', detail: '계약 단가·수수료·정산방식 미완성', jumpTab: 'billing' };
  }
  const latest = d.settlements[0];
  if (latest && (latest.status === 'held' || latest.below_minimum === true)) {
    const reason = latest.status === 'held' ? '보류' : '최소지급 미달';
    return { domain: 'settlement', label: '정산', status: 'attention', headline: `주의 · ${reason}`, detail: `최근 정산(${latest.settlement_month ?? '—'}) 확인 필요`, jumpTab: 'billing' };
  }
  return { domain: 'settlement', label: '정산', status: 'ready', headline: '조건 완료', detail: `단가·수수료·방식 설정됨 (정산 ${d.settlements.length}건)`, jumpTab: 'billing' };
}

/** 초대코드 발급 + 온보딩 활성화 상태. */
export function inviteReadiness(d: EnterpriseDetail): ReadinessItem {
  const hq = nonEmpty(d.invite.hq_invite_code);
  const store = nonEmpty(d.invite.store_invite_code);
  const onboarding = d.enterprise.onboarding_enabled === true;
  const count = (hq ? 1 : 0) + (store ? 1 : 0);
  if (count === 0) {
    return { domain: 'invite', label: '초대·온보딩', status: 'missing', headline: '코드 없음', detail: '본사·매장 초대코드 미발급', jumpTab: null };
  }
  if (count === 2 && onboarding) {
    return { domain: 'invite', label: '초대·온보딩', status: 'ready', headline: '발급 완료', detail: '본사·매장 코드 발급 · 온보딩 ON', jumpTab: null };
  }
  if (!onboarding) {
    return { domain: 'invite', label: '초대·온보딩', status: 'attention', headline: '온보딩 OFF', detail: `코드 ${count}/2 · 초대 가입 비활성화`, jumpTab: null };
  }
  return { domain: 'invite', label: '초대·온보딩', status: 'partial', headline: `코드 ${count}/2`, detail: '초대코드 일부만 발급됨', jumpTab: null };
}

/** 지역 등록 상태. */
export function regionReadiness(d: EnterpriseDetail): ReadinessItem {
  const n = d.regions.length;
  if (n === 0) {
    return { domain: 'region', label: '지역', status: 'missing', headline: '미등록', detail: '등록된 지역이 없음', jumpTab: null };
  }
  return { domain: 'region', label: '지역', status: 'ready', headline: `${n}개 지역`, detail: '지역 등록됨', jumpTab: null };
}

/** 매장 연결 + 온라인 건전성. 상세는 매장 탭. */
export function storeReadiness(d: EnterpriseDetail): ReadinessItem {
  const s = d.store_summary;
  if (!s || s.total === 0) {
    return { domain: 'store', label: '매장', status: 'missing', headline: '연결 없음', detail: '연결된 매장이 없음', jumpTab: 'stores' };
  }
  if (s.offline_or_error > 0) {
    return { domain: 'store', label: '매장', status: 'attention', headline: `오프라인/오류 ${s.offline_or_error}`, detail: `활성 ${s.active} / ${s.total} · 점검 필요`, jumpTab: 'stores' };
  }
  return { domain: 'store', label: '매장', status: 'ready', headline: `활성 ${s.active} / ${s.total}`, detail: `재생중 ${s.playing} · 오프라인/오류 0`, jumpTab: 'stores' };
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
