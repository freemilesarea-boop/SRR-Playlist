// AI-MUSIC-9 — Boundary reservation. A candidate queue is never applied immediately; it is RESERVED and only
// consumed at a confirmed safe boundary. Reservations live ONLY in Preview-session memory (persistedToProduction
// Db:false) — never a Production DB row. Pure state machine with legal transitions and expiry/cap guards.

import type { BoundaryReservation, ReservationState, RuntimeHookInput } from './types';
import { DEFAULT_RESERVATION_TTL_MS } from './thresholds';

const LEGAL: Record<ReservationState, ReservationState[]> = {
  RESERVED: ['VALIDATED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED'],
  VALIDATED: ['WAITING_BOUNDARY', 'REJECTED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED'],
  WAITING_BOUNDARY: ['APPLYING', 'REJECTED', 'CANCELLED', 'EXPIRED', 'SUPERSEDED'],
  APPLYING: ['APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  APPLIED: [],            // terminal (model-only "applied"; never a real store write)
  SUPERSEDED: [],
  EXPIRED: [],
  REJECTED: [],
  CANCELLED: [],
};

export function createReservation(input: RuntimeHookInput, reservationId: string, commandId: string): BoundaryReservation {
  return {
    reservationId,
    commandId,
    sessionId: input.playerSessionId,
    queueRevision: input.queueRevision,
    candidatePlaylistId: input.candidatePlaylistId,
    candidateVersion: input.candidateVersion,
    candidateSnapshotHash: input.candidateSnapshotHash,
    existingQueueHash: input.existingQueueTrackIds.join(',') || null,
    currentTrackHash: input.currentTrackId,
    requestedBoundary: input.boundaryState,
    createdAtMs: input.nowMs,
    expiresAtMs: input.nowMs + DEFAULT_RESERVATION_TTL_MS,
    maxApplyCount: Math.max(1, input.store?.maxQueueApplications ?? 1),
    appliedCount: input.appliedCount,
    state: 'RESERVED',
    rejectionReason: null,
    persistedToProductionDb: false,
  };
}

export function canReservationTransition(from: ReservationState, to: ReservationState): boolean {
  return LEGAL[from]?.includes(to) ?? false;
}

export function transitionReservation(r: BoundaryReservation, to: ReservationState, nowMs: number, reason?: string): BoundaryReservation {
  if (r.expiresAtMs != null && nowMs >= r.expiresAtMs && to !== 'EXPIRED') {
    return { ...r, state: 'EXPIRED', rejectionReason: '예약 만료' };
  }
  if (!canReservationTransition(r.state, to)) return r;
  const next: BoundaryReservation = { ...r, state: to };
  if (to === 'REJECTED' || to === 'CANCELLED' || to === 'SUPERSEDED') next.rejectionReason = reason ?? to;
  if (to === 'APPLIED') next.appliedCount = r.appliedCount + 1;
  return next;
}
