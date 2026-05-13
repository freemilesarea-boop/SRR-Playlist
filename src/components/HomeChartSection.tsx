import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ChevronRight } from 'lucide-react';
import { fetchTrackChart, chartTrackToTrackRow, type ChartTrack } from '@/lib/chartsApi';
import { isPlayableUrl } from '@/lib/audio';
import { filterPlayableTracks } from '@/lib/trackPlayability';
import { usePlayerStore } from '@/store/playerStore';
import { toast } from '@/store/toastStore';
import ChartRow from './charts/ChartRow';

export default function HomeChartSection() {
  const [tracks, setTracks] = useState<ChartTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const setQueue = usePlayerStore((s) => s.setQueue);
  const currentTrackId = usePlayerStore((s) => s.queue[s.index]?.id);

  useEffect(() => {
    let alive = true;
    fetchTrackChart('daily', 5)
      .then((res) => {
        if (!alive) return;
        setTracks(res.tracks);
        setIsFallback(res.isFallback);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  function handlePlay(idx: number) {
    if (tracks.length === 0) return;
    if (!isPlayableUrl(tracks[idx]?.audio_url)) return; // 재생 불가 행은 변경 없음
    const rows = tracks.map(chartTrackToTrackRow);
    const { playable } = filterPlayableTracks(rows);
    if (playable.length === 0) {
      toast.info('아직 재생 가능한 음원이 없어요.');
      return;
    }
    const targetId = tracks[idx].track_id;
    const startIndex = Math.max(0, playable.findIndex((t) => t.id === targetId));
    setQueue(playable, startIndex < 0 ? 0 : startIndex, null);
  }

  if (loading) return null;
  if (tracks.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between px-0.5">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-bold tracking-tight sm:text-xl">
            <BarChart3 size={16} className="text-accent" />
            오늘의 차트
          </h2>
          <p className="mt-0.5 text-xs text-ink-mute">
            {isFallback ? '추천 트랙 미리보기' : '지금 가장 많이 듣는 곡 TOP 5'}
          </p>
        </div>
        <Link
          to="/charts"
          className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent hover:underline"
        >
          전체 차트
          <ChevronRight size={12} />
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10">
        <ul className="divide-y divide-line/10">
          {tracks.map((t, i) => (
            <li key={t.track_id}>
              <ChartRow
                track={t}
                index={i}
                isCurrent={currentTrackId === t.track_id}
                onPlay={() => handlePlay(i)}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
