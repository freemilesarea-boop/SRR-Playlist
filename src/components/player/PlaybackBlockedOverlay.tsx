/**
 * PlaybackBlockedOverlay — 매장/브랜드 플레이어 전용 전체화면 안내.
 *
 * 두 가지를 무인 매장에서 "눈에 보이게" 만든다.
 *
 *  1. 자동재생 차단 — 서비스워커가 새 빌드를 받아 페이지를 스스로 리로드하면 사용자
 *     제스처가 없는 상태로 재생이 시작되는데, 브라우저 자동재생 정책이 이를 막는다.
 *     기존에는 작은 토스트만 떠서 아무도 없는 매장에서는 그대로 무음이 됐다.
 *     화면 전체를 덮고 아무 데나 누르면 즉시 이어지게 한다.
 *
 *  2. 업데이트 대기 — 재생 중에는 자동 리로드를 미루므로(swUpdateGate), 운영자가
 *     원할 때 직접 적용할 수 있는 경로를 남긴다. 재생을 끊지 않도록 작은 칩으로만.
 */
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { usePlayerStore } from '@/store/playerStore';
import { applyPendingUpdateNow } from '@/lib/swUpdateGate';
import { Play, RefreshCw } from 'lucide-react';

export default function PlaybackBlockedOverlay() {
  const autoplayBlocked = usePlaybackHealthStore((s) => s.autoplayBlocked);
  const swUpdatePending = usePlaybackHealthStore((s) => s.swUpdatePending);
  const setAutoplayBlocked = usePlaybackHealthStore((s) => s.setAutoplayBlocked);
  const play = usePlayerStore((s) => s.play);

  function resume() {
    // 이 클릭이 곧 사용자 제스처 — 브라우저 자동재생 제한이 풀린다.
    setAutoplayBlocked(false);
    play();
  }

  if (autoplayBlocked) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={resume}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') resume(); }}
        className="fixed inset-0 z-[120] flex cursor-pointer flex-col items-center justify-center gap-6 bg-black/95 px-8 text-center"
      >
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-2 ring-white/25">
          <Play size={44} className="ml-1 text-white" />
        </div>
        <div>
          <p className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            화면을 눌러 음악을 이어주세요
          </p>
          <p className="mt-3 text-base text-white/70 sm:text-lg">
            브라우저 보안 정책 때문에 자동으로 소리를 켤 수 없습니다.<br />
            아무 곳이나 한 번 누르면 바로 이어집니다.
          </p>
        </div>
      </div>
    );
  }

  if (swUpdatePending) {
    return (
      <button
        onClick={applyPendingUpdateNow}
        className="fixed bottom-4 left-1/2 z-[110] -translate-x-1/2 inline-flex items-center gap-2 rounded-full bg-white/12 px-4 py-2 text-xs font-semibold text-white ring-1 ring-white/25 backdrop-blur hover:bg-white/20"
      >
        <RefreshCw size={13} />
        업데이트 준비됨 · 지금 적용 (음악이 잠깐 끊깁니다)
      </button>
    );
  }

  return null;
}
