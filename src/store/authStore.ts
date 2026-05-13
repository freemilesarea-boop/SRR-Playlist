import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { UserRow } from '@/types/db';

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserRow | null;
  loading: boolean;
  init: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string, nickname?: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,

  init: async () => {
    set({ loading: true });
    if (!isSupabaseConfigured) {
      // 미설정 시 더미 호출이 영원히 멈출 수 있으므로 즉시 종료
      set({ session: null, user: null, profile: null, loading: false });
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      set({ session: data.session, user: data.session?.user ?? null });
      if (data.session?.user) {
        await get().refreshProfile();
      }
      supabase.auth.onAuthStateChange(async (_event, session) => {
        set({ session, user: session?.user ?? null });
        if (session?.user) {
          await get().refreshProfile();
          // 비로그인 동안 localStorage 에 쌓인 좋아요/최근/이어듣기/팔로우를 DB 로 머지
          void (async () => {
            try {
              const { mergePersonalLibrary } = await import('@/lib/personalLibraryApi');
              await mergePersonalLibrary(session.user.id);
            } catch {
              /* 마이그레이션 미적용 등 — 조용히 폴백 */
            }
            try {
              const { mergePlaylistFollows } = await import('@/lib/playlistFollowApi');
              await mergePlaylistFollows(session.user.id);
            } catch {
              /* 0012 미적용 — 조용히 폴백 */
            }
          })();
        } else {
          set({ profile: null });
        }
      });
    } catch {
      // 네트워크 실패 등 — 로그인 페이지로 폴백
      set({ session: null, user: null, profile: null });
    } finally {
      set({ loading: false });
    }
  },

  refreshProfile: async () => {
    const user = get().user;
    if (!user) {
      set({ profile: null });
      return;
    }
    const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
    set({ profile: data ?? null });
  },

  signInWithPassword: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  signUpWithPassword: async (email, password, nickname) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { nickname: nickname || email.split('@')[0] },
      },
    });
    if (error) throw error;
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
  },
}));
