import { useEffect, useState } from 'react';
import { isNativeApp } from '@/lib/native';
import { screenAwakeMode } from '@/lib/screenAwake';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // 네이티브 쉘(App Store / Play 스토어로 설치된 앱)은 이미 '설치된 앱'이다.
  // WebView 는 display-mode: standalone 이 아니므로 명시 가드가 없으면
  // 앱 안에서 "홈 화면에 추가" 배너가 다시 뜬다.
  if (isNativeApp()) return true;
  // iOS Safari
  if ((navigator as unknown as { standalone?: boolean }).standalone) return true;
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false;
}

export function useInstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    function onBeforeInstall(e: Event) {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
      setEvent(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function prompt() {
    if (!event) return false;
    await event.prompt();
    const choice = await event.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setEvent(null);
    return choice.outcome === 'accepted';
  }

  return { canInstall: !!event, installed, prompt };
}

/** @deprecated 화면 꺼짐 방지 지원 여부는 screenAwakeMode() 를 쓴다(네이티브 포함). */
export function wakeLockSupported(): boolean {
  return screenAwakeMode() !== 'unsupported';
}
