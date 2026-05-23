import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { UserRow } from '@/types/db';

declare global {
  interface Window {
    __srrAuthListenersBound?: boolean;
  }
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: UserRow | null;
  profileError: string | null;
  /** Supabase 세션 복원(getSession) 완료 여부 */
  isAuthReady: boolean;
  /** 현재 auth 상태에 대한 profile 조회 완료 여부 (세션 없음=true) */
  isProfileReady: boolean;
  /** 하위호환 coarse 플래그: auth+profile 가 아직 정착되지 않음 */
  loading: boolean;
  init: () => Promise<void>;
  /** 게이팅 fetch — isProfileReady/loading 을 토글. 사용자 전환/초기화 시. */
  loadProfile: (userId: string) => Promise<void>;
  /** 사일런트 refetch — readiness/loading 을 건드리지 않음 (focus/액션 후 갱신용). */
  refreshProfile: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
    nickname?: string,
    metadata?: Record<string, string | null | undefined>,
  ) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  profile: null,
  profileError: null,
  isAuthReady: false,
  isProfileReady: false,
  loading: true,

  init: async () => {
    set({ loading: true, isAuthReady: false, isProfileReady: false });
    if (!isSupabaseConfigured) {
      set({
        session: null, user: null, profile: null, profileError: null,
        isAuthReady: true, isProfileReady: true, loading: false,
      });
      return;
    }
    try {
      const { data } = await supabase.auth.getSession();
      const s = data.session ?? null;
      set({ session: s, user: s?.user ?? null, isAuthReady: true });
      if (s?.user) {
        await get().loadProfile(s.user.id);
      } else {
        set({ profile: null, profileError: null, isProfileReady: true, loading: false });
      }

      // focus/가시성 변화 시 사일런트 refetch (결제/환불 webhook 반영). 한 번만 등록.
      if (typeof window !== 'undefined' && !window.__srrAuthListenersBound) {
        window.__srrAuthListenersBound = true;
        const refreshIfLoggedIn = () => {
          if (get().user) void get().refreshProfile();
        };
        window.addEventListener('focus', refreshIfLoggedIn);
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') refreshIfLoggedIn();
        });
      }

      supabase.auth.onAuthStateChange(async (_event, session) => {
        const prevUserId = get().user?.id ?? null;
        const nextUserId = session?.user?.id ?? null;
        set({ session, user: session?.user ?? null, isAuthReady: true });

        if (!nextUserId) {
          // 로그아웃/세션 만료 — 절대 여기서 강제 이동/사이드이펙트 없음
          set({ profile: null, profileError: null, isProfileReady: true, loading: false });
          return;
        }

        // 같은 사용자 + 이미 프로필 로드됨 (TOKEN_REFRESHED 등) → loader 깜빡임 방지 위해 사일런트만
        if (nextUserId === prevUserId && get().isProfileReady && get().profile) {
          void get().refreshProfile();
          return;
        }

        // 신규 로그인 / 사용자 전환 → 게이팅 로드 (이 구간엔 loader 표시, 절대 signOut/redirect 안 함)
        await get().loadProfile(nextUserId);

        // 가입 직후 pending signup 캐시 적용 + 비로그인 라이브러리 머지 (best-effort)
        void (async () => {
          try {
            const { applyPendingSignupOnLogin } = await import('@/lib/pendingSignup');
            const r = await applyPendingSignupOnLogin(nextUserId);
            if (r.ok && r.type) await get().refreshProfile();
          } catch (e) {
            if (import.meta.env.DEV) console.error('[auth] applyPendingSignup error:', e);
          }
        })();
        void (async () => {
          try {
            const { mergePersonalLibrary } = await import('@/lib/personalLibraryApi');
            await mergePersonalLibrary(nextUserId);
          } catch { /* noop */ }
          try {
            const { mergePlaylistFollows } = await import('@/lib/playlistFollowApi');
            await mergePlaylistFollows(nextUserId);
          } catch { /* noop */ }
        })();
      });
    } catch {
      // 네트워크 실패 등 — 세션 없음으로 정착시키고 로딩 종료 (로그인 라우트는 RequireAuth 가 판단)
      set({
        session: null, user: null, profile: null, profileError: null,
        isAuthReady: true, isProfileReady: true, loading: false,
      });
    }
  },

  loadProfile: async (userId) => {
    set({ isProfileReady: false, loading: true, profileError: null });
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (error) {
        set({ profile: null, profileError: error.message, isProfileReady: true, loading: false });
        return;
      }
      set({ profile: (data as UserRow | null) ?? null, profileError: null, isProfileReady: true, loading: false });
    } catch (e) {
      set({
        profile: null,
        profileError: e instanceof Error ? e.message : 'profile load failed',
        isProfileReady: true,
        loading: false,
      });
    }
  },

  refreshProfile: async () => {
    const user = get().user;
    if (!user) {
      set({ profile: null });
      return;
    }
    // 사일런트: 실패해도 기존 profile 유지 (배경 갱신이 화면을 깨지 않도록)
    const { data, error } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
    if (error) return;
    set({ profile: (data as UserRow | null) ?? null, profileError: null });
  },

  signInWithPassword: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  },

  signUpWithPassword: async (email, password, nickname, metadata) => {
    const data: Record<string, string | null | undefined> = {
      nickname: nickname || email.split('@')[0],
      ...(metadata ?? {}),
    };
    // eslint-disable-next-line no-console
    console.log('[auth] signUp request:', { email, data });
    const { data: signUpData, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data },
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[auth] signUp error:', error);
      throw error;
    }
    const ids = signUpData.user?.identities;
    // eslint-disable-next-line no-console
    console.log('[auth] signUp response:', {
      user_id: signUpData.user?.id,
      email_confirmed: signUpData.user?.email_confirmed_at != null,
      has_session: !!signUpData.session,
      identities_count: ids?.length ?? 0,
    });
    // confirm email ON 환경에서 동일 이메일 재가입 시 identities=[] 빈 배열로 반환됨 → silent duplicate.
    if (signUpData.user && (!ids || ids.length === 0)) {
      throw new Error('이미 가입된 이메일입니다. 로그인해주세요.');
    }
  },

  signInWithGoogle: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({
      session: null, user: null, profile: null, profileError: null,
      isProfileReady: true, loading: false,
    });
  },
}));
