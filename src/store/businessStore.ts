import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 이 기기가 마지막으로 띄운 매장 재생 화면.
 *
 * businessMode 만으로는 매장 플레이어(/business/player)를 쓰는 기기인지 브랜드 플레이어
 * (/brand/player/:id)를 쓰는 기기인지 알 수 없다. 둘 다 businessMode 를 켜기 때문이다.
 * 앱 실행 시 복귀할 화면을 고르려면 이 값이 필요하다 (2026-10 웹앱 브랜드 플레이어 회귀).
 */
export type LastPlayerSurface = { kind: 'store' } | { kind: 'brand'; brandId: string };

interface BusinessState {
  businessMode: boolean;
  selectedCategory: string | null;
  lastPlayerSurface: LastPlayerSurface | null;
  setBusinessMode: (v: boolean) => void;
  setCategory: (c: string | null) => void;
  setLastPlayerSurface: (s: LastPlayerSurface) => void;
}

export const useBusinessStore = create<BusinessState>()(
  persist(
    (set) => ({
      businessMode: false,
      selectedCategory: null,
      lastPlayerSurface: null,
      setBusinessMode: (v) => set({ businessMode: v }),
      setCategory: (c) => set({ selectedCategory: c }),
      setLastPlayerSurface: (s) => set({ lastPlayerSurface: s }),
    }),
    {
      name: 'srr-business',
    },
  ),
);
