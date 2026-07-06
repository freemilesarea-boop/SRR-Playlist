import { AlertCircle, Loader2 } from 'lucide-react';
import type { TrackPlaybackState } from '@/lib/trackPlayability';
import { trackPlaybackStateLabel } from '@/lib/trackPlayability';

interface Props {
  state: TrackPlaybackState;
  /** 'pill' = 라벨 텍스트 포함 배지, 'icon' = 작은 아이콘만 (썸네일 코너용) */
  variant?: 'pill' | 'icon';
  className?: string;
}

/**
 * 재생 불가 트랙 상태 표시. state==='ready' 이면 아무것도 렌더 안 함.
 */
export default function TrackStateBadge({ state, variant = 'pill', className = '' }: Props) {
  if (state === 'ready') return null;

  const Icon = state === 'processing' ? Loader2 : AlertCircle;
  const tone =
    state === 'processing'
      ? 'bg-blue-500/25 text-slate-900 dark:text-blue-200 ring-blue-300/30'
      : 'bg-yellow-500/25 text-slate-900 dark:text-yellow-200 ring-yellow-300/30';

  if (variant === 'icon') {
    return (
      <span
        aria-label={trackPlaybackStateLabel(state)}
        title={trackPlaybackStateLabel(state)}
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full ring-1 ${tone} ${className}`}
      >
        <Icon size={11} className={state === 'processing' ? 'animate-spin' : ''} />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ring-1 ${tone} ${className}`}
    >
      <Icon size={9} className={state === 'processing' ? 'animate-spin' : ''} />
      {trackPlaybackStateLabel(state)}
    </span>
  );
}
