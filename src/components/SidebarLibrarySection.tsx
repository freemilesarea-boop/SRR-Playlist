import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Plus } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useLikedTracksStore } from '@/store/likedTracksStore';
import { usePlayerStore } from '@/store/playerStore';
import { fetchFollowedPlaylists, type FollowedPlaylist } from '@/lib/playlistFollowApi';
import { fetchFollowedUserPlaylists, type FollowedUserPlaylist } from '@/lib/userPlaylistApi';
import AbstractCover, { type CoverTone } from '@/components/AbstractCover';

/** 라이브러리 아이템 통합 타입 */
interface LibraryItem {
  key: string;
  to: string;
  title: string;
  subtitle: string;
  tone: CoverTone;
  glyph?: string | null;
  special?: 'liked' | null;
  /** 현재 재생 컨텍스트와 일치하면 EQ glyph 표시 */
  matchesCurrent?: boolean;
}

const TONES: CoverTone[] = ['violet', 'teal', 'amber', 'blackberry', 'carbon', 'deep'];
function pickTone(seed: string): CoverTone {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length];
}
function pickGlyph(s: string): string | null {
  const ch = (s || '').trim().slice(0, 1);
  if (!ch) return null;
  const c = ch.charCodeAt(0);
  return c >= 0xac00 && c <= 0xd7a3 ? ch : null;
}

export default function SidebarLibrarySection() {
  const session = useAuthStore((s) => s.session);
  const likedCount = useLikedTracksStore((s) => s.ids.size);
  const currentPlaylist = usePlayerStore((s) => s.playlist);
  const playing = usePlayerStore((s) => s.playing);

  const [followedCatalog, setFollowedCatalog] = useState<FollowedPlaylist[]>([]);
  const [followedUser, setFollowedUser] = useState<FollowedUserPlaylist[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!session) {
      setFollowedCatalog([]);
      setFollowedUser([]);
      setLoaded(true);
      return;
    }
    let alive = true;
    const userId = session.user?.id ?? null;
    Promise.all([
      fetchFollowedPlaylists(userId).catch(() => []),
      fetchFollowedUserPlaylists().catch(() => []),
    ]).then(([cat, usr]) => {
      if (!alive) return;
      setFollowedCatalog(cat);
      setFollowedUser(usr);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [session]);

  // 아이템 합치기: 좋아요한 곡(special) → 팔로우 catalog → 팔로우 user, 최대 6개
  const items: LibraryItem[] = [];
  // 좋아요한 곡 (항상 노출 — 0곡이어도 진입 가능)
  items.push({
    key: 'liked',
    to: '/library',
    title: '좋아요한 곡',
    subtitle: `${likedCount}곡`,
    tone: 'violet',
    glyph: null,
    special: 'liked',
    matchesCurrent: false,
  });
  // 팔로우 catalog playlists
  for (const p of followedCatalog) {
    if (items.length >= 7) break;
    items.push({
      key: `c-${p.id}`,
      to: `/playlist/${p.id}`,
      title: p.title,
      subtitle: p.category ?? '',
      tone: pickTone(p.category || p.title),
      glyph: pickGlyph(p.title),
      matchesCurrent: currentPlaylist?.id === p.id,
    });
  }
  // 팔로우 user playlists
  for (const p of followedUser) {
    if (items.length >= 7) break;
    items.push({
      key: `u-${p.id}`,
      to: `/my/playlist/${p.id}`,
      title: p.title,
      subtitle: `${p.track_count}곡`,
      tone: pickTone(p.title),
      glyph: pickGlyph(p.title),
      matchesCurrent: currentPlaylist?.id === p.id,
    });
  }

  return (
    <div className="mt-2 border-t border-line/10 px-3 pt-4">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink-dim">
          내 라이브러리
        </span>
        <Link
          to="/my/playlists"
          className="rounded-md p-1 text-ink-dim transition-colors hover:bg-bg-hover hover:text-ink"
          aria-label="플레이리스트 추가"
          title="내 플레이리스트로 이동"
        >
          <Plus size={14} />
        </Link>
      </div>

      <ul className="space-y-0.5">
        {items.map((it) => {
          const isCurrent = it.matchesCurrent;
          return (
            <li key={it.key}>
              <Link
                to={it.to}
                className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-bg-hover"
              >
                {/* 36px 썸네일 */}
                <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-md ring-1 ring-line/10">
                  {it.special === 'liked' ? (
                    <div className="flex h-full w-full items-center justify-center bg-accent/15 text-accent">
                      <Heart size={14} fill="currentColor" />
                    </div>
                  ) : (
                    <AbstractCover tone={it.tone} glyph={it.glyph} mini />
                  )}
                </div>
                {/* 텍스트 */}
                <div className="min-w-0 flex-1">
                  <p className={`truncate text-[13px] font-semibold ${isCurrent ? 'text-accent' : 'text-ink'}`}>
                    {it.title}
                  </p>
                  <p className="truncate text-[11px] text-ink-dim">
                    {isCurrent ? '이어듣기' : it.subtitle}
                  </p>
                </div>
                {/* 현재 재생 EQ glyph */}
                {isCurrent && playing && (
                  <span className="eq-bars shrink-0 text-accent" aria-label="재생 중">
                    <span /><span /><span />
                  </span>
                )}
              </Link>
            </li>
          );
        })}

        {/* 로딩/빈 상태 */}
        {!loaded && session && (
          <li className="px-2 py-2 font-mono text-[10px] text-ink-dim">불러오는 중…</li>
        )}
        {loaded && session && items.length === 1 && (
          <li className="px-2 py-2 text-[11px] leading-relaxed text-ink-dim">
            플레이리스트에 하트를 눌러 라이브러리에 추가하세요.
          </li>
        )}
        {!session && (
          <li className="px-2 py-2 font-mono text-[10px] text-ink-dim">로그인 후 표시</li>
        )}
      </ul>
    </div>
  );
}
