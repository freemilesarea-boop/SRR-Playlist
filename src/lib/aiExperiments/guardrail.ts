// AI-MUSIC-4 — Guardrail Evaluation. Even a good primary metric cannot justify expansion if streaming
// quality / TTFA / stall / media error / recovery / incidents regress. Each guardrail is evaluated ONLY when
// its metric is available (no prod source → NOT_AVAILABLE, never a fabricated pass). Thresholds are constants.

import type { GuardrailStatus, GuardrailCheck, GuardrailEvaluation } from './types';
import { GUARDRAIL } from './thresholds';

export interface GuardrailInput {
  streamingQuality?: { control: number | null; treatment: number | null };   // higher better
  ttfaMs?: { control: number | null; treatment: number | null };            // lower better
  stallRate?: { control: number | null; treatment: number | null };         // lower better
  mediaErrorRate?: { control: number | null; treatment: number | null };
  recoveryFailRate?: { control: number | null; treatment: number | null };
  criticalIncidents?: number | null;   // in treatment arm
}

function pair(control: number | null | undefined, treatment: number | null | undefined): { c: number | null; t: number | null } {
  return { c: control ?? null, t: treatment ?? null };
}

/** Higher-is-better guardrail: FAIL when treatment drops by ≥ failDrop, WARNING at warnDrop. */
function higherBetter(key: string, label: string, control: number | null, treatment: number | null, warnDrop: number, failDrop: number): GuardrailCheck {
  if (control == null || treatment == null) return { key, label, control, treatment, status: 'NOT_AVAILABLE', note: 'source 미적용/데이터 없음' };
  const drop = control - treatment;
  const status: GuardrailStatus = drop >= failDrop ? 'FAIL' : drop >= warnDrop ? 'WARNING' : 'PASS';
  return { key, label, control, treatment, status, note: status === 'PASS' ? '정상' : `treatment 하락 ${drop.toFixed(2)}` };
}
/** Lower-is-better guardrail: FAIL when treatment rises by ≥ failInc, WARNING at warnInc. */
function lowerBetter(key: string, label: string, control: number | null, treatment: number | null, warnInc: number, failInc: number): GuardrailCheck {
  if (control == null || treatment == null) return { key, label, control, treatment, status: 'NOT_AVAILABLE', note: 'source 미적용/데이터 없음' };
  const inc = treatment - control;
  const status: GuardrailStatus = inc >= failInc ? 'FAIL' : inc >= warnInc ? 'WARNING' : 'PASS';
  return { key, label, control, treatment, status, note: status === 'PASS' ? '정상' : `treatment 악화 +${inc.toFixed(3)}` };
}

export function evaluateGuardrails(input: GuardrailInput): GuardrailEvaluation {
  const checks: GuardrailCheck[] = [];
  const sq = pair(input.streamingQuality?.control, input.streamingQuality?.treatment);
  checks.push(higherBetter('streaming_quality_score', 'Streaming Quality', sq.c, sq.t, GUARDRAIL.streamingQualityDropWarn, GUARDRAIL.streamingQualityDropFail));
  const tt = pair(input.ttfaMs?.control, input.ttfaMs?.treatment);
  checks.push(lowerBetter('ttfa_approx', 'TTFA (approx)', tt.c, tt.t, GUARDRAIL.ttfaRegressWarnMs, GUARDRAIL.ttfaRegressFailMs));
  const st = pair(input.stallRate?.control, input.stallRate?.treatment);
  checks.push(lowerBetter('stall_session_rate', 'Stall Session Rate', st.c, st.t, GUARDRAIL.stallRateIncreaseWarn, GUARDRAIL.stallRateIncreaseFail));
  const me = pair(input.mediaErrorRate?.control, input.mediaErrorRate?.treatment);
  checks.push(lowerBetter('media_error_rate', 'Media Error Rate', me.c, me.t, GUARDRAIL.mediaErrorIncreaseWarn, GUARDRAIL.mediaErrorIncreaseFail));
  const rf = pair(input.recoveryFailRate?.control, input.recoveryFailRate?.treatment);
  checks.push(lowerBetter('recovery_failure_rate', 'Recovery Failure Rate', rf.c, rf.t, GUARDRAIL.recoveryFailIncreaseWarn, GUARDRAIL.recoveryFailIncreaseFail));
  // critical incident: any in treatment → FAIL
  if (input.criticalIncidents == null) checks.push({ key: 'critical_incident_count', label: 'Critical Incident', control: null, treatment: null, status: 'NOT_AVAILABLE', note: 'source 미적용' });
  else checks.push({ key: 'critical_incident_count', label: 'Critical Incident', control: 0, treatment: input.criticalIncidents, status: input.criticalIncidents >= GUARDRAIL.criticalIncidentFail ? 'FAIL' : 'PASS', note: input.criticalIncidents >= 1 ? 'treatment 심각 인시던트' : '정상' });

  const failed = checks.filter((c) => c.status === 'FAIL').map((c) => c.key);
  const warned = checks.filter((c) => c.status === 'WARNING').map((c) => c.key);
  const available = checks.filter((c) => c.status !== 'NOT_AVAILABLE');
  const notes: string[] = [];
  if (available.length === 0) notes.push('가드레일 소스 전부 NOT_AVAILABLE — 확장 판단 보류');

  let status: GuardrailStatus;
  if (available.length === 0) status = 'NOT_AVAILABLE';
  else if (failed.length > 0) status = 'FAIL';
  else if (warned.length > 0) status = 'WARNING';
  else status = 'PASS';

  return { status, checks, failed, warned, notes };
}
