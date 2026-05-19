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
  loading: boolean;
  init: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (
    email: string,
    password: string,
    nickname?: string,
    metadata?: Record<string, string | null | undefined>,
  ) => Promise<void>;
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
      // 페이지 포커스 / 가시성 변화 시 profile 자동 refetch — 결제/환불 webhook
      // 적용 직후 다른 탭에서 처리된 변경을 빠르게 반영. 한 번만 등록.
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
        set({ session, user: session?.user ?? null });
        if (session?.user) {
          await get().refreshProfile();
          // 1) 가입 직후 pending signup 캐시 적용 — 0021 트리거 미적용 환경 / 이메일 인증
          //    ON 환경에서 첫 로그인 시 가입 정보 DB 적용 보장.
          void (async () => {
            try {
              const { applyPendingSignupOnLogin } = await import('@/lib/pendingSignup');
              const r = await applyPendingSignupOnLogin(session.user.id);
              if (r.ok && r.type) {
                // 적용 후 profile 다시 불러옴 (account_type / artist_approval_status 등 반영)
                await get().refreshProfile();
              }
            } catch (e) {
              if (import.meta.env.DEV) console.error('[auth] applyPendingSignup error:', e);
            }
          })();
          // 2) 비로그인 동안 localStorage 에 쌓인 좋아요/최근/이어듣기/팔로우를 DB 로 머지
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

  signUpWithPassword: async (email, password, nickname, metadata) => {
    // user_metadata 는 0021 handle_new_user 트리거가 읽어서 public.users +
    // artist_profiles 자동 생성에 사용. 이메일 인증 ON 환경에서도 동작.
    const data: Record<string, string | null | undefined> = {
      nickname: nickname || email.split('@')[0],
      ...(metadata ?? {}),
    };
    // 항상 출력 (DEV 만 아닌 production 도) — 운영 진단 시 사용자에게 콘솔 캡처 요청 가능
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
    // 응답 가시화 — user_id / session 존재 여부 / identities length
    const ids = signUpData.user?.identities;
    // eslint-disable-next-line no-console
    console.log('[auth] signUp response:', {
      user_id: signUpData.user?.id,
      email_confirmed: signUpData.user?.email_confirmed_at != null,
      has_session: !!signUpData.session,
      identities_count: ids?.length ?? 0,
    });
    // Supabase quirk: confirm email ON 환경에서 동일 이메일로 재가입 시 error 가 아닌
    // user.identities=[] 빈 배열 + 정상 응답으로 반환됨 → silent duplicate.
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
    set({ session: null, user: null, profile: null });
  },
}));
