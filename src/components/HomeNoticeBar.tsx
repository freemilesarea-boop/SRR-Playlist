/**
 * HomeNoticeBar — 홈 상단 최신 공지 한 줄 (공지사항 게시판 0566).
 *
 * 무엇을 띄우나: 공지 목록 순서 그대로 맨 앞 글 — 상단 고정 글이 있으면 그 글, 없으면 가장 최근 글.
 *   고정하지 않은 글은 게시 30일이 지나면 홈에서 내린다(오래된 소식이 계속 맨 위에 있지 않게).
 * 닫기: 같은 글은 이 기기에서 다시 안 띄운다. 새 공지가 올라오면 다시 보인다.
 * 공지가 없거나 불러오기에 실패하면 아무것도 그리지 않는다 — 홈은 그대로.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Megaphone, ChevronRight, X } from 'lucide-react';
import { listNoticePosts, formatNoticeDate, pickHomeNotice, type NoticePostSummary } from '@/lib/noticePostsApi';

const DISMISS_KEY = 'deudda.homeNotice.dismissedNo';
function readDismissed(): number | null {
  try {
    const v = window.localStorage.getItem(DISMISS_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export default function HomeNoticeBar() {
  const [notice, setNotice] = useState<NoticePostSummary | null>(null);

  useEffect(() => {
    let alive = true;
    listNoticePosts()
      .then((rows) => { if (alive) setNotice(pickHomeNotice(rows, readDismissed())); })
      .catch(() => { /* 홈은 공지 없이도 정상 */ });
    return () => { alive = false; };
  }, []);

  if (!notice) return null;

  function dismiss() {
    try { window.localStorage.setItem(DISMISS_KEY, String(notice!.no)); } catch { /* 저장 못 해도 이번엔 닫는다 */ }
    setNotice(null);
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-bg-card px-3 py-2 ring-1 ring-line/10" role="region" aria-label="최신 공지">
      <Megaphone size={15} className="shrink-0 text-accent" aria-hidden />
      <Link to={`/notice/${notice.no}`} className="group flex min-w-0 flex-1 items-center gap-2">
        <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">{notice.category}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium group-hover:text-accent">{notice.title}</span>
        <span className="hidden shrink-0 text-[11px] text-ink-dim sm:inline">{formatNoticeDate(notice.published_at)}</span>
      </Link>
      <Link to="/notice" className="hidden shrink-0 items-center text-[11px] font-semibold text-ink-mute hover:text-ink sm:inline-flex">
        전체 <ChevronRight size={12} />
      </Link>
      <button type="button" onClick={dismiss} aria-label="공지 닫기" title="이 공지 닫기"
        className="shrink-0 rounded p-1 text-ink-dim hover:bg-bg-hover hover:text-ink">
        <X size={13} />
      </button>
    </div>
  );
}
