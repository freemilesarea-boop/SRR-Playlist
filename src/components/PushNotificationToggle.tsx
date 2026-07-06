import { useState } from 'react';
import { Bell, BellOff, AlertCircle, Send } from 'lucide-react';
import { usePushSubscription } from '@/hooks/usePushSubscription';
import { sendPush } from '@/lib/pushApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';

/**
 * PWA Web Push 알림 on/off 토글.
 *
 * 표시 조건:
 *   - 브라우저가 Notification + ServiceWorker + PushManager 지원
 *   - VITE_VAPID_PUBLIC_KEY 환경변수 설정됨
 * 미지원이면 안내 한 줄 (선택적 — 디폴트 hidden).
 *
 * 알림 권한 / 구독 상태에 따라 4가지 표시:
 *   - default(미요청) + 미구독: "알림 켜기" 버튼
 *   - granted + 구독됨: "알림 켜져 있음" + 끄기 버튼
 *   - denied: "차단됨" 안내 (브라우저 설정에서 풀어야 함)
 *   - granted but unsubscribed: "다시 켜기" 버튼
 */
export default function PushNotificationToggle({
  showWhenUnsupported = false,
}: {
  showWhenUnsupported?: boolean;
}) {
  const { supported, permission, subscribed, busy, error, subscribe, unsubscribe } =
    usePushSubscription();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    if (!userId || testing) return;
    setTesting(true);
    try {
      const r = await sendPush({
        user_id: userId,
        title: '🔔 DEUDDA 테스트 알림',
        body: '푸시 알림이 정상 동작해요. 매장 운영 이벤트가 발생하면 여기로 알려드릴게요.',
        url: '/profile',
        tag: 'test',
      });
      if (r.ok && r.sent > 0) {
        toast.success(`푸시 ${r.sent}건 발송됨`);
      } else if (r.ok && r.candidates === 0) {
        toast.info('구독된 디바이스가 없어요. 위에서 "켜기" 먼저 해주세요.');
      } else {
        toast.error(r.error ?? '푸시 발송 실패');
      }
    } finally {
      setTesting(false);
    }
  }

  if (!supported) {
    if (!showWhenUnsupported) return null;
    return (
      <div className="flex items-start gap-2 rounded-xl bg-bg-card p-3 text-xs text-ink-dim ring-1 ring-line/10">
        <AlertCircle size={14} className="mt-0.5 shrink-0" />
        <div>
          이 브라우저는 푸시 알림을 지원하지 않거나 VAPID 키가 설정되지 않았어요. Chrome / Edge 또는 PWA 설치 후 사용 가능.
        </div>
      </div>
    );
  }

  const blocked = permission === 'denied';
  const on = permission === 'granted' && subscribed;

  return (
    <div className="space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            on
              ? 'bg-accent/15 text-accent'
              : blocked
                ? 'bg-red-500/20 text-red-300'
                : 'bg-ink/10 text-ink-mute'
          }`}
        >
          {on ? <Bell size={16} /> : <BellOff size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {on ? '푸시 알림이 켜져 있어요' : blocked ? '푸시 알림이 차단됨' : '푸시 알림 받기'}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-mute">
            {on
              ? '매장 모드 중단/자동 전환 실패/체험 만료 등 운영 이벤트를 폰으로 받아요.'
              : blocked
                ? '브라우저 주소창 좌측 자물쇠 아이콘에서 알림을 허용한 뒤 다시 시도해주세요.'
                : '매장 사장님이 자리 비웠을 때 운영 이벤트를 폰으로 알려드려요.'}
          </p>
          {error && <p className="mt-1 text-[11px] text-red-300">에러: {error}</p>}
        </div>
        {!blocked && (
          <div className="flex shrink-0 items-center gap-1.5">
            {on && (
              <button
                onClick={() => void sendTest()}
                disabled={testing || !userId}
                aria-label="테스트 푸시 발송"
                title="이 디바이스에 테스트 푸시 보내기"
                className="rounded-full bg-bg-soft p-2 text-ink-mute ring-1 ring-line/15 hover:text-ink disabled:opacity-50"
              >
                <Send size={12} />
              </button>
            )}
            <button
              onClick={() => (on ? void unsubscribe() : void subscribe())}
              disabled={busy}
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
                on
                  ? 'bg-bg-soft text-ink-mute ring-1 ring-line/15 hover:text-ink'
                  : 'bg-accent text-bg hover:opacity-90'
              }`}
            >
              {busy ? '처리 중…' : on ? '끄기' : '켜기'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
