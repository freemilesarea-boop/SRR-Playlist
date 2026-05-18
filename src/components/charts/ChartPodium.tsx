import { Play, Crown, Medal, AlertCircle } from 'lucide-react';
import type { ChartTrack } from '@/lib/chartsApi';
import { isPlayableUrl } from '@/lib/audio';
import AutoCover from '@/components/AutoCover';

const NUM = (n: number) => n.toLocaleString('ko-KR');

const PODIUM_STYLES = {
  1: {
    ring: 'ring-amber-300/35',
    gradient: 'from-amber-400/22 via-yellow-500/8 to-transparent',
    rankBg: 'bg-gradient-to-br from-amber-300 to-amber-500 text-black',
    icon: <Crown size={11} fill="currentColor" />,
    badge: '1',
    glow: 'shadow-card',
  },
  2: {
    ring: 'ring-slate-300/25',
    gradient: 'from-slate-200/18 via-slate-400/6 to-transparent',
    rankBg: 'bg-gradient-to-br from-slate-200 to-slate-400 text-black',
    icon: <Medal size={10} />,
    badge: '2',
    glow: 'shadow-card',
  },
  3: {
    ring: 'ring-orange-400/25',
    gradient: 'from-orange-500/18 via-orange-600/6 to-transparent',
    rankBg: 'bg-gradient-to-br from-orange-300 to-orange-600 text-black',
    icon: <Medal size={10} />,
    badge: '3',
    glow: 'shadow-card',
  },
} as const;

export default function ChartPodium({
  tracks,
  onPlay,
  currentTrackId,
}: {
  tracks: ChartTrack[];
  onPlay: (idx: number) => void;
  currentTrackId?: string;
}) {
  if (tracks.length === 0) return null;
  const top3 = tracks.slice(0, 3);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {top3.map((track, idx) => {
        const rank = (idx + 1) as 1 | 2 | 3;
        const style = PODIUM_STYLES[rank];
        const playable = isPlayableUrl(track.audio_url);
        const isCurrent = currentTrackId === track.track_id;

        return (
          <button
            key={track.track_id}
            onClick={() => onPlay(idx)}
            className={`group relative overflow-hidden rounded-2xl bg-bg-card ring-1 ${style.ring} ${style.glow} p-3 text-left transition-transform hover:-translate-y-0.5 ${
              !playable ? 'opacity-70' : ''
            } ${isCurrent ? 'ring-2 ring-accent' : ''}`}
          >
            {/* 배경 그라데이션 */}
            <div
              className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${style.gradient}`}
            />

            <div className="relative flex items-center gap-3">
              {/* 커버 + 순위 뱃지 */}
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-line/15">
                <AutoCover
                  title={track.title}
                  category={track.genre}
                  imageUrl={track.cover_url}
                  size="md"
                />
                <div
                  className={`absolute -left-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full text-xs font-black shadow-lg ${style.rankBg}`}
                >
                  {style.badge}
                </div>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15" style={{ boxShadow: '0 8px 24px rgb(var(--color-accent) / 0.5)' }}>
                    <Play size={18} fill="currentColor" className="ml-0.5" />
                  </span>
                </div>
              </div>

              {/* 정보 */}
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                  {style.icon}
                  <span>
                    {rank === 1 ? '1위' : rank === 2 ? '2위' : '3위'}
                  </span>
                </div>
                <p
                  className={`flex items-center gap-1 truncate text-sm font-bold ${
                    isCurrent ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {!playable && (
                    <AlertCircle size={10} className="shrink-0 text-yellow-300" />
                  )}
                  {track.title}
                </p>
                <p className="truncate text-xs text-ink-mute">
                  {track.artist ?? '—'}
                </p>
                {track.play_count > 0 && (
                  <p className="text-[10px] font-semibold text-ink-dim">
                    {NUM(track.play_count)} 회 재생
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
