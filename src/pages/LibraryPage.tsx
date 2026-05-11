import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchRecentPlaylists } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { PlaylistRow } from '@/types/db';
import PlaylistRow_ from '@/components/PlaylistRow';

export default function LibraryPage() {
  const { user } = useAuthStore();
  const [liked, setLiked] = useState<PlaylistRow[]>([]);
  const [recents, setRecents] = useState<PlaylistRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      supabase
        .from('likes')
        .select('created_at, playlists(*)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          const rows = (data ?? []) as unknown as Array<{ playlists: PlaylistRow }>;
          return rows.map((r) => r.playlists).filter(Boolean);
        }),
      fetchRecentPlaylists(user.id, 20),
    ]).then(([likedList, recentList]) => {
      if (!alive) return;
      setLiked(likedList);
      setRecents(recentList);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [user]);

  return (
    <div className="space-y-8 px-4 pb-8 pt-6 sm:px-6">
      <header>
        <h1 className="text-2xl font-bold sm:text-3xl">보관함</h1>
        <p className="mt-1 text-sm text-ink-mute">좋아요와 최근 들은 플레이리스트를 모았어요.</p>
      </header>

      {loading ? (
        <p className="text-sm text-ink-mute">불러오는 중…</p>
      ) : (
        <>
          <PlaylistRow_
            title="❤️ 좋아요"
            playlists={liked}
            emptyText="아직 좋아요한 플레이리스트가 없어요."
          />
          <PlaylistRow_
            title="🕒 최근 들은"
            playlists={recents}
            emptyText="아직 들은 기록이 없어요."
          />
        </>
      )}
    </div>
  );
}
