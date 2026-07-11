// WEB-OBS-9 — Incident Escalation Matrix. Maps severity × blast radius (affected stores/brands) to an
// escalation LEVEL (Store → Brand → Enterprise → Platform) and a contact ladder. Advisory routing only —
// it notifies no one automatically; it recommends who the operator should involve.

import { ESCALATION_BRAND_STORES, ESCALATION_ENTERPRISE_BRANDS, ESCALATION_PLATFORM_STORES } from './thresholds';
import type { EscalationInput, Escalation, EscalationLevel } from './types';

const LADDER: Record<EscalationLevel, string[]> = {
  STORE: ['매장 담당자 확인'],
  BRAND: ['매장 담당자', '브랜드 운영 담당'],
  ENTERPRISE: ['브랜드 운영', '엔터프라이즈 운영/NOC'],
  PLATFORM: ['엔터프라이즈 운영', '플랫폼 엔지니어링(Player/CDN/인프라)'],
};

/** Determine the escalation level. CRITICAL severity raises the floor to at least ENTERPRISE. */
export function computeEscalation(input: EscalationInput): Escalation {
  const { severity, affectedStores, affectedBrands } = input;
  let level: EscalationLevel = 'STORE';
  const reasons: string[] = [];

  if (affectedStores >= ESCALATION_PLATFORM_STORES) { level = 'PLATFORM'; reasons.push(`영향 매장 ${affectedStores} ≥ ${ESCALATION_PLATFORM_STORES}`); }
  else if (affectedBrands >= ESCALATION_ENTERPRISE_BRANDS) { level = 'ENTERPRISE'; reasons.push(`영향 브랜드 ${affectedBrands} ≥ ${ESCALATION_ENTERPRISE_BRANDS}`); }
  else if (affectedStores >= ESCALATION_BRAND_STORES) { level = 'BRAND'; reasons.push(`한 브랜드 내 영향 매장 ${affectedStores} ≥ ${ESCALATION_BRAND_STORES}`); }
  else reasons.push('국소 영향');

  // Severity floor: CRITICAL → at least ENTERPRISE, HIGH → at least BRAND.
  const order: EscalationLevel[] = ['STORE', 'BRAND', 'ENTERPRISE', 'PLATFORM'];
  const floor = severity === 'CRITICAL' ? 'ENTERPRISE' : severity === 'HIGH' ? 'BRAND' : 'STORE';
  if (order.indexOf(floor) > order.indexOf(level)) { level = floor as EscalationLevel; reasons.push(`severity ${severity} → 최소 ${floor}`); }

  return { severity, level, rationale: reasons.join(' · '), contactLadder: LADDER[level] };
}
