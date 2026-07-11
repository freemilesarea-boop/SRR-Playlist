// WEB-OBS-8 — Browser / Device / OS quality matrix. Compares per-dimension quality cells and flags
// concentration (one browser/device holding the majority of a problem). Rule-based; a thin cell is
// shown but marked INSUFFICIENT_DATA. The emit schema only distinguishes a fixed browser/os/device
// allow-list — dimensions the client cannot tell apart (e.g. Electron vs Chrome, iOS-Safari vs Safari)
// simply do not appear as separate cells; we never invent a cell that was not observed.

import { round, safeRatio } from '../observability/math';
import { computeStreamingQuality } from '../streamingQuality/quality';
import type { QualityAggregate } from '../streamingQuality/types';
import { MATRIX_CONCENTRATION, MATRIX_MIN_CELL_SESSIONS } from './thresholds';
import type { QualityMatrix, MatrixCell, MatrixDimension } from './types';

export interface DimAggregate { value: string; aggregate: QualityAggregate; }

/** Build a quality matrix for a dimension from per-value aggregates. */
export function buildQualityMatrix(dimension: MatrixDimension, dims: DimAggregate[]): QualityMatrix {
  const cells: MatrixCell[] = dims.map(({ value, aggregate }) => {
    const q = computeStreamingQuality(aggregate);
    const insufficient = aggregate.sessions < MATRIX_MIN_CELL_SESSIONS || q.confidence === 'INSUFFICIENT';
    return {
      value,
      sessions: aggregate.sessions,
      ttfaP75: q.ttfa.p75,
      mediaErrorRate: q.mediaError.sessionRate,
      stallRate: q.stall.sessionRate,
      recoverySuccessRate: q.recovery.successRate,
      crossfadeCompletionRate: q.crossfade.completionRate,
      score: q.score,
      status: insufficient ? 'INSUFFICIENT_DATA' : q.status,
      insufficient,
    };
  }).sort((a, b) => (b.sessions - a.sessions));

  const decisive = cells.filter((c) => !c.insufficient);
  const worstCell = decisive.length
    ? decisive.reduce((w, c) => ((c.score ?? 101) < (w.score ?? 101) ? c : w)).value
    : null;

  // Concentration: does one cell hold ≥ MATRIX_CONCENTRATION of total media-error events?
  const totalErrEvents = dims.reduce((s, d) => s + d.aggregate.mediaErrorEvents, 0);
  let concentration: QualityMatrix['concentration'] = null;
  if (totalErrEvents > 0) {
    const top = dims.reduce((w, d) => (d.aggregate.mediaErrorEvents > w.aggregate.mediaErrorEvents ? d : w));
    const share = safeRatio(top.aggregate.mediaErrorEvents, totalErrEvents);
    if (share >= MATRIX_CONCENTRATION && top.aggregate.mediaErrorEvents > 0) {
      concentration = { signal: 'media_error', value: top.value, share: round(share, 3) ?? 0 };
    }
  }
  return { dimension, cells, worstCell, concentration };
}
