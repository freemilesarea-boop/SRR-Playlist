import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { UserRow } from '@/types/db';

declare global {
  interface Window {
    __srrAuthListenersBound?: boolean;
    __srrAuthSubBound?: boolean;
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
  signInWithKakao: () => Promise<void>;
  signOut: () => Promise<void>;
  /** 회원가입 인증 메일 재발송 — 메일 못 받았거나 만료된 경우 사용. */
  resendSignupEmail: (email: string) => Promise<void>;
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

      // onAuthStateChange 는 앱 생애주기에 한 번만 등록한다. StrictMode/init 재호출 시
      // 중복 등록되면 TOKEN_REFRESHED 마다 loadProfile/refreshProfile 가 N배로 발화됨.
      if (typeof window !== 'undefined' && window.__srrAuthSubBound) {
        set({ loading: false });
        return;
      }
      if (typeof window !== 'undefined') window.__srrAuthSubBound = true;

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
            if (r.ok && r.type) {
              await get().refreshProfile();
              // pendingSignup 으로 sales_agent_code 가 막 적용된 직후에도 체험 자동 시작 시도.
              try {
                const { maybeAutoStartTrial } = await import('@/lib/trialApi');
                await maybeAutoStartTrial(get().profile, () => void get().refreshProfile());
              } catch { /* noop */ }
            }
          } catch (e) {
            if (import.meta.env.DEV) console.error('[auth] applyPendingSignup error:', e);
          }
        })();
        // Phase 1-6 — enterprise invite claim 캐시 적용 (이메일 인증 ON 환경 보조)
        // pendingEnterpriseClaim 모듈은 자체적으로 idempotent + 실패 시 캐시 보존.
        // 일반/사업자/아티스트 가입 흐름과 완전 독립 — 캐시 없으면 즉시 no-op.
        void (async () => {
          try {
            const { applyPendingEnterpriseClaimOnLogin } = await import('@/lib/pendingEnterpriseClaim');
            const email = session?.user?.email ?? null;
            const r = await applyPendingEnterpriseClaimOnLogin(email);
            if (r.ok && r.type && !r.skipped) {
              const { toast } = await import('@/store/toastStore');
              toast.success(
                r.type === 'hq'
                  ? '본사 계정이 연결되었습니다.'
                  : '매장이 본사와 연결되었습니다.',
              );
              await get().refreshProfile();
            } else if (!r.ok && r.reason && !r.skipped) {
              const { toast } = await import('@/store/toastStore');
              toast.warning(`엔터프라이즈 연결 실패: ${r.reason}`);
            }
          } catch (e) {
            if (import.meta.env.DEV) console.error('[auth] applyPendingEnterpriseClaim error:', e);
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
      const loaded = (data as UserRow | null) ?? null;
      set({ profile: loaded, profileError: null, isProfileReady: true, loading: false });
      // 영업인 코드 연결된 사업자에 한해 3일 무료 체험 자동 시작 (서버가 악용/중복 차단).
      void (async () => {
        try {
          const { maybeAutoStartTrial } = await import('@/lib/trialApi');
          await maybeAutoStartTrial(loaded, () => void get().refreshProfile());
        } catch { /* noop */ }
      })();
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
     
    console.log('[auth] signUp request:', { email, data });
    const { data: signUpData, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data },
    });
    if (error) {
       
      console.error('[auth] signUp error:', error);
      throw error;
    }
    const ids = signUpData.user?.identities;
     
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

  signInWithKakao: async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'kakao',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        // X6.11: 로그인 목적의 최소 scope 만 — profile_nickname + account_email.
        // talk_message 는 별도 권한 심사 + 사용자 동의 부담이 커서 제거. 알림톡 발송이
        // 필요해지면 비즈 메시지 (알림톡/친구톡 API) 로 별도 솔루션 사용 권장.
        scopes: 'profile_nickname account_email',
      },
    });
    if (error) throw error;
  },

  signOut: async () => {
    // 명시적 로그아웃 — 재생 중이어도 unload 경고 띄우지 않음
    try {
      const { suppressUnloadWarningOnce } = await import('@/lib/playbackGuard');
      suppressUnloadWarningOnce();
    } catch { /* noop */ }
    await supabase.auth.signOut();
    set({
      session: null, user: null, profile: null, profileError: null,
      isProfileReady: true, loading: false,
    });
  },

  resendSignupEmail: async (email) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) throw error;
  },
}));
