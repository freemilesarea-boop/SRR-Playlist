import { useState } from 'react';
import { Ban, ChevronDown, ChevronUp } from 'lucide-react';
import { useBlockStore } from '@/store/blockStore';
import { useBlockedUsersLoader } from '@/hooks/useBlockedUsersLoader';
import { moderationErrorMessage } from '@/lib/moderationApi';
import { toast } from '@/store/toastStore';

/** 내 정보 → 차단한 사용자. 목록 확인과 해제. */
export default function BlockedUsersSection() {
  useBlockedUsersLoader();
  const users = useBlockStore((s) => s.users);
  const [open, setOpen] = useState(false);

  return (
    <section className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover"
        aria-expanded={open}
      >
        <Ban size={18} className="text-ink-mute" />
        <span className="flex-1 text-sm font-medium">차단한 사용자</span>
        <span className="text-xs text-ink-mute">{users.length}명</span>
        {open ? <ChevronUp size={16} className="text-ink-dim" /> : <ChevronDown size={16} className="text-ink-dim" />}
      </button>
      {open && (
        <div className="border-t border-line/10">
          {users.length === 0 ? (
            <p className="px-4 py-4 text-xs text-ink-mute">차단한 사용자가 없어요. 플레이리스트나 큐레이터 화면의 "차단" 버튼으로 차단할 수 있어요.</p>
          ) : (
            <ul className="divide-y divide-line/10">
              {users.map((u) => (
                <li key={u.user_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <span className="min-w-0 truncate text-sm">{u.display_name}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await useBlockStore.getState().unblock(u.user_id);
                        toast.success(`${u.display_name} 님 차단을 해제했어요.`);
                      } catch (e) {
                        toast.error(moderationErrorMessage(e));
                      }
                    }}
                    className="min-h-9 shrink-0 rounded-full px-3 py-1.5 text-xs text-ink-mute ring-1 ring-line/15 hover:text-ink"
                  >
                    차단 해제
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
