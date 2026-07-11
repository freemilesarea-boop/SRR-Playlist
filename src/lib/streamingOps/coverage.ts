// WEB-OBS-8 — Signal coverage. How much of each quality signal was actually OBSERVED for a scope.
// Low coverage down-weights confidence in that signal's verdict — it is reported, never hidden. A signal
// that is structurally NOT_AVAILABLE (crossfade/preload in business mode) is coverage 0 with NONE level,
// not "bad" — the dashboard renders it as unobservable, not as a failure.

import { round } from '../observability/math';
import type { QualityAggregate } from '../streamingQuality/types';
import { COVERAGE_GOOD, COVERAGE_FAIR } from './thresholds';
import type { CoverageReport, SignalCoverage, CoverageLevel } from './types';

function level(ratio: number | null): CoverageLevel {
  if (ratio == null) return 'NONE';
  if (ratio >= COVERAGE_GOOD) return 'GOOD';
  if (ratio >= COVERAGE_FAIR) return 'FAIR';
  if (ratio <= 0) return 'NONE';
  return 'LOW';
}

/**
 * Coverage per signal for a scope's aggregate. "expected" is the natural denominator for that signal
 * (sessions, or crossfade-started, etc.); "observed" is what we actually have. ratio null → not observable.
 */
export function computeSignalCoverage(agg: QualityAggregate): CoverageReport {
  const sessions = agg.sessions;
  const ratio = (obs: number, exp: number): number | null => (exp <= 0 ? null : Math.min(1, obs / exp));

  const ttfaR = ratio(agg.ttfa.samples, agg.startSuccess || sessions);
  const crossExp = agg.crossfadeStarted;
  const crossR = agg.crossfadeApplicable ? ratio(agg.crossfadeCompleted + agg.crossfadeFallback + agg.crossfadeAborted, crossExp || 1) : null;
  const preloadExp = agg.preloadReady + agg.preloadFailed;
  const preloadR = preloadExp > 0 ? 1 : null; // preload observed only when at least one preload event exists
  const recoveryR = agg.recoveryAttempted > 0 ? ratio(agg.recoverySucceeded + agg.recoveryFailed, agg.recoveryAttempted) : null;
  const mediaR = sessions > 0 ? 1 : null; // media errors are always observable when there are sessions
  const continuityR = agg.continuityTransitions > 0 ? ratio(agg.stableSessions, sessions || 1) : null;

  const signals: SignalCoverage[] = [
    { signal: 'ttfa', label: 'TTFA_APPROX', observed: agg.ttfa.samples, expected: agg.startSuccess || sessions, ratio: round(ttfaR, 3), level: level(ttfaR) },
    { signal: 'crossfade', label: 'Crossfade', observed: agg.crossfadeStarted, expected: crossExp, ratio: round(crossR, 3), level: level(crossR) },
    { signal: 'preload', label: 'Preload', observed: preloadExp, expected: preloadExp, ratio: round(preloadR, 3), level: level(preloadR) },
    { signal: 'recovery', label: 'Recovery', observed: agg.recoverySucceeded + agg.recoveryFailed, expected: agg.recoveryAttempted, ratio: round(recoveryR, 3), level: level(recoveryR) },
    { signal: 'media', label: 'Media', observed: agg.mediaErrorSessions, expected: sessions, ratio: round(mediaR, 3), level: level(mediaR) },
    { signal: 'continuity', label: 'Continuity', observed: agg.stableSessions, expected: sessions, ratio: round(continuityR, 3), level: level(continuityR) },
  ];
  const observable = signals.filter((s) => s.ratio != null);
  const overall = observable.length > 0 ? observable.reduce((s, x) => s + (x.ratio as number), 0) / observable.length : null;
  return { scope: agg.scope, signals, overall: round(overall, 3) };
}
