import { Play } from 'lucide-react';
import type { ChartTrack } from '@/lib/chartsApi';
import { chartTrackToTrackRow } from '@/lib/chartsApi';
import { formatTime } from '@/lib/format';
import { getTrackPlaybackState } from '@/lib/trackPlayability';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
import TrackStateBadge from '@/components/TrackStateBadge';

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
  const state = getTrackPlaybackState(track);
  const playable = state === 'ready';
  const rank = track.rank || index + 1;

  function handleClick() {
    if (!playable) return; // 재생 불가 행은 클릭 무시
    onPlay();
  }

  return (
    <button
      onClick={handleClick}
      aria-disabled={!playable}
      title={!playable ? '재생할 수 없는 트랙입니다' : undefined}
      className={`group flex w-full items-center gap-3 px-3 py-2.5 text-left transition ${
        playable ? 'hover:bg-ink/5' : 'cursor-not-allowed opacity-[0.55]'
      } ${isCurrent ? 'bg-accent/10' : ''}`}
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
        {playable && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-lift ring-1 ring-white/15" style={{ boxShadow: '0 6px 18px rgb(var(--color-accent) / 0.5)' }}>
              <Play size={14} fill="currentColor" className="ml-0.5" />
            </span>
          </div>
        )}
      </div>

      {/* 정보 */}
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 truncate text-sm font-semibold ${
          isCurrent ? 'text-accent' : ''
        }`}>
          <span className="truncate">{track.title}</span>
          {!playable && <TrackStateBadge state={state} variant="pill" className="shrink-0" />}
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

      {/* 좋아요 버튼 — 호버 시 진하게 표시, 좋아요한 상태면 항상 표시 */}
      <span className="shrink-0 opacity-70 transition-opacity group-hover:opacity-100">
        <TrackLikeButton
          trackId={track.track_id}
          track={chartTrackToTrackRow(track)}
          size={14}
        />
      </span>

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
