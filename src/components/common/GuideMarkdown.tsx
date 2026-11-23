/**
 * GuideMarkdown — 엔터프라이즈 가이드 본문(마크다운) 표시.
 *
 * 원문 HTML 은 그리지 않는다(react-markdown 기본값 — rehype-raw 없음). 그래서 본문에 <script> 등이
 * 섞여 있어도 글자로만 보인다. 링크는 http(s)·mailto·사이트 내부 경로만 살린다.
 */
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import { safeGuideHref } from '@/lib/guideMarkdown';

/** app: 사이트 기본 테마 색(라이트·다크 모두) · paper: 공지사항·약관처럼 아이보리 종이 배경 고정 */
export type GuideMarkdownVariant = 'app' | 'paper';

const TONES: Record<GuideMarkdownVariant, {
  text: string; strong: string; quote: string; soft: string; line: string; lineSoft: string; ring: string; link: string;
}> = {
  app: {
    text: 'text-ink/90', strong: 'text-ink', quote: 'border-accent/60 bg-accent/5 text-ink-mute',
    soft: 'bg-bg-soft', line: 'border-line/15', lineSoft: 'border-line/10', ring: 'ring-line/15', link: 'text-accent',
  },
  paper: {
    text: 'text-stone-700', strong: 'text-stone-900', quote: 'border-stone-400 bg-stone-100 text-stone-600',
    soft: 'bg-stone-100', line: 'border-stone-200', lineSoft: 'border-stone-200', ring: 'ring-stone-200', link: 'text-stone-900',
  },
};

function makeComponents(v: GuideMarkdownVariant): Components {
  const t = TONES[v];
  return {
    h1: ({ children }) => <h2 className={`mt-8 text-xl font-extrabold tracking-tight first:mt-0 ${t.strong}`}>{children}</h2>,
    h2: ({ children }) => <h2 className={`mt-8 text-lg font-bold tracking-tight first:mt-0 ${t.strong}`}>{children}</h2>,
    h3: ({ children }) => <h3 className={`mt-6 text-base font-bold ${t.strong}`}>{children}</h3>,
    h4: ({ children }) => <h4 className={`mt-4 text-sm font-bold ${t.strong}`}>{children}</h4>,
    p: ({ children }) => <p className={`mt-3 text-[15px] leading-7 ${t.text}`}>{children}</p>,
    ul: ({ children }) => <ul className={`mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-7 ${t.text}`}>{children}</ul>,
    ol: ({ children }) => <ol className={`mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-7 ${t.text}`}>{children}</ol>,
    li: ({ children }) => <li className="pl-0.5">{children}</li>,
    strong: ({ children }) => <strong className={`font-bold ${t.strong}`}>{children}</strong>,
    blockquote: ({ children }) => (
      <blockquote className={`mt-4 rounded-r-xl border-l-4 px-4 py-2 ${t.quote}`}>{children}</blockquote>
    ),
    hr: () => <hr className={`my-8 ${t.line}`} />,
    code: ({ children }) => <code className={`rounded px-1.5 py-0.5 text-[13px] ${t.soft}`}>{children}</code>,
    pre: ({ children }) => <pre className={`mt-3 overflow-x-auto rounded-xl p-4 text-[13px] leading-6 ${t.soft}`}>{children}</pre>,
    table: ({ children }) => (
      <div className={`mt-4 overflow-x-auto rounded-xl ring-1 ${t.ring}`}>
        <table className={`w-full border-collapse text-left text-sm ${t.text}`}>{children}</table>
      </div>
    ),
    th: ({ children }) => <th className={`border-b px-3 py-2 font-bold ${t.line} ${t.soft} ${t.strong}`}>{children}</th>,
    td: ({ children }) => <td className={`border-b px-3 py-2 align-top ${t.lineSoft}`}>{children}</td>,
    img: ({ src, alt }) => {
      const s = typeof src === 'string' && /^https:\/\//i.test(src) ? src : null;
      if (!s) return null;
      return (
        <img src={s} alt={alt ?? ''} loading="lazy"
          className={`mt-4 w-full rounded-xl object-contain ring-1 ${t.soft} ${t.ring}`} />
      );
    },
    a: ({ href, children }) => {
      const h = safeGuideHref(href);
      if (!h) return <span>{children}</span>;
      const cls = `font-semibold underline underline-offset-2 ${t.link}`;
      if (h.startsWith('/')) return <Link to={h} className={cls}>{children}</Link>;
      return (
        <a href={h} target={h.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer" className={cls}>
          {children}
        </a>
      );
    },
  };
}

const COMPONENTS: Record<GuideMarkdownVariant, Components> = { app: makeComponents('app'), paper: makeComponents('paper') };

export default function GuideMarkdown({ source, variant = 'app' }: { source: string; variant?: GuideMarkdownVariant }) {
  return (
    <div className="guide-markdown break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS[variant]} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}
