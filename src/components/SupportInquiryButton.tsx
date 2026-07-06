/**
 * SupportInquiryButton — Phase X6.1
 *
 * 문의하기 trigger 버튼 (form 모달 토글).
 * variant 로 디자인 변형 — chip / icon / nav.
 */
import { useState } from 'react';
import { MessageCircleQuestion, AlertTriangle } from 'lucide-react';
import SupportInquiryForm from '@/components/SupportInquiryForm';
import type { InquiryType } from '@/lib/supportInquiryApi';

interface Props {
  label?: string;
  variant?: 'chip' | 'icon' | 'nav' | 'alert';
  defaultType?: InquiryType;
  context?: Record<string, unknown>;
  successMessage?: string;
  className?: string;
  title?: string;
}

export default function SupportInquiryButton({
  label, variant = 'chip', defaultType, context, successMessage, className, title,
}: Props) {
  const [open, setOpen] = useState(false);

  const buttonContent = (() => {
    switch (variant) {
      case 'icon':
        return <MessageCircleQuestion size={16} />;
      case 'alert':
        return (
          <>
            <AlertTriangle size={13} />
            <span>{label ?? '문제 신고 / 문의하기'}</span>
          </>
        );
      case 'nav':
        return (
          <>
            <MessageCircleQuestion size={14} />
            <span>{label ?? '문의하기'}</span>
          </>
        );
      case 'chip':
      default:
        return (
          <>
            <MessageCircleQuestion size={13} />
            <span>{label ?? '문의하기'}</span>
          </>
        );
    }
  })();

  const baseClass = (() => {
    switch (variant) {
      case 'icon':
        return 'rounded-full p-2 text-ink-mute hover:bg-bg-hover';
      case 'alert':
        return 'inline-flex items-center gap-1.5 rounded-lg bg-rose-500/25 px-3 py-1.5 text-xs font-bold text-rose-500 hover:bg-rose-500/25';
      case 'nav':
        return 'inline-flex items-center gap-1.5 rounded-lg bg-bg-card px-3 py-2 text-sm font-semibold hover:bg-bg-hover';
      case 'chip':
      default:
        return 'inline-flex items-center gap-1 rounded-full bg-bg-card px-2.5 py-1.5 text-xs font-semibold text-ink-mute hover:bg-bg-hover';
    }
  })();

  return (
    <>
      <button onClick={() => setOpen(true)} className={`${baseClass} ${className ?? ''}`} title={label ?? '문의하기'}>
        {buttonContent}
      </button>
      <SupportInquiryForm
        open={open}
        onClose={() => setOpen(false)}
        defaultType={defaultType}
        context={context}
        successMessage={successMessage}
        title={title}
      />
    </>
  );
}
