// AI-MUSIC-4 — Control / Treatment Design. Produces a *recommended* split (never an assignment) balancing
// Store count, Session/Playback volume, industry mix, and baseline skip/completion. Control = keep existing
// playlist; Treatment = candidate preview only. Flags same-enterprise spillover + duplicate-store
// contamination risk. Read-only, requiresApproval.

import { clamp, round, safeRatio } from '../observability/math';
import {
  GROUP_MIN_STORES_PER_ARM, GROUP_SESSION_IMBALANCE_ACCEPTABLE, GROUP_SESSION_IMBALANCE_BALANCED, GROUP_BASELINE_SKEW_MAX,
} from './thresholds';
import type { StoreExperimentSignal, ControlTreatmentDesign, GroupBalance, GroupMember, GroupStats } from './types';

function toMember(s: StoreExperimentSignal): GroupMember {
  return { storeId: s.storeId, storeName: s.storeName, industry: s.industry, browser: s.browser, device: s.device, sessions: s.sessions, playbacks: s.playbacks, baselineSkipRate: s.skipRate, baselineCompletionRate: s.completionRate };
}
function statsOf(members: GroupMember[]): GroupStats {
  const industries: Record<string, number> = {};
  for (const m of members) { if (m.industry) industries[m.industry] = (industries[m.industry] ?? 0) + 1; }
  const skips = members.map((m) => m.baselineSkipRate).filter((v): v is number => v != null);
  const comps = members.map((m) => m.baselineCompletionRate).filter((v): v is number => v != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    stores: members.length, sessions: members.reduce((n, m) => n + m.sessions, 0), playbacks: members.reduce((n, m) => n + m.playbacks, 0),
    meanSkipRate: round(mean(skips), 3), meanCompletionRate: round(mean(comps), 3), industries,
  };
}

/**
 * Snake-draft the stores (sorted by sessions desc) into control/treatment to balance session volume, then
 * measure balance + contamination risk. Assignment is a RECOMMENDATION only.
 */
export function designGroups(stores: StoreExperimentSignal[]): ControlTreatmentDesign {
  const reasons: string[] = [];
  const contaminationRisk: string[] = [];
  const base = { balanceScore: null as number | null, contaminationRisk, reasons, requiresApproval: true as const, automated: false as const };

  // duplicate-store detection (a store must not appear twice)
  const seen = new Set<string>();
  const uniq = stores.filter((s) => { if (seen.has(s.storeId)) { contaminationRisk.push(`중복 Store ${s.storeId.slice(0, 8)}`); return false; } seen.add(s.storeId); return true; });

  if (uniq.length < GROUP_MIN_STORES_PER_ARM * 2) {
    return {
      ...base, status: 'INSUFFICIENT_DATA',
      control: { members: [], stats: statsOf([]), note: 'Control = 기존 Playlist 유지' },
      treatment: { members: [], stats: statsOf([]), note: 'Treatment = Candidate Preview' },
      reasons: [`Store 부족: ${uniq.length} < ${GROUP_MIN_STORES_PER_ARM * 2}`],
    };
  }

  const sorted = [...uniq].sort((a, b) => b.sessions - a.sessions);
  const control: GroupMember[] = [], treatment: GroupMember[] = [];
  let cSess = 0, tSess = 0;
  for (const s of sorted) {
    // assign to the lighter arm by session volume (balances Session, not just Store count)
    if (cSess <= tSess) { control.push(toMember(s)); cSess += s.sessions; } else { treatment.push(toMember(s)); tSess += s.sessions; }
  }

  // same-enterprise spillover risk (a franchise present in both arms)
  const cEnt = new Set(sorted.filter((s) => control.some((m) => m.storeId === s.storeId)).map((s) => s.enterpriseId).filter(Boolean));
  const tEnt = new Set(sorted.filter((s) => treatment.some((m) => m.storeId === s.storeId)).map((s) => s.enterpriseId).filter(Boolean));
  for (const e of cEnt) { if (e && tEnt.has(e)) contaminationRisk.push(`동일 Enterprise 양쪽 포함 (spillover): ${String(e).slice(0, 8)}`); }

  const cStats = statsOf(control), tStats = statsOf(treatment);
  const sessionImbalance = safeRatio(Math.abs(cStats.sessions - tStats.sessions), Math.max(cStats.sessions, tStats.sessions, 1));
  const skewSkip = cStats.meanSkipRate != null && tStats.meanSkipRate != null ? Math.abs(cStats.meanSkipRate - tStats.meanSkipRate) : 0;
  const skewComp = cStats.meanCompletionRate != null && tStats.meanCompletionRate != null ? Math.abs(cStats.meanCompletionRate - tStats.meanCompletionRate) : 0;
  const balanceScore = round(clamp(1 - (sessionImbalance * 0.5 + skewSkip * 1.5 + skewComp * 1.5), 0, 1), 3);

  let status: GroupBalance;
  if (control.length < GROUP_MIN_STORES_PER_ARM || treatment.length < GROUP_MIN_STORES_PER_ARM) status = 'INSUFFICIENT_DATA';
  else if (contaminationRisk.length > 0) status = 'CONTAMINATION_RISK';
  else if (skewSkip > GROUP_BASELINE_SKEW_MAX || skewComp > GROUP_BASELINE_SKEW_MAX || sessionImbalance > GROUP_SESSION_IMBALANCE_ACCEPTABLE) status = 'IMBALANCED';
  else if (sessionImbalance <= GROUP_SESSION_IMBALANCE_BALANCED) status = 'BALANCED';
  else status = 'ACCEPTABLE';

  reasons.push(`Session 불균형 ${(sessionImbalance * 100).toFixed(0)}% · baseline skip gap ${(skewSkip * 100).toFixed(1)}%`);
  if (status === 'IMBALANCED') reasons.push('그룹 재배분 권고 (Session/baseline 편중)');

  return {
    ...base, status, balanceScore,
    control: { members: control, stats: cStats, note: 'Control = 기존 Playlist 유지 (Preview 없음)' },
    treatment: { members: treatment, stats: tStats, note: 'Treatment = Candidate Preview only (실배포 없음)' },
  };
}
