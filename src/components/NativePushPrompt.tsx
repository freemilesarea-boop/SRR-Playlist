/**
 * NativePushPrompt — 앱을 열었을 때 알림 허용 묻기 (iOS/Android 앱만).
 *
 * 언제 무엇을 하는지는 lib/pushPrompt.ts 의 decidePushAction 이 정한다:
 *   이미 허용된 기기 → 조용히 토큰 재등록(sync)
 *   아직 안 물어본 기기 → 화면 아래 안내(ask) → '알림 받기'를 누르면 그때 OS 권한 창
 *   '나중에' → 7일 뒤 다시, 3번 미루면 더 묻지 않는다(내 정보 › 알림에서 켤 수 있다)
 * 웹·로그아웃 상태·매장/브랜드 플레이어 화면에서는 아무것도 하지 않는다.
 */
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { BellRing, X } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { nativePushSupported, checkNativePushPermission, enableNativePush } from '@/lib/nativePush';
import {
  decidePushAction, readPushPromptState, writePushPromptState, readPushOptedOut,
  snoozedState, ANSWERED_STATE, readOnboardingPending, isDevicePlayerRoute,
} from '@/lib/pushPrompt';

/** 앱이 뜨자마자 덮지 않게 잠깐 기다렸다 띄운다 */
const SHOW_DELAY_MS = 1500;
/** 첫 방문 안내 창이 닫혔는지 다시 보는 간격 */
const WAIT_POLL_MS = 2000;

export default function NativePushPrompt() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // 한 번 실행에 한 번만 판단한다(로그인한 사용자가 바뀌면 다시)
  const decidedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || decidedFor.current === userId) return;
    if (!nativePushSupported()) return;
    let alive = true;
    let timer = 0;
    const check = async () => {
      const permission = await checkNativePushPermission();
      if (!alive) return;
      const action = decidePushAction({
        native: true,
        loggedIn: true,
        permission,
        optedOut: readPushOptedOut(),
        pathname: window.location.pathname,
        state: readPushPromptState(),
        onboardingPending: readOnboardingPending(),
      });
      if (action === 'wait') {
        // 첫 방문 안내 창을 닫을 때까지 기다렸다 다시 본다
        timer = window.setTimeout(() => void check(), WAIT_POLL_MS);
        return;
      }
      decidedFor.current = userId;
      if (action === 'sync') {
        void enableNativePush(); // 이미 허용 — 권한 창 없이 토큰만 다시 저장
      } else if (action === 'ask') {
        setOpen(true);
      }
    };
    timer = window.setTimeout(() => void check(), SHOW_DELAY_MS);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [userId]);

  // 매장·브랜드 플레이어 화면으로 넘어가면 닫는다(무인 재생 화면을 덮지 않게)
  useEffect(() => {
    if (open && isDevicePlayerRoute(pathname)) setOpen(false);
  }, [open, pathname]);

  if (!open) return null;

  function later() {
    writePushPromptState(snoozedState(readPushPromptState()));
    setOpen(false);
  }

  async function allow() {
    setBusy(true);
    const r = await enableNativePush();
    setBusy(false);
    // OS 창까지 띄웠으면 허용·거절과 상관없이 앱 안 안내는 끝
    writePushPromptState(ANSWERED_STATE);
    setOpen(false);
    if (r.ok) toast.success('알림을 켰어요. 공지와 매장 소식을 바로 알려 드릴게요.');
    else if (r.error === 'permission_denied') toast.info('알림은 휴대폰 설정 › 듣다 › 알림에서 언제든 켤 수 있어요.');
    else toast.error('알림 등록에 실패했어요. 내 정보 › 알림에서 다시 시도해 주세요.');
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:pb-6"
      role="dialog" aria-modal="false" aria-labelledby="push-prompt-title">
      <div className="w-full max-w-md rounded-2xl bg-bg-card p-4 shadow-2xl ring-1 ring-line/15">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <BellRing size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="push-prompt-title" className="text-sm font-bold">알림을 받아 보세요</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-mute">
              점검·업데이트 공지와 매장 운영 소식을 놓치지 않게 바로 알려 드려요.
            </p>
          </div>
          <button type="button" onClick={later} aria-label="닫기" className="rounded p-1 text-ink-dim hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={later} disabled={busy}
            className="flex-1 rounded-xl bg-bg-soft py-2.5 text-sm font-semibold text-ink-mute ring-1 ring-line/10 disabled:opacity-50">
            나중에
          </button>
          <button type="button" onClick={() => void allow()} disabled={busy}
            className="btn-primary flex-1 justify-center py-2.5 text-sm font-bold disabled:opacity-50">
            {busy ? '확인 중…' : '알림 받기'}
          </button>
        </div>
      </div>
    </div>
  );
}
