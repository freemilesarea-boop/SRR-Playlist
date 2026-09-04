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
 *
 *  3. 구독 만료 — 무료 등급으로 매장 플레이어를 돌리면 곡당 25초만 나오고 멈춰서
 *     "음악이 중간에 끊긴다" 로 보인다. 매장에서는 미리듣기를 주지 않고 이유를 명시한다.
 *     이 화면은 눌러서 닫을 수 없다 — 결제 전까지 재생이 불가능한 상태이기 때문.
 */
import { Link } from 'react-router-dom';
import { usePlaybackHealthStore } from '@/store/playbackHealthStore';
import { usePlayerStore } from '@/store/playerStore';
import { applyPendingUpdateNow } from '@/lib/swUpdateGate';
import { Play, RefreshCw, CreditCard } from 'lucide-react';

export default function PlaybackBlockedOverlay() {
  const autoplayBlocked = usePlaybackHealthStore((s) => s.autoplayBlocked);
  const swUpdatePending = usePlaybackHealthStore((s) => s.swUpdatePending);
  const subscriptionBlocked = usePlaybackHealthStore((s) => s.subscriptionBlocked);
  const setAutoplayBlocked = usePlaybackHealthStore((s) => s.setAutoplayBlocked);
  const play = usePlayerStore((s) => s.play);

  function resume() {
    // 이 클릭이 곧 사용자 제스처 — 브라우저 자동재생 제한이 풀린다.
    setAutoplayBlocked(false);
    play();
  }

  // 구독 차단이 최우선 — 결제 전까지는 어떤 조작으로도 재생이 안 된다.
  if (subscriptionBlocked) {
    return (
      <div className="fixed inset-0 z-[130] flex flex-col items-center justify-center gap-6 bg-black/97 px-8 text-center">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-amber-400/15 ring-2 ring-amber-400/40">
          <CreditCard size={42} className="text-amber-300" />
        </div>
        <div>
          <p className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            구독이 만료되어 매장 재생이 중단되었습니다
          </p>
          <p className="mt-3 text-base leading-relaxed text-white/70 sm:text-lg">
            결제가 확인되지 않아 매장 음악을 재생할 수 없습니다.<br />
            결제를 완료하시면 즉시 이어서 재생됩니다.
          </p>
        </div>
        <Link
          to="/pricing"
          className="rounded-full bg-white px-7 py-3.5 text-base font-bold text-black transition hover:opacity-90"
        >
          결제하고 이어서 이용하기
        </Link>
        <p className="text-xs text-white/40">
          이미 결제하셨다면 잠시 후 자동으로 재생이 시작됩니다.
        </p>
      </div>
    );
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
