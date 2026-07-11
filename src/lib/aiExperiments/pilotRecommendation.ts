// AI-MUSIC-4 — Pilot Store Recommendation. Recommends (never assigns) a diverse set of eligible stores for a
// pilot, maximizing industry / browser / device diversity and playback/session spread. Read-only. If no
// eligible store exists → INSUFFICIENT_DATA (never invents a store id).

import { clamp, round } from '../observability/math';
import { PILOT_TARGET_STORES_DEFAULT, PILOT_MIN_ELIGIBLE_STORES, PILOT_DIVERSITY_MIN_INDUSTRIES } from './thresholds';
import { computeEligibility } from './eligibility';
import type { StoreExperimentSignal, PilotRecommendation, PilotStorePick, PilotExclusion } from './types';

function distinct<T>(xs: Array<T | null>): number { return new Set(xs.filter((x): x is T => x != null)).size; }

/** Greedy diversity pick: prefer stores that add a new industry/browser/device, then higher sessions. */
export function recommendPilotStores(signals: StoreExperimentSignal[], targetStores = PILOT_TARGET_STORES_DEFAULT): PilotRecommendation {
  const evaluated = signals.map((s) => ({ s, e: computeEligibility(s) }));
  const eligible = evaluated.filter((x) => x.e.status === 'ELIGIBLE');
  const excludedStores: PilotExclusion[] = evaluated
    .filter((x) => x.e.status !== 'ELIGIBLE')
    .map((x) => ({ storeId: x.s.storeId, storeName: x.s.storeName, reason: `${x.e.status}: ${[...x.e.blockingReasons, ...x.e.reasons][0] ?? '—'}` }));

  const base = { excludedStores, requiresApproval: true as const, automated: false as const };

  if (eligible.length < PILOT_MIN_ELIGIBLE_STORES) {
    return {
      ...base, status: 'INSUFFICIENT_DATA', recommendedStores: [],
      diversityCoverage: { industries: 0, browsers: 0, devices: 0, note: `eligible ${eligible.length} < ${PILOT_MIN_ELIGIBLE_STORES}` },
      expectedSample: { stores: 0, sessions: 0, playbacks: 0 }, risk: 'NOT_AVAILABLE', confidence: null,
    };
  }

  const pool = [...eligible].sort((a, b) => b.s.sessions - a.s.sessions);
  const picked: typeof pool = [];
  const seenIndustry = new Set<string>(), seenBrowser = new Set<string>(), seenDevice = new Set<string>();
  // pass 1: diversity-first
  for (const x of pool) {
    if (picked.length >= targetStores) break;
    const novel = (x.s.industry && !seenIndustry.has(x.s.industry)) || (x.s.browser && !seenBrowser.has(x.s.browser)) || (x.s.device && !seenDevice.has(x.s.device));
    if (novel || picked.length < 2) {
      picked.push(x); if (x.s.industry) seenIndustry.add(x.s.industry); if (x.s.browser) seenBrowser.add(x.s.browser); if (x.s.device) seenDevice.add(x.s.device);
    }
  }
  // pass 2: fill by session volume
  for (const x of pool) { if (picked.length >= targetStores) break; if (!picked.includes(x)) picked.push(x); }

  const recommendedStores: PilotStorePick[] = picked.map((x) => ({
    storeId: x.s.storeId, storeName: x.s.storeName, industry: x.s.industry, browser: x.s.browser, device: x.s.device,
    expectedSessions: x.s.sessions, reason: `eligible · sessions ${x.s.sessions} · ${x.s.industry ?? '?'}/${x.s.browser ?? '?'}/${x.s.device ?? '?'}`,
  }));

  const industries = distinct(picked.map((x) => x.s.industry));
  const browsers = distinct(picked.map((x) => x.s.browser));
  const devices = distinct(picked.map((x) => x.s.device));
  const expectedSample = {
    stores: picked.length,
    sessions: picked.reduce((n, x) => n + x.s.sessions, 0),
    playbacks: picked.reduce((n, x) => n + x.s.playbacks, 0),
  };
  const diversityOk = industries >= PILOT_DIVERSITY_MIN_INDUSTRIES;
  const risk = !diversityOk ? 'HIGH' : industries >= 3 && browsers >= 2 ? 'LOW' : 'MEDIUM';
  const confidence = round(clamp((Math.min(picked.length / targetStores, 1) * 60) + (diversityOk ? 30 : 0), 0, 90), 1);

  return {
    ...base, status: 'READY', recommendedStores,
    diversityCoverage: { industries, browsers, devices, note: diversityOk ? '업종 다양성 충족' : `업종 다양성 부족 (${industries} < ${PILOT_DIVERSITY_MIN_INDUSTRIES})` },
    expectedSample, risk, confidence,
  };
}
