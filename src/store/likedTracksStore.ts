import { create } from 'zustand';
import { fetchLikedTrackIds } from '@/lib/libraryApi';

interface LikedTracksState {
  ids: Set<string>;
  ready: boolean;
  init: (userId: string | null) => Promise<void>;
  isLiked: (trackId: string) => boolean;
  set: (trackId: string, liked: boolean) => void;
}

let initToken = '';

export const useLikedTracksStore = create<LikedTracksState>((set, get) => ({
  ids: new Set(),
  ready: false,

  init: async (userId) => {
    const token = `${userId ?? 'anon'}`;
    if (initToken === token && get().ready) return;
    initToken = token;
    const ids = await fetchLikedTrackIds(userId);
    set({ ids, ready: true });
  },

  isLiked: (trackId) => get().ids.has(trackId),

  set: (trackId, liked) => {
    const next = new Set(get().ids);
    if (liked) next.add(trackId);
    else next.delete(trackId);
    set({ ids: next });
  },
}));
