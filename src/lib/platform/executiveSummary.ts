// WEB-OPS-10 — Executive Summary. Rule-based (NOT AI) weekly narrative bullets derived from the platform
// score, readiness, incidents and recovery. Read-only summary — no action, no recommendation execution.

import { EXEC_STABLE_SCORE, EXEC_RECOVERY_EXCELLENT, PLATFORM_MIN_SESSIONS } from './thresholds';
import type { ExecutiveSummary, SummaryLine } from './types';

export interface ExecSummaryInput {
  window: string;
  platformScore: number | null;
  sessions: number;
  hasBlockingRelease: boolean;
  criticalIncidents: number;
  highIncidents: number;
  mediumIncidents: number;
  recoveryRate: number | null;
}

/** Build the rule-based executive summary bullets. */
export function buildExecutiveSummary(input: ExecSummaryInput): ExecutiveSummary {
  const lines: SummaryLine[] = [];
  const dataSufficient = input.sessions >= PLATFORM_MIN_SESSIONS && input.platformScore != null;

  if (!dataSufficient) {
    return { window: input.window, dataSufficient: false, headline: 'INSUFFICIENT_DATA — 표본 부족', lines: [{ tone: 'info', text: `표본 부족 (sessions ${input.sessions}) — 주간 요약 보류` }] };
  }

  const stable = (input.platformScore as number) >= EXEC_STABLE_SCORE;
  lines.push({ tone: stable ? 'good' : 'watch', text: stable ? 'Platform Stable — 플랫폼 안정' : `Platform Watch — 점수 ${input.platformScore}` });
  lines.push(input.hasBlockingRelease
    ? { tone: 'bad', text: 'Release Risk — 승격 보류 권고 릴리스 존재(자동 차단 아님)' }
    : { tone: 'good', text: 'Release Safe — 차단 권고 릴리스 없음' });
  lines.push(input.criticalIncidents === 0
    ? { tone: 'good', text: 'No Critical Regression — 치명적 회귀 없음' }
    : { tone: 'bad', text: `${input.criticalIncidents} Critical Incident` });
  if (input.highIncidents > 0) lines.push({ tone: 'watch', text: `${input.highIncidents} High Incident` });
  if (input.mediumIncidents > 0) lines.push({ tone: 'watch', text: `${input.mediumIncidents} Medium Incident` });
  if (input.recoveryRate != null) {
    lines.push(input.recoveryRate >= EXEC_RECOVERY_EXCELLENT
      ? { tone: 'good', text: 'Recovery Excellent — 복구 우수' }
      : { tone: 'watch', text: `Recovery ${(input.recoveryRate * 100).toFixed(0)}%` });
  }

  const headline = input.criticalIncidents > 0 ? '주의 필요 — Critical Incident' : stable ? '이번 주 Platform Stable' : '이번 주 관찰 필요';
  return { window: input.window, dataSufficient: true, headline, lines };
}
