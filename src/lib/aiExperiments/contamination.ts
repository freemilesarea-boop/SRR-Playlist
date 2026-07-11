// AI-MUSIC-4 — Experiment Contamination Detection. Detects conditions that invalidate a control/treatment
// comparison (same store both arms / multiple experiments / mid-experiment playlist or release change /
// incident / long offline / candidate change / overlapping windows). Read-only classification.

import type { ContaminationStatus, ContaminationResult } from './types';

export interface ContaminationInput {
  controlStoreIds: string[];
  treatmentStoreIds: string[];
  storesWithMultipleExperiments?: string[];
  storesWithPlaylistVersionChange?: string[];
  storesWithReleaseChange?: string[];
  storesWithCriticalIncident?: string[];
  storesLongOffline?: string[];
  candidateChanged?: boolean;
  controlPlaylistChanged?: boolean;
  overlappingWindow?: boolean;
  guardrailSourcesAvailable?: boolean;   // false → cannot fully verify → UNKNOWN bias
}

export function detectContamination(input: ContaminationInput): ContaminationResult {
  const evidence: string[] = [];
  const affected = new Set<string>();

  const both = input.controlStoreIds.filter((id) => input.treatmentStoreIds.includes(id));
  for (const id of both) { evidence.push(`동일 Store 양쪽 그룹 포함: ${id.slice(0, 8)}`); affected.add(id); }
  for (const id of input.storesWithMultipleExperiments ?? []) { evidence.push(`복수 Experiment 참여: ${id.slice(0, 8)}`); affected.add(id); }
  for (const id of input.storesWithPlaylistVersionChange ?? []) { evidence.push(`실험 중 Playlist Version 변경: ${id.slice(0, 8)}`); affected.add(id); }
  for (const id of input.storesWithReleaseChange ?? []) { evidence.push(`실험 중 Release 변경: ${id.slice(0, 8)}`); affected.add(id); }
  for (const id of input.storesWithCriticalIncident ?? []) { evidence.push(`실험 중 Critical Incident: ${id.slice(0, 8)}`); affected.add(id); }
  for (const id of input.storesLongOffline ?? []) { evidence.push(`장기 Offline: ${id.slice(0, 8)}`); affected.add(id); }
  if (input.candidateChanged) evidence.push('실험 중 Candidate 구성 변경');
  if (input.controlPlaylistChanged) evidence.push('실험 중 Control Playlist 변경');
  if (input.overlappingWindow) evidence.push('데이터 기간 중복');

  // hard contamination = a store in both arms, or control/candidate changed mid-flight, or overlapping window
  const hard = both.length > 0 || input.candidateChanged === true || input.controlPlaylistChanged === true || input.overlappingWindow === true;

  let status: ContaminationStatus;
  if (hard) status = 'CONTAMINATED';
  else if (evidence.length > 0) status = 'SUSPECTED';
  else if (input.guardrailSourcesAvailable === false) status = 'UNKNOWN';
  else status = 'CLEAN';

  return { status, evidence: evidence.length ? evidence : ['오염 신호 없음'], affectedStores: [...affected] };
}
