import { create } from 'zustand';
import { blockUser, fetchMyBlockedUsers, unblockUser, type BlockedUser } from '@/lib/moderationApi';

/**
 * 내가 차단한 사용자 목록 — 화면에서 그 사람의 플레이리스트·큐레이터 프로필을 가린다.
 * 로그인한 사용자 기준으로 한 번 불러오고, 차단/해제 시 바로 갱신한다.
 */
interface BlockState {
  /** 목록을 불러온 사용자 id(로그아웃·계정 전환 감지용). null 이면 아직 안 불러옴 */
  loadedFor: string | null;
  users: BlockedUser[];
  ids: Set<string>;
  load: (userId: string | null, force?: boolean) => Promise<void>;
  block: (userId: string, displayName?: string) => Promise<void>;
  unblock: (userId: string) => Promise<void>;
  reset: () => void;
}

export const useBlockStore = create<BlockState>((set, get) => ({
  loadedFor: null,
  users: [],
  ids: new Set(),

  load: async (userId, force = false) => {
    if (!userId) { get().reset(); return; }
    if (!force && get().loadedFor === userId) return;
    try {
      const users = await fetchMyBlockedUsers();
      set({ loadedFor: userId, users, ids: new Set(users.map((u) => u.user_id)) });
    } catch {
      // 0568 미적용 등 — 차단 없음으로 둔다(화면은 그대로 보인다).
      set({ loadedFor: userId, users: [], ids: new Set() });
    }
  },

  block: async (userId, displayName) => {
    await blockUser(userId);
    const { users, ids } = get();
    if (ids.has(userId)) return;
    const next = [{ user_id: userId, display_name: displayName ?? '사용자', blocked_at: new Date().toISOString() }, ...users];
    set({ users: next, ids: new Set(next.map((u) => u.user_id)) });
  },

  unblock: async (userId) => {
    await unblockUser(userId);
    const next = get().users.filter((u) => u.user_id !== userId);
    set({ users: next, ids: new Set(next.map((u) => u.user_id)) });
  },

  reset: () => set({ loadedFor: null, users: [], ids: new Set() }),
}));
