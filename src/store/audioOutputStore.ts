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
  /**
   * persist 미들웨어 rehydration 완료 여부.
   * Guardian 이 hydrate 이전에 실행되면 sinkId=null → desired='default' 로
   * setSinkId 를 호출해 audio.sinkId 가 "" 로 고정되는 문제 방지.
   * persist 하지 않는 runtime flag.
   */
  hasHydrated: boolean;

  setSink: (deviceId: string | null, label: string | null) => void;
  markApplied: (effectiveSinkId: string | null) => void;
  setConnectionStatus: (s: AudioConnectionStatus) => void;
  /** 기본 출력으로 전환 (사용자 액션 또는 recovery 자동). */
  resetToDefault: () => void;
  /** persist onRehydrateStorage 콜백이 호출하는 internal setter. */
  _setHasHydrated: (v: boolean) => void;
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
      hasHydrated: false,

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
      _setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // sinkId/sinkLabel/savedAt 만 persist. 나머지는 runtime 계산.
      partialize: (s) => ({ sinkId: s.sinkId, sinkLabel: s.sinkLabel, savedAt: s.savedAt }),
      version: 1,
      // Phase 2-2 hotfix — persist rehydration 완료 시점 명시적 감지.
      // localStorage 는 이론상 동기이지만 zustand 4 의 persist 는 별도 rehydration
      // step 을 거치므로 Guardian 이 hydrate 이전에 sinkId=null 을 읽을 수 있음.
      onRehydrateStorage: () => (state, error) => {
        console.warn('[audio:sink:hydrate]', {
          fired: true,
          error: error ? String(error) : null,
          rehydratedSinkId: state?.sinkId ?? null,
          rehydratedSinkLabel: state?.sinkLabel ?? null,
          rehydratedSavedAt: state?.savedAt ?? null,
        });
        // Phase 2-6 진단 로그 B — hydrate 직후 store state + localStorage raw 를 함께 확인.
        // UI 표시값이 아닌 실제 store state 를 신뢰할 수 있는지 검증용.
        let rawStorage: string | null = null;
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            rawStorage = window.localStorage.getItem(STORAGE_KEY);
          }
        } catch { /* silent */ }
        console.warn('[audio:sink:store-hydrate]', {
          sinkId: state?.sinkId ?? null,
          sinkLabel: state?.sinkLabel ?? null,
          hasHydrated: true,
          rawStorage,
        });
        state?._setHasHydrated(true);
      },
    },
  ),
);
