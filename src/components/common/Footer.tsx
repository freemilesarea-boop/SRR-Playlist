import { Instagram, Music2 } from 'lucide-react';
import { Link } from 'react-router-dom';

interface LinkItem {
  label: string;
  href: string;
  external?: boolean;
}

const SERVICE_LINKS: LinkItem[] = [
  { label: '플레이리스트', href: '/' },
  { label: '차트', href: '/charts' },
  { label: '검색', href: '/search' },
  { label: '아티스트', href: '/artist' },
];

const SUPPORT_LINKS: LinkItem[] = [
  { label: '고객센터', href: '/support' },
  { label: '공지사항', href: '/notice' },
  { label: '광고 / B2B 문의', href: 'mailto:freemilesarea@gmail.com?subject=듣다 문의' },
  { label: '이용약관', href: '/terms' },
  { label: '개인정보 처리방침', href: '/privacy' },
];

const COMPANY_INFO: { label: string; value: string }[] = [
  { label: '상호', value: '루베르 콘텐츠 스튜디오' },
  { label: '대표', value: '이승현' },
  { label: '사업자번호', value: '234-52-00922' },
  { label: '통신판매업', value: '2026-서울성동-0724 호' },
  { label: '주소', value: '서울특별시 성동구 왕십리로 326 세신빌딩 6층 614호' },
  { label: '이메일', value: 'freemilesarea@gmail.com' },
];

export default function Footer() {
  return (
    <footer className="relative bg-bg-soft/95 text-ink">
      {/* 상단 violet gradient divider — Spotify/Apple Music 풍의 미세한 경계 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent 0%, rgb(var(--color-accent) / 0.35) 50%, transparent 100%)',
        }}
      />
      {/* 미세한 ambient 톤 — 과한 glass 없이 차분하게 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 opacity-40"
        style={{
          background:
            'radial-gradient(60% 100% at 50% 0%, rgb(var(--color-accent) / 0.08), transparent 70%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-7xl px-6 py-14 sm:px-8 lg:py-20">
        {/* 메인 그리드 — Brand | Service | Support | Business */}
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-12 lg:gap-10">
          {/* Brand col */}
          <div className="lg:col-span-4">
            <Link to="/" className="inline-flex items-center gap-2.5 group">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white ring-1 ring-white/15 transition-transform group-hover:scale-105"
                style={{ boxShadow: '0 6px 20px rgb(var(--color-accent) / 0.45)' }}
              >
                <Music2 size={17} fill="currentColor" />
              </span>
              <span className="text-lg font-extrabold tracking-tight text-ink">듣다</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-mute">
              상황에 어울리는 음악, 흐르듯 자연스럽게.
              <br />
              매장 BGM과 감성 플레이리스트를 한 곳에서.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <a
                href="#"
                target="_blank"
                rel="noreferrer noopener"
                aria-label="Instagram"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ink/5 text-ink-mute ring-1 ring-line/10 transition hover:bg-accent/15 hover:text-accent hover:ring-accent/30"
              >
                <Instagram size={15} />
              </a>
            </div>
          </div>

          {/* Service col */}
          <FooterSection title="서비스" items={SERVICE_LINKS} className="lg:col-span-2" />

          {/* Support col */}
          <FooterSection title="지원" items={SUPPORT_LINKS} className="lg:col-span-3" />

          {/* Business col */}
          <div className="lg:col-span-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/90">
              사업자 정보
            </h3>
            <dl className="mt-5 space-y-2 text-xs leading-relaxed text-ink-dim">
              {COMPANY_INFO.map((c) => (
                <div key={c.label} className="flex flex-wrap gap-x-2">
                  <dt className="shrink-0 text-ink-dim/70">{c.label}</dt>
                  <dd className="text-ink-mute">{c.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* 하단 copyright — 낮은 opacity */}
        <div className="mt-14 flex flex-col items-center gap-2 border-t border-line/5 pt-6 text-[11px] text-ink-dim/60 sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} 루베르 콘텐츠 스튜디오. All rights reserved.</p>
          <p className="text-ink-dim/50">Made with 🎧 in Seoul</p>
        </div>
      </div>
    </footer>
  );
}

function FooterSection({
  title,
  items,
  className,
}: {
  title: string;
  items: LinkItem[];
  className?: string;
}) {
  return (
    <div className={className}>
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/90">{title}</h3>
      <ul className="mt-5 space-y-3">
        {items.map((it) => {
          const isExternal = it.external || it.href.startsWith('http') || it.href.startsWith('mailto:');
          if (isExternal) {
            return (
              <li key={it.label}>
                <a
                  href={it.href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-sm text-ink-mute transition-colors duration-smooth hover:text-accent"
                >
                  {it.label}
                </a>
              </li>
            );
          }
          return (
            <li key={it.label}>
              <Link
                to={it.href}
                className="text-sm text-ink-mute transition-colors duration-smooth hover:text-accent"
              >
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
