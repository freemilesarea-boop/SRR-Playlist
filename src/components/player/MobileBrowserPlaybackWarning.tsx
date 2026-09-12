/**
 * MobileBrowserPlaybackWarning — 폰 브라우저로 매장 음악을 틀어둘 때의 경고.
 *
 * 숙대점(2026-09-11)에서 PC → 폰으로 갈아탄 뒤 백그라운드 2시간 50분 만에
 * 음악이 끊겼다. 매장은 폰으로 틀어도 괜찮은 줄 알았고, 우리도 알려준 적이 없다.
 *
 * 이 배너는 끊김을 막지 못한다 — 웹에서는 막을 수단이 없다(포그라운드 서비스 불가).
 * 막을 수 있는 건 **모르고 폰으로 틀어두는 것** 뿐이라 여기서 그것만 한다.
 *
 * 닫기는 이 화면을 띄워둔 동안만 유효하다(컴포넌트 state). 새로고침하면 다시 뜬다 —
 * 매장 플레이어는 한 번 열어 며칠을 돌리므로, 영구히 숨기면 경고가 사라진 것과 같다.
 */
import { useState } from 'react';
import { Smartphone, X } from 'lucide-react';
import InstallAppButton from '@/components/InstallAppButton';
import { isNativeApp } from '@/lib/native';
import { isStandalone } from '@/hooks/useInstallPrompt';
import { currentPlaybackDeviceRisk, shouldWarnMobileBrowser } from '@/lib/mobileBrowserPlaybackRisk';

export default function MobileBrowserPlaybackWarning({ className = '' }: { className?: string }) {
  const [dismissed, setDismissed] = useState(false);
  // 판정은 매 렌더 싸다(문자열 정규식 1회). 기기가 바뀌면 어차피 새 세션이다.
  // isStandalone() — 설치를 마친 매장에는 더 권할 게 없으므로 배너를 내린다.
  const risk = currentPlaybackDeviceRisk(isNativeApp(), isStandalone());

  if (dismissed || !shouldWarnMobileBrowser(risk)) return null;

  return (
    <div
      role="status"
      className={`flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl bg-amber-500/15 px-3 py-2.5 text-[12px] leading-relaxed text-amber-100 ring-1 ring-amber-400/30 ${className}`}
    >
      <Smartphone size={14} className="mt-0.5 shrink-0 text-amber-300" />
      <p className="min-w-[12rem] flex-1">
        <b className="font-bold text-amber-50">인터넷 창으로 재생 중입니다.</b>{' '}
        화면이 꺼지거나 다른 앱으로 넘어가면 <b className="font-bold text-amber-50">음악이 멈출 수 있어요.</b>{' '}
        오른쪽 <b className="font-bold text-amber-50">[매장용 앱 설치]</b>를 누르시면 홈 화면에 앱이 생기고, 그걸로 켜시면 잘 안 끊깁니다.
      </p>
      <div className="flex shrink-0 items-center gap-1">
        <InstallAppButton variant="ghost" label="매장용 앱 설치" />
        <button
          onClick={() => setDismissed(true)}
          aria-label="경고 닫기"
          className="rounded-full p-1 text-amber-200/70 hover:bg-amber-400/15 hover:text-amber-100"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
