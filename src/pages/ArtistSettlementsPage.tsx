import { useEffect, useState } from 'react';
import { ArrowLeft, Wallet, Eye } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  getMySettlements,
  getMySettlementDetail,
  type MySettlementRow,
  type SettlementItem,
  type SettlementStatus,
} from '@/lib/artistSettlementApi';
import Alert from '@/components/Alert';

function fmtKrw(n: number): string {
  return `₩${n.toLocaleString()}`;
}
function fmtMonth(s: string): string {
  return s.slice(0, 7);
}

// 0388 — 아티스트 노출 허용 status (관리자 확정 완료된 상태만).
// 'pending' (계산 중) 은 정책상 노출 금지 — 서버 RPC + RLS 가 1차 차단,
// 이 화면 필터링은 2중 방어선.
const ALLOWED_ARTIST_STATUSES: ReadonlySet<SettlementStatus> = new Set<SettlementStatus>([
  'carried_over', 'payable', 'paid', 'held', 'disputed',
]);

const STATUS_TONE: Record<SettlementStatus, string> = {
  pending: 'bg-ink/10 text-ink-dim',  // 노출 안 됨 — 안전 default
  carried_over: 'bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-200',
  payable: 'bg-sky-100 text-sky-900 dark:bg-sky-500/25 dark:text-sky-200',
  paid: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/25 dark:text-emerald-300',
  held: 'bg-yellow-100 text-yellow-900 dark:bg-yellow-500/25 dark:text-yellow-200',
  disputed: 'bg-red-100 text-red-900 dark:bg-red-500/25 dark:text-red-300',
};

const STATUS_LABEL: Record<SettlementStatus, string> = {
  pending: '확정 대기',                 // 노출되지 않지만, 만약 통과 시 "실시간" 단어 사용 금지
  carried_over: '5만원 미만 → 이월',
  payable: '지급 예정',
  paid: '지급 완료',
  held: '보류',
  disputed: '분쟁',
};

export default function ArtistSettlementsPage() {
  const [rows, setRows] = useState<MySettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

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
        <Link to="/artist" className="flex h-9 w-9 items-center justify-center rounded-full bg-bg-card">
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

      {error && <Alert tone="error" title="조회 실패">{error}</Alert>}

      {loading ? (
        <p className="py-12 text-center text-sm text-ink-mute">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <Alert tone="info" title="아직 정산 내역이 없어요">
          관리자가 매월 정산서를 발행하면 이 화면에 표시됩니다. 보통 익월 15일 이내.
        </Alert>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <article
              key={r.id}
              className="cursor-pointer rounded-2xl bg-bg-card p-4 ring-1 ring-line/10 hover:bg-bg-hover"
              onClick={() => setDetailId(r.id)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="text-base font-bold">{fmtMonth(r.settlement_month)}</h2>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_TONE[r.status]}`}>
                  {STATUS_LABEL[r.status]}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Kv label="당월 net" value={fmtKrw(r.artist_net_settlement)} />
                <Kv label="직전월 이월" value={r.previous_carried_amount > 0 ? `+${fmtKrw(r.previous_carried_amount)}` : '—'} />
                <Kv label="총 정산액" value={fmtKrw(r.total_settlement_amount)} bold />
                {r.meets_min_payout ? (
                  <Kv label="최종 지급액" value={fmtKrw(r.final_payout_amount)} accent bold />
                ) : (
                  <Kv label="다음달 이월" value={fmtKrw(r.carried_over_amount)} muted />
                )}
              </div>
              <button className="mt-2 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                <Eye size={12} /> 상세 보기
              </button>
            </article>
          ))}
        </div>
      )}

      {detailId && (
        <DetailModal id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  );
}

function Kv({
  label,
  value,
  bold,
  accent,
  muted,
}: {
  label: string;
  value: string;
  bold?: boolean;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-md bg-bg-soft px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-ink-dim">{label}</p>
      <p
        className={`mt-0.5 tabular-nums ${bold ? 'font-bold' : ''} ${accent ? 'text-accent' : ''} ${muted ? 'text-ink-mute' : ''}`}
      >
        {value}
      </p>
    </div>
  );
}

function DetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<{
    settlement: Record<string, unknown>;
    items: SettlementItem[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    getMySettlementDetail(id)
      .then((d) => alive && setData(d))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-t-3xl bg-bg-soft p-5 ring-1 ring-line/15 sm:rounded-3xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold">정산 상세</h3>
          <button onClick={onClose} className="rounded-full p-1.5 hover:bg-ink/5">
            ✕
          </button>
        </div>
        {loading ? (
          <p className="py-12 text-center text-sm text-ink-mute">불러오는 중…</p>
        ) : !data ? (
          <Alert tone="error">조회 실패</Alert>
        ) : (
          <>
            {/* 0492: 원시 JSON 대신 산출 내역. 이월과 보정은 성격이 다른 돈이라 따로 보여준다
                (합쳐 보이던 탓에 "지급 완료인데 이월금 있음"으로 읽히는 오독이 있었다). */}
            <dl className="space-y-1 rounded-xl bg-bg-card p-3 text-xs ring-1 ring-line/10">
              <DetailRow label="당월 정산액 (net)" value={num(data.settlement.artist_net_settlement)} />
              <DetailRow label="직전월 이월금" value={num(data.settlement.previous_carried_amount)} signed />
              {num(data.settlement.adjustment_amount) !== 0 && (
                <DetailRow label="보정 (소급 정산)" value={num(data.settlement.adjustment_amount)} signed />
              )}
              <div className="my-1 border-t border-line/20" />
              <DetailRow label="총 정산액" value={num(data.settlement.total_settlement_amount)} bold />
              {data.settlement.meets_min_payout ? (
                <>
                  <DetailRow label="원천징수" value={-num(data.settlement.withholding_tax_amount)} signed muted />
                  <DetailRow label="최종 지급액" value={num(data.settlement.final_payout_amount)} bold accent />
                </>
              ) : (
                <DetailRow label="다음 달 이월" value={num(data.settlement.carried_over_amount)} muted />
              )}
            </dl>
            <section>
              <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-mute">
                트랙별 상세 ({data.items.length})
              </h4>
              <ul className="divide-y divide-line/10 rounded-xl bg-bg-card text-xs ring-1 ring-line/10">
                {data.items.map((it, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 p-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{it.track_title}</p>
                      <p className="font-mono text-[10px] text-ink-mute">{it.track_code}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular-nums">{Number(it.stream_count ?? 0).toLocaleString()} 스트림</p>
                      <p className="tabular-nums font-bold">{`₩${Number(it.pool_revenue_share ?? 0).toLocaleString()}`}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/** settlement jsonb 의 숫자 필드를 안전하게 읽는다(RPC 는 Record<string, unknown> 반환). */
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function DetailRow({
  label, value, bold, accent, muted, signed,
}: {
  label: string; value: number;
  bold?: boolean; accent?: boolean; muted?: boolean; signed?: boolean;
}) {
  const text = signed && value !== 0
    ? `${value > 0 ? '+' : '−'}₩${Math.abs(value).toLocaleString('ko-KR')}`
    : `₩${value.toLocaleString('ko-KR')}`;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? 'text-ink-dim' : 'text-ink-mute'}>{label}</dt>
      <dd className={`tabular-nums ${bold ? 'font-bold' : ''} ${accent ? 'text-accent' : muted ? 'text-ink-dim' : 'text-ink'}`}>
        {text}
      </dd>
    </div>
  );
}
