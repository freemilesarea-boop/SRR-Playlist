import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, Pin, Paperclip } from 'lucide-react';
import LegalPageLayout from '@/components/common/LegalPageLayout';
import {
  listNoticePosts, formatNoticeDate, NOTICE_CATEGORIES, NOTICE_CATEGORY_TONE,
  type NoticePostSummary, type NoticeCategory,
} from '@/lib/noticePostsApi';

export default function NoticePage() {
  const [rows, setRows] = useState<NoticePostSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<NoticeCategory | ''>('');

  useEffect(() => {
    document.title = '공지사항 · 듣다';
    let alive = true;
    listNoticePosts()
      .then((r) => { if (alive) setRows(r); })
      .catch(() => { if (alive) { setFailed(true); setRows([]); } });
    return () => { alive = false; };
  }, []);

  const shown = useMemo(() => (rows ?? []).filter((r) => !filter || r.category === filter), [rows, filter]);
  const usedCategories = useMemo(
    () => NOTICE_CATEGORIES.filter((c) => (rows ?? []).some((r) => r.category === c)),
    [rows],
  );

  return (
    <LegalPageLayout title="공지사항" subtitle="듣다의 새 소식과 업데이트가 게시됩니다.">
      {rows === null && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-stone-200/60" />)}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-stone-200 bg-white/60 px-6 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100 text-stone-500">
            <Megaphone size={20} />
          </div>
          <h2 className="text-base font-semibold text-stone-900">
            {failed ? '공지사항을 불러오지 못했어요' : '아직 올라온 공지가 없어요'}
          </h2>
          <p className="text-[13px] text-stone-600">
            {failed ? '잠시 후 다시 시도해 주세요.' : '서비스 소식이 생기면 이곳에 올려 드릴게요.'}
          </p>
        </div>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="space-y-4">
          {usedCategories.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="분류">
              {(['', ...usedCategories] as const).map((c) => (
                <button key={c || 'all'} type="button" role="tab" aria-selected={filter === c} onClick={() => setFilter(c)}
                  className={`rounded-full px-3 py-1 text-[12px] font-semibold transition ${
                    filter === c ? 'bg-stone-900 text-white' : 'bg-white/70 text-stone-600 ring-1 ring-stone-200 hover:text-stone-900'}`}>
                  {c || '전체'}
                </button>
              ))}
            </div>
          )}
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-2xl border border-stone-200 bg-white/70">
            {shown.map((n) => (
              <li key={n.no}>
                <Link to={`/notice/${n.no}`}
                  className={`flex flex-col gap-1 px-4 py-3.5 transition hover:bg-white sm:flex-row sm:items-center sm:gap-3 ${n.is_pinned ? 'bg-stone-50' : ''}`}>
                  <span className="flex shrink-0 items-center gap-1.5 sm:w-[92px]">
                    {n.is_pinned && <Pin size={12} className="text-stone-900" aria-label="고정" />}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${NOTICE_CATEGORY_TONE[n.category]}`}>
                      {n.category}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[14px] text-stone-900 ${n.is_pinned ? 'font-bold' : 'font-medium'}`}>{n.title}</span>
                    {n.excerpt && <span className="mt-0.5 block truncate text-[12px] text-stone-500">{n.excerpt}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-[12px] text-stone-500">
                    {n.attachment_count > 0 && <Paperclip size={12} aria-label={`첨부 ${n.attachment_count}개`} />}
                    {formatNoticeDate(n.published_at)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </LegalPageLayout>
  );
}
