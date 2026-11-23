import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronUp, ChevronDown, Download, FileText, Image as ImageIcon, Pin } from 'lucide-react';
import GuideMarkdown from '@/components/common/GuideMarkdown';
import { formatFileSize } from '@/lib/postFiles';
import { getNoticePost, formatNoticeDate, NOTICE_CATEGORY_TONE, type NoticePost } from '@/lib/noticePostsApi';

export default function NoticePostPage() {
  const { no = '' } = useParams();
  const [post, setPost] = useState<NoticePost | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setPost(undefined);
    setFailed(false);
    getNoticePost(Number(no))
      .then((p) => { if (alive) setPost(p); })
      .catch(() => { if (alive) { setFailed(true); setPost(null); } });
    return () => { alive = false; };
  }, [no]);

  useEffect(() => {
    document.title = post ? `${post.title} · 공지사항 · 듣다` : '공지사항 · 듣다';
  }, [post]);

  return (
    <div className="bg-[#f5f1ea] text-stone-700">
      <div className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-8 sm:py-14">
        <Link to="/notice" className="inline-flex items-center gap-1 text-[12px] text-stone-500 transition hover:text-stone-900">
          <ArrowLeft size={12} /> 공지사항 목록
        </Link>

        {post === undefined && (
          <div className="mt-6 space-y-3" aria-busy="true">
            <div className="h-8 w-2/3 animate-pulse rounded-lg bg-stone-200/70" />
            <div className="h-48 animate-pulse rounded-2xl bg-stone-200/60" />
          </div>
        )}

        {post === null && (
          <div className="mt-6 rounded-2xl border border-stone-200 bg-white/60 px-6 py-14 text-center">
            <h1 className="text-base font-semibold text-stone-900">{failed ? '공지를 불러오지 못했어요' : '찾는 공지가 없어요'}</h1>
            <p className="mt-2 text-[13px] text-stone-600">{failed ? '잠시 후 다시 시도해 주세요.' : '내려갔거나 주소가 잘못된 공지예요.'}</p>
          </div>
        )}

        {post && (
          <article>
            <header className="mt-6 border-b border-stone-200 pb-5">
              <div className="flex items-center gap-1.5">
                {post.is_pinned && <Pin size={12} className="text-stone-900" aria-label="고정" />}
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${NOTICE_CATEGORY_TONE[post.category]}`}>{post.category}</span>
              </div>
              <h1 className="mt-2 text-2xl font-bold leading-snug tracking-tight text-stone-900 sm:text-3xl">{post.title}</h1>
              <p className="mt-2 text-[12px] text-stone-500">
                {formatNoticeDate(post.published_at)}
                {post.updated_at && formatNoticeDate(post.updated_at) !== formatNoticeDate(post.published_at)
                  && <> · {formatNoticeDate(post.updated_at)} 수정</>}
              </p>
            </header>

            <div className="mt-6">
              {post.body_md.trim()
                ? <GuideMarkdown source={post.body_md} variant="paper" />
                : <p className="text-[13px] text-stone-500">본문이 없어요.</p>}
            </div>

            {post.attachments.length > 0 && (
              <section className="mt-8 space-y-2 rounded-2xl border border-stone-200 bg-white/70 p-4">
                <h2 className="text-[13px] font-semibold text-stone-900">첨부 파일</h2>
                <ul className="space-y-1.5">
                  {post.attachments.map((a) => (
                    <li key={a.url}>
                      <a href={a.url} target="_blank" rel="noopener noreferrer" download={a.name}
                        className="flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-2.5 text-[13px] text-stone-800 ring-1 ring-stone-200 hover:bg-white">
                        {a.type?.startsWith('image/') ? <ImageIcon size={15} className="shrink-0" /> : <FileText size={15} className="shrink-0" />}
                        <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                        {a.size ? <span className="shrink-0 text-[11px] text-stone-500">{formatFileSize(a.size)}</span> : null}
                        <Download size={13} className="shrink-0 text-stone-500" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <nav className="mt-10 divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-white/70 text-[13px]" aria-label="다른 공지">
              {post.next && (
                <Link to={`/notice/${post.next.no}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white">
                  <span className="flex shrink-0 items-center gap-1 text-stone-500"><ChevronUp size={14} /> 다음 글</span>
                  <span className="min-w-0 flex-1 truncate text-stone-900">{post.next.title}</span>
                </Link>
              )}
              {post.prev && (
                <Link to={`/notice/${post.prev.no}`} className="flex items-center gap-3 px-4 py-3 hover:bg-white">
                  <span className="flex shrink-0 items-center gap-1 text-stone-500"><ChevronDown size={14} /> 이전 글</span>
                  <span className="min-w-0 flex-1 truncate text-stone-900">{post.prev.title}</span>
                </Link>
              )}
              <Link to="/notice" className="block px-4 py-3 text-center font-semibold text-stone-700 hover:bg-white">목록으로</Link>
            </nav>
          </article>
        )}
      </div>
    </div>
  );
}
