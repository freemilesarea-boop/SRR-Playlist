import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, Crown, X } from 'lucide-react';
import type { GateMode } from '@/store/gateStore';

export type { GateMode };

/**
 * 재생 구독 게이트 모달.
 * - login: 비회원 재생 시도 → 로그인 유도 (로그인 성공 시 현재 페이지로 자동 복귀)
 * - upsell: 무료회원 25초 미리듣기 초과 → 프리미엄 구독 유도
 */
export default function SubscriptionGate({
  mode,
  onClose,
}: {
  mode: GateMode;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  // 로그인/회원가입 후 원래 페이지로 복귀하기 위해 현재 경로 캡처.
  // /login 자체에서 트리거된 경우는 무시 (무한 루프 방지).
  const returnTo =
    location.pathname.startsWith('/login') || location.pathname.startsWith('/auth')
      ? '/'
      : location.pathname + location.search;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm space-y-4 rounded-t-3xl bg-bg-soft p-6 ring-1 ring-line/15 sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <span
            className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15 text-accent"
            style={{ boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.35)' }}
          >
            {mode === 'login' ? <Lock size={22} /> : <Crown size={22} />}
          </span>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5" aria-label="닫기">
            <X size={16} />
          </button>
        </div>

        {mode === 'login' ? (
          <>
            <div>
              <h2 className="text-lg font-extrabold tracking-tight">로그인하고 들어보세요</h2>
              <p className="mt-1 text-sm text-ink-mute">
                음악 재생은 로그인 후 이용할 수 있어요. 무료 회원은 25초 미리듣기를 제공해요.
              </p>
            </div>
            <div className="space-y-2">
              <button
                onClick={() => {
                  navigate('/login', { state: { from: returnTo } });
                  onClose();
                }}
                className="btn-primary w-full py-3"
              >
                로그인 / 회원가입
              </button>
              <button onClick={onClose} className="btn-ghost w-full py-2.5 text-sm">
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-lg font-extrabold tracking-tight">프리미엄으로 무제한 감상</h2>
              <p className="mt-1 text-sm text-ink-mute">
                무료 회원은 곡당 25초까지 미리들을 수 있어요. 프리미엄을 구독하면 모든 곡을 무제한으로 즐길 수 있어요.
              </p>
            </div>
            <div className="space-y-2">
              <button onClick={() => navigate('/subscription')} className="btn-primary w-full py-3">
                <Crown size={16} /> 프리미엄 구독하기
              </button>
              <button onClick={onClose} className="btn-ghost w-full py-2.5 text-sm">
                닫기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
