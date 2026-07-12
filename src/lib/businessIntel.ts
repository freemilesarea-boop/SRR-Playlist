/**
 * businessIntel — Business Intelligence 순수 로직 (Health/온라인율/지원매트릭스/정합성).
 *
 * DB(0476 RPC)는 raw count + Health 컴포넌트(available 신호) 만 반환하고, 여기서
 * Health(0~100)·비율·정합성을 계산한다(단위 테스트 대상). NaN/Infinity 금지.
 * 퍼널 전환/단조는 memberFunnel.computeFunnel 재사용.
 */
import type { BusinessSummary, BusinessHealth, HealthComponent } from './adminApi';

export function formatKRW(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '₩0';
  return `₩${Math.round(n).toLocaleString('ko-KR')}`;
}

export function pct(numerator: number, denominator: number): number | null {
  if (!denominator || denominator <= 0) return null;
  const r = (numerator / denominator) * 100;
  if (!Number.isFinite(r)) return null;
  return Math.min(100, Math.max(0, Math.round(r * 10) / 10));
}

export function formatPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
}

/** Player 온라인율. */
export function onlineRate(s: BusinessSummary): number | null {
  return pct(s.online_players, s.total_players);
}

export type HealthLevel = 'healthy' | 'warning' | 'danger' | 'unknown';

export interface HealthResult {
  score: number | null;    // available 컴포넌트만 평균 (0~100), 없으면 null
  level: HealthLevel;
  usedCount: number;       // 계산에 쓰인 컴포넌트 수
  excludedCount: number;   // 데이터 없어 제외된 신호 수
}

/**
 * Business Health = available=true 컴포넌트 점수의 단순 평균 (0~100).
 * 없는 신호는 계산에서 제외(추정 금지). 80+ 정상 · 50~80 주의 · <50 위험.
 * available 컴포넌트가 하나도 없으면 unknown(null).
 */
export function computeHealth(h: BusinessHealth): HealthResult {
  const usable = h.components.filter((c) => c.available && c.score != null);
  const excludedCount = (h.excluded?.length ?? 0) + h.components.filter((c) => !c.available || c.score == null).length;
  if (usable.length === 0) {
    return { score: null, level: 'unknown', usedCount: 0, excludedCount };
  }
  const avg = usable.reduce((s, c) => s + (c.score as number), 0) / usable.length;
  const score = Math.round(Math.min(100, Math.max(0, avg)) * 10) / 10;
  const level: HealthLevel = score >= 80 ? 'healthy' : score >= 50 ? 'warning' : 'danger';
  return { score, level, usedCount: usable.length, excludedCount };
}

export const HEALTH_LEVEL_LABEL: Record<HealthLevel, string> = {
  healthy: '정상', warning: '주의', danger: '위험', unknown: '데이터 없음',
};
export const HEALTH_LEVEL_TONE: Record<HealthLevel, 'success' | 'warning' | 'danger' | 'neutral'> = {
  healthy: 'success', warning: 'warning', danger: 'danger', unknown: 'neutral',
};

/** 정합성 경고 — 온라인 ≤ 총 Player, 활성 ≤ 총 사업자 등. */
export function businessIntegrityWarnings(s: BusinessSummary): string[] {
  const w: string[] = [];
  if (s.online_players > s.total_players) w.push(`온라인 Player ${s.online_players} > 총 Player ${s.total_players}`);
  if (s.active_business > s.total_business) w.push(`활성 사업자 ${s.active_business} > 총 사업자 ${s.total_business}`);
  if (s.active_brands > s.total_brands) w.push(`활성 브랜드 ${s.active_brands} > 총 브랜드 ${s.total_brands}`);
  if (s.online_players + s.offline_players !== s.total_players) {
    w.push(`온라인 ${s.online_players} + 오프라인 ${s.offline_players} ≠ 총 Player ${s.total_players}`);
  }
  return w;
}

export const BUSINESS_SUPPORT_LABELS: Record<string, string> = {
  player_recovery: 'Player Recovery', heartbeat_history: 'Heartbeat History', store_health: 'Store Health',
  streaming_quality: 'Streaming Quality', playback_error: 'Playback Error', queue_delay: 'Queue Delay',
  crossfade: 'Crossfade', business_ai_score: 'Business AI Score', region: '지역별', country: '국가별',
};

export function businessSupportMatrix(support: Record<string, boolean> | undefined): Array<{ key: string; label: string; supported: boolean }> {
  const s = support ?? {};
  return Object.keys(BUSINESS_SUPPORT_LABELS).map((key) => ({
    key, label: BUSINESS_SUPPORT_LABELS[key], supported: s[key] === true,
  }));
}

/** Health 컴포넌트 표시용 정렬(available 먼저, 점수 낮은 순). */
export function sortedHealthComponents(components: HealthComponent[]): HealthComponent[] {
  return [...components].sort((a, b) => {
    if (a.available !== b.available) return a.available ? -1 : 1;
    return (a.score ?? 999) - (b.score ?? 999);
  });
}
