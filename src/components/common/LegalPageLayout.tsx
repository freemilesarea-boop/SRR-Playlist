import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface Props {
  title: string;
  subtitle?: string;
  updatedAt?: string;
  children: React.ReactNode;
}

/**
 * 법적/정적 페이지 공용 레이아웃 (Footer 와 동일한 아이보리 톤).
 * AppShell 안에서 자연스럽게 표시되도록 자체 배경 + 컨테이너 갖춤.
 */
export default function LegalPageLayout({ title, subtitle, updatedAt, children }: Props) {
  return (
    <div className="bg-[#f5f1ea] text-stone-700">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-8 sm:py-14">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-[12px] text-stone-500 transition hover:text-stone-900"
        >
          <ArrowLeft size={12} /> 홈으로
        </Link>

        <header className="mt-6 border-b border-stone-200 pb-6">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900 sm:text-3xl">{title}</h1>
          {subtitle && <p className="mt-2 text-[13px] text-stone-600">{subtitle}</p>}
          {updatedAt && (
            <p className="mt-3 text-[11px] uppercase tracking-wider text-stone-500">
              최종 업데이트: {updatedAt}
            </p>
          )}
        </header>

        <div className="prose-legal mt-8 space-y-8 text-[14px] leading-relaxed text-stone-700">
          {children}
        </div>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function LegalSection({ title, children }: SectionProps) {
  return (
    <section className="space-y-3">
      <h2 className="text-[15px] font-semibold uppercase tracking-[0.1em] text-stone-900">
        {title}
      </h2>
      <div className="space-y-2 text-[13.5px] leading-relaxed text-stone-700">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: (string | React.ReactNode)[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-stone-600 marker:text-stone-400">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}
