import { Instagram } from 'lucide-react';

interface LinkItem {
  label: string;
  href: string;
  external?: boolean;
}

const ABOUT_LINKS: LinkItem[] = [
  { label: '스르륵 플리', href: '/' },
  { label: '광고 문의', href: 'mailto:freemilesarea@gmail.com?subject=스르륵 플리 광고 문의' },
  { label: 'B2B 문의', href: 'mailto:freemilesarea@gmail.com?subject=스르륵 플리 B2B 문의' },
];

const SERVICE_LINKS: LinkItem[] = [
  { label: '공지사항', href: '#' },
  { label: '고객센터', href: 'mailto:freemilesarea@gmail.com?subject=스르륵 플리 고객센터' },
  { label: '이용약관', href: '#' },
  { label: '개인정보 처리방침', href: '#' },
];

const COMPANY_INFO: { label: string; value: string }[] = [
  { label: '상호명', value: '루베르 콘텐츠 스튜디오' },
  { label: '대표', value: '이승현' },
  { label: '사업자번호', value: '234-52-00922' },
  { label: '통신판매업 신고번호', value: '2026-서울성동-0724 호' },
  { label: '이메일', value: 'freemilesarea@gmail.com' },
  { label: '주소', value: '서울특별시 성동구 왕십리로 326 세신빌딩 6층 614호' },
];

export default function Footer() {
  return (
    <footer className="border-t border-stone-200 bg-[#f5f1ea] text-stone-700">
      <div className="mx-auto w-full max-w-7xl px-6 py-12 sm:px-8 lg:py-16">
        {/* 상단: 회사 정보 + 링크 3컬럼 */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-4 lg:gap-12">
          {/* 회사 정보 — desktop col 1 */}
          <div className="lg:col-span-1">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-900">
              루베르 콘텐츠 스튜디오
            </h3>
            <dl className="mt-4 space-y-1.5 text-[12px] leading-relaxed text-stone-600">
              {COMPANY_INFO.map((c) => (
                <div key={c.label} className="flex flex-wrap gap-x-2">
                  <dt className="shrink-0 text-stone-500">{c.label}</dt>
                  <dd className="text-stone-700">{c.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* 소개 */}
          <FooterSection title="소개" items={ABOUT_LINKS} />

          {/* 서비스 */}
          <FooterSection title="서비스" items={SERVICE_LINKS} />

          {/* 소셜 */}
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-900">
              소셜
            </h3>
            <ul className="mt-4 space-y-2.5">
              <li>
                <a
                  href="#"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-[13px] text-stone-600 transition hover:text-stone-900"
                >
                  <Instagram size={14} />
                  인스타그램
                </a>
              </li>
            </ul>
          </div>
        </div>

        {/* 하단: 저작권 */}
        <div className="mt-12 border-t border-stone-200 pt-6 text-center text-[11px] text-stone-500 lg:mt-16">
          © {new Date().getFullYear()} 루베르 콘텐츠 스튜디오. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

function FooterSection({ title, items }: { title: string; items: LinkItem[] }) {
  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-900">
        {title}
      </h3>
      <ul className="mt-4 space-y-2.5">
        {items.map((it) => {
          const isExternal = it.external || it.href.startsWith('http') || it.href.startsWith('mailto:');
          return (
            <li key={it.label}>
              <a
                href={it.href}
                {...(isExternal ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
                className="text-[13px] text-stone-600 transition hover:text-stone-900"
              >
                {it.label}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
