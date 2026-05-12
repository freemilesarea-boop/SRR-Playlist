import { Play, AlertCircle } from 'lucide-react';
import type { ChartTrack } from '@/lib/chartsApi';
import { formatTime } from '@/lib/format';
import { isPlayableUrl } from '@/lib/audio';
import AutoCover from '@/components/AutoCover';

const NUM = (n: number) => n.toLocaleString('ko-KR');

export default function ChartRow({
  track,
  index,
  isCurrent,
  onPlay,
}: {
  track: ChartTrack;
  index: number;
  isCurrent?: boolean;
  onPlay: () => void;
}) {
  const playable = isPlayableUrl(track.audio_url);
  const rank = track.rank || index + 1;

  return (
    <button
      onClick={onPlay}
      className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-ink/5 ${
        isCurrent ? 'bg-accent/10' : ''
      } ${!playable ? 'opacity-60' : ''}`}
    >
      {/* 순위 */}
      <div className="w-7 shrink-0 text-right text-sm font-bold tabular-nums">
        <span className={isCurrent ? 'text-accent' : 'text-ink-mute'}>
          {rank.toString().padStart(2, '0')}
        </span>
      </div>

      {/* 커버 */}
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10">
        <AutoCover
          title={track.title}
          category={track.genre}
          imageUrl={track.cover_url}
          size="sm"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover:opacity-100">
          <Play size={16} fill="currentColor" className="text-white" />
        </div>
      </div>

      {/* 정보 */}
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1 truncate text-sm font-semibold ${
          isCurrent ? 'text-accent' : ''
        }`}>
          {!playable && <AlertCircle size={10} className="shrink-0 text-yellow-300" />}
          {track.title}
        </p>
        <p className="truncate text-xs text-ink-mute">
          {track.artist ?? '—'}
          {track.genre && (
            <>
              <span className="mx-1.5 text-ink-dim">·</span>
              <span className="text-ink-dim">{track.genre}</span>
            </>
          )}
        </p>
      </div>

      {/* 재생 수 (모바일 짧게, 데스크탑 자세히) */}
      <div className="hidden shrink-0 text-right md:block">
        <p className="text-xs font-semibold tabular-nums text-ink">
          {NUM(track.play_count)}
          <span className="ml-1 text-[10px] font-normal text-ink-dim">회</span>
        </p>
        {track.completed_count > 0 && (
          <p className="text-[10px] text-ink-dim">완료 {NUM(track.completed_count)}</p>
        )}
      </div>
      <div className="shrink-0 text-right md:hidden">
        {track.play_count > 0 ? (
          <p className="text-xs font-semibold tabular-nums text-ink-mute">
            {NUM(track.play_count)}
          </p>
        ) : (
          <p className="text-[10px] text-ink-dim">{track.duration ? formatTime(track.duration) : ''}</p>
        )}
      </div>
    </button>
  );
}
