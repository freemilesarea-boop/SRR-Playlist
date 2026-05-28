import { useState } from 'react';
import { Download, X, Sparkles } from 'lucide-react';
import { useInstallPrompt, isStandalone } from '@/hooks/useInstallPrompt';
import { useVisitCount } from '@/hooks/useVisitCount';

const DISMISSED_KEY = 'srr-install-banner-dismissed-at';
const COOLDOWN_DAYS = 7;
const MIN_VISITS = 2;

/**
 * PWA 설치 자동 유도 배너 — 가벼운 가로 strip.
 *
 * 노출 조건 (모두 만족):
 *   - canInstall (beforeinstallprompt 이벤트 받음, Chrome/Edge/Android 등)
 *   - 미설치 (standalone 아님)
 *   - 누적 방문 ≥ 2회 (첫 방문엔 안 띄움)
 *   - 마지막 dismiss 후 7일 경과
 *
 * 동작:
 *   - 설치 클릭 → 네이티브 prompt → 수락/거절 모두 dismiss 처리
 *   - X 닫기 → 7일 쿨다운
 *
 * iOS Safari 는 beforeinstallprompt 미발화 → canInstall=false → 배너 미노출.
 * iOS 사용자에겐 별도 안내 (InstallAppButton) 가 매장 페이지에 노출됨.
 */
export default function InstallPromptBanner() {
  const { canInstall, installed, prompt } = useInstallPrompt();
  const visits = useVisitCount();
  const [hiddenThisSession, setHiddenThisSession] = useState(false);
  const [busy, setBusy] = useState(false);

  const shouldShow = (() => {
    if (hiddenThisSession) return false;
    if (installed || isStandalone()) return false;
    if (!canInstall) return false;
    if (visits < MIN_VISITS) return false;
    try {
      const dismissedAt = parseInt(localStorage.getItem(DISMISSED_KEY) ?? '0', 10);
      if (dismissedAt > 0) {
        const elapsedMs = Date.now() - dismissedAt;
        const cooldownMs = COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
        if (elapsedMs < cooldownMs) return false;
      }
    } catch {
      /* noop — localStorage 불가 시 표시 시도 */
    }
    return true;
  })();

  if (!shouldShow) return null;

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED_KEY, String(Date.now()));
    } catch {
      /* noop */
    }
    setHiddenThisSession(true);
  }

  async function install() {
    setBusy(true);
    try {
      const ok = await prompt();
      // 수락이든 거절이든 다시 안 띄움 — 거절은 7일 쿨다운, 수락은 useInstallPrompt 가 installed=true
      if (!ok) dismiss();
      setHiddenThisSession(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 flex items-center gap-2 rounded-2xl bg-accent/[0.08] px-3.5 py-2.5 text-xs ring-1 ring-accent/25">
      <Sparkles size={14} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-ink">앱처럼 설치하면 더 안정적이에요</p>
        <p className="mt-0.5 text-[11px] text-ink-mute">백그라운드 재생 + 빠른 진입</p>
      </div>
      <button
        onClick={() => void install()}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-[11px] font-bold text-black hover:bg-accent/90 disabled:opacity-50"
      >
        <Download size={11} /> {busy ? '설치 중…' : '설치'}
      </button>
      <button
        onClick={dismiss}
        aria-label="닫기 (7일 동안 보지 않기)"
        className="shrink-0 rounded-full p-1 text-ink-mute hover:bg-ink/5 hover:text-ink"
      >
        <X size={14} />
      </button>
    </div>
  );
}
