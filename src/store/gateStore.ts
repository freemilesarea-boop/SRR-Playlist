import { create } from 'zustand';

export type GateMode = 'login' | 'upsell';

interface GateState {
  mode: GateMode | null;
  open: (mode: GateMode) => void;
  close: () => void;
}

/**
 * 구독/로그인 게이트 모달 전역 상태.
 * - 재생 핸들러(여러 페이지) 에서 openGate('login') 호출
 * - Player 의 anonymous/free 게이트도 동일 store 사용
 * - Player 가 이 상태를 구독해 SubscriptionGate 렌더
 */
export const useGateStore = create<GateState>((set) => ({
  mode: null,
  open: (mode) => set({ mode }),
  close: () => set({ mode: null }),
}));
