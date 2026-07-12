/**
 * missionControl — Mission Control 통합 레이어 순수 로직.
 *
 * Mission Control 은 기존 Dashboard 의 통합이다. 여기서는 새 KPI 를 계산하지 않고,
 * 이미 계산된 기존 KPI/Health 값을 조합·요약·상태화만 한다(단위 테스트 대상).
 * AI Insights 는 LLM/예측/원인분석 없이 실제 KPI 변화만 사실 서술한다.
 */
import type { MissionFeedKind, MissionFeedItem } from './adminApi';

/* ── Mission Health (기존 Health 조합, 없는 항목 제외) ─────────────── */
export interface HealthComponentInput { key: string; label: string; score: number | null; available: boolean }
export type MissionHealthLevel = 'healthy' | 'warning' | 'danger' | 'unknown';

export interface MissionHealthResult {
  score: number | null; level: MissionHealthLevel; used: HealthComponentInput[]; excluded: HealthComponentInput[];
}

/** available & score!=null 컴포넌트의 단순 평균(0~100). 없으면 unknown. 80+ 정상·50~80 주의·<50 위험. */
export function composeMissionHealth(components: HealthComponentInput[]): MissionHealthResult {
  const used = components.filter((c) => c.available && c.score != null);
  const excluded = components.filter((c) => !c.available || c.score == null);
  if (used.length === 0) return { score: null, level: 'unknown', used, excluded };
  const avg = used.reduce((s, c) => s + (c.score as number), 0) / used.length;
  const score = Math.round(Math.min(100, Math.max(0, avg)) * 10) / 10;
  const level: MissionHealthLevel = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'danger';
  return { score, level, used, excluded };
}

export const MISSION_HEALTH_LABEL: Record<MissionHealthLevel, string> = {
  healthy: '정상', warning: '주의', danger: '위험', unknown: '데이터 없음',
};
export const MISSION_HEALTH_TONE: Record<MissionHealthLevel, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success', warning: 'warning', danger: 'danger', unknown: 'neutral',
};

/* ── AI Insights (규칙 기반 · 사실 서술만, LLM/예측/원인분석 금지) ──── */
export interface Insight { key: string; text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }

export interface InsightInputs {
  memberToday?: number | null; memberMomText?: string | null; memberMomTone?: 'success' | 'danger' | 'neutral' | null;
  businessToday?: number | null; artistToday?: number | null;
  revenueToday?: number | null; revenueGrowthText?: string | null; revenueGrowthTone?: 'success' | 'danger' | 'neutral' | null;
  completionRate?: number | null;
  onlinePlayers?: number | null; totalPlayers?: number | null;
  todayIncidents?: number | null;
}

const KRW = (n: number) => `₩${Math.round(n).toLocaleString('ko-KR')}`;

/**
 * 실제 KPI 값/변화만 사실 서술. 추측·예측·허위 원인 없음.
 * 각 지표에 데이터가 있을 때만 문장을 생성한다(없으면 스킵 = 데이터 없음).
 */
export function generateInsights(x: InsightInputs): Insight[] {
  const out: Insight[] = [];
  if (x.memberToday != null) {
    const mom = x.memberMomText ? ` (전월 대비 ${x.memberMomText})` : '';
    out.push({ key: 'member', text: `오늘 신규 회원 ${x.memberToday.toLocaleString('ko-KR')}명${mom}`, tone: x.memberToday > 0 ? (x.memberMomTone ?? 'success') : 'neutral' });
  }
  if (x.businessToday != null) {
    out.push({ key: 'business', text: `오늘 신규 사업자 ${x.businessToday.toLocaleString('ko-KR')}명`, tone: x.businessToday > 0 ? 'success' : 'neutral' });
  }
  if (x.artistToday != null) {
    out.push({ key: 'artist', text: `오늘 신규 아티스트 ${x.artistToday.toLocaleString('ko-KR')}명`, tone: x.artistToday > 0 ? 'success' : 'neutral' });
  }
  if (x.revenueToday != null) {
    const g = x.revenueGrowthText ? ` · 이번달 ${x.revenueGrowthText}` : '';
    out.push({ key: 'revenue', text: `오늘 매출 ${KRW(x.revenueToday)}${g}`, tone: x.revenueToday > 0 ? (x.revenueGrowthTone ?? 'success') : 'neutral' });
  }
  if (x.completionRate != null) {
    out.push({ key: 'streaming', text: `재생 완료율 ${x.completionRate.toFixed(1)}%`, tone: x.completionRate >= 80 ? 'success' : x.completionRate >= 50 ? 'warning' : 'danger' });
  }
  if (x.totalPlayers != null && x.onlinePlayers != null && x.totalPlayers > 0) {
    const offline = x.totalPlayers - x.onlinePlayers;
    out.push({ key: 'players', text: `온라인 Player ${x.onlinePlayers}/${x.totalPlayers} (오프라인 ${offline})`, tone: x.onlinePlayers === 0 ? 'danger' : offline > 0 ? 'warning' : 'success' });
  }
  if (x.todayIncidents != null) {
    out.push({ key: 'incident', text: `오늘 Incident ${x.todayIncidents}건`, tone: x.todayIncidents > 0 ? 'danger' : 'success' });
  }
  return out;
}

/* ── Mission Map (서비스 체인 상태; 기존 KPI 재사용) ────────────────── */
export interface MissionMapNode { key: string; label: string; value: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }

/* ── Live Feed 표시 헬퍼 ──────────────────────────────────────────── */
export const FEED_META: Record<MissionFeedKind, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info' }> = {
  member_signup: { label: '신규 회원', tone: 'info' },
  business_signup: { label: '신규 사업자', tone: 'success' },
  artist_signup: { label: '신규 아티스트', tone: 'info' },
  artist_approved: { label: '아티스트 승인', tone: 'success' },
  qc_passed: { label: 'QC 통과', tone: 'success' },
  track_released: { label: '음원 유통', tone: 'success' },
  subscription: { label: '구독 생성', tone: 'success' },
  payment_paid: { label: '결제 완료', tone: 'success' },
  settlement: { label: '정산 생성', tone: 'info' },
  store_created: { label: '매장 생성', tone: 'success' },
};

export function feedLabel(item: Pick<MissionFeedItem, 'kind' | 'label'>): string {
  return FEED_META[item.kind]?.label ?? item.label ?? item.kind;
}

/* ── Executive Modes (기존 위젯 조합만; 새 계산 없음) ─────────────── */
export type ExecutiveMode = 'ceo' | 'coo' | 'operations' | 'finance' | 'artist' | 'business' | 'engineering';

/** 각 모드가 강조하는 KPI 키 집합 (위젯 선택용, 계산 아님). */
export const EXECUTIVE_MODES: Record<ExecutiveMode, { label: string; kpis: string[] }> = {
  ceo:        { label: 'CEO',        kpis: ['member_today', 'revenue_today', 'mrr', 'artist_today', 'business_today', 'mission_health'] },
  coo:        { label: 'COO',        kpis: ['online_stores', 'online_players', 'now_playing', 'fleet_health', 'incidents', 'store_health'] },
  operations: { label: 'Operations', kpis: ['online_players', 'now_playing', 'fleet_health', 'incidents', 'completion_rate', 'store_health'] },
  finance:    { label: 'Finance',    kpis: ['revenue_today', 'mrr', 'arr', 'paid_conversion', 'settlement_pending', 'revenue_growth'] },
  artist:     { label: 'Artist',     kpis: ['artist_today', 'artist_total', 'qc_score', 'distributed', 'settlement_pending'] },
  business:   { label: 'Business',   kpis: ['business_today', 'business_total', 'stores', 'online_players', 'store_health'] },
  engineering:{ label: 'Engineering',kpis: ['fleet_health', 'incidents', 'completion_rate', 'online_players', 'streaming_health'] },
};

export function modeKpis(mode: ExecutiveMode): string[] {
  return EXECUTIVE_MODES[mode]?.kpis ?? [];
}
