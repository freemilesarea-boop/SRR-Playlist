import { create } from 'zustand';
import { fetchMyAdminPermissions, type AdminPermissions } from '@/lib/adminRbacApi';

interface AdminPermsState {
  perms: AdminPermissions | null;
  loaded: boolean;
  loading: boolean;
  load: () => Promise<void>;
}

/**
 * 관리자 RBAC 권한 단일 소스. 여러 관리자 컴포넌트가 prop-drilling 없이 권한을 읽도록 한다.
 * 권한 최종 판정은 서버 RPC. 이 스토어는 UI 게이트(탭/버튼 숨김)용.
 */
export const useAdminPermsStore = create<AdminPermsState>((set, get) => ({
  perms: null,
  loaded: false,
  loading: false,
  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const perms = await fetchMyAdminPermissions();
      set({ perms, loaded: true, loading: false });
    } catch {
      set({ loaded: true, loading: false });
    }
  },
}));
