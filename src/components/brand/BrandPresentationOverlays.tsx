// Phase BRAND-PLAYER-UX-2 — Presentation Fullscreen 표시 옵션 오버레이.
//   브랜드명 / 현재 곡 / 시계(HH:mm) — 전부 opt-in(기본 off). 선택된 것만 노출한다.
//   옵션 UI 자체는 여기서 렌더하지 않는다(전체화면에는 결과만). audio/재생 상태는 절대 건드리지 않는다.
//   "현재 곡" 은 player store 에서 넘겨받은 title/artist 를 read-only 로 표시할 뿐(재생 제어 없음).
import { useEffect, useState } from 'react';
import { Music } from 'lucide-react';
import { formatClockHhMm } from '@/lib/brandSignageSettings';

interface Props {
  show: { brandName: boolean; nowPlaying: boolean; clock: boolean };
  brandName: string;
  /** player store 의 현재 곡(읽기 전용). title/artist 둘 다 없으면 현재곡 오버레이 미표시. */
  nowPlaying?: { title: string | null; artist: string | null } | null;
}

export default function BrandPresentationOverlays({ show, brandName, nowPlaying }: Props) {
  const hasTrack = !!(nowPlaying && (nowPlaying.title || nowPlaying.artist));
  return (
    <>
      {show.brandName && brandName && (
        <div className="pointer-events-none absolute left-6 top-6 z-[105] rounded-full bg-black/40 px-4 py-1.5 text-sm font-bold text-white/90 backdrop-blur-sm">
          {brandName}
        </div>
      )}
      {show.clock && <PresentationClock />}
      {show.nowPlaying && hasTrack && (
        <div className="pointer-events-none absolute bottom-6 left-6 z-[105] flex max-w-[70vw] items-center gap-2 rounded-full bg-black/40 px-4 py-2 text-white/90 backdrop-blur-sm">
          <Music size={14} className="shrink-0 text-accent" />
          <span className="truncate text-sm font-semibold">{nowPlaying?.title ?? '—'}</span>
          {nowPlaying?.artist && <span className="truncate text-xs text-white/60">· {nowPlaying.artist}</span>}
        </div>
      )}
    </>
  );
}

/** HH:mm 시계 — 분 단위 갱신(초 타이머 없음). 다음 분 경계에 맞춰 1회 정렬 후 60초 간격. */
function PresentationClock() {
  const [label, setLabel] = useState(() => formatClockHhMm(new Date()));
  useEffect(() => {
    let intervalId: number | undefined;
    const tick = () => setLabel(formatClockHhMm(new Date()));
    tick();
    const now = new Date();
    const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
    const alignId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, 60_000);
    }, Math.max(0, msToNextMinute));
    return () => {
      window.clearTimeout(alignId);
      if (intervalId) window.clearInterval(intervalId);
    };
  }, []);
  return (
    <div className="pointer-events-none absolute right-6 top-6 z-[105] rounded-full bg-black/40 px-4 py-1.5 text-sm font-bold tabular-nums text-white/90 backdrop-blur-sm">
      {label}
    </div>
  );
}
