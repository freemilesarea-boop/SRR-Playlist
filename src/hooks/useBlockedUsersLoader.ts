import { useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useBlockStore } from '@/store/blockStore';

/** 로그인한 사용자의 차단 목록을 한 번 불러온다(계정이 바뀌면 다시). */
export function useBlockedUsersLoader(): Set<string> {
  const me = useAuthStore((s) => s.user?.id ?? null);
  const ids = useBlockStore((s) => s.ids);
  useEffect(() => {
    void useBlockStore.getState().load(me);
  }, [me]);
  return ids;
}
