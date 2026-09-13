/**
 * PlayerRecoveryOptIn — 매장 플레이어에 "끊김 자동 복구" 를 켜는 한 줄 안내.
 *
 * 왜 필요한가 — 숙대점 2026-09-12:
 *   02:50 에 탭이 죽어 07:18 에 점주가 직접 열 때까지 4시간 28분 무음이었다.
 *   탭이 죽으면 페이지 JS 는 한 줄도 안 돌아 스스로 살아날 수 없다.
 *   서비스워커만이 푸시로 깨어나 재생을 되살릴 수 있는데(playerRecoverySignal.ts),
 *   **푸시를 받으려면 매장이 알림을 한 번 허용해야 한다.**
 *
 *   구독이 없으면 서버가 복구 신호를 보내도 기기에 닿지 않는다. 실제로 숙대점·
 *   화정점 모두 구독 0건이라 그 경로가 통째로 무력한 상태였다.
 *
 * 브라우저는 사용자 제스처 없는 권한 요청을 막으므로 자동으로 켤 수 없다.
 * 그래서 버튼 하나로 줄인다 — 매장이 눌러야 할 것은 이것 하나뿐이다.
 *
 * 이미 허용했거나 미지원 환경이면 아무것도 그리지 않는다.
 */
import { useState } from 'react';
import { BellRing, Check } from 'lucide-react';
import { usePushSubscription } from '@/hooks/usePushSubscription';

export default function PlayerRecoveryOptIn({ className = '' }: { className?: string }) {
  const { supported, permission, subscribed, busy, error, subscribe } = usePushSubscription();
  const [justEnabled, setJustEnabled] = useState(false);

  // 지원 안 하거나(구형 브라우저·VAPID 미설정) 이미 켜져 있으면 조용히 사라진다.
  if (!supported || subscribed || justEnabled) {
    return justEnabled ? (
      <p className={`flex items-center gap-1.5 text-[12px] text-emerald-300 ${className}`}>
        <Check size={13} className="shrink-0" /> 자동 복구를 켰습니다. 이제 음악이 멈추면 스스로 다시 켜집니다.
      </p>
    ) : null;
  }

  // 사용자가 예전에 '차단' 을 눌렀으면 버튼을 눌러도 소용없다 — 푸는 법을 알려준다.
  if (permission === 'denied') {
    return (
      <p className={`text-[12px] leading-relaxed text-white/55 ${className}`}>
        음악이 멈췄을 때 자동으로 복구하려면 알림이 필요합니다. 주소창 왼쪽 자물쇠 → <b className="text-white/75">알림</b> 을 허용으로 바꿔주세요.
      </p>
    );
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 text-[12px] leading-relaxed text-white/60 ${className}`}>
      <BellRing size={13} className="shrink-0 text-white/45" />
      <p className="min-w-[12rem] flex-1">
        음악이 멈추면 <b className="text-white/80">스스로 다시 켜지도록</b> 할 수 있어요. 알림을 한 번 허용해주세요.
      </p>
      <button
        type="button"
        onClick={() => { void subscribe().then(() => setJustEnabled(true)).catch(() => { /* error 로 표시된다 */ }); }}
        disabled={busy}
        className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-bold text-white hover:bg-white/20 disabled:opacity-50"
      >
        {busy ? '켜는 중…' : '자동 복구 켜기'}
      </button>
      {error && <span className="w-full text-[11px] text-amber-300">{error}</span>}
    </div>
  );
}
