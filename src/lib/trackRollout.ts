/**
 * trackRollout — New Track Test Pool & Progressive Rollout 순수 로직 (Phase AI-PLAYLIST-3).
 *
 * 신규 음원을 전체 매장에 즉시 배포하지 않고 Draft → Test Pool → Pilot → Limited →
 * Expanded → Global → Archived 순으로 점진 확산한다. **자동 배포/승격/Rollback 없음** —
 * 실제 재생 이벤트 KPI 로 승격/보류/Rollback 을 "추천"만 하고 단계 변경은 수동 승인이다.
 *
 * 원칙: Evidence 없는 승격 금지 · Sample 부족 → '판단 보류(insufficient)' · 실제 KPI 만 ·
 * 점수/비율 clamp · NaN/Infinity 금지.
 */
import { clampPct } from './playlistIntel';

/* ── Stage ────────────────────────────────────────────────────────── */
export type RolloutStage = 'draft' | 'test_pool' | 'pilot' | 'limited' | 'expanded' | 'global' | 'archived';
export const STAGE_ORDER: RolloutStage[] = ['draft', 'test_pool', 'pilot', 'limited', 'expanded', 'global', 'archived'];
export const STAGE_LABEL: Record<RolloutStage, string> = {
  draft: 'Draft', test_pool: 'Test Pool', pilot: 'Pilot', limited: 'Limited', expanded: 'Expanded', global: 'Global', archived: 'Archived',
};
/** 점진 확산 비율(스테이지 대응). global=100. */
export const STAGE_PERCENT: Record<RolloutStage, number> = {
  draft: 0, test_pool: 5, pilot: 10, limited: 25, expanded: 50, global: 100, archived: 0,
};

export function stageRank(s: RolloutStage): number { return STAGE_ORDER.indexOf(s); }
/** 승격 대상 다음 단계(global 다음은 없음, archived 는 대상 아님). */
export function nextStage(s: RolloutStage): RolloutStage | null {
  if (s === 'global' || s === 'archived') return null;
  const i = STAGE_ORDER.indexOf(s);
  const next = STAGE_ORDER[i + 1];
  return next === 'archived' ? 'global' : next; // archived 는 승격이 아니라 별도 결정
}
/** Rollback 대상 이전 단계(test_pool 이하로는 내리지 않음). */
export function prevStage(s: RolloutStage): RolloutStage | null {
  const i = STAGE_ORDER.indexOf(s);
  if (i <= STAGE_ORDER.indexOf('test_pool')) return null;
  return STAGE_ORDER[i - 1];
}

/* ── Track KPI / Config ───────────────────────────────────────────── */
export interface TrackKpi {
  events: number; skips: number; skip_rate: number | null; completion_rate: number | null;
  avg_listen_seconds: number | null; likes: number; replays: number; store_coverage: number; playlist_coverage: number;
}
export interface PromotionConfig {
  completion_min: number; skip_max: number; sample_min: number;
  rollback_skip_max: number; rollback_completion_min: number;
}
export const DEFAULT_CONFIG: PromotionConfig = {
  completion_min: 70, skip_max: 10, sample_min: 30, rollback_skip_max: 25, rollback_completion_min: 50,
};

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/* ── 승격/보류/Rollback 판정 ─────────────────────────────────────────── */
export type RolloutDecision = 'promote' | 'hold' | 'rollback' | 'insufficient';
export interface RolloutEvidence { kpi: string; label: string; value: number | null; threshold: number; pass: boolean }
export interface RolloutEvaluation {
  decision: RolloutDecision; reason: string; evidence: RolloutEvidence[];
  completion: number | null; skip: number | null; sampleOk: boolean;
}

/**
 * Test Pool KPI + config → 판정. Sample<min → insufficient(판단 보류).
 * Rollback 우선(Skip 급증 또는 Completion 급감) → Rollback. 승격 기준 충족 → promote. 그 외 hold.
 */
export function evaluatePromotion(kpi: TrackKpi, config: PromotionConfig = DEFAULT_CONFIG): RolloutEvaluation {
  const completion = clampPct(kpi.completion_rate);
  const skip = clampPct(kpi.skip_rate);
  const sampleOk = kpi.events >= config.sample_min;

  if (!sampleOk) {
    return {
      decision: 'insufficient', sampleOk: false, completion, skip,
      reason: `Sample 부족(${kpi.events} < ${config.sample_min}) — 판단 보류`,
      evidence: [{ kpi: 'events', label: '재생 이벤트', value: kpi.events, threshold: config.sample_min, pass: false }],
    };
  }

  // Rollback 조건(급증/급감) 우선 검사.
  const rollbackSkip = skip != null && skip > config.rollback_skip_max;
  const rollbackCompletion = completion != null && completion < config.rollback_completion_min;
  if (rollbackSkip || rollbackCompletion) {
    return {
      decision: 'rollback', sampleOk: true, completion, skip,
      reason: rollbackSkip ? `Skip율 급증(${skip}% > ${config.rollback_skip_max}%)` : `완주율 급감(${completion}% < ${config.rollback_completion_min}%)`,
      evidence: [
        { kpi: 'skip_rate', label: 'Skip율(Rollback 기준)', value: skip, threshold: config.rollback_skip_max, pass: !rollbackSkip },
        { kpi: 'completion_rate', label: '완주율(Rollback 기준)', value: completion, threshold: config.rollback_completion_min, pass: !rollbackCompletion },
      ],
    };
  }

  // 승격 조건.
  const completionPass = completion != null && completion >= config.completion_min;
  const skipPass = skip != null && skip <= config.skip_max;
  const evidence: RolloutEvidence[] = [
    { kpi: 'completion_rate', label: '완주율', value: completion, threshold: config.completion_min, pass: completionPass },
    { kpi: 'skip_rate', label: 'Skip율', value: skip, threshold: config.skip_max, pass: skipPass },
    { kpi: 'events', label: '샘플(이벤트)', value: kpi.events, threshold: config.sample_min, pass: true },
  ];
  if (completionPass && skipPass) {
    return { decision: 'promote', sampleOk: true, completion, skip, reason: `승격 기준 충족 (완주 ${completion}%≥${config.completion_min}, Skip ${skip}%≤${config.skip_max})`, evidence };
  }
  return {
    decision: 'hold', sampleOk: true, completion, skip,
    reason: `승격 기준 미충족(${!completionPass ? '완주율' : ''}${!completionPass && !skipPass ? '·' : ''}${!skipPass ? 'Skip율' : ''}) — 보류`,
    evidence,
  };
}

/** 승격 추천 시 다음 확산 비율. */
export function suggestNextPercent(stage: RolloutStage): number | null {
  const ns = nextStage(stage);
  return ns ? STAGE_PERCENT[ns] : null;
}

/* ── Learning 집계(참고용; 자동 Rule 변경 없음) ───────────────────────── */
export interface RolloutHistoryLike { decision: string }
export interface RolloutLearning { promote: number; hold: number; rollback: number; total: number; promoteRate: number | null; rollbackRate: number | null }
export function aggregateRolloutLearning(history: RolloutHistoryLike[]): RolloutLearning {
  let promote = 0, hold = 0, rollback = 0;
  for (const h of history) {
    if (h.decision === 'promote') promote += 1;
    else if (h.decision === 'hold') hold += 1;
    else if (h.decision === 'rollback') rollback += 1;
  }
  const decided = promote + rollback; // 승격 성공률 = promote / (promote+rollback)
  const total = promote + hold + rollback;
  return {
    promote, hold, rollback, total,
    promoteRate: decided > 0 ? Math.round((promote / decided) * 1000) / 10 : null,
    rollbackRate: total > 0 ? Math.round((rollback / total) * 1000) / 10 : null,
  };
}

/** KPI null-safe 정규화(음수·NaN 제거). */
export function normalizeKpi(raw: Partial<TrackKpi> | null | undefined): TrackKpi {
  const n = (v: unknown) => (isNum(v) && v >= 0 ? v : 0);
  return {
    events: n(raw?.events), skips: n(raw?.skips),
    skip_rate: clampPct(raw?.skip_rate ?? null), completion_rate: clampPct(raw?.completion_rate ?? null),
    avg_listen_seconds: isNum(raw?.avg_listen_seconds) ? raw!.avg_listen_seconds : null,
    likes: n(raw?.likes), replays: n(raw?.replays), store_coverage: n(raw?.store_coverage), playlist_coverage: n(raw?.playlist_coverage),
  };
}

/* ── 표시 헬퍼 ────────────────────────────────────────────────────── */
export const DECISION_LABEL: Record<RolloutDecision, string> = {
  promote: '승격 추천', hold: '보류', rollback: 'Rollback 추천', insufficient: '판단 보류',
};
export const DECISION_TONE: Record<RolloutDecision, 'success' | 'warning' | 'danger' | 'neutral'> = {
  promote: 'success', hold: 'warning', rollback: 'danger', insufficient: 'neutral',
};
export const STAGE_TONE: Record<RolloutStage, 'neutral' | 'info' | 'success' | 'warning'> = {
  draft: 'neutral', test_pool: 'info', pilot: 'info', limited: 'info', expanded: 'success', global: 'success', archived: 'warning',
};
