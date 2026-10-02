/**
 * SettlementContent — 정산 내역 본문.
 *
 * 같은 내용을 /artist/settlements 페이지와 대시보드 '정산' 탭 양쪽에서 쓴다.
 * 중복 구현을 막으려고 본문만 떼어냈다 — 페이지 헤더는 쓰는 쪽이 각자 그린다.
 *
 * 데이터는 받아서 그린다(순수 표현). 대시보드는 이미 다른 데이터와 함께 한 번에
 * 불러오므로, 여기서 또 fetch 하면 같은 화면에서 두 번 조회하게 된다.
 *
 * 금액 계산은 전부 서버가 끝낸 값을 그대로 쓴다. 여기서 더하거나 빼지 않는다.
 */
import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import {
  getMySettlementDetail,
  type MySettlementRow,
  type SettlementItem,
} from '@/lib/artistSettlementApi';
import Alert from '@/components/Alert';
import EmptyState from '@/components/ui/EmptyState';
import { fmtKrw, fmtMonth, STATUS_TONE, STATUS_LABEL } from '@/components/artist/settlementDisplay';

export default function SettlementContent({
  rows,
  loading,
  error,
}: {
  rows: MySettlementRow[];
  loading: boolean;
  error?: string | null;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {error && <Alert tone="error" title="조회 실패">{error}</Alert>}

      {loading ? (
        <p className="py-12 text-center text-sm text-ink-mute">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="아직 정산 내역이 없어요"
          desc="관리자가 매월 정산서를 발행하면 이 화면에 표시됩니다. 보통 익월 15일 이내."
        />
      ) : (
        rows.map((r) => (
          <article
            key={r.id}
            className="cursor-pointer rounded-2xl bg-bg-card p-4 ring-1 ring-line/10 hover:bg-bg-hover"
            onClick={() => setDetailId(r.id)}
          >
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-base font-bold">{fmtMonth(r.settlement_month)}</h3>
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
        ))
      )}

      {detailId && <DetailModal id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function Kv({
  label, value, bold, accent, muted,
}: {
  label: string; value: string; bold?: boolean; accent?: boolean; muted?: boolean;
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
