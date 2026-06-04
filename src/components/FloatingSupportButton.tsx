/**
 * FloatingSupportButton — Phase X6.2.2
 *
 * 모든 인증된 페이지의 우측 하단 플로팅 문의 버튼.
 * - 로그인 사용자만 노출
 * - /admin/* 라우트에서는 숨김
 * - 미니 플레이어 / BottomNav 와 겹치지 않게 위치 자동 조정
 *
 * 메뉴 항목:
 *   1) 카톡으로 바로 문의 (@듣다 채널 채팅) — openKakaoChannelChat
 *   2) 문의 남기기 (SupportInquiryForm 모달)
 *
 * 마운트 위치: AppShell 1회만 (라우트마다 중복 마운트 금지).
 */
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Headphones, MessageCircle, MessageSquare, X } from 'lucide-react';
import SupportInquiryForm from '@/components/SupportInquiryForm';
import { useAuthStore } from '@/store/authStore';
import { usePlayerStore } from '@/store/playerStore';
import { isKakaoChannelConfigured, openKakaoChannelChat } from '@/lib/kakao';

export default function FloatingSupportButton() {
  const user = useAuthStore((s) => s.user);
  const queueLen = usePlayerStore((s) => s.queue.length);
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  // ESC 로 메뉴 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  // 노출 조건
  if (!user?.id) return null;
  if (location.pathname.startsWith('/admin')) return null;

  const hasPlayer = queueLen > 0;
  // 미니 플레이어 위로 — 플레이어 있을 때 + 없을 때 분리
  // 모바일: BottomNav (~bottom-0, 64px) + Player (~bottom-[5.25rem], 80px tall)
  // 데스크탑: Sidebar 사용 → BottomNav 없음. Player at lg:bottom-4 (~60px tall)
  const positionClass = hasPlayer
    ? 'bottom-[9.5rem] lg:bottom-24'
    : 'bottom-[5.5rem] lg:bottom-6';

  const kakaoEnabled = isKakaoChannelConfigured();

  return (
    <>
      {/* 메뉴 백드롭 — 클릭 시 닫기 */}
      {menuOpen && (
        <button
          aria-label="메뉴 닫기"
          className="fixed inset-0 z-30 bg-black/20"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* 메뉴 + FAB 컨테이너 */}
      <div className={`fixed right-4 sm:right-6 ${positionClass} z-40 flex flex-col items-end gap-2`}>
        {/* 메뉴 (위로 펼침) */}
        {menuOpen && (
          <div className="flex flex-col items-end gap-1.5 animate-slide-up">
            {kakaoEnabled && (
              <button
                onClick={() => {
                  setMenuOpen(false);
                  void openKakaoChannelChat();
                }}
                className="group flex items-center gap-2 rounded-full bg-[#FEE500] py-2.5 pl-3 pr-4 text-sm font-semibold text-[#191919] shadow-elevated ring-1 ring-black/10 transition hover:bg-[#FDD800] active:scale-[0.98]"
              >
                <MessageCircle size={16} />
                <span>카톡으로 바로 문의</span>
              </button>
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

        {/* FAB */}
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? '문의 메뉴 닫기' : '문의하기'}
          aria-expanded={menuOpen}
          className={`group inline-flex h-14 w-14 items-center justify-center rounded-full shadow-elevated ring-1 ring-black/10 transition active:scale-95 ${
            menuOpen
              ? 'bg-bg-card text-ink-mute hover:bg-bg-hover'
              : 'bg-accent text-bg hover:opacity-95'
          }`}
        >
          {menuOpen ? <X size={20} /> : <Headphones size={20} />}
        </button>
      </div>

      {/* 모달 — SupportInquiryForm 자체가 z-50 */}
      <SupportInquiryForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultType="기타"
      />
    </>
  );
}
