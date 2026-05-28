import { Link, useLocation } from 'react-router-dom';
import { Search } from 'lucide-react';
import ThemeQuickToggle from './ThemeQuickToggle';

/** 경로 → 한국어 페이지명 매핑 (DEUDDA TopBar breadcrumb 용) */
function pageTitle(pathname: string): { eyebrow?: string; title: string } {
  const p = pathname.split('?')[0];
  if (p === '/' || p === '') return { title: '홈' };
  if (p.startsWith('/charts')) return { eyebrow: 'DISCOVER', title: '차트' };
  if (p.startsWith('/search')) return { eyebrow: 'SEARCH', title: '검색' };
  if (p.startsWith('/library')) return { eyebrow: 'YOU', title: '보관함' };
  if (p.startsWith('/my/playlists')) return { eyebrow: 'YOU', title: '내 플레이리스트' };
  if (p.startsWith('/my/playlist/')) return { eyebrow: 'YOU', title: '내 플레이리스트' };
  if (p.startsWith('/playlist/')) return { eyebrow: 'PLAYLIST', title: '플레이리스트' };
  if (p.startsWith('/track/')) return { eyebrow: 'TRACK', title: '곡 상세' };
  if (p.startsWith('/curator/')) return { eyebrow: 'CURATOR', title: '큐레이터' };
  if (p.startsWith('/business')) return { eyebrow: 'STORE', title: '매장 모드' };
  if (p.startsWith('/artist')) return { eyebrow: 'ARTIST', title: '아티스트 스튜디오' };
  if (p.startsWith('/curator/studio')) return { eyebrow: 'CURATOR', title: '큐레이터 스튜디오' };
  if (p.startsWith('/admin')) return { eyebrow: 'ADMIN', title: '관리자' };
  if (p.startsWith('/profile')) return { eyebrow: 'YOU', title: '내 정보' };
  if (p.startsWith('/subscription')) return { eyebrow: 'PLAN', title: '구독' };
  if (p.startsWith('/payment')) return { eyebrow: 'PLAN', title: '결제' };
  if (p.startsWith('/sales-partners')) return { eyebrow: 'PARTNERS', title: '영업 파트너스' };
  if (p.startsWith('/salesperson')) return { eyebrow: 'SALES', title: '영업 대시보드' };
  if (p.startsWith('/service')) return { eyebrow: 'SERVICE', title: '서비스' };
  if (p.startsWith('/notice')) return { eyebrow: 'INFO', title: '공지' };
  if (p.startsWith('/support')) return { eyebrow: 'INFO', title: '고객지원' };
  if (p.startsWith('/terms')) return { eyebrow: 'INFO', title: '이용약관' };
  if (p.startsWith('/privacy')) return { eyebrow: 'INFO', title: '개인정보' };
  return { title: '듣다' };
}

/**
 * DEUDDA TopBar — lg+ 에서만 노출되는 sticky 상단 바.
 * 좌측: 페이지 eyebrow + title.
 * 중앙: 검색 affordance (/search 로 이동).
 * 우측: ThemeQuickToggle.
 * 모바일은 기존 BottomNav 가 담당하므로 hidden.
 */
export default function TopBar() {
  const loc = useLocation();
  const { eyebrow, title } = pageTitle(loc.pathname);
  const onSearchPage = loc.pathname.startsWith('/search');

  return (
    <div className="sticky top-0 z-20 hidden lg:block pt-safe">
      <div className="flex items-center gap-3 border-b border-line/10 bg-bg-card/75 px-6 py-3 backdrop-blur-xl">
        {/* 좌측 — 페이지 타이틀 */}
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.22em] text-accent">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-[17px] font-bold tracking-tight">{title}</h1>
        </div>

        {/* 중앙/우측 — 검색 affordance */}
        {!onSearchPage && (
          <Link
            to="/search"
            className="group hidden items-center gap-2.5 rounded-xl bg-bg-soft/80 px-3.5 py-2 text-sm text-ink-mute ring-1 ring-line/10 transition-colors duration-smooth hover:bg-bg-hover hover:text-ink md:inline-flex"
          >
            <Search size={14} className="text-ink-dim group-hover:text-ink-mute" />
            <span>플레이리스트, 곡, 큐레이터 검색</span>
            <kbd className="ml-1 hidden rounded bg-bg/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim ring-1 ring-line/10 xl:inline-block">
              /search
            </kbd>
          </Link>
        )}

        {/* 우측 — theme toggle */}
        <div className="shrink-0">
          <ThemeQuickToggle />
        </div>
      </div>
    </div>
  );
}
