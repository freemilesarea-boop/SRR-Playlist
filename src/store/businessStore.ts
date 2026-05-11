import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface BusinessState {
  businessMode: boolean;
  selectedCategory: string | null;
  setBusinessMode: (v: boolean) => void;
  setCategory: (c: string | null) => void;
}

export const useBusinessStore = create<BusinessState>()(
  persist(
    (set) => ({
      businessMode: false,
      selectedCategory: null,
      setBusinessMode: (v) => set({ businessMode: v }),
      setCategory: (c) => set({ selectedCategory: c }),
    }),
    {
      name: 'srr-business',
    },
  ),
);
