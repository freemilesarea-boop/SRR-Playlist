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

const components: Components = {
  h1: ({ children }) => <h2 className="mt-8 text-xl font-extrabold tracking-tight first:mt-0">{children}</h2>,
  h2: ({ children }) => <h2 className="mt-8 text-lg font-bold tracking-tight first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-6 text-base font-bold">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-4 text-sm font-bold">{children}</h4>,
  p: ({ children }) => <p className="mt-3 text-[15px] leading-7 text-ink/90">{children}</p>,
  ul: ({ children }) => <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-ink/90">{children}</ul>,
  ol: ({ children }) => <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[15px] leading-7 text-ink/90">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-bold text-ink">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="mt-4 rounded-r-xl border-l-4 border-accent/60 bg-accent/5 px-4 py-2 text-ink-mute">{children}</blockquote>
  ),
  hr: () => <hr className="my-8 border-line/15" />,
  code: ({ children }) => <code className="rounded bg-bg-soft px-1.5 py-0.5 text-[13px]">{children}</code>,
  pre: ({ children }) => <pre className="mt-3 overflow-x-auto rounded-xl bg-bg-soft p-4 text-[13px] leading-6">{children}</pre>,
  table: ({ children }) => (
    <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-line/15">
      <table className="w-full border-collapse text-left text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-line/15 bg-bg-soft px-3 py-2 font-bold">{children}</th>,
  td: ({ children }) => <td className="border-b border-line/10 px-3 py-2 align-top">{children}</td>,
  img: ({ src, alt }) => {
    const s = typeof src === 'string' && /^https:\/\//i.test(src) ? src : null;
    if (!s) return null;
    return (
      <img src={s} alt={alt ?? ''} loading="lazy"
        className="mt-4 w-full rounded-xl bg-bg-soft object-contain ring-1 ring-line/10" />
    );
  },
  a: ({ href, children }) => {
    const h = safeGuideHref(href);
    if (!h) return <span>{children}</span>;
    if (h.startsWith('/')) return <Link to={h} className="font-semibold text-accent underline underline-offset-2">{children}</Link>;
    return (
      <a href={h} target={h.startsWith('#') ? undefined : '_blank'} rel="noopener noreferrer"
        className="font-semibold text-accent underline underline-offset-2">
        {children}
      </a>
    );
  },
};

export default function GuideMarkdown({ source }: { source: string }) {
  return (
    <div className="guide-markdown break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components} skipHtml>
        {source}
      </ReactMarkdown>
    </div>
  );
}
