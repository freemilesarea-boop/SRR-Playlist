import { useState } from 'react';
import { Download, X, Share, Plus, CheckCircle2, MonitorSmartphone } from 'lucide-react';
import { useInstallPrompt, isStandalone } from '@/hooks/useInstallPrompt';

type Platform = 'ios' | 'android' | 'desktop-chrome' | 'other';

function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Chrome|Edg|CriOS/.test(ua)) return 'desktop-chrome';
  return 'other';
}

/**
 * "매장용 앱으로 설치" 버튼.
 * - beforeinstallprompt 가능(Chrome/Android/Windows/Mac Chrome) → 네이티브 설치 프롬프트
 * - iOS Safari → 설치 방법 안내 모달(공유 → 홈 화면에 추가)
 * - 이미 설치(standalone)면 표시하지 않음
 */
export default function InstallAppButton({
  variant = 'primary',
  label = '매장용 앱으로 설치',
  className = '',
}: {
  variant?: 'primary' | 'ghost';
  label?: string;
  className?: string;
}) {
  const { canInstall, installed, prompt } = useInstallPrompt();
  const [showGuide, setShowGuide] = useState(false);
  const platform = detectPlatform();

  if (installed || isStandalone()) return null;

  async function onClick() {
    if (canInstall) {
      const ok = await prompt();
      if (!ok) setShowGuide(true); // 사용자가 프롬프트를 닫았거나 미지원 → 안내
      return;
    }
    setShowGuide(true);
  }

  const base =
    variant === 'primary'
      ? 'inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-black hover:bg-accent/90'
      : 'inline-flex items-center justify-center gap-2 rounded-xl bg-bg-card px-3 py-2 text-xs font-semibold text-ink-mute ring-1 ring-line/15 hover:bg-bg-hover hover:text-ink';

  return (
    <>
      <button onClick={onClick} className={`${base} ${className}`}>
        <Download size={variant === 'primary' ? 16 : 14} />
        {label}
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-[95] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
          onClick={() => setShowGuide(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90vh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <MonitorSmartphone size={18} />
                </span>
                <div>
                  <h3 className="text-base font-bold">매장용 앱 설치 안내</h3>
                  <p className="text-[11px] text-ink-mute">앱처럼 설치하면 더 안정적으로 재생됩니다.</p>
                </div>
              </div>
              <button onClick={() => setShowGuide(false)} aria-label="닫기" className="rounded-full p-1 text-ink-mute hover:bg-ink/5 hover:text-ink">
                <X size={18} />
              </button>
            </div>

            {platform === 'ios' ? (
              <ol className="space-y-2 text-sm text-ink">
                <Step n={1} icon={<Share size={14} />}>Safari 하단의 <b>공유</b> 버튼을 누르세요.</Step>
                <Step n={2} icon={<Plus size={14} />}><b>홈 화면에 추가</b>를 선택하세요.</Step>
                <Step n={3} icon={<CheckCircle2 size={14} />}>홈 화면의 <b>듣다</b> 아이콘으로 실행하면 전체화면으로 사용할 수 있어요.</Step>
              </ol>
            ) : platform === 'android' ? (
              <ol className="space-y-2 text-sm text-ink">
                <Step n={1}>Chrome 우측 상단 <b>⋮</b> 메뉴를 누르세요.</Step>
                <Step n={2}><b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택하세요.</Step>
                <Step n={3}>설치된 <b>듣다</b> 앱으로 실행하세요.</Step>
              </ol>
            ) : platform === 'desktop-chrome' ? (
              <ol className="space-y-2 text-sm text-ink">
                <Step n={1}>주소창 오른쪽의 <b>설치 아이콘</b>(모니터+↓) 을 누르세요.</Step>
                <Step n={2}>없으면 <b>⋮</b> 메뉴 → <b>저장 및 공유</b> → <b>페이지를 앱으로 설치</b>.</Step>
                <Step n={3}>설치 후 <b>독립 창</b>으로 실행하면 매장 재생에 안정적입니다.</Step>
              </ol>
            ) : (
              <p className="text-sm text-ink-mute">
                Chrome 또는 Edge 브라우저에서 메뉴 → <b>앱으로 설치</b>를 선택하면 더 안정적으로 사용할 수 있어요.
              </p>
            )}

            <p className="rounded-lg bg-bg-card/70 px-3 py-2 text-[11px] leading-relaxed text-ink-mute ring-1 ring-line/10">
              설치형 웹앱도 브라우저 창을 완전히 닫으면 음악은 중단됩니다. 24시간 운영 매장은 전용
              플레이어 앱 출시 전까지 설치형 웹앱을 켜둔 상태로 사용하는 것을 권장합니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function Step({ n, icon, children }: { n: number; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 rounded-xl bg-bg-card/60 p-2.5 ring-1 ring-line/10">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-bold text-accent">
        {n}
      </span>
      <span className="flex items-center gap-1.5 text-sm leading-relaxed">
        {icon}
        <span>{children}</span>
      </span>
    </li>
  );
}
