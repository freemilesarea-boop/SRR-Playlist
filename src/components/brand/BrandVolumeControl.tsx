// Phase BRAND-PLAYER-UX-5 — 전체화면 볼륨 컨트롤(아이콘 + Mute + 슬라이더).
// 기존 PlayerStore volume(0..1)/setVolume/toggleMute 를 재사용 — 별도 volume state 없음.
import { useCallback } from 'react';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { usePlayerStore } from '@/store/playerStore';

interface Props {
  onHold?: (held: boolean) => void;
  onActivity?: () => void;
  /** 모바일 등에서 슬라이더 숨김(아이콘 Mute 토글만). */
  compact?: boolean;
}

export default function BrandVolumeControl({ onHold, onActivity, compact = false }: Props) {
  const volume = usePlayerStore((s) => s.volume);       // 0..1
  const setVolume = usePlayerStore((s) => s.setVolume);
  const toggleMute = usePlayerStore((s) => s.toggleMute);

  const pct = Math.round(volume * 100);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const label = volume === 0 ? '음소거 해제' : '음소거';

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(e.target.value) / 100); // UI 0..100 → store 0..1
    onActivity?.();
  }, [setVolume, onActivity]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => { toggleMute(); onActivity?.(); }}
        aria-label={label}
        className="rounded-full bg-white/10 p-2.5 text-white hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Icon size={18} />
      </button>
      {!compact && (
        <input
          type="range"
          min={0}
          max={100}
          value={pct}
          onChange={onChange}
          onPointerDown={() => { onHold?.(true); onActivity?.(); }}
          onPointerUp={() => onHold?.(false)}
          onPointerCancel={() => onHold?.(false)}
          onKeyDown={() => onActivity?.()}
          aria-label="볼륨"
          aria-valuetext={`${pct}%`}
          className="h-1.5 w-20 cursor-pointer accent-accent"
        />
      )}
    </div>
  );
}
