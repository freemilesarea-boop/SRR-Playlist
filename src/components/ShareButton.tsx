import { useState } from 'react';
import { Share2, QrCode } from 'lucide-react';
import { performShare, logShareEvent, type ShareTargetType } from '@/lib/shareApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';
import { isKakaoConfigured, shareTrackToKakao, sharePlaylistToKakao } from '@/lib/kakao';
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
  /** 카카오 공유 버튼 노출 — pill 에서만 노출, 기본 true. */
  showKakaoButton?: boolean;
  /** Kakao 공유 카드용 — 곡/플리 메타. 없으면 url 만으로 단순 share. */
  kakaoMeta?: {
    coverUrl?: string | null;
    artist?: string | null;
    description?: string | null;
  };
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
  showKakaoButton = true,
  kakaoMeta,
  className = '',
}: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const [qrOpen, setQrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [kakaoBusy, setKakaoBusy] = useState(false);
  const kakaoEnabled = isKakaoConfigured() && (targetType === 'track' || targetType === 'playlist');

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

  async function handleKakao(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (kakaoBusy) return;
    setKakaoBusy(true);
    try {
      const ok = targetType === 'track' && targetId
        ? await shareTrackToKakao({
            trackId: targetId,
            title, artist: kakaoMeta?.artist ?? null,
            coverUrl: kakaoMeta?.coverUrl ?? null,
            shareUrl: url,
          })
        : targetType === 'playlist' && targetId
          ? await sharePlaylistToKakao({
              playlistId: targetId,
              title, description: kakaoMeta?.description ?? null,
              coverUrl: kakaoMeta?.coverUrl ?? null,
              shareUrl: url,
            })
          : false;
      if (ok) {
        void logShareEvent(targetType, targetId ?? null, 'kakao_share', userId);
      } else {
        toast.error('카카오톡 공유에 실패했어요.');
      }
    } finally { setKakaoBusy(false); }
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
          {showKakaoButton && kakaoEnabled && (
            <button
              onClick={handleKakao}
              disabled={kakaoBusy}
              title="카카오톡 공유"
              className="inline-flex items-center gap-1 rounded-full bg-[#FEE500] px-3 py-2 text-xs font-semibold text-[#191919] hover:bg-[#FDD800] disabled:opacity-60"
            >
              <KakaoBubble /> 카카오톡
            </button>
          )}
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

function KakaoBubble() {
  return (
    <svg width="14" height="14" viewBox="0 0 18 18" aria-hidden>
      <path fill="currentColor" d="M9 1.5C4.582 1.5 1 4.27 1 7.69c0 2.226 1.522 4.18 3.808 5.27-.15.508-.96 3.236-.992 3.395 0 0-.02.166.087.23.107.063.232.014.232.014.225-.031 3.486-2.291 4.052-2.673A11.59 11.59 0 0 0 9 13.88c4.418 0 8-2.77 8-6.19S13.418 1.5 9 1.5z"/>
    </svg>
  );
}
