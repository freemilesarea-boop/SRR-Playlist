import { Play } from 'lucide-react';
import type { ChartTrack } from '@/lib/chartsApi';
import { chartTrackToTrackRow } from '@/lib/chartsApi';
import { formatTime } from '@/lib/format';
import { getTrackPlaybackState } from '@/lib/trackPlayability';
import AutoCover from '@/components/AutoCover';
import TrackLikeButton from '@/components/TrackLikeButton';
import AddToPlaylistButton from '@/components/AddToPlaylistButton';
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
      className={`group flex w-full items-center gap-4 rounded-xl px-3 py-3 text-left transition-colors duration-smooth sm:gap-5 sm:px-4 ${
        playable ? 'hover:bg-ink/8' : 'cursor-not-allowed opacity-[0.55]'
      } ${isCurrent ? 'bg-accent/12 ring-1 ring-accent/25' : ''}`}
    >
      {/* DEUDDA §7.2 — 순위 슬롯: 평상시 rank, hover 시 play icon, 재생 중이면 EQ glyph */}
      <div className="relative flex h-6 w-8 shrink-0 items-center justify-center sm:w-10">
        {isCurrent ? (
          <span className="eq-bars text-accent" aria-label="재생 중">
            <span /><span /><span />
          </span>
        ) : (
          <>
            <span className="font-mono text-sm font-medium tabular-nums text-ink-mute transition-opacity duration-smooth ease-emphasized group-hover:opacity-0">
              {rank.toString().padStart(2, '0')}
            </span>
            {playable && (
              <Play
                size={13}
                fill="currentColor"
                className="absolute text-ink opacity-0 transition-opacity duration-smooth ease-emphasized group-hover:opacity-100"
                aria-hidden
              />
            )}
          </>
        )}
      </div>

      {/* 커버 */}
      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg ring-1 ring-line/10 sm:h-14 sm:w-14">
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

      {/* 우측 액션 영역 — 정렬 통일 */}
      <div className="flex shrink-0 items-center gap-3 sm:gap-4">
        {/* 좋아요 + 플레이리스트 담기 */}
        <span className="flex items-center gap-2 opacity-70 transition-opacity group-hover:opacity-100">
          <TrackLikeButton
            trackId={track.track_id}
            track={chartTrackToTrackRow(track)}
            size={14}
          />
          {playable && <AddToPlaylistButton trackId={track.track_id} variant="bare" size={15} />}
        </span>

        {/* 재생 수 — 고정 폭 */}
        <div className="hidden w-20 text-right md:block">
          <p className="text-xs font-semibold tabular-nums text-ink">
            {NUM(track.play_count)}
            <span className="ml-1 text-[10px] font-normal text-ink-dim">회</span>
          </p>
          {track.completed_count > 0 && (
            <p className="text-[10px] text-ink-dim">완료 {NUM(track.completed_count)}</p>
          )}
        </div>
        <div className="w-12 text-right md:hidden">
          {track.play_count > 0 ? (
            <p className="text-xs font-semibold tabular-nums text-ink-mute">
              {NUM(track.play_count)}
            </p>
          ) : (
            <p className="text-[10px] text-ink-dim">{track.duration ? formatTime(track.duration) : ''}</p>
          )}
        </div>
      </div>
    </button>
  );
}
