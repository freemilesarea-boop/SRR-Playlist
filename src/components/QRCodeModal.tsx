import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import { X, Download, Copy, Check, QrCode } from 'lucide-react';
import {
  downloadBlob,
  logShareEvent,
  svgElementToPng,
  type ShareTargetType,
} from '@/lib/shareApi';
import { useAuthStore } from '@/store/authStore';
import { toast } from '@/store/toastStore';

interface Props {
  url: string;
  title: string;
  /** QR 위에 보여줄 한 줄 보조 설명 */
  subtitle?: string;
  targetType: ShareTargetType;
  targetId?: string | null;
  onClose: () => void;
}

export default function QRCodeModal({
  url,
  title,
  subtitle,
  targetType,
  targetId,
  onClose,
}: Props) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // 모달 진입 시 view 이벤트 1회
  useEffect(() => {
    void logShareEvent(targetType, targetId ?? null, 'qr_view', userId);
  }, [targetType, targetId, userId]);

  async function handleDownload() {
    const svg = containerRef.current?.querySelector('svg');
    if (!svg) return;
    setDownloading(true);
    try {
      const blob = await svgElementToPng(svg as SVGSVGElement, 1024);
      if (!blob) {
        toast.error('QR 이미지 생성에 실패했어요.');
        return;
      }
      const filename = `srr-qr-${title.replace(/\s+/g, '_').slice(0, 40)}.png`;
      downloadBlob(blob, filename);
      void logShareEvent(targetType, targetId ?? null, 'qr_download', userId);
    } finally {
      setDownloading(false);
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('링크 복사 실패');
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-t-3xl bg-bg-soft shadow-elevated ring-1 ring-line/15 sm:rounded-3xl animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent ring-1 ring-accent/20">
              <QrCode size={14} />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-dim">QR</p>
              <h3 className="truncate text-sm font-bold">{title}</h3>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-ink/5"
            aria-label="닫기"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {subtitle && (
            <p className="text-center text-xs text-ink-mute">{subtitle}</p>
          )}

          {/* QR — 항상 흰 배경 */}
          <div
            ref={containerRef}
            className="mx-auto flex aspect-square w-full max-w-[260px] items-center justify-center rounded-2xl bg-white p-5 shadow-lift"
          >
            <QRCode
              value={url}
              size={220}
              level="M"
              bgColor="#ffffff"
              fgColor="#0F1115"
              style={{ width: '100%', height: 'auto' }}
            />
          </div>

          <p className="break-all text-center text-[11px] text-ink-dim">{url}</p>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleCopy}
              className="btn-ghost py-3 text-sm"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? '복사됨' : '링크 복사'}
            </button>
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="btn-primary py-3 text-sm"
            >
              <Download size={14} />
              {downloading ? '다운로드…' : 'PNG 저장'}
            </button>
          </div>

          <p className="text-center text-[10px] text-ink-dim">
            QR을 스캔하면 바로 재생 페이지로 이동해요
          </p>
        </div>
      </div>
    </div>
  );
}
