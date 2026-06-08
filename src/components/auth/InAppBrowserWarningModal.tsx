/**
 * InAppBrowserWarningModal — 인앱 브라우저에서 Google 로그인 시도 시 안내 (X6.26)
 *
 * 동작:
 *   사용자가 카카오톡 / 인스타 / 네이버앱 등 인앱브라우저 에서 "Google 로그인"
 *   버튼을 누르면, OAuth 를 보내지 않고 이 모달을 먼저 띄움.
 *
 *   "Google 정책 차단" 발생 확률이 높으므로 외부 브라우저 (Chrome / Safari) 로
 *   현재 URL 을 다시 여는 안내 + URL 복사 + 이메일 로그인 폴백을 제공.
 *
 * 한계:
 *   - 모든 인앱브라우저가 URL scheme 으로 외부 브라우저를 직접 열 수 있는
 *     건 아님. 안드로이드 인텐트 / iOS Safari deeplink 는 실패 가능 →
 *     "URL 복사" 가 가장 안정적인 폴백.
 */
import { useEffect, useState } from 'react';
import { X, AlertCircle, ExternalLink, Copy, Mail } from 'lucide-react';
import { toast } from '@/store/toastStore';
import { isIosDevice, isAndroidDevice, type InAppBrowserName } from '@/lib/inAppBrowser';

interface Props {
  browserLabel: string | null;
  browserName: InAppBrowserName | null;
  /** X6.33: PWA standalone 모드 — 라벨/안내문구를 "설치 앱" 으로 분기. */
  isPwa?: boolean;
  onClose: () => void;
  onContinueWithEmail: () => void;
}

export default function InAppBrowserWarningModal({
  browserLabel,
  isPwa,
  onClose,
  onContinueWithEmail,
}: Props) {
  const [copied, setCopied] = useState(false);
  const currentUrl =
    typeof window !== 'undefined' ? window.location.href : '';
  const ios = isIosDevice();
  const android = isAndroidDevice();

  useEffect(() => {
    // ESC 키로 닫기
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setCopied(true);
      toast.success('URL을 복사했어요. Chrome 또는 Safari 주소창에 붙여넣어주세요.');
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      // 인앱브라우저 일부는 clipboard API 권한이 없음 — fallback selection
      try {
        const ta = document.createElement('textarea');
        ta.value = currentUrl;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(true);
        toast.success('URL을 복사했어요. Chrome 또는 Safari 주소창에 붙여넣어주세요.');
        window.setTimeout(() => setCopied(false), 3000);
      } catch {
        toast.error('URL 복사가 막혀있어요. 주소창을 길게 눌러 직접 복사해주세요.');
      }
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="inapp-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="mt-0.5 shrink-0 text-amber-500" />
            <div>
              <h3 id="inapp-modal-title" className="text-base font-bold">
                Google 로그인이 차단될 수 있어요
              </h3>
              {isPwa ? (
                <p className="mt-0.5 text-xs text-ink-mute">
                  현재 <strong>설치된 앱 (홈 화면 추가)</strong> 으로 실행 중 — Google 정책상
                  브라우저 UI 가 없는 환경에서 OAuth 가 차단됩니다.
                </p>
              ) : browserLabel ? (
                <p className="mt-0.5 text-xs text-ink-mute">
                  현재 <strong>{browserLabel}</strong> 인앱브라우저에서 접속 중
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 hover:bg-ink/5"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 rounded-xl bg-amber-500/10 px-3 py-3 text-xs text-ink ring-1 ring-amber-500/30">
          <p className="leading-relaxed">
            현재 앱 내 브라우저에서는 Google 로그인이 차단될 수 있습니다.
          </p>
          <p className="leading-relaxed">
            <strong>Chrome</strong> 또는 <strong>Safari</strong>에서 열어주세요.
          </p>
          <p className="text-[10px] leading-snug text-ink-mute">
            ※ Google 의 <strong>"보안 브라우저 사용" 정책</strong>으로 인해 인앱 브라우저에서는
            로그인 화면에 <code className="font-mono">403 disallowed_useragent</code> 오류가 표시됩니다.
          </p>
        </div>

        <div className="space-y-2">
          <div className="rounded-xl bg-bg-card px-3 py-2.5 text-[11px] leading-relaxed text-ink-mute ring-1 ring-line/10">
            {ios && (
              <p>
                <strong className="text-ink">Safari로 여는 법</strong>
                <br />
                우측 하단 ··· 또는 공유 버튼 → "Safari로 열기" 선택
                <br />
                또는 아래 "URL 복사" 후 Safari 주소창에 붙여넣기
              </p>
            )}
            {android && (
              <p>
                <strong className="text-ink">Chrome으로 여는 법</strong>
                <br />
                우측 상단 ⋮ → "다른 브라우저로 열기" 또는 "Chrome으로 열기" 선택
                <br />
                또는 아래 "URL 복사" 후 Chrome 주소창에 붙여넣기
              </p>
            )}
            {!ios && !android && (
              <p>
                아래 "URL 복사" 를 누른 뒤 Chrome 또는 Safari 주소창에 붙여넣어주세요.
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-black hover:bg-accent/90"
          >
            {copied ? (
              <>
                <ExternalLink size={14} /> 복사됨 — 외부 브라우저에 붙여넣기
              </>
            ) : (
              <>
                <Copy size={14} /> URL 복사하기
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              onClose();
              onContinueWithEmail();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-bg-card px-4 py-3 text-sm font-semibold text-ink ring-1 ring-line/10 hover:bg-bg-hover"
          >
            <Mail size={14} /> 이메일 로그인으로 계속하기
          </button>
        </div>

        <p className="text-center text-[10px] text-ink-dim">
          Chrome / Safari 에서는 정상 로그인됩니다.
        </p>
      </div>
    </div>
  );
}
