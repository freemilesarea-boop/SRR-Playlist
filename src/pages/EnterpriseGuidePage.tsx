import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download, FileText, Image as ImageIcon } from 'lucide-react';
import GuideMarkdown from '@/components/common/GuideMarkdown';
import { getEnterpriseGuide, formatFileSize, type EnterpriseGuide } from '@/lib/enterpriseGuideApi';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

export default function EnterpriseGuidePage() {
  const { slug = '' } = useParams();
  const [guide, setGuide] = useState<EnterpriseGuide | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setGuide(undefined);
    setFailed(false);
    getEnterpriseGuide(slug)
      .then((g) => { if (alive) setGuide(g); })
      .catch(() => { if (alive) { setFailed(true); setGuide(null); } });
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    document.title = guide ? `${guide.title} · 엔터프라이즈 가이드 · 듣다` : '엔터프라이즈 가이드 · 듣다';
  }, [guide]);

  const back = (
    <Link to="/enterprise-guide" className="inline-flex items-center gap-1 text-xs font-semibold text-ink-mute hover:text-ink">
      <ArrowLeft size={14} /> 엔터프라이즈 가이드
    </Link>
  );

  if (guide === undefined) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-20 pt-8 sm:px-6" aria-busy="true">
        {back}
        <div className="h-9 w-2/3 animate-pulse rounded-lg bg-bg-card" />
        <div className="h-64 animate-pulse rounded-2xl bg-bg-card" />
      </div>
    );
  }

  if (guide === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 px-4 pb-20 pt-8 sm:px-6">
        {back}
        <div className="rounded-2xl bg-bg-card px-6 py-14 text-center ring-1 ring-line/10">
          <h1 className="text-base font-bold">{failed ? '가이드를 불러오지 못했어요' : '찾는 가이드가 없어요'}</h1>
          <p className="mt-2 text-sm text-ink-mute">
            {failed ? '잠시 후 다시 시도해 주세요.' : '주소가 바뀌었거나 내려간 글이에요.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <article className="mx-auto max-w-3xl px-4 pb-20 pt-8 sm:px-6">
      {back}
      <header className="mt-4 space-y-2">
        <span className="inline-flex rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-semibold text-accent">
          {guide.category}
        </span>
        <h1 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">{guide.title}</h1>
        {guide.summary && <p className="text-sm leading-relaxed text-ink-mute">{guide.summary}</p>}
        <p className="text-[11px] text-ink-dim">
          {formatDate(guide.updated_at ?? guide.published_at)} 업데이트
        </p>
      </header>

      {guide.cover_image_url && (
        <img src={guide.cover_image_url} alt="" className="mt-6 w-full rounded-2xl bg-bg-soft object-cover ring-1 ring-line/10" />
      )}

      <div className="mt-6">
        <GuideMarkdown source={guide.body_md} />
      </div>

      {guide.attachments.length > 0 && (
        <section className="mt-10 space-y-2 rounded-2xl bg-bg-card p-4 ring-1 ring-line/10">
          <h2 className="text-sm font-bold">첨부 자료</h2>
          <ul className="space-y-1.5">
            {guide.attachments.map((a) => (
              <li key={a.url}>
                <a href={a.url} target="_blank" rel="noopener noreferrer" download={a.name}
                  className="flex items-center gap-2 rounded-xl bg-bg-soft/60 px-3 py-2.5 text-sm hover:bg-bg-hover">
                  {a.type?.startsWith('image/') ? <ImageIcon size={16} className="shrink-0 text-accent" /> : <FileText size={16} className="shrink-0 text-accent" />}
                  <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                  {a.size ? <span className="shrink-0 text-xs text-ink-dim">{formatFileSize(a.size)}</span> : null}
                  <Download size={14} className="shrink-0 text-ink-mute" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-10 flex flex-col gap-3 rounded-2xl bg-bg-soft/60 p-5 ring-1 ring-line/10 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm text-ink-mute">도입이나 운영에 대해 더 궁금한 점이 있으신가요?</p>
        <a href="https://pf.kakao.com/_xgHxbGX/chat" target="_blank" rel="noopener noreferrer"
          className="btn-primary justify-center px-4 py-2 text-sm font-bold">
          카톡으로 문의하기
        </a>
      </div>
    </article>
  );
}
