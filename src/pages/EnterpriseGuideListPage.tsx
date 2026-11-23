import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Building2, Paperclip, ArrowRight } from 'lucide-react';
import { listEnterpriseGuides, groupGuidesByCategory, type EnterpriseGuideSummary } from '@/lib/enterpriseGuideApi';

export default function EnterpriseGuideListPage() {
  const [rows, setRows] = useState<EnterpriseGuideSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    document.title = '엔터프라이즈 가이드 · 듣다';
    let alive = true;
    listEnterpriseGuides()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) { setFailed(true); setRows([]); } });
    return () => { alive = false; };
  }, []);

  const groups = rows ? groupGuidesByCategory(rows) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 pb-20 pt-8 sm:px-6">
      <header className="space-y-3 text-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <Building2 size={12} /> DEUDDA · ENTERPRISE
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">엔터프라이즈 가이드</h1>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ink-mute">
          여러 매장을 운영하는 브랜드·본사를 위한 듣다 도입과 운영 안내예요.
        </p>
      </header>

      {rows === null && (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-2xl bg-bg-card" />)}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-bg-card px-6 py-14 text-center ring-1 ring-line/10">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
            <BookOpen size={20} />
          </div>
          <h2 className="text-base font-bold">
            {failed ? '가이드를 불러오지 못했어요' : '가이드를 준비하고 있어요'}
          </h2>
          <p className="text-sm text-ink-mute">
            {failed ? '잠시 후 다시 시도해 주세요.' : '도입 문의는 카카오톡 채널로 편하게 남겨 주세요.'}
          </p>
          <a href="https://pf.kakao.com/_xgHxbGX/chat" target="_blank" rel="noopener noreferrer"
            className="btn-primary mt-1 px-4 py-2 text-sm font-bold">
            카톡으로 문의하기
          </a>
        </div>
      )}

      {groups.map((g) => (
        <section key={g.category} className="space-y-3">
          <h2 className="text-sm font-bold text-ink-mute">{g.category}</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {g.items.map((it) => (
              <li key={it.id}>
                <Link to={`/enterprise-guide/${it.slug}`}
                  className="group flex h-full flex-col overflow-hidden rounded-2xl bg-bg-card ring-1 ring-line/10 transition hover:ring-accent/40">
                  {it.cover_image_url && (
                    <img src={it.cover_image_url} alt="" loading="lazy"
                      className="aspect-[16/9] w-full bg-bg-soft object-cover" />
                  )}
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <h3 className="text-base font-bold leading-snug group-hover:text-accent">{it.title}</h3>
                    {it.summary && <p className="line-clamp-2 text-xs leading-relaxed text-ink-mute">{it.summary}</p>}
                    <div className="mt-auto flex items-center justify-between pt-2 text-[11px] text-ink-dim">
                      <span className="inline-flex items-center gap-1">
                        {it.attachment_count > 0 && <><Paperclip size={11} /> 첨부 {it.attachment_count}</>}
                      </span>
                      <span className="inline-flex items-center gap-0.5 font-semibold text-accent">
                        읽기 <ArrowRight size={12} />
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
