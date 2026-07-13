/**
 * aiRecommendation — AI Recommendation Engine 순수 로직 (Phase AI-RECOMMENDATION-1).
 *
 * 관리자가 데이터를 직접 해석하지 않아도, **실제 운영 KPI 만** 근거로 실행 가능한 추천을
 * 생성한다. LLM 추론·허위 원인·존재하지 않는 데이터 기반 추천은 없다(단위 테스트 대상).
 *
 * 원칙:
 *   - 기존 Dashboard KPI 재사용(새 KPI 계산 없음). 입력은 이미 계산된 KPI 스냅샷.
 *   - 모든 추천은 Evidence(근거 KPI)를 가진다 — Evidence 없으면 추천 없음.
 *   - Confidence = LLM 신뢰도가 아니라 **데이터 충족률**(evidence 만족/전체, 0~100).
 *   - Priority = 영향도 × 변화율 × 영향범위(지속시간은 History telemetry 부재로 중립).
 *   - Suggested Action 은 기존 Action Center action 또는 Dashboard 링크 재사용.
 *   - NaN/Infinity 금지, Confidence/Score clamp 0~100.
 */

/* ── 타입 ─────────────────────────────────────────────────────────── */
export type RecCategory = 'member' | 'revenue' | 'artist' | 'business' | 'streaming' | 'operations' | 'system' | 'automation';
export type Priority = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Evidence {
  kpi: string;                 // 사용된 KPI 키
  label: string;               // 표시 라벨
  current: number | null;      // 현재값
  baseline: number | null;     // 기준값(평균/전월 등)
  changeRate: number | null;   // 변화율(%) — 기준 대비
  period: string;              // 기간
  source: string;              // 사용된 Dashboard/RPC
  satisfied: boolean;          // 근거 충족 여부(Confidence 산정)
}

export interface SuggestedAction {
  label: string;
  kind: 'action' | 'link';     // action=Action Center Command 재사용, link=Dashboard 이동
  ref: string;                 // action id 또는 dashboard 링크 키
}

export interface Recommendation {
  ruleKey: string;
  category: RecCategory;
  priority: Priority;
  score: number;               // 0~100
  confidence: number;          // 0~100 (데이터 충족률)
  title: string;
  message: string;
  reason: string;              // 왜 추천했는지(실제 KPI 비교, LLM 설명 아님)
  evidence: Evidence[];
  suggestedAction: SuggestedAction;
}

/* ── 입력(기존 KPI 재사용; 모두 nullable = 데이터 없음 허용) ──────────── */
export interface RecommendationInputs {
  // Member (admin_member_growth_kpis)
  memberThisMonth?: number | null; memberLastMonth?: number | null; memberMomRate?: number | null;
  // Revenue (admin_revenue_kpis / breakdown)
  revenueThis?: number | null; revenueLast?: number | null; revenueGrowthThis?: number | null;
  paymentFailures?: number | null;
  // Business (admin_business_summary)
  businessTotal?: number | null; businessMonthSignups?: number | null;
  offlinePlayers?: number | null; totalPlayers?: number | null;
  // Artist (admin_artist_breakdown)
  qcPending?: number | null; settlementPending?: number | null;
  // Streaming (admin_stream_v2_health / now_playing)
  streamHealth?: number | null; playbackErrors?: number | null;
  // Operations / NOC (admin_noc_kpi)
  offlineStores?: number | null; todayIncidents?: number | null;
}

/* ── 유틸 ─────────────────────────────────────────────────────────── */
const num = (n: number | null | undefined): number | null => (n == null || !Number.isFinite(n) ? null : n);
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const pct = (current: number, baseline: number): number | null => {
  if (baseline === 0) return null; // 0 나눔 → Infinity 금지
  const r = ((current - baseline) / Math.abs(baseline)) * 100;
  return Number.isFinite(r) ? Math.round(r * 10) / 10 : null;
};

/** Confidence = 데이터 충족률(evidence 만족/전체). 0~100. */
export function computeConfidence(evidence: Evidence[]): number {
  if (evidence.length === 0) return 0;
  const satisfied = evidence.filter((e) => e.satisfied).length;
  return Math.round((satisfied / evidence.length) * 100);
}

/**
 * Priority Score = 영향도 × (0.4+0.6·변화율) × (0.4+0.6·영향범위) × 지속시간.
 * 각 요소 0~1 clamp. 지속시간 telemetry 부재 → 1(중립). 결과 0~100.
 */
export function priorityScore(p: { impact: number; changeRate: number; scope: number; duration?: number }): number {
  const impact = clamp01(p.impact);
  const change = clamp01(Math.abs(p.changeRate));
  const scope = clamp01(p.scope);
  const duration = p.duration == null ? 1 : clamp01(p.duration);
  const raw = impact * (0.4 + 0.6 * change) * (0.4 + 0.6 * scope) * duration;
  return Math.round(clamp01(raw) * 100);
}

export function scoreToPriority(score: number): Priority {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 40) return 'medium';
  if (score >= 20) return 'low';
  return 'info';
}

/* ── Rule 정의 ────────────────────────────────────────────────────── */
interface RuleResult { rec: Recommendation | null }
type Rule = (x: RecommendationInputs) => RuleResult;

const PERIOD_MONTH = '이번달 vs 지난달';
const PERIOD_NOW = '현재';

/** 1) Revenue 감소 — revenue_growth_this < 0 또는 이번달<지난달. */
const revenueDrop: Rule = (x) => {
  const growth = num(x.revenueGrowthThis);
  const cur = num(x.revenueThis); const base = num(x.revenueLast);
  const change = growth ?? (cur != null && base != null ? pct(cur, base) : null);
  if (change == null || change >= 0) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'month_revenue', label: '이번달 매출', current: cur, baseline: base, changeRate: change, period: PERIOD_MONTH, source: 'Revenue · admin_revenue_kpis', satisfied: true },
    { kpi: 'revenue_growth_this', label: '매출 증감률', current: change, baseline: 0, changeRate: change, period: PERIOD_MONTH, source: 'Revenue · admin_revenue_kpis', satisfied: change < 0 },
    { kpi: 'baseline_present', label: '전월 기준 존재', current: base, baseline: base, changeRate: null, period: PERIOD_MONTH, source: 'Revenue', satisfied: base != null },
  ];
  const mag = Math.min(Math.abs(change) / 30, 1); // -30% → 최대
  const score = priorityScore({ impact: 0.95, changeRate: mag, scope: 0.9 });
  return {
    rec: {
      ruleKey: 'revenue_drop', category: 'revenue', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: '매출 감소 감지', message: 'Revenue Dashboard 를 확인하십시오.',
      reason: `매출 증감률 ${change}% (전월 대비 감소).`, evidence: ev,
      suggestedAction: { label: 'Open Revenue Dashboard', kind: 'link', ref: 'revenue' },
    },
  };
};

/** 2) 가입 감소 — mom_rate < 0. */
const signupDrop: Rule = (x) => {
  const mom = num(x.memberMomRate);
  const cur = num(x.memberThisMonth); const base = num(x.memberLastMonth);
  const change = mom ?? (cur != null && base != null ? pct(cur, base) : null);
  if (change == null || change >= 0) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'this_month_signups', label: '이번달 가입', current: cur, baseline: base, changeRate: change, period: PERIOD_MONTH, source: 'Member Growth · admin_member_growth_kpis', satisfied: true },
    { kpi: 'mom_growth_rate', label: '전월비 증감률', current: change, baseline: 0, changeRate: change, period: PERIOD_MONTH, source: 'Member Growth', satisfied: change < 0 },
    { kpi: 'baseline_present', label: '전월 기준 존재', current: base, baseline: base, changeRate: null, period: PERIOD_MONTH, source: 'Member Growth', satisfied: base != null },
  ];
  const mag = Math.min(Math.abs(change) / 40, 1);
  const score = priorityScore({ impact: 0.7, changeRate: mag, scope: 0.7 });
  return {
    rec: {
      ruleKey: 'signup_drop', category: 'member', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: '신규 가입 감소', message: 'Member Growth Dashboard 를 확인하십시오.',
      reason: `이번달 가입 전월 대비 ${change}%.`, evidence: ev,
      suggestedAction: { label: 'Open Member Growth', kind: 'link', ref: 'member' },
    },
  };
};

/** 3) Payment Failure 증가 — failed_payments >= 5. */
const paymentFailure: Rule = (x) => {
  const f = num(x.paymentFailures);
  if (f == null || f < 5) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'failed_payments', label: '결제 실패 수', current: f, baseline: 5, changeRate: null, period: PERIOD_NOW, source: 'Revenue · admin_revenue_kpis', satisfied: true },
    { kpi: 'threshold', label: '임계(5) 초과', current: f, baseline: 5, changeRate: null, period: PERIOD_NOW, source: 'Revenue', satisfied: f >= 5 },
  ];
  const mag = Math.min(f / 50, 1);
  const score = priorityScore({ impact: 0.85, changeRate: mag, scope: 0.6 });
  return {
    rec: {
      ruleKey: 'payment_failure', category: 'revenue', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: '결제 실패 급증', message: 'Revenue Dashboard 에서 결제 실패를 확인하십시오.',
      reason: `결제 실패 ${f}건 (임계 5 초과).`, evidence: ev,
      suggestedAction: { label: 'Open Revenue Dashboard', kind: 'link', ref: 'revenue' },
    },
  };
};

/** 4) QC Pending 증가 — qc_pending >= 50. */
const qcBacklog: Rule = (x) => {
  const q = num(x.qcPending);
  if (q == null || q < 50) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'qc_pending', label: 'QC 대기 수', current: q, baseline: 50, changeRate: null, period: PERIOD_NOW, source: 'Artist · admin_artist_breakdown', satisfied: true },
    { kpi: 'threshold', label: '임계(50) 초과', current: q, baseline: 50, changeRate: null, period: PERIOD_NOW, source: 'Artist', satisfied: q >= 50 },
  ];
  const mag = Math.min(q / 200, 1);
  const score = priorityScore({ impact: 0.6, changeRate: mag, scope: 0.6 });
  return {
    rec: {
      ruleKey: 'qc_backlog', category: 'artist', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: 'QC 적체 증가', message: 'QC Dashboard 에서 일괄 검토를 권장합니다.',
      reason: `QC 대기 ${q}건 (임계 50 초과).`, evidence: ev,
      suggestedAction: { label: 'Retry QC (Action Center)', kind: 'action', ref: 'qc_retry' },
    },
  };
};

/** 5) Settlement Pending 증가 — settlement_pending >= 1. */
const settlementPending: Rule = (x) => {
  const s = num(x.settlementPending);
  if (s == null || s < 1) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'settlement_pending', label: '정산 예정 수', current: s, baseline: 0, changeRate: null, period: PERIOD_NOW, source: 'Artist · admin_artist_breakdown', satisfied: true },
  ];
  const mag = Math.min(s / 20, 1);
  const score = priorityScore({ impact: 0.4, changeRate: mag, scope: 0.4 });
  return {
    rec: {
      ruleKey: 'settlement_pending', category: 'artist', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: '정산 예정 누적', message: '정산 Dashboard 에서 정산 생성을 검토하십시오.',
      reason: `정산 예정 ${s}건.`, evidence: ev,
      suggestedAction: { label: 'Open Settlement Dashboard', kind: 'link', ref: 'artist' },
    },
  };
};

/** 6) Store Offline 증가 — offline_stores >= 1. */
const storeOffline: Rule = (x) => {
  const o = num(x.offlineStores);
  if (o == null || o < 1) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'offline_stores', label: '오프라인 매장 수', current: o, baseline: 0, changeRate: null, period: PERIOD_NOW, source: 'Business/NOC · admin_noc_kpi', satisfied: true },
  ];
  const mag = Math.min(o / 10, 1);
  const score = priorityScore({ impact: 0.75, changeRate: mag, scope: 0.7 });
  return {
    rec: {
      ruleKey: 'store_offline', category: 'operations', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: '매장 오프라인 증가', message: '매장 재동기화를 검토하십시오.',
      reason: `오프라인 매장 ${o}개.`, evidence: ev,
      suggestedAction: { label: 'Store Resync (Action Center)', kind: 'action', ref: 'store_resync' },
    },
  };
};

/** 7) Player Offline 증가 — offline_players 비율 기반. */
const playerOffline: Rule = (x) => {
  const off = num(x.offlinePlayers); const total = num(x.totalPlayers);
  if (off == null || off < 1) return { rec: null };
  const ratio = total && total > 0 ? off / total : null;
  const ev: Evidence[] = [
    { kpi: 'offline_players', label: '오프라인 Player 수', current: off, baseline: 0, changeRate: null, period: PERIOD_NOW, source: 'Business/Streaming', satisfied: true },
    { kpi: 'offline_ratio', label: '오프라인 비율', current: ratio != null ? Math.round(ratio * 1000) / 10 : null, baseline: 0, changeRate: null, period: PERIOD_NOW, source: 'Business', satisfied: ratio != null },
  ];
  const mag = ratio ?? Math.min(off / 10, 1);
  const score = priorityScore({ impact: 0.7, changeRate: mag, scope: ratio ?? 0.5 });
  return {
    rec: {
      ruleKey: 'player_offline', category: 'operations', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: 'Player 오프라인 증가', message: '매장 재동기화 또는 Player 진단을 검토하십시오.',
      reason: `오프라인 Player ${off}대${ratio != null ? ` (${Math.round(ratio * 1000) / 10}%)` : ''}.`, evidence: ev,
      suggestedAction: { label: 'Store Resync (Action Center)', kind: 'action', ref: 'store_resync' },
    },
  };
};

/** 8) Streaming Health 저하 — stream_health < 80. */
const streamingHealth: Rule = (x) => {
  const h = num(x.streamHealth);
  if (h == null || h >= 80) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'overall_health', label: 'Streaming Health', current: h, baseline: 80, changeRate: null, period: '최근 30일', source: 'Streaming · admin_stream_v2_health', satisfied: true },
    { kpi: 'threshold', label: '기준(80) 미만', current: h, baseline: 80, changeRate: null, period: '최근 30일', source: 'Streaming', satisfied: h < 80 },
  ];
  const mag = Math.min((80 - h) / 80, 1);
  const score = priorityScore({ impact: 0.8, changeRate: mag, scope: 0.8 });
  return {
    rec: {
      ruleKey: 'streaming_health', category: 'streaming', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: 'Streaming 건강도 저하', message: 'Streaming Dashboard 를 확인하십시오.',
      reason: `Streaming Health ${h}점 (기준 80 미만).`, evidence: ev,
      suggestedAction: { label: 'Open Streaming Dashboard', kind: 'link', ref: 'streaming' },
    },
  };
};

/** 9) Playback Error 증가 — playback_errors >= 1. */
const playbackError: Rule = (x) => {
  const e = num(x.playbackErrors);
  if (e == null || e < 1) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'error_count', label: 'Playback 오류 수', current: e, baseline: 0, changeRate: null, period: PERIOD_NOW, source: 'Streaming · admin_now_playing_kpi', satisfied: true },
  ];
  const mag = Math.min(e / 20, 1);
  const score = priorityScore({ impact: 0.75, changeRate: mag, scope: 0.6 });
  return {
    rec: {
      ruleKey: 'playback_error', category: 'streaming', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: 'Playback 오류 증가', message: 'Streaming/Player 오류를 확인하십시오.',
      reason: `Playback 오류 ${e}건.`, evidence: ev,
      suggestedAction: { label: 'Open Streaming Dashboard', kind: 'link', ref: 'streaming' },
    },
  };
};

/** 10) Incident 증가 — today_incidents >= 1. */
const incidentUp: Rule = (x) => {
  const i = num(x.todayIncidents);
  if (i == null || i < 1) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'today_incidents', label: '오늘 Incident 수', current: i, baseline: 0, changeRate: null, period: '오늘', source: 'NOC · admin_noc_kpi', satisfied: true },
  ];
  const mag = Math.min(i / 5, 1);
  const score = priorityScore({ impact: 0.95, changeRate: mag, scope: 0.9 });
  return {
    rec: {
      ruleKey: 'incident_up', category: 'system', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: 'Incident 발생', message: 'Mission Control / 매장 조치를 검토하십시오.',
      reason: `오늘 Incident ${i}건.`, evidence: ev,
      suggestedAction: { label: 'Store Resync (Action Center)', kind: 'action', ref: 'store_resync' },
    },
  };
};

/** 11) 사업자 신규 정체 — business_total>0 & month_signups=0 (info). */
const businessStall: Rule = (x) => {
  const total = num(x.businessTotal); const m = num(x.businessMonthSignups);
  if (total == null || total <= 0 || m == null || m > 0) return { rec: null };
  const ev: Evidence[] = [
    { kpi: 'business_month_signups', label: '이번달 신규 사업자', current: m, baseline: null, changeRate: null, period: '이번달', source: 'Business · admin_business_summary', satisfied: true },
    { kpi: 'total_business', label: '전체 사업자', current: total, baseline: null, changeRate: null, period: PERIOD_NOW, source: 'Business', satisfied: total > 0 },
  ];
  const score = priorityScore({ impact: 0.3, changeRate: 0.2, scope: 0.3 });
  return {
    rec: {
      ruleKey: 'business_stall', category: 'business', priority: scoreToPriority(score), score, confidence: computeConfidence(ev),
      title: '이번달 신규 사업자 없음', message: 'Business Dashboard 에서 파이프라인을 확인하십시오.',
      reason: '이번달 신규 사업자 0명.', evidence: ev,
      suggestedAction: { label: 'Open Business Dashboard', kind: 'link', ref: 'business' },
    },
  };
};

const RULES: Rule[] = [
  revenueDrop, signupDrop, paymentFailure, qcBacklog, settlementPending,
  storeOffline, playerOffline, streamingHealth, playbackError, incidentUp, businessStall,
];

/** 실제 KPI 로 추천 생성. Evidence 없는 추천 없음. Priority Score 내림차순. */
export function generateRecommendations(x: RecommendationInputs): Recommendation[] {
  const out: Recommendation[] = [];
  for (const rule of RULES) {
    const { rec } = rule(x);
    if (rec && rec.evidence.length > 0) out.push(rec);
  }
  return out.sort((a, b) => b.score - a.score);
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const PRIORITY_ORDER: Priority[] = ['critical', 'high', 'medium', 'low', 'info'];
export const PRIORITY_LABEL: Record<Priority, string> = {
  critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info',
};
export const PRIORITY_TONE: Record<Priority, 'danger' | 'warning' | 'info' | 'neutral' | 'success'> = {
  critical: 'danger', high: 'danger', medium: 'warning', low: 'info', info: 'neutral',
};
export const CATEGORY_LABEL: Record<RecCategory, string> = {
  member: '회원', revenue: '매출', artist: '아티스트', business: '사업자',
  streaming: '스트리밍', operations: '운영', system: '시스템', automation: '자동화',
};

/** priority 오름차순 정렬 키(critical=0). */
export function priorityRank(p: Priority): number { return PRIORITY_ORDER.indexOf(p); }
