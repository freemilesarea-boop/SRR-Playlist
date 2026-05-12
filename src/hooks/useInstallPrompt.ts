import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
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

export function wakeLockSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return 'wakeLock' in navigator;
}
