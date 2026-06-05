/**
 * FloatingSupportButton — Phase X6.2.7 (운영)
 *
 * 모든 인증된 페이지의 우측 하단 플로팅 문의 버튼.
 * - createPortal → document.body 마운트 (AppShell/라우트 의존성 0)
 * - 로그인 사용자만 노출
 * - /admin/*, /login, /auth/* 라우트에서는 숨김
 * - 미니 플레이어 / BottomNav 와 겹치지 않게 위치 자동 조정
 *
 * 메뉴 항목:
 *   1) 카카오톡 문의하기 — openKakaoChannelChat (@듣다 채널)
 *   2) 문의 남기기 — SupportInquiryForm 모달
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Headphones, MessageCircle, MessageSquare, X } from 'lucide-react';
import SupportInquiryForm from '@/components/SupportInquiryForm';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import {
  isKakaoChannelConfigured,
  isKakaoLoginEnabled,
  openKakaoChannelChat,
  kakaoChannelChatUrl,
  setKakaoChatPending,
} from '@/lib/kakao';
import { logSupportContactEvent } from '@/lib/supportContactApi';
import { toast } from '@/store/toastStore';
import type { User } from '@supabase/supabase-js';

/** 카카오 identity 가 있는지 (Supabase Auth user.identities 검사) */
function hasKakaoIdentity(user: User | null | undefined): boolean {
  if (!user?.identities) return false;
  return user.identities.some((i) => i.provider === 'kakao');
}

const HIDDEN_PREFIXES = ['/admin', '/login', '/auth'];

export default function FloatingSupportButton() {
  const user = useAuthStore((s) => s.user);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const hiddenByRoute = HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p));
  const visible = !!user?.id && !hiddenByRoute;

  if (!visible || !mounted || typeof document === 'undefined') return null;

  const hasPlayer = queueLen > 0;
  const userHasKakao = hasKakaoIdentity(user);
  // X6.13 — 카카오 OAuth 활성화 전까지 미연결 사용자에게 카카오 로그인 진입점 숨김.
  // 이미 카카오 연결된 사용자는 채널 채팅 진입만 하므로 노출 유지.
  const kakaoEnabled = isKakaoChannelConfigured() &&
    (userHasKakao || isKakaoLoginEnabled());
  // 미니 플레이어 위로 — 큐 있으면 156px, 없으면 92px (safe-area 포함)
  const bottomPx = hasPlayer ? 156 : 92;

  async function handleKakaoChatFlow() {
    setMenuOpen(false);

    void logSupportContactEvent({
      channel: 'kakao',
      action: 'open_chat',
      context: { user_email: user?.email ?? null, kakao_linked: userHasKakao },
    });

    // 사례 1: 이미 카카오 identity 있음 → 즉시 채팅창 열기
    if (userHasKakao) {
      const ok = openKakaoChannelChat();
      if (ok) {
        toast.info(
          user?.email
            ? `채팅방에서 본인 이메일(${user.email})로 시작해주세요.`
            : '채팅방에서 본인 이메일/매장명으로 시작해주세요.',
        );
      } else {
        toast.error('카카오톡 채팅을 열 수 없어요. 잠시 후 다시 시도해주세요.');
      }
      return;
    }

    // 사례 2: 카카오 미연결 → 카카오 로그인부터 시작
    toast.info('카카오 계정으로 로그인하면 채팅이 매끄럽게 연결돼요…');
    setKakaoChatPending();
    try {
      await useAuthStore.getState().signInWithKakao();
      // signInWithKakao 가 redirectTo 로 페이지 이동 — 이후 코드 실행 안 됨.
    } catch (e) {
      // OAuth 호출 자체 실패 → fallback 으로 그냥 채팅창 열기
      if (import.meta.env.DEV) console.warn('[kakao] signInWithKakao failed', e);
      const raw = e instanceof Error ? e.message : '';
      const friendly = /provider.*not.*enabled|unsupported provider|validation_failed/i.test(raw)
        ? '카카오 로그인 설정이 완료되지 않았습니다. 채팅창을 직접 엽니다.'
        : '카카오 로그인 실패 — 채팅창을 직접 엽니다.';
      toast.error(friendly);
      openKakaoChannelChat();
    }
  }

  const node = (
    <>
      {/* 백드롭 */}
      {menuOpen && (
        <button
          aria-label="메뉴 닫기"
          onClick={() => setMenuOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.2)',
            zIndex: 49,
            border: 'none',
            cursor: 'default',
          }}
        />
      )}

      {/* FAB + 메뉴 컨테이너 */}
      <div
        style={{
          position: 'fixed',
          right: 'max(16px, env(safe-area-inset-right))',
          bottom: `calc(${bottomPx}px + env(safe-area-inset-bottom))`,
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '8px',
        }}
      >
        {/* 메뉴 (위로 펼침) */}
        {menuOpen && (
          <div className="flex flex-col items-end gap-1.5 animate-slide-up">
            {kakaoEnabled && (
              <div className="flex flex-col items-end gap-1">
                <button
                  onClick={() => { void handleKakaoChatFlow(); }}
                  className="flex items-center gap-2 rounded-full bg-[#FEE500] py-2.5 pl-3 pr-4 text-sm font-semibold text-[#191919] shadow-elevated ring-1 ring-black/10 transition hover:bg-[#FDD800] active:scale-[0.98]"
                  title={kakaoChannelChatUrl()}
                >
                  <MessageCircle size={16} />
                  <span>{userHasKakao ? '카카오톡 문의하기' : '카카오 로그인 + 카톡 문의'}</span>
                </button>
                <p className="max-w-[240px] rounded-md bg-bg-card/95 px-2 py-1.5 text-right text-[10px] leading-snug text-ink-dim shadow-card">
                  {userHasKakao ? (
                    <>채팅방에서 <b>이메일/매장명 + 메시지</b>를 보내주시면 운영팀에 즉시 도착해요.</>
                  ) : (
                    <>카카오 로그인 후 자동으로 <b>@듣다 채팅창</b>이 열려요.</>
                  )}
                </p>
              </div>
            )}
            <button
              onClick={() => {
                setMenuOpen(false);
                setFormOpen(true);
              }}
              className="flex items-center gap-2 rounded-full bg-bg-card py-2.5 pl-3 pr-4 text-sm font-semibold text-ink shadow-elevated ring-1 ring-line/20 transition hover:bg-bg-hover active:scale-[0.98]"
            >
              <MessageSquare size={16} className="text-accent" />
              <span>문의 남기기</span>
            </button>
          </div>
        )}

        {/* FAB — 보라 (DEUDDA accent) */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? '문의 메뉴 닫기' : '문의하기'}
          aria-expanded={menuOpen}
          title="문의하기"
          className={`inline-flex h-14 w-14 items-center justify-center rounded-full shadow-elevated ring-1 ring-black/20 transition active:scale-95 ${
            menuOpen
              ? 'bg-bg-card text-ink-mute hover:bg-bg-hover'
              : 'bg-accent text-white hover:opacity-95'
          }`}
        >
          {menuOpen ? <X size={20} /> : <Headphones size={22} />}
        </button>
      </div>

      {/* 문의 모달 — z-50 (기존 유지) */}
      <SupportInquiryForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultType="기타"
      />
    </>
  );

  return createPortal(node, document.body);
}
