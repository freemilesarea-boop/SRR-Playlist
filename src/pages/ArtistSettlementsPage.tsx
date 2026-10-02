/**
 * /artist/settlements — 내 정산 내역 (독립 페이지).
 *
 * 본문은 SettlementContent 가 그린다. 대시보드 '정산' 탭과 같은 컴포넌트를 쓰므로
 * 한쪽만 고쳐지는 일이 없다. 이 라우트는 기존 링크·북마크 보존을 위해 유지한다.
 */
import { useEffect, useState } from 'react';
import { ArrowLeft, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getMySettlements, type MySettlementRow } from '@/lib/artistSettlementApi';
import SettlementContent from '@/components/artist/SettlementContent';
import { ALLOWED_ARTIST_STATUSES } from '@/components/artist/settlementDisplay';

export default function ArtistSettlementsPage() {
  const [rows, setRows] = useState<MySettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getMySettlements()
      // 0388 — 2중 방어선: 서버 RPC + RLS 가 pending 차단하지만, 만일을 위해 client 도 필터.
      .then((r) => alive && setRows(r.filter((row) => ALLOWED_ARTIST_STATUSES.has(row.status))))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="space-y-5 px-4 pb-8 pt-6 sm:px-6">
      <header className="flex items-center gap-3">
        <Link to="/artist" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card" aria-label="뒤로">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <Wallet size={20} /> 내 정산 내역
          </h1>
          <p className="text-xs text-ink-mute">
            매월 1회 정산서 발행 · 5만원 미만은 다음 달로 이월 · 3.3% 원천징수
          </p>
        </div>
      </header>

      <SettlementContent rows={rows} loading={loading} error={error} />
    </div>
  );
}
