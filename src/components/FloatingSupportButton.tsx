/**
 * FloatingSupportButton — Phase X6.2.4 (Portal 진단 모드)
 *
 * 진단을 위해 body Portal + 인라인 style 강제.
 * - ReactDOM.createPortal → document.body 직접 마운트
 *   (AppShell 하위 어떤 컨테이너의 transform/overflow 도 무시)
 * - 모든 위치/색상 inline style — Tailwind purge 의존성 0
 * - FAB 배경 빨간색 → 화면 보이면 portal/css 정상, 안 보이면 React/auth 문제
 * - 디자인 원복은 진단 확인 후.
 *
 * 동작은 동일:
 *   FAB 클릭 → 메뉴 (카톡 / 문의 남기기)
 *   ESC / 백드롭 클릭 → 메뉴 닫기
 */
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { Headphones, MessageCircle, MessageSquare, X } from 'lucide-react';
import SupportInquiryForm from '@/components/SupportInquiryForm';
import { useAuthStore } from '@/store/authStore';
import { isKakaoChannelConfigured, openKakaoChannelChat } from '@/lib/kakao';

const HIDDEN_PREFIXES = ['/admin', '/login', '/auth'];

// X6.2.6 — 모듈 로드 즉시 진단 마커. 브라우저 콘솔에 이 로그가 안 보이면
// 해당 컴포넌트 모듈 자체가 클라이언트 번들에 로드되지 않은 것 = 배포 미반영.
// eslint-disable-next-line no-console
console.warn('[FAB MODULE LOADED] FloatingSupportButton.tsx X6.2.6', new Date().toISOString());

export default function FloatingSupportButton() {
  // X6.2.6 — 함수 시작 즉시 (분기 전) 무조건 1회 출력. console.warn 사용 (vite 가 production 에서 log 만 제거).
  // eslint-disable-next-line no-console
  console.warn('[FAB MOUNTED] render attempt', { ts: Date.now() });

  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // body 가 있을 때만 portal 마운트 (SSR / 초기화 안전 가드)
  useEffect(() => { setMounted(true); }, []);

  // ESC 로 메뉴 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const hiddenByRoute = HIDDEN_PREFIXES.some((p) => location.pathname.startsWith(p));
  const visible = !!user?.id && !hiddenByRoute;

  // 진단 콘솔 — console.warn 으로 production 에서도 출력 유지 (vite 가 log/info/debug 만 제거)
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.warn('[FAB] state', {
      path: location.pathname,
      hasUser: !!user?.id,
      hiddenByRoute,
      visible,
      mounted,
      portalTarget: typeof document !== 'undefined' ? 'document.body' : 'none',
    });
  }, [location.pathname, user?.id, hiddenByRoute, visible, mounted]);

  if (!visible || !mounted || typeof document === 'undefined') return null;

  const kakaoEnabled = isKakaoChannelConfigured();

  // ===== 진단 모드 인라인 style — Tailwind 의존 0 =====
  const fabContainerStyle: React.CSSProperties = {
    position: 'fixed',
    right: '24px',
    bottom: '120px',
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
  };

  const fabButtonStyle: React.CSSProperties = {
    width: '56px',
    height: '56px',
    borderRadius: '9999px',
    background: 'red', // 🔴 진단용 — 보이면 portal/CSS 정상. 확인 후 원복.
    color: '#ffffff',
    border: 'none',
    boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const backdropStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.2)',
    zIndex: 9998,
    border: 'none',
    cursor: 'default',
  };

  const menuItemKakaoStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    background: '#FEE500',
    color: '#191919',
    padding: '10px 16px 10px 12px',
    borderRadius: '9999px',
    fontWeight: 600,
    fontSize: '14px',
    border: 'none',
    boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
    cursor: 'pointer',
  };

  const menuItemFormStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    background: '#ffffff',
    color: '#111111',
    padding: '10px 16px 10px 12px',
    borderRadius: '9999px',
    fontWeight: 600,
    fontSize: '14px',
    border: '1px solid rgba(0,0,0,0.12)',
    boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
    cursor: 'pointer',
  };

  const node = (
    <>
      {menuOpen && (
        <button
          aria-label="메뉴 닫기"
          style={backdropStyle}
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div
        data-testid="floating-support-button"
        data-fab-portal="body"
        style={fabContainerStyle}
      >
        {menuOpen && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            {kakaoEnabled && (
              <button
                style={menuItemKakaoStyle}
                onClick={() => {
                  setMenuOpen(false);
                  void openKakaoChannelChat();
                }}
              >
                <MessageCircle size={16} />
                <span>카톡으로 바로 문의</span>
              </button>
            )}
            <button
              style={menuItemFormStyle}
              onClick={() => {
                setMenuOpen(false);
                setFormOpen(true);
              }}
            >
              <MessageSquare size={16} color="#7C3AED" />
              <span>문의 남기기</span>
            </button>
          </div>
        )}

        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={menuOpen ? '문의 메뉴 닫기' : '문의하기'}
          aria-expanded={menuOpen}
          title="고객센터 / 문의하기 (진단 모드)"
          style={fabButtonStyle}
        >
          {menuOpen ? <X size={22} /> : <Headphones size={24} />}
        </button>
      </div>

      <SupportInquiryForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        defaultType="기타"
      />
    </>
  );

  return createPortal(node, document.body);
}
