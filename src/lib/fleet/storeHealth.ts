// WEB-OBS-6 — Per-store health rollup (pure). Composes the signal classifiers into one StoreHealthResult
// with a 0..100 score and a status band. A store with insufficient telemetry → INSUFFICIENT_DATA
// (score null), never a fabricated number. Liveness OFFLINE forces the OFFLINE band regardless of score.

import { round } from '../observability/math';
import type { Confidence } from '../observability/release';
import type {
  StoreHealthInput, StoreHealthResult, LivenessStatus, PlaybackHealthStatus,
  QueueHealthStatus, NetworkHealthStatus, RepetitionStatus, FleetHealthStatus,
} from './types';
import {
  computeLiveness, computePlaybackHealth, computeSilence, computeQueueHealth,
  computeSchedulerHealth, computeNetworkHealth, computeRepetition, storeConfidence, isHidden,
} from './signals';
import {
  STORE_SCORE_WEIGHTS, STORE_BAND_HEALTHY, STORE_BAND_WATCH, STORE_BAND_DEGRADED,
} from './thresholds';

function livenessGoodness(s: LivenessStatus): number | null {
  switch (s) { case 'ONLINE': return 1; case 'DEGRADED': return 0.5; case 'STALE': return 0.4; case 'OFFLINE': return 0; default: return null; }
}
function playbackGoodness(s: PlaybackHealthStatus): number | null {
  switch (s) {
    case 'HEALTHY': case 'PLAYING': return 1;
    case 'PAUSED_EXPECTED': return 0.9;
    case 'NETWORK_DEGRADED': return 0.4;
    case 'QUEUE_EMPTY': return 0.2;
    case 'SILENCE_SUSPECTED': return 0.15;
    case 'STALLED': return 0.1;
    case 'PAUSED_UNEXPECTED': return 0.3;
    case 'OFFLINE': return 0;
    default: return null;
  }
}
function queueGoodness(s: QueueHealthStatus): number | null {
  switch (s) { case 'HEALTHY': return 1; case 'LOW': return 0.6; case 'STALE': return 0.4; case 'EMPTY': return 0.1; default: return null; }
}
function networkGoodness(s: NetworkHealthStatus): number | null {
  switch (s) { case 'HEALTHY': return 1; case 'RECOVERED': return 0.8; case 'RECONNECTING': return 0.5; case 'DEGRADED': return 0.4; case 'DISCONNECTED': return 0; default: return null; }
}
function repetitionGoodness(s: RepetitionStatus): number | null {
  switch (s) { case 'NORMAL': return 1; case 'REPEAT_WARNING': return 0.6; case 'REPEAT_ANOMALY': return 0.3; default: return null; }
}

function bandFor(score: number, liveness: LivenessStatus): FleetHealthStatus {
  if (liveness === 'OFFLINE') return 'OFFLINE';
  if (score >= STORE_BAND_HEALTHY) return 'HEALTHY';
  if (score >= STORE_BAND_WATCH) return 'WATCH';
  if (score >= STORE_BAND_DEGRADED) return 'DEGRADED';
  return 'CRITICAL';
}

export function computeStoreHealth(input: StoreHealthInput): StoreHealthResult {
  const confidence: Confidence = storeConfidence(input);
  const liveness = computeLiveness(input);
  const playback = computePlaybackHealth(input);
  const silence = computeSilence(input);
  const queue = computeQueueHealth(input);
  const scheduler = computeSchedulerHealth(input);
  const network = computeNetworkHealth(input);
  const repetition = computeRepetition(input);
  const hidden = isHidden(input);

  const reasons: string[] = [];
  if (hidden) reasons.push('탭 hidden(백그라운드 throttling) — confidence 하향');
  if (liveness === 'OFFLINE') reasons.push('heartbeat 장기 미수신(Offline 후보)');
  if (playback === 'SILENCE_SUSPECTED') reasons.push('재생 상태이나 진행 정체 — Silence 의심(확정 아님)');
  if (playback === 'STALLED') reasons.push('재생 진행 정체(Stall 의심)');
  if (queue === 'EMPTY') reasons.push('Queue 비어 있음');
  if (network === 'DISCONNECTED') reasons.push('오프라인 상태 보고');
  if (network === 'DEGRADED') reasons.push('재연결 반복');
  if (repetition === 'REPEAT_ANOMALY') reasons.push('동일 곡 비정상 반복');

  const base: Omit<StoreHealthResult, 'healthScore' | 'status'> = {
    storeId: input.storeId,
    storeName: input.storeName ?? null,
    brandId: input.brandId ?? null,
    brandName: input.brandName ?? null,
    regionName: input.regionName ?? null,
    release: input.release,
    browserFamily: input.browserFamily,
    deviceClass: input.deviceClass,
    liveness, playback, silence, queue, scheduler, network, repetition,
    confidence, lastSeenAgeSec: input.lastSeenAgeSec, hidden, reasons,
  };

  if (confidence === 'INSUFFICIENT') {
    return { ...base, healthScore: null, status: 'INSUFFICIENT_DATA' };
  }

  const components: Array<[number, number | null]> = [
    [STORE_SCORE_WEIGHTS.liveness, livenessGoodness(liveness)],
    [STORE_SCORE_WEIGHTS.playback, playbackGoodness(playback)],
    [STORE_SCORE_WEIGHTS.queue, queueGoodness(queue)],
    [STORE_SCORE_WEIGHTS.network, networkGoodness(network)],
    [STORE_SCORE_WEIGHTS.repetition, repetitionGoodness(repetition)],
  ];
  let wSum = 0;
  let gSum = 0;
  for (const [w, g] of components) { if (g != null) { wSum += w; gSum += w * g; } }
  if (wSum === 0) return { ...base, healthScore: null, status: 'INSUFFICIENT_DATA' };
  const score = round((gSum / wSum) * 100, 1) ?? 0;
  return { ...base, healthScore: score, status: bandFor(score, liveness) };
}
