/**
 * audioDiagnosticsStore — Phase 7-1 Admin Audio Diagnostics 공유 store.
 *
 * 목적:
 *   Player 내부 Debug Overlay 가 계산한 진단 스냅샷을 관리자 패널에서
 *   read-only 로 확인할 수 있게 브라우저 세션 로컬 zustand store 로 발행.
 *
 * 규칙:
 *   • DB / API 사용 안 함 · 브라우저 세션 로컬 상태만.
 *   • Player 재생 로직 · Recovery / Health / Session / Preload / Invalid State
 *     / Burn-in 판정 로직 무변경.
 *   • Debug OFF 세션에서는 publish 되지 않음 (Dashboard 자체가 렌더 X).
 *   • Admin panel 은 read-only subscribe.
 */
import { create } from 'zustand';
import type { RecoveryHistoryEntry, RecoverySummary } from '@/hooks/useAudioRecoveryManager';
import type { LongRunSummary } from '@/hooks/useAudioLongRunDiagnostics';
import type { LifecycleSnapshot } from '@/hooks/useAudioLifecycleAudit';
import type { SessionSummary } from '@/hooks/useAudioSessionState';
import type { InvalidStateSummary } from '@/hooks/useAudioInvalidStateGuard';
import type { BurnInSummary } from '@/hooks/useAudioBurnInCertification';

export interface AudioDiagnosticsAudioSummary {
  activeIdx: 0 | 1;
  playing: boolean;
  crossfadeInProgress: boolean;
  sinkReady: boolean;
  currentTrackId: string | null;
  currentTrackTitle: string | null;
  activeSinkId: string;
  inactiveSinkId: string;
  desiredSinkId: string | null;
  activeCurrentTime: number;
  activeDuration: number;
  activePaused: boolean;
  inactivePaused: boolean;
  activeVolume: number;
  inactiveVolume: number;
}

export interface AudioDiagnosticsSnapshot {
  publishedAt: number; // performance.now() at publish time
  recovery: RecoverySummary;
  history: RecoveryHistoryEntry[];
  longRun: LongRunSummary;
  lifecycle: LifecycleSnapshot | null;
  session: SessionSummary | null;
  invalidState: InvalidStateSummary | null;
  burnIn: BurnInSummary | null;
  audio: AudioDiagnosticsAudioSummary;
}

interface AudioDiagnosticsState {
  snapshot: AudioDiagnosticsSnapshot | null;
  publish: (s: AudioDiagnosticsSnapshot) => void;
  reset: () => void;
}

export const useAudioDiagnosticsStore = create<AudioDiagnosticsState>()((set) => ({
  snapshot: null,
  publish: (snapshot) => set({ snapshot }),
  reset: () => set({ snapshot: null }),
}));
