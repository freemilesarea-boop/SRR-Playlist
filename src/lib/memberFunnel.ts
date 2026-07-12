/**
 * memberFunnel — 회원 전환 퍼널 순수 로직 (전환율/이탈률/단조성/증감/색상).
 *
 * DB(0473 RPC)는 각 step 의 raw count + supported flag 만 반환하고, 여기서
 * 전환율·이탈률·최종 전환율·단조성 검증·색상·증감을 계산한다(단위 테스트 대상).
 * 전환율은 0~100 clamp, NaN/Infinity 금지.
 */
import type { FunnelStep, FunnelHistoryStep, MemberFunnel } from './adminApi';

export interface ComputedStep extends FunnelStep {
  /** 직전 "supported" step 대비 전환율(%) — 첫 step 또는 미지원이면 null */
  convFromPrev: number | null;
  /** 직전 대비 이탈률(%) = 100 - convFromPrev */
  dropFromPrev: number | null;
  /** 직전 대비 이탈 인원 */
  dropCount: number | null;
  /** 색상 톤 (전환율 기준) */
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  /** count > prev (비단조) 여부 — 데이터 정합성 경고용 */
  nonMonotonic: boolean;
}

/** 안전 나눗셈 → 0~100 clamp, 유한수만. 분모 0 이면 null. */
export function safeRate(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  const r = (numerator / denominator) * 100;
  if (!Number.isFinite(r)) return null;
  return Math.min(100, Math.max(0, Math.round(r * 10) / 10));
}

/** 전환율 → 색상 톤. 90%+ 초록 · 70~90 노랑 · 70 미만 빨강 · null 중립. */
export function funnelTone(conv: number | null): ComputedStep['tone'] {
  if (conv == null) return 'neutral';
  if (conv >= 90) return 'success';
  if (conv >= 70) return 'warning';
  return 'danger';
}

/**
 * 퍼널 step 배열 → 전환율/이탈률/색상/단조성 계산.
 * 전환/이탈은 "직전 supported step" 대비. 미지원 step 은 통과(전환 계산 제외).
 */
export function computeFunnel(steps: FunnelStep[]): ComputedStep[] {
  let prevCount: number | null = null;
  return steps.map((s, i) => {
    const supported = s.supported && s.count != null;
    if (!supported) {
      return { ...s, convFromPrev: null, dropFromPrev: null, dropCount: null, tone: 'neutral', nonMonotonic: false };
    }
    const count = s.count as number;
    const isFirst = i === 0 || prevCount == null;
    const conv = isFirst ? null : safeRate(count, prevCount as number);
    const drop = conv == null ? null : Math.round((100 - conv) * 10) / 10;
    const dropCount = prevCount == null ? null : Math.max(0, (prevCount as number) - count);
    const nonMonotonic = prevCount != null && count > (prevCount as number);
    prevCount = count;
    return {
      ...s, convFromPrev: conv, dropFromPrev: drop, dropCount,
      tone: isFirst ? 'neutral' : funnelTone(conv), nonMonotonic,
    };
  });
}

/** 최종 전환율 = 마지막 supported step / 첫 supported step. */
export function finalConversion(steps: FunnelStep[]): number | null {
  const supported = steps.filter((s) => s.supported && s.count != null);
  if (supported.length < 2) return null;
  const first = supported[0].count as number;
  const last = supported[supported.length - 1].count as number;
  return safeRate(last, first);
}

export interface DropRank {
  key: string;
  label: string;
  dropCount: number;
  dropRate: number; // %
}

/** 이탈 인원/이탈률 TOP-N (직전 supported 대비). 이탈률 높은 순. */
export function topDropSteps(steps: FunnelStep[], n = 5): DropRank[] {
  const computed = computeFunnel(steps);
  return computed
    .filter((s) => s.dropCount != null && s.dropCount > 0 && s.dropFromPrev != null)
    .map((s) => ({ key: s.key, label: s.label, dropCount: s.dropCount as number, dropRate: s.dropFromPrev as number }))
    .sort((a, b) => b.dropRate - a.dropRate || b.dropCount - a.dropCount)
    .slice(0, n);
}

/** 비단조(정합성 위반) step 경고 메시지 목록. */
export function monotonicWarnings(steps: FunnelStep[]): string[] {
  const computed = computeFunnel(steps);
  const out: string[] = [];
  for (const s of computed) {
    if (s.nonMonotonic) out.push(`${s.label}(${s.count}) > 직전 단계 — 앞 단계보다 클 수 없음`);
  }
  return out;
}

export interface HistoryDelta {
  key: string;
  label: string;
  thisConv: number | null;   // 이번달 코호트: step/가입 전환율
  prevConv: number | null;   // 지난달 코호트
  deltaPct: number | null;   // thisConv - prevConv (포인트)
}

/**
 * 이번달 vs 지난달 코호트의 step 별 전환율(가입 대비) + 증감(pp).
 * 첫 step(가입)은 기준(100%)이므로 delta 계산에서 전환율은 100 고정.
 */
export function computeHistoryDeltas(steps: FunnelHistoryStep[]): HistoryDelta[] {
  if (steps.length === 0) return [];
  const thisBase = steps[0].this;
  const prevBase = steps[0].prev;
  return steps.map((s) => {
    const thisConv = safeRate(s.this, thisBase);
    const prevConv = safeRate(s.prev, prevBase);
    const deltaPct = thisConv != null && prevConv != null
      ? Math.round((thisConv - prevConv) * 10) / 10
      : null;
    return { key: s.key, label: s.label, thisConv, prevConv, deltaPct };
  });
}

/** 증감 표시 문자열 (+12.0% / -3.0% / —). */
export function formatDelta(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return '—';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${delta.toFixed(1)}pp`;
}

/** supported step 수 / 전체 step 수 요약 (미지원 안내용). */
export function funnelSupportSummary(funnel: MemberFunnel): { supported: number; total: number; unsupported: string[] } {
  const unsupported = funnel.steps.filter((s) => !s.supported).map((s) => s.label);
  return { supported: funnel.steps.length - unsupported.length, total: funnel.steps.length, unsupported };
}
