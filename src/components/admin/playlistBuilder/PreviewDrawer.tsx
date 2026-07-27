/**
 * PreviewDrawer — UX-2 Playlist Preview(관리자용 짧은 미리듣기).
 *
 * 안전: 자체 HTMLAudioElement 만 사용한다. Store Player/Queue/Crossfade/정산/학습에
 *   전혀 관여하지 않는다(record_play_event/playbackFeedback 호출 없음). Queue 생성 없음.
 *   자동재생은 사용자 제스처(재생 버튼) 이후에만 발생한다.
 */
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { AdminModal } from '@/components/admin/ui';
import { type BuilderTrack, formatTotalDuration, totalDuration, effectiveScore } from '@/lib/playlistBuilder';

export function PreviewDrawer({
  open,
  onClose,
  tracks,
  startIndex = 0,
}: {
  open: boolean;
  onClose: () => void;
  tracks: BuilderTrack[];
  startIndex?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(startIndex);
  const [playing, setPlaying] = useState(false);
  const startedRef = useRef(false); // 사용자 제스처로 재생을 시작했는지

  // 열릴 때 시작 인덱스로 초기화.
  useEffect(() => {
    if (open) {
      setIndex(Math.min(Math.max(0, startIndex), Math.max(0, tracks.length - 1)));
      setPlaying(false);
      startedRef.current = false;
    }
  }, [open, startIndex, tracks.length]);

  // 닫히면 재생 정지.
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
    }
  }, [open]);

  const current = tracks[index] ?? null;

  // index 변경 시: 이미 재생 중이었다면(사용자 제스처 이후) 자동으로 다음 곡 재생.
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !current) return;
    if (startedRef.current && playing) {
      el.play().catch(() => setPlaying(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const play = () => {
    const el = audioRef.current;
    if (!el || !current?.audioUrl) return;
    startedRef.current = true;
    el.play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  };
  const pause = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };
  const go = (next: number) => {
    if (tracks.length === 0) return;
    const clamped = ((next % tracks.length) + tracks.length) % tracks.length;
    setIndex(clamped);
  };

  return (
    <AdminModal open={open} onClose={onClose} title="플레이리스트 미리듣기" size="lg">
      <div className="space-y-3">
        <p className="rounded-lg bg-line/5 px-3 py-2 text-[11px] text-ink-mute">
          미리듣기는 관리자 확인용입니다 — 정산·학습·통계에 반영되지 않으며 매장 재생/큐를 생성하지 않습니다. 총{' '}
          {formatTotalDuration(totalDuration(tracks))} · {tracks.length}곡
        </p>

        {current && (
          <div className="rounded-lg border border-line/10 p-3">
            <p className="truncate text-sm font-medium">
              #{index + 1} {current.title ?? '제목 없음'}
            </p>
            <p className="truncate text-xs text-ink-mute">
              {current.artist ?? '—'}
              {current.genre ? ` · ${current.genre}` : ''}
              {effectiveScore(current) != null ? ` · 점수 ${Math.round(effectiveScore(current)!)}` : ''}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button className="btn-ghost h-8 px-2" onClick={() => go(index - 1)} aria-label="이전 트랙">
                <SkipBack size={15} />
              </button>
              {playing ? (
                <button className="btn-primary h-8 gap-1 px-3 text-sm" onClick={pause} aria-label="일시정지">
                  <Pause size={14} /> 정지
                </button>
              ) : (
                <button
                  className="btn-primary h-8 gap-1 px-3 text-sm disabled:opacity-50"
                  onClick={play}
                  disabled={!current.audioUrl}
                  aria-label="재생"
                  title={!current.audioUrl ? '오디오 없음' : undefined}
                >
                  <Play size={14} /> 재생
                </button>
              )}
              <button className="btn-ghost h-8 px-2" onClick={() => go(index + 1)} aria-label="다음 트랙">
                <SkipForward size={15} />
              </button>
            </div>
            {/* 자체 audio element — controls 로 스크럽 허용. onEnded → 다음 곡. */}
            <audio
              ref={audioRef}
              src={current.audioUrl ?? undefined}
              controls
              preload="none"
              className="mt-2 h-8 w-full"
              onEnded={() => go(index + 1)}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
          </div>
        )}

        <ol className="max-h-[40vh] divide-y divide-line/10 overflow-y-auto rounded-lg border border-line/10">
          {tracks.map((t, i) => (
            <li
              key={t.track_id}
              className={`flex items-center gap-2 p-2 text-sm ${i === index ? 'bg-accent/5' : ''}`}
            >
              <span className="w-6 shrink-0 text-right text-xs tabular-nums text-ink-dim">{i + 1}</span>
              <button className="min-w-0 flex-1 text-left" onClick={() => go(i)}>
                <p className="truncate text-sm">{t.title ?? '제목 없음'}</p>
                <p className="truncate text-xs text-ink-mute">{t.artist ?? '—'}</p>
              </button>
              <span className="shrink-0 text-xs text-ink-dim">{formatTotalDuration(t.duration ?? 0)}</span>
            </li>
          ))}
        </ol>
      </div>
    </AdminModal>
  );
}
