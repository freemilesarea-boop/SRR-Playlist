/**
 * audioOutputStore — Phase 1 (in-memory).
 *
 * 선택된 audiooutput deviceId 만 저장.
 * Persistence 는 Phase 2 (localStorage), Enterprise 관리자 lock 은 Phase 3.
 *
 * 새 DB / API / RPC / polling 도입 0.
 */
import { create } from 'zustand';

interface AudioOutputState {
  /** 선택된 audio device id. null 이면 브라우저 기본 출력. */
  sinkId: string | null;
  /** 선택된 장치 label (표시용). */
  sinkLabel: string | null;
  /** 마지막 setSinkId 시각 (ISO). Player 가 구독해서 재적용 트리거. */
  lastAppliedAt: string | null;
  setSink: (deviceId: string | null, label: string | null) => void;
  markApplied: () => void;
}

export const useAudioOutputStore = create<AudioOutputState>((set) => ({
  sinkId: null,
  sinkLabel: null,
  lastAppliedAt: null,
  setSink: (deviceId, label) =>
    set({ sinkId: deviceId, sinkLabel: label, lastAppliedAt: new Date().toISOString() }),
  markApplied: () => set({ lastAppliedAt: new Date().toISOString() }),
}));
