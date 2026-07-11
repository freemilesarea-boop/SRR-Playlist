// AI-MUSIC-4 — Experiment metric definitions + Lift. Every metric documents its numerator/denominator so
// Store count, Session count and Playback count are never confused. Pure math — read-only. Lift guards a
// zero/small denominator: no relative delta is fabricated when the denominator is absent.

import { round, safeRatio } from '../observability/math';
import { MEANINGFUL_ABS_DELTA, MEANINGFUL_REL_DELTA } from './thresholds';
import type { MetricValue, Lift } from './types';

/** Metric definition — documents exactly what divides what (no Store/Session/Playback confusion). */
export interface MetricDef { key: string; label: string; numerator: string; denominator: string; higherIsBetter: boolean; }

export const METRIC_DEFS: Record<string, MetricDef> = {
  completion_rate: { key: 'completion_rate', label: 'Completion Rate', numerator: 'play_complete events', denominator: 'playbacks', higherIsBetter: true },
  skip_rate: { key: 'skip_rate', label: 'Skip Rate', numerator: 'skip events', denominator: 'playbacks', higherIsBetter: false },
  like_ratio: { key: 'like_ratio', label: 'Like Ratio', numerator: 'like events', denominator: 'playbacks', higherIsBetter: true },
  dislike_ratio: { key: 'dislike_ratio', label: 'Dislike Ratio', numerator: 'dislike reactions', denominator: 'playbacks', higherIsBetter: false },
  adaptive_playlist_score: { key: 'adaptive_playlist_score', label: 'Adaptive Playlist Score', numerator: 'AI-MUSIC-3 adaptive score', denominator: '(index 0..100)', higherIsBetter: true },
  session_duration: { key: 'session_duration', label: 'Session Duration', numerator: 'sum listened_seconds', denominator: 'sessions', higherIsBetter: true },
  repeat_fatigue: { key: 'repeat_fatigue', label: 'Repeat Fatigue', numerator: 'over-repeat plays', denominator: 'playbacks', higherIsBetter: false },
  track_reputation: { key: 'track_reputation', label: 'Track Reputation', numerator: 'AI-MUSIC-3 mean reputation', denominator: '(index 0..100)', higherIsBetter: true },
  playlist_drift: { key: 'playlist_drift', label: 'Playlist Drift', numerator: 'TV-distance from intent', denominator: '(0..1)', higherIsBetter: false },
  diversity_score: { key: 'diversity_score', label: 'Diversity Score', numerator: 'distinct genres', denominator: 'tracks', higherIsBetter: true },
  compatibility_score: { key: 'compatibility_score', label: 'Compatibility Score', numerator: 'AI-MUSIC-1 mean compat', denominator: '(index 0..100)', higherIsBetter: true },
  playback_start_success: { key: 'playback_start_success', label: 'Playback Start Success', numerator: 'started playbacks', denominator: 'attempts', higherIsBetter: true },
  ttfa_approx: { key: 'ttfa_approx', label: 'TTFA (approx, ms)', numerator: 'approx time-to-first-audio', denominator: '(ms)', higherIsBetter: false },
  transition_gap: { key: 'transition_gap', label: 'Transition Gap (ms)', numerator: 'gap between tracks', denominator: '(ms)', higherIsBetter: false },
  stall_session_rate: { key: 'stall_session_rate', label: 'Stall Session Rate', numerator: 'sessions with a stall', denominator: 'sessions', higherIsBetter: false },
  media_error_rate: { key: 'media_error_rate', label: 'Media Error Rate', numerator: 'media errors', denominator: 'playbacks', higherIsBetter: false },
  recovery_failure_rate: { key: 'recovery_failure_rate', label: 'Recovery Failure Rate', numerator: 'failed recoveries', denominator: 'recovery attempts', higherIsBetter: false },
  streaming_quality_score: { key: 'streaming_quality_score', label: 'Streaming Quality Score', numerator: 'WEB-OBS-7 quality index', denominator: '(0..100)', higherIsBetter: true },
  critical_incident_count: { key: 'critical_incident_count', label: 'Critical Incident Count', numerator: 'critical incidents', denominator: '(count)', higherIsBetter: false },
};

/** Build a MetricValue from control/treatment values, guarding a zero/absent denominator for relative delta. */
export function metricValue(key: string, control: number | null, treatment: number | null): MetricValue {
  const absoluteDelta = control == null || treatment == null ? null : round(treatment - control, 4);
  // relative delta only when the control (denominator) is a usable non-zero baseline
  const relativeDelta = control == null || treatment == null || Math.abs(control) < 1e-9 ? null : round(safeRatio(treatment - control, Math.abs(control)), 4);
  return { metric: key, control: round(control, 4), treatment: round(treatment, 4), absoluteDelta, relativeDelta };
}

/** Directional Lift for a metric (respects higherIsBetter). No relative delta when denominator absent. */
export function computeLift(key: string, control: number | null, treatment: number | null): Lift {
  const def = METRIC_DEFS[key];
  const mv = metricValue(key, control, treatment);
  const label = def?.label ?? key;
  let note = 'directional only';
  if (mv.absoluteDelta == null) note = 'INSUFFICIENT_DATA';
  else if (mv.relativeDelta == null) note = 'relative delta 미산출 (분모 0/부재)';
  return { metric: key, label, absoluteDelta: mv.absoluteDelta, relativeDelta: mv.relativeDelta, note };
}

/** Is a metric change meaningful (both absolute + relative below floors → not meaningful)? */
export function isMeaningful(mv: MetricValue): boolean {
  const a = mv.absoluteDelta, r = mv.relativeDelta;
  if (a == null) return false;
  if (Math.abs(a) >= MEANINGFUL_ABS_DELTA) return true;
  if (r != null && Math.abs(r) >= MEANINGFUL_REL_DELTA) return true;
  return false;
}
