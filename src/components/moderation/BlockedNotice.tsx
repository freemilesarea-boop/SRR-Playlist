import { Ban } from 'lucide-react';
import { useBlockStore } from '@/store/blockStore';
import { toast } from '@/store/toastStore';
import { moderationErrorMessage } from '@/lib/moderationApi';

/** 차단한 사용자의 콘텐츠 자리에 대신 보여 준다. 여기서 바로 해제할 수 있다. */
export default function BlockedNotice({ userId, displayName, onBack }: { userId: string; displayName: string; onBack?: () => void }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center">
      <Ban size={28} className="text-ink-dim" />
      <p className="text-sm font-semibold">차단한 사용자의 콘텐츠예요</p>
      <p className="text-xs text-ink-mute">{displayName} 님을 차단해서 이 콘텐츠를 숨겼어요.</p>
      <div className="mt-2 flex gap-2">
        {onBack && <button onClick={onBack} className="btn-ghost px-4 py-2 text-sm">뒤로</button>}
        <button
          onClick={async () => {
            try {
              await useBlockStore.getState().unblock(userId);
              toast.success('차단을 해제했어요.');
            } catch (e) {
              toast.error(moderationErrorMessage(e));
            }
          }}
          className="rounded-full px-4 py-2 text-sm text-ink-mute ring-1 ring-line/15 hover:text-ink"
        >
          차단 해제
        </button>
      </div>
    </div>
  );
}
