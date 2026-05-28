import { create } from 'zustand';
import { fetchBrandSettings, type BrandSettings } from '@/lib/brandApi';

interface BrandState extends BrandSettings {
  loaded: boolean;
  load: () => Promise<void>;
  setLogoUrl: (url: string | null) => void;
}

export const useBrandStore = create<BrandState>((set, get) => ({
  logo_url: null,
  updated_at: null,
  loaded: false,
  async load() {
    if (get().loaded) return;
    const s = await fetchBrandSettings();
    set({ ...s, loaded: true });
  },
  setLogoUrl(url) { set({ logo_url: url, updated_at: new Date().toISOString() }); },
}));
