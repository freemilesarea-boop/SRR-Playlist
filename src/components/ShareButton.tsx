import { useState } from 'react';
import { Share2, QrCode } from 'lucide-react';
import { performShare, type ShareTargetType } from '@/lib/shareApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import QRCodeModal from './QRCodeModal';

interface Props {
  title: string;
  text?: string;
  url: string;
  targetType: ShareTargetType;
  targetId?: string | null;
  /** sm: 아이콘만, md: 아이콘 + 라벨 */
  variant?: 'icon' | 'pill' | 'inline';
  showQrButton?: boolean;
  className?: string;
}

export default function ShareButton({
  title,
  text,
  url,
  targetType,
  targetId,
  variant = 'icon',
  showQrButton = true,
  className = '',
}: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleShare(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const res = await performShare({ title, text, url, targetType, targetId, userId });
    setBusy(false);
    if (res.ok) {
      if (res.method === 'clipboard') toast.success('링크를 복사했어요.');
      // web_share 는 OS UI 가 처리 — toast 안 띄움
    } else if (res.error !== 'aborted') {
      toast.error('공유에 실패했어요.');
    }
  }

  function handleQr(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setQrOpen(true);
  }

  if (variant === 'pill') {
    return (
      <>
        <div className={`inline-flex items-center gap-1.5 ${className}`}>
          <button
            onClick={handleShare}
            className="btn-ghost px-3 py-2 text-xs"
            disabled={busy}
          >
            <Share2 size={14} /> 공유
          </button>
          {showQrButton && (
            <button onClick={handleQr} className="btn-ghost px-3 py-2 text-xs">
              <QrCode size={14} /> QR
            </button>
          )}
        </div>
        {qrOpen && (
          <QRCodeModal
            url={url}
            title={title}
            targetType={targetType}
            targetId={targetId ?? null}
            onClose={() => setQrOpen(false)}
          />
        )}
      </>
    );
  }

  if (variant === 'inline') {
    return (
      <>
        <button
          onClick={handleShare}
          className={`inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-ink ${className}`}
          disabled={busy}
        >
          <Share2 size={12} /> 공유
        </button>
        {qrOpen && (
          <QRCodeModal
            url={url}
            title={title}
            targetType={targetType}
            targetId={targetId ?? null}
            onClose={() => setQrOpen(false)}
          />
        )}
      </>
    );
  }

  // icon
  return (
    <>
      <button
        onClick={handleShare}
        aria-label="공유"
        title="공유"
        className={`inline-flex h-9 w-9 items-center justify-center rounded-full bg-bg-card text-ink-mute ring-1 ring-line/10 transition hover:text-ink ${className}`}
        disabled={busy}
      >
        <Share2 size={14} />
      </button>
      {qrOpen && (
        <QRCodeModal
          url={url}
          title={title}
          targetType={targetType}
          targetId={targetId ?? null}
          onClose={() => setQrOpen(false)}
        />
      )}
    </>
  );
}
