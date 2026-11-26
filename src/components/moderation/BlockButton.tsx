import { useRef, useState } from 'react';
import { Ban, X } from 'lucide-react';
import { useModalA11y } from '@/hooks/useModalA11y';
import { useAuthStore } from '@/store/authStore';
import { useGateStore } from '@/store/gateStore';
import { useBlockStore } from '@/store/blockStore';
import { toast } from '@/store/toastStore';
import { moderationErrorMessage } from '@/lib/moderationApi';
import { useBlockedUsersLoader } from '@/hooks/useBlockedUsersLoader';

interface Props {
  userId: string;
  displayName: string;
  /** 차단한 뒤 할 일(예: 이전 화면으로) */
  onBlocked?: () => void;
  className?: string;
}

/**
 * 사용자 차단 버튼 (App Store 지침 1.2).
 * 차단하면 그 사람의 플레이리스트·큐레이터 프로필이 나에게 보이지 않는다.
 * 내 정보 → 차단한 사용자에서 해제할 수 있다.
 */
export default function BlockButton({ userId, displayName, onBlocked, className }: Props) {
  const session = useAuthStore((s) => s.session);
  const me = useAuthStore((s) => s.user?.id ?? null);
  const blocked = useBlockStore((s) => s.ids.has(userId));
  const [confirming, setConfirming] = useState(false);

  useBlockedUsersLoader();

  if (me && me === userId) return null; // 나 자신은 차단할 수 없다

  async function onUnblock() {
    try {
      await useBlockStore.getState().unblock(userId);
      toast.success(`${displayName} 님 차단을 해제했어요.`);
    } catch (e) {
      toast.error(moderationErrorMessage(e));
    }
  }

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!session) {
      toast.info('로그인 후 차단할 수 있어요.');
      useGateStore.getState().open('login');
      return;
    }
    if (blocked) { void onUnblock(); return; }
    setConfirming(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex min-h-9 items-center gap-1 rounded-full px-3 py-1.5 text-xs ring-1 transition ${
          blocked ? 'bg-red-500/10 text-red-500 ring-red-400/40' : 'text-ink-mute ring-line/15 hover:text-red-500 hover:ring-red-400/40'
        } ${className ?? ''}`}
        aria-label={blocked ? '차단 해제' : '사용자 차단'}
      >
        <Ban size={13} /> {blocked ? '차단 해제' : '차단'}
      </button>
      {confirming && (
        <ConfirmBlock
          displayName={displayName}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            try {
              await useBlockStore.getState().block(userId, displayName);
              toast.success(`${displayName} 님을 차단했어요.`);
              setConfirming(false);
              onBlocked?.();
            } catch (e) {
              toast.error(moderationErrorMessage(e));
            }
          }}
        />
      )}
    </>
  );
}

function ConfirmBlock({
  displayName, onCancel, onConfirm,
}: { displayName: string; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useModalA11y(ref, { onClose: onCancel });
  return (
    <div
      ref={ref}
      role="dialog" aria-modal="true" aria-labelledby="block-title"
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onCancel}
    >
      <div className="w-full max-w-sm rounded-t-3xl bg-bg-soft p-5 text-ink ring-1 ring-line/15 sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="block-title" className="text-base font-bold">{displayName} 님을 차단할까요?</h2>
          <button onClick={onCancel} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-ink/5" aria-label="닫기">
            <X size={16} />
          </button>
        </div>
        <ul className="mt-3 space-y-1.5 text-sm text-ink-mute">
          <li>· 이 사용자의 플레이리스트와 큐레이터 프로필이 더 이상 보이지 않아요.</li>
          <li>· 상대방에게는 차단 사실이 알려지지 않아요.</li>
          <li>· 내 정보 → 차단한 사용자에서 언제든 해제할 수 있어요.</li>
        </ul>
        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost flex-1 py-2.5 text-sm">취소</button>
          <button
            type="button"
            disabled={busy}
            onClick={async () => { setBusy(true); await onConfirm(); setBusy(false); }}
            className="flex-1 rounded-full bg-red-500 py-2.5 text-sm font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
          >
            {busy ? '처리 중…' : '차단하기'}
          </button>
        </div>
      </div>
    </div>
  );
}
