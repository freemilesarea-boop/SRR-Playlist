/**
 * audioOutputStore — Phase 2 (localStorage persistence).
 *
 * Phase 1 의 in-memory store 를 zustand persist middleware 로 확장.
 * 선택된 출력 장치 정보를 localStorage 에 저장 → 앱 재실행/새로고침
 * 후에도 자동 복원.
 *
 * 새 DB / API / RPC / polling 도입 0.
 * Player 재생 로직 무영향 · Enterprise 기능 무영향.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

const STORAGE_KEY = 'deudda.audioOutput.v1';

export type AudioConnectionStatus =
  | 'default'       // 저장된 장치 없음 → 브라우저 기본 출력 사용
  | 'connected'     // 저장된 장치가 현재 목록에 존재하고 적용 성공
  | 'disconnected'  // 저장된 장치가 목록에 없음 → 기본 출력으로 fallback
  | 'unsupported';  // setSinkId 미지원 브라우저

interface AudioOutputState {
  /** 선택된 audio device id. null 이면 브라우저 기본 출력. */
  sinkId: string | null;
  /** 선택된 장치 label (표시용 · deviceId 를 우선하고 label 은 참고용). */
  sinkLabel: string | null;
  /** 저장 시각 (ISO). */
  savedAt: string | null;
  /** 마지막 setSinkId 실제 적용 시각 (ISO). Player 가 구독해서 재적용 트리거. */
  lastAppliedAt: string | null;
  /** 실제 적용된 deviceId (Player useEffect 가 setSinkId 성공 후 기록). */
  effectiveSinkId: string | null;
  /** 실시간 연결 상태 (persist 하지 않음). */
  connectionStatus: AudioConnectionStatus;

  setSink: (deviceId: string | null, label: string | null) => void;
  markApplied: (effectiveSinkId: string | null) => void;
  setConnectionStatus: (s: AudioConnectionStatus) => void;
  /** 기본 출력으로 전환 (사용자 액션 또는 recovery 자동). */
  resetToDefault: () => void;
}

export const useAudioOutputStore = create<AudioOutputState>()(
  persist(
    (set) => ({
      sinkId: null,
      sinkLabel: null,
      savedAt: null,
      lastAppliedAt: null,
      effectiveSinkId: null,
      connectionStatus: 'default',

      setSink: (deviceId, label) =>
        set({
          sinkId: deviceId,
          sinkLabel: label,
          savedAt: new Date().toISOString(),
          lastAppliedAt: new Date().toISOString(),
        }),
      markApplied: (effectiveSinkId) =>
        set({
          effectiveSinkId,
          lastAppliedAt: new Date().toISOString(),
        }),
      setConnectionStatus: (s) => set({ connectionStatus: s }),
      resetToDefault: () =>
        set({
          sinkId: null,
          sinkLabel: null,
          savedAt: new Date().toISOString(),
          lastAppliedAt: new Date().toISOString(),
          effectiveSinkId: null,
          connectionStatus: 'default',
        }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // sinkId/sinkLabel/savedAt 만 persist. 나머지는 runtime 계산.
      partialize: (s) => ({ sinkId: s.sinkId, sinkLabel: s.sinkLabel, savedAt: s.savedAt }),
      version: 1,
    },
  ),
);
